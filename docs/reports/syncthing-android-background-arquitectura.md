# Ingeniería inversa: motor de sincronización en background de `syncthing-android`

**Repositorio analizado:** [syncthing/syncthing-android](https://github.com/syncthing/syncthing-android) (archivado, último release v1.28.1 — `versionCode 4395`, `minSdk 21`, `targetSdk 33`)
**Alcance:** motor de ejecución en segundo plano (servicio, ciclo de vida, condiciones de ejecución, wake locks, notificaciones, arranque en boot, apagado ordenado).
**Objetivo:** replicar esta funcionalidad en una app Android propia.

---

## 0. La idea central en una frase

Syncthing-Android **no implementa la sincronización**. Es un *wrapper*: empaqueta el binario nativo de Syncthing (escrito en Go) dentro del APK, lo lanza como **proceso hijo del sistema operativo**, y usa un `Service` de Android en primer plano únicamente como **supervisor de ciclo de vida** de ese proceso. Toda la lógica de sincronización con el computador (descubrimiento, TLS, protocolo BEP, resolución de conflictos) vive en el binario Go; la app Android sólo decide **cuándo el proceso debe estar vivo** y habla con él por **REST sobre HTTP a localhost**.

Esta separación es la decisión arquitectónica más importante del proyecto, y de ella se derivan casi todas las demás.

```mermaid
flowchart LR
    subgraph AND["📱 Android"]
      direction TB
      APP["App Java/Kotlin<br/>(supervisor + UI)"]
      BIN["libsyncthing.so<br/>(binario Go, proceso aparte)"]
      APP -->|"lanza / mata proceso"| BIN
      APP <-->|"REST + eventos<br/>https://127.0.0.1:8384"| BIN
    end
    subgraph PC["💻 Computador"]
      STPC["syncthing (daemon)"]
    end
    BIN <==>|"protocolo BEP sobre TLS 1.3<br/>puerto 22000 · descubrimiento local/global"| STPC

    style APP fill:#e3f2fd,stroke:#1565c0
    style BIN fill:#fff3e0,stroke:#e65100
    style STPC fill:#e8f5e9,stroke:#2e7d32
```

> **Implicación para ti:** si vas a sincronizar con un computador, la pregunta previa a toda la arquitectura es *¿qué corre el trabajo real?* Un binario nativo empaquetado (como aquí), una librería Kotlin propia, o un cliente de un protocolo existente. El patrón de supervisión que documento abajo es reutilizable en los tres casos; sólo cambia qué hay al otro lado del "lanza / mata proceso".

---

## 1. Diagrama de componentes

```mermaid
flowchart TB
    subgraph PROC["Proceso de la app (com.nutomic.syncthingandroid)"]

        subgraph UI["Capa UI (opcional, la app funciona sin ella)"]
            ACT["SyncthingActivity<br/><i>bindService(BIND_AUTO_CREATE)</i>"]
            MAIN["MainActivity / SettingsActivity"]
        end

        subgraph SVC["Capa de servicio — el motor de background"]
            SS["<b>SyncthingService</b><br/>Service · START_STICKY<br/>máquina de estados<br/>orquestador único"]
            BIND["SyncthingServiceBinder"]
            RCM["<b>RunConditionMonitor</b><br/>decide shouldRun"]
            NH["<b>NotificationHandler</b><br/>notificación persistente<br/>startForeground()"]
            SR["<b>SyncthingRunnable</b><br/>Runnable en Thread propio<br/>ProcessBuilder + WakeLock"]
            EP["<b>EventProcessor</b><br/>long-poll de eventos c/15s"]
            API["<b>RestApi</b><br/>caché de config/estado"]
            RM["ReceiverManager<br/>(registro dinámico de receivers)"]
        end

        subgraph UTIL["Soporte"]
            CFG["ConfigXml<br/>lee/escribe config.xml"]
            POLL["PollWebGuiAvailableTask<br/>poll c/100ms hasta 200 OK"]
            HTTP["ApiRequest (Volley)<br/>+ SyncthingTrustManager"]
            CONST["Constants<br/>claves de SharedPreferences"]
        end

        subgraph RCV["BroadcastReceivers (estáticos, en manifest)"]
            BR["BootReceiver<br/>BOOT_COMPLETED<br/>MY_PACKAGE_REPLACED"]
            ACR["AppConfigReceiver<br/>action.START / action.STOP<br/>(exported: automatización)"]
        end

        DAG["SyncthingApp + Dagger<br/>inyecta SharedPreferences<br/>y NotificationHandler"]
    end

    NATIVE["<b>libsyncthing.so</b><br/>proceso hijo del SO<br/>(no es una librería JNI)"]

    ACT -->|bind| BIND --> SS
    MAIN -->|"evaluateRunConditions()"| SS
    BR -->|"startForegroundService()"| SS
    ACR -->|"start / stop"| SS

    SS -->|"crea, escucha callback"| RCM
    RCM -.->|"onRunConditionChanged(result)"| SS
    SS --> NH
    SS -->|"new Thread(runnable).start()"| SR
    SS --> API
    SS --> EP
    SS --> CFG
    SS --> POLL

    RCM --> RM
    SR -->|"ProcessBuilder.start()"| NATIVE
    SR -->|"kill -SIGINT / -SIGKILL"| NATIVE
    SR -.->|"exit code 1 o 3 →<br/>Intent ACTION_RESTART"| SS
    POLL -->|"GET /rest/system/ping"| NATIVE
    API -->|"REST + X-API-Key"| NATIVE
    EP -->|"GET /rest/events?since=N"| API
    API --> HTTP
    CFG -->|"lanza con -generate"| NATIVE

    style SS fill:#1565c0,color:#fff
    style RCM fill:#ef6c00,color:#fff
    style SR fill:#6a1b9a,color:#fff
    style NATIVE fill:#2e7d32,color:#fff
    style NH fill:#c62828,color:#fff
```

### Responsabilidad de cada componente

| Componente | Responsabilidad única | Por qué está separado |
|---|---|---|
| `SyncthingService` | Orquestador. Es el **único** que cambia de estado y el único que decide arrancar/parar el binario. | Un solo punto de verdad evita carreras entre UI, receivers y monitor de condiciones. |
| `RunConditionMonitor` | Responde una sola pregunta: *¿debe correr ahora?* Devuelve `SHOULD_RUN` o una lista de `BlockerReason`. | Aísla toda la política (WiFi/datos/batería/ahorro de energía) del mecanismo. Testeable y sustituible. |
| `SyncthingRunnable` | Lanza, vigila y mata el proceso nativo. Mantiene el `WakeLock`. | Encapsula todo lo que es "sistema operativo", incluido el `su` opcional. |
| `NotificationHandler` | Es quien llama a `startForeground()` / `stopForeground()`. | La notificación **es** el mecanismo que mantiene vivo el servicio; centralizarlo evita el crash por `startForeground` tardío. |
| `EventProcessor` | Traduce eventos del núcleo Syncthing a acciones Android (notificaciones de consentimiento, MediaScanner). | Es el puente evento-núcleo → mundo Android. |
| `RestApi` | Cliente REST + caché de config y estado. | La UI nunca toca el binario directamente. |
| `PollWebGuiAvailableTask` | Detecta *cuándo* el binario terminó de arrancar. | El binario tarda un tiempo indeterminado; no hay callback, hay que sondear. |

---

## 2. Máquina de estados del servicio

Todo el motor gira alrededor de cinco estados (`SyncthingService.State`). El campo `mCurrentState` está protegido por `mStateLock`.

```mermaid
stateDiagram-v2
    [*] --> DISABLED : onCreate()<br/><i>arranca en DISABLED a propósito</i>

    DISABLED --> INIT : shouldRun = true<br/>(shutdown defensivo previo)
    INIT --> STARTING : launchStartupTask()<br/>StartupTask termina OK
    STARTING --> ACTIVE : onApiAvailable()<br/>(config + version + systemInfo leídos)
    STARTING --> ERROR : OpenConfigException

    ACTIVE --> DISABLED : shouldRun = false<br/>(WiFi perdido, batería, etc.)
    ACTIVE --> INIT : ACTION_RESTART<br/>ACTION_RESET_DATABASE<br/>ACTION_RESET_DELTAS
    ACTIVE --> [*] : onDestroy()

    STARTING --> STARTING : onDestroy() durante arranque<br/>→ mDestroyScheduled = true

    ERROR --> INIT : reintento manual

    note right of DISABLED
        Servicio VIVO en foreground,
        binario MUERTO.
        Sigue escuchando cambios
        de condiciones.
    end note

    note right of ACTIVE
        Binario vivo, REST disponible,
        RestApi con caché poblada.
        EventProcessor corriendo.
    end note
```

### El detalle que la mayoría de la gente pasa por alto

`DISABLED` **no significa "servicio muerto"**. Significa "servicio en primer plano, con notificación visible, binario apagado, escuchando cambios de red y batería para volver a encender". Esta es la clave de todo el diseño de background:

> El servicio Android vive **siempre**; lo que se enciende y apaga es el proceso de sincronización.

Si el servicio se muriera cuando no hay que sincronizar, nadie recibiría el broadcast de "volvió el WiFi" en Android 8+, y la sincronización nunca se reanudaría sola.

Por eso el estado inicial es `DISABLED` y no `INIT` — el comentario en el código lo explica: `mLastDeterminedShouldRun` arranca en `false`, así que si `RunConditionMonitor` no manda un `shouldRun = true` poco después de instanciarse, la UI debe ver `DISABLED` y no quedarse colgada en un spinner.

---

## 3. Diagramas de secuencia

### 3.1 Arranque completo — desde `BOOT_COMPLETED` hasta `ACTIVE`

Este es el flujo principal. Nota el **shutdown defensivo antes de arrancar** y el **doble asincronismo** (AsyncTask para config, Thread para el proceso, polling para detectar disponibilidad).

```mermaid
sequenceDiagram
    autonumber
    participant OS as Android OS
    participant BR as BootReceiver
    participant SS as SyncthingService
    participant NH as NotificationHandler
    participant RCM as RunConditionMonitor
    participant ST as StartupTask<br/>(AsyncTask)
    participant CFG as ConfigXml
    participant SR as SyncthingRunnable<br/>(Thread)
    participant BIN as libsyncthing.so
    participant POLL as PollWebGuiAvailable
    participant API as RestApi
    participant EP as EventProcessor

    OS->>BR: BOOT_COMPLETED
    BR->>BR: ¿pref always_run_in_background?
    alt preferencia desactivada
        BR-->>OS: return (no hace nada)
    end
    BR->>SS: startForegroundService(Intent)

    SS->>SS: onCreate() → Dagger inject<br/>chequea permiso de storage
    Note over SS: si el permiso fue revocado:<br/>notificación + stopSelf() + START_NOT_STICKY

    SS->>SS: onStartCommand()
    SS->>SS: onServiceStateChange(DISABLED)
    SS->>RCM: new RunConditionMonitor(this, ::onUpdatedShouldRunDecision)

    RCM->>OS: registerReceiver(NetworkReceiver, CONNECTIVITY_ACTION)
    RCM->>OS: registerReceiver(BatteryReceiver, POWER_CONNECTED/DISCONNECTED)
    RCM->>OS: registerReceiver(PowerSaveModeChangedReceiver)
    RCM->>OS: ContentResolver.addStatusChangeListener(SYNC_OBSERVER_TYPE_SETTINGS)
    RCM->>RCM: updateShouldRunDecision()

    SS->>NH: updatePersistentNotification()
    NH->>SS: startForeground(ID_PERSISTENT_WAITING, notif)
    Note over NH,SS: ⏱ CRÍTICO: startForeground debe ocurrir<br/>en los primeros ~5s tras startForegroundService()

    RCM-->>SS: onRunConditionChanged(SHOULD_RUN)
    SS->>SS: onUpdatedShouldRunDecision(result)
    Note over SS: mLastDeterminedShouldRun: false → true

    rect rgb(255, 243, 224)
    Note over SS,BIN: 🔒 Shutdown DEFENSIVO antes de arrancar
    SS->>SS: shutdown(State.INIT, callback)
    SS->>SR: killSyncthing() sobre instancia previa (si la hay)
    Note over SS: comentario del código: "HACK: asegurar que no quedó<br/>un binario huérfano de un cierre impropio (ej. update de Play Store)"
    end

    SS->>SS: onServiceStateChange(STARTING)
    SS->>ST: executeOnExecutor(THREAD_POOL_EXECUTOR)

    activate ST
    ST->>CFG: new ConfigXml(context)
    alt primer arranque (config.xml no existe)
        CFG->>BIN: exec: libsyncthing.so -generate <filesDir>
        BIN-->>CFG: genera key.pem, cert.pem, config.xml
        CFG->>BIN: exec: libsyncthing.so --device-id
        BIN-->>CFG: XXXXXXX-XXXXXXX-... (device ID)
        CFG->>CFG: fija nombre de dispositivo + carpeta por defecto
    end
    ST->>CFG: updateIfNeeded()
    Note over CFG: fuerza gui.address, apikey aleatoria,<br/>usuario/password bcrypt, tls=true
    deactivate ST

    ST-->>SS: onPostExecute → onStartupTaskCompleteListener()

    SS->>API: new RestApi(url, apiKey, ::onApiAvailable, ...)
    SS->>SR: new SyncthingRunnable(ctx, Command.main)
    SS->>SR: new Thread(runnable).start()

    activate SR
    SR->>SR: trimLogFile() · chmod 500 binario
    SR->>OS: PowerManager.newWakeLock(PARTIAL_WAKE_LOCK)<br/>(sólo si pref wakelock_while_binary_running)
    SR->>SR: buildEnvironment()<br/>HOME, STTRACE, STNOUPGRADE=1,<br/>STMONITORED=1, STHASHING=minio, proxies
    SR->>BIN: ProcessBuilder(binario, -home, -no-browser, -logflags=0).start()
    SR->>SR: 2 threads leen stdout/stderr → logcat + syncthing.log
    SR->>SR: process.waitFor()  ⟵ BLOQUEA aquí
    Note over SR,BIN: el hilo queda bloqueado aquí<br/>mientras el binario vive
    deactivate SR

    SS->>POLL: new PollWebGuiAvailableTask(url, apiKey, listener)
    loop cada 100 ms hasta éxito
        POLL->>BIN: GET /rest/system/ping
        BIN-->>POLL: ConnectException (aún arrancando)
    end
    BIN-->>POLL: 200 OK
    POLL-->>SS: listener.onSuccess()

    SS->>API: readConfigFromRestApi()
    par 3 peticiones en paralelo
        API->>BIN: GET /rest/system/version
    and
        API->>BIN: GET /rest/config
    and
        API->>BIN: GET /rest/system/status
    end
    Note over API: cada callback marca su flag —<br/>checkReadConfigFromRestApiCompleted()<br/>dispara sólo cuando las 3 terminaron

    API-->>SS: onApiAvailable()
    SS->>SS: onServiceStateChange(ACTIVE)
    SS->>NH: updatePersistentNotification()
    NH->>SS: startForeground(ID_PERSISTENT, "Syncthing activo")
    Note over NH: cambia de canal e ID:<br/>ID_PERSISTENT_WAITING → ID_PERSISTENT

    SS->>EP: new EventProcessor(ctx, api) · start()
    Note over EP: postDelayed(this, 15s)

    Note over SS,BIN: ✅ Sincronizando con el computador
```

**Puntos de diseño que vale la pena robar:**

1. **`startForeground()` se llama antes de que exista nada que mostrar.** No espera a que el binario arranque. Android 8+ mata la app si `startForegroundService()` no va seguido de `startForeground()` en pocos segundos.
2. **Dos IDs de notificación distintos** (`ID_PERSISTENT` = 1 y `ID_PERSISTENT_WAITING` = 4) en dos canales distintos. El comentario del código explica el porqué: si el usuario oculta uno de los canales, `startForeground()` no actualizaría la notificación sino que reutilizaría la vieja. Usando IDs separados, siempre se muestra el correcto y se cancela el otro.
3. **El polling a 100 ms** es agresivo pero acotado: sólo dura lo que tarda el binario en levantar el servidor HTTP (~1-3 s). Es más simple y más rápido que un backoff exponencial para esta ventana.
4. **`checkReadConfigFromRestApiCompleted()`** es un contador de fan-in de 3 peticiones paralelas. El comentario dice explícitamente que se hizo así para no bloquear el hilo principal con peticiones REST síncronas.

---

### 3.2 Decisión de ejecución — el corazón del "background inteligente"

```mermaid
sequenceDiagram
    autonumber
    participant OS as Android OS
    participant NR as NetworkReceiver
    participant BR2 as BatteryReceiver
    participant PSR as PowerSaveReceiver
    participant SO as SyncStatusObserver
    participant RCM as RunConditionMonitor
    participant PREF as SharedPreferences
    participant SS as SyncthingService

    Note over OS: el usuario sale de casa,<br/>se pierde el WiFi

    OS->>NR: CONNECTIVITY_ACTION
    NR->>RCM: updateShouldRunDecision()

    Note over BR2: ACTION_POWER_CONNECTED /<br/>DISCONNECTED → postDelayed 5000ms<br/>(el estado de batería tarda en estabilizarse)
    Note over PSR: ACTION_POWER_SAVE_MODE_CHANGED
    Note over SO: toggle "Autosincronizar" del sistema

    RCM->>RCM: decideShouldRun()
    RCM->>PREF: lee 10 preferencias de run conditions

    rect rgb(232, 245, 233)
    Note over RCM: Evaluación en cascada:<br/>1. ¿static_run_conditions desactivado? → SHOULD_RUN<br/>2. power_source vs isCharging() → ON_BATTERY / ON_CHARGER<br/>3. respect_battery_saving && isPowerSaveMode() → POWERSAVING_ENABLED<br/>4. respect_master_sync && !getMasterSyncAutomatically() → GLOBAL_SYNC_DISABLED<br/>5. run_on_mobile_data && isMobileData() → SHOULD_RUN<br/>6. run_on_wifi && isWifiOrEthernet() → chequea metered + whitelist SSID<br/>7. run_in_flight_mode && isFlightMode() → SHOULD_RUN<br/>8. ninguna coincide → deduce el blocker más informativo
    end

    RCM-->>RCM: RunConditionCheckResult([NO_WIFI_CONNECTION])

    alt el resultado cambió respecto al anterior
        RCM->>SS: onRunConditionChanged(result)
        SS->>SS: mCurrentCheckResult.getAndSet(result)
        SS->>SS: notifica OnRunConditionCheckResultListener (para la UI)
        alt shouldRun cambió de true a false
            SS->>SS: shutdown(State.DISABLED, {})
            Note over SS: binario muerto,<br/>servicio SIGUE en foreground
        end
    else resultado idéntico
        Note over RCM: no hace nada — evita<br/>reinicios en cascada por broadcasts duplicados
    end
```

**El patrón clave: `RunConditionCheckResult` no es un booleano.** Es `shouldRun` **más la lista de razones por las que no**, y tiene `equals()` implementado sobre ambos campos. Esto permite dos cosas a la vez:

- **Deduplicación:** los broadcasts de conectividad llegan por docenas; sólo se actúa cuando la *decisión* cambia, no cuando llega el evento.
- **UI honesta:** la app puede mostrar *"Detenido: no hay WiFi"* en vez de un genérico "desactivado". Cada `BlockerReason` lleva su `@StringRes`.

```java
// El enum con su mensaje asociado — patrón muy limpio para replicar
public enum BlockerReason {
    ON_BATTERY(R.string.syncthing_disabled_reason_on_battery),
    ON_CHARGER(R.string.syncthing_disabled_reason_on_charger),
    POWERSAVING_ENABLED(R.string.syncthing_disabled_reason_powersaving),
    GLOBAL_SYNC_DISABLED(R.string.syncthing_disabled_reason_android_sync_disabled),
    WIFI_SSID_NOT_WHITELISTED(...), WIFI_WIFI_IS_METERED(...),
    NO_NETWORK_OR_FLIGHTMODE(...), NO_MOBILE_CONNECTION(...),
    NO_WIFI_CONNECTION(...), NO_ALLOWED_NETWORK(...);
}
```

---

### 3.3 Bucle de eventos — cómo la app se entera de lo que pasa

```mermaid
sequenceDiagram
    autonumber
    participant EP as EventProcessor
    participant H as Handler<br/>(main looper)
    participant API as RestApi
    participant BIN as libsyncthing.so
    participant NH as NotificationHandler
    participant MS as MediaScanner
    participant PREF as SharedPreferences

    Note over EP: start() → postDelayed(this, 15s)

    loop cada ≥15 s, sin despertar el dispositivo
        H->>EP: run()
        EP->>PREF: lee last_sync_id (persistido)
        EP->>API: getEvents(since=0, limit=1)
        API->>BIN: GET /rest/events?since=0&limit=1
        BIN-->>API: [{id: N, ...}]
        alt N < mLastEventId
            EP->>EP: mLastEventId = 0
            Note over EP: los IDs corrieron hacia atrás<br/>⇒ el binario se reinició, hay que empezar de cero
        end

        EP->>API: getEvents(since=mLastEventId, limit=0)
        API->>BIN: GET /rest/events?since=M
        BIN-->>API: [ evento, evento, ... ]

        loop por cada evento
            API-->>EP: onEvent(event)
            alt "ConfigSaved"
                EP->>API: reloadConfig()
            else "PendingDevicesChanged"
                EP->>NH: showConsentNotification("dispositivo X quiere conectar",<br/>PendingIntent Aceptar, PendingIntent Ignorar)
            else "PendingFoldersChanged"
                EP->>NH: showConsentNotification("X quiere compartir carpeta Y", ...)
            else "FolderCompletion"
                EP->>API: setCompletionInfo(device, folder, %)
            else "ItemFinished"
                EP->>MS: scanFile(archivo)
                Note over MS: para que la galería vea<br/>los archivos recién sincronizados.<br/>En Android 10+ el borrado NO se propaga<br/>(bug #1801: borraba archivos de verdad)
            else evento ignorado
                Note over EP: DeviceConnected, StateChanged,<br/>DownloadProgress, Ping...
            end
        end

        API-->>EP: onDone(lastId)
        EP->>PREF: putLong("last_sync_id", lastId).apply()
        Note over EP: se persiste por si Android nos mata
        EP->>H: removeCallbacks(this) + postDelayed(this, 15s)
    end
```

**Decisiones notables:**

- **`Handler.postDelayed`, no `AlarmManager`.** El comentario lo dice literalmente: *"Este intervalo no despertará el dispositivo para ahorrar batería"*. Si el teléfono está en Doze, el poll simplemente no ocurre — y no pasa nada, porque el binario Go sigue teniendo su propio estado. Los eventos no se pierden: se acumulan y se leen al siguiente ciclo gracias a `since=<lastEventId>`.
- **El `lastEventId` se persiste en `SharedPreferences`** en cada ciclo. Si Android mata el proceso, al volver no se reprocesan eventos viejos ni se pierden los nuevos.
- **`removeCallbacks` antes de cada `postDelayed`** garantiza que nunca haya dos pollers concurrentes.
- **El chequeo de "IDs hacia atrás"** es el detector de reinicio del binario. Elegante y barato.

---

### 3.4 Reinicio del binario y manejo de crashes

```mermaid
sequenceDiagram
    autonumber
    participant SR as SyncthingRunnable<br/>(Thread bloqueado en waitFor)
    participant BIN as libsyncthing.so
    participant SS as SyncthingService
    participant NH as NotificationHandler

    Note over SR,BIN: el hilo lleva horas bloqueado en process.waitFor()

    BIN-->>SR: el proceso termina, devuelve exit code
    SR->>SR: mSyncthing.set(null) · join() de los hilos de log
    SR->>SR: wakeLock.release() · process.destroy()

    alt exit code 0 ó 137
        Note over SR: apagado limpio (API o SIGKILL) — no hacer nada
    else exit code 1
        Note over SR: "ya hay otra instancia corriendo"<br/>→ cae al caso 3
        SR->>SS: startService(ACTION_RESTART)
    else exit code 3
        Note over SR: reinicio pedido vía REST<br/>(ej. el usuario cambió config en la Web GUI)
        SR->>SS: startService(ACTION_RESTART)
        SS->>SS: shutdown(INIT) → launchStartupTask()
    else cualquier otro código
        SR->>NH: showCrashedNotification(R.string.notification_crash_title)
        Note over NH: sólo si pref "notify_crashes"<br/>abre LogActivity al tocarla
    end
```

**El binario se auto-reinicia por intención propia.** Cuando cambias la configuración desde la Web GUI, el núcleo Syncthing sale con código 3 y espera que su supervisor lo relance. La app implementa exactamente ese contrato — y lo hace **mandándose un Intent a sí misma** (`ACTION_RESTART`), no llamando a un método. Eso serializa el reinicio en el mismo `onStartCommand` que atiende todo lo demás, evitando carreras.

---

### 3.5 Apagado ordenado (y el caso feo: apagar mientras arranca)

```mermaid
sequenceDiagram
    autonumber
    participant OS as Android OS
    participant SS as SyncthingService
    participant RCM as RunConditionMonitor
    participant NH as NotificationHandler
    participant POLL as PollWebGuiAvailable
    participant EP as EventProcessor
    participant API as RestApi
    participant SR as SyncthingRunnable
    participant BIN as libsyncthing.so

    OS->>SS: onDestroy()
    SS->>RCM: shutdown()
    RCM->>RCM: removeStatusChangeListener()
    RCM->>OS: unregisterAllReceivers()
    Note over RCM: primero se apaga el monitor:<br/>no queremos eventos de condición<br/>durante el apagado

    SS->>NH: setAppShutdownInProgress(true)

    alt mCurrentState == STARTING
        SS->>SS: mDestroyScheduled = true
        Note over SS: ⚠️ NO se apaga ahora.<br/>Se espera a onApiAvailable() para<br/>que el binario pueda cerrarse limpio.
        SS-->>OS: (retorna)
        Note over SS: ...más tarde...
        API-->>SS: onApiAvailable()
        SS->>SS: stopSelf()
    else cualquier otro estado
        SS->>SS: shutdown(DISABLED, {})
    end

    rect rgb(255, 235, 238)
    Note over SS,BIN: shutdown() — orden estricto de desmontaje
    SS->>POLL: cancelRequestsAndCallback()
    SS->>EP: stop()
    SS->>API: shutdown()
    SS->>SR: killSyncthing()
    loop 2 intentos
        SR->>SR: getSyncthingPIDs() vía `ps | grep libsyncthing.so`
        alt primer intento
            SR->>BIN: kill -SIGINT <pid> · sleep 1s
            Note over BIN: apagado limpio:<br/>flush de índices a disco
        else segundo intento
            SR->>SR: sleep 3s
            SR->>BIN: kill -SIGKILL <pid>
        end
    end
    SS->>SS: mSyncthingRunnableThread.join()
    SS->>SS: mStartupTask.cancel(true) + get()
    end

    SS->>SS: onKilledListener.onKilled()
```

**Dos cosas que casi nadie hace bien y aquí sí:**

1. **`mDestroyScheduled`.** Si te matan mientras estás arrancando, no puedes apagar el binario limpiamente (aún no sabes ni su PID ni si terminó de escribir su base de datos). La solución es aplazar el `stopSelf()` hasta que el arranque complete. El comentario del código lo documenta explícitamente.
2. **SIGINT antes de SIGKILL, con espera.** Un `SIGKILL` directo sobre Syncthing corrompe los índices. El flujo es: SIGINT → 1 s → ¿sigue vivo? → 3 s → SIGKILL. Y todo esto identificando los PIDs por `ps`, no por el handle del `Process`, porque con `su` el proceso hijo real es otro.

---

### 3.6 Cómo se conecta la UI (y por qué la UI es opcional)

```mermaid
sequenceDiagram
    autonumber
    participant A as SyncthingActivity
    participant OS as Android OS
    participant SS as SyncthingService
    participant B as SyncthingServiceBinder

    A->>OS: onResume() → bindService(Intent, this, BIND_AUTO_CREATE)
    OS->>SS: onBind()
    SS-->>B: return mBinder
    B-->>A: onServiceConnected(binder)
    A->>B: getService()
    A->>SS: registerOnServiceStateChangeListener(this)
    SS-->>A: onServiceStateChange(mCurrentState)
    Note over SS,A: se notifica INMEDIATAMENTE con el estado actual,<br/>para que la UI no muestre "desactivado" mientras arranca

    A->>SS: registerOnRunConditionCheckResultChange(this)
    SS-->>A: onRunConditionCheckResultChanged(result)
    Note over A: muestra "Detenido: no hay WiFi"

    Note over A,SS: ... el usuario usa la app ...

    A->>OS: onPause() → unbindService(this)
    Note over SS: el servicio NO muere:<br/>fue arrancado con startService/startForegroundService,<br/>no sólo con bind
```

La combinación **`startForegroundService()` + `bindService(BIND_AUTO_CREATE)`** es deliberada: `startService` da la vida larga (el servicio sobrevive a que se cierre la UI) y `bind` da el canal de comunicación directo mientras hay UI. Los listeners se notifican inmediatamente al registrarse, para que la UI nunca parpadee con un estado obsoleto.

---

## 4. Cómo se mantiene vivo: el inventario completo de mecanismos

| Mecanismo | Dónde | Qué consigue |
|---|---|---|
| `startForeground()` **siempre** en Android 8+ | `NotificationHandler.updatePersistentNotification()` | Prioridad de proceso alta + **capacidad de recibir broadcasts implícitos**. Sin esto, en Android 8+ no llegaría `CONNECTIVITY_ACTION`. |
| `START_STICKY` | `SyncthingService.onStartCommand()` | Si el sistema mata el servicio por memoria, lo relanza con Intent nulo. |
| `START_NOT_STICKY` cuando falta permiso de storage | idem | No reintentar algo que va a fallar siempre. |
| `BootReceiver` con `BOOT_COMPLETED` + `MY_PACKAGE_REPLACED` | manifest | Rearranque tras reiniciar el teléfono **y tras actualizar la app**. |
| `PARTIAL_WAKE_LOCK` | `SyncthingRunnable.run()` | CPU despierta con la pantalla apagada. **Opt-in** (`wakelock_while_binary_running`), desactivado por defecto. |
| Diálogo de exención de optimización de batería | `MainActivity`, con `isIgnoringBatteryOptimizations()` | Pide al usuario salir de Doze. Es un permiso especial, no se puede conceder solo. |
| Receivers **dinámicos** para red/batería | `RunConditionMonitor` + `ReceiverManager` | Registrados sólo mientras el servicio vive; Android 8+ prohíbe estos broadcasts en receivers de manifest. |
| Notificación de prioridad `IMPORTANCE_MIN` | `NotificationHandler` | Cumple el requisito de FGS con la mínima molestia visual. |
| `AppConfigReceiver` exportado | manifest | Permite a Tasker/automatizaciones arrancar y parar el servicio. |
| `STNOUPGRADE=1` | `SyncthingRunnable.buildEnvironment()` | El binario no intenta auto-actualizarse (Play lo prohíbe). |
| `STHASHING=minio` | idem | Salta el benchmark de hashing al arrancar → arranque más rápido. |

---

## 5. Cómo se empaqueta el binario nativo (truco importante)

El binario Go se compila para cada ABI y se coloca en `app/src/main/jniLibs/<abi>/` con el nombre **`libsyncthing.so`**, aunque no sea una librería compartida sino un ejecutable.

```python
# syncthing/build-syncthing.py (resumido)
target_artifact = os.path.join(project_dir, 'app','src','main','jniLibs', jni_dir, 'libsyncthing.so')
os.rename(os.path.join(syncthing_dir, 'syncthing'), target_artifact)
```

```kotlin
// app/build.gradle.kts
packagingOptions {
    jniLibs { useLegacyPackaging = true }   // si no, el .so no queda extraído en instalaciones por App Bundle
}
```

Y en tiempo de ejecución:

```java
// Constants.java
static File getSyncthingBinary(Context context) {
    return new File(context.getApplicationInfo().nativeLibraryDir, "libsyncthing.so");
}
```

**Por qué este truco:** desde Android 10, `/data/data/<pkg>/files` está montado con `noexec`. El único directorio del que puedes ejecutar un binario propio es `nativeLibraryDir`, y para que el instalador lo coloque ahí tiene que llamarse `lib*.so` y estar en `jniLibs`. Con App Bundles hace falta además `useLegacyPackaging = true` para que quede extraído en disco y no comprimido dentro del APK.

> Aviso: en Android 14+ Google ha ido restringiendo la ejecución de código no incluido como librería del sistema. Si vas por esta ruta, valídala en dispositivos recientes antes de comprometerte.

---

## 6. Replicarlo hoy: qué cambia en Android 14/15/16

El código analizado apunta a `targetSdk 33` (Android 13). **Ese diseño ya no compila igual ni se comporta igual en las versiones actuales.** Estos son los cambios que te van a afectar, en orden de gravedad.

### 6.1 ⚠️ El bloqueante mayor: `dataSync` tiene límite de 6 horas

Desde Android 15, un foreground service de tipo `dataSync` sólo puede correr **6 horas por cada periodo de 24 h** (compartidas entre todos los servicios de ese tipo de tu app). Al agotarse:

- el sistema llama a `Service.onTimeout(int, int)`,
- tienes **unos pocos segundos** para llamar a `stopSelf()`,
- si no lo haces: `RemoteServiceException: "A foreground service of type dataSync did not stop within its timeout"` (crash),
- intentar arrancar otro después lanza `ForegroundServiceStartNotAllowedException`.

El contador **se reinicia cuando el usuario trae la app a primer plano**. Un modelo "siempre encendido" al estilo Syncthing es, literalmente, imposible con `dataSync`.

### 6.2 ⚠️ `dataSync` ya no puede arrancarse desde `BOOT_COMPLETED`

Apps que apuntan a Android 15+ no pueden lanzar un FGS de tipo `dataSync` desde un receiver de `BOOT_COMPLETED`. Tipos que **sí** pueden: `connectedDevice`, `health`, `location`, `shortService`, `specialUse`, `systemExempted`, `remoteMessaging`, `mediaProcessing`.

### 6.3 Opciones reales, comparadas

| Opción | Vida útil | Arranca en boot | Coste |
|---|---|---|---|
| FGS `dataSync` | 6 h / 24 h | ❌ | Inviable para always-on |
| FGS **`specialUse`** | Sin límite documentado | ✅ | Requiere `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE">` con justificación **revisada manualmente por Google Play**. Fuera de Play (F-Droid, sideload) no hay revisión. |
| FGS `connectedDevice` | Sin límite de 6 h | ✅ | Legítimo si sincronizas por Bluetooth/USB/NFC/conexión local. Con un PC en la misma LAN es defendible; con un servidor en internet, no. |
| **User-Initiated Data Transfer job** (`setUserInitiated(true)`, API 34+) | Larga, sin el límite de 6 h | ❌ (por definición lo inicia el usuario) | Debe originarse en una acción explícita del usuario y mostrar progreso. |
| **WorkManager periódico** con constraints | ≤10 min por ejecución, mínimo 15 min de intervalo | ✅ (se re-agenda solo) | No es tiempo real, pero es lo que Google recomienda y lo que sobrevive a Doze sin pelearse con el sistema. |

### 6.4 Arquitectura recomendada para una app nueva

La respuesta pragmática es **híbrida**: no elijas uno, combina el modo oportunista con el modo de fondo.

```mermaid
flowchart TB
    subgraph TRIG["Disparadores"]
        BOOT["BootReceiver<br/>BOOT_COMPLETED"]
        USER["Usuario abre la app<br/>o pulsa Sincronizar"]
        NET["NetworkCallback<br/>(ConnectivityManager)"]
        PERIOD["WorkManager<br/>PeriodicWorkRequest 15+ min"]
    end

    subgraph POLICY["Política — puerto a tu RunConditionMonitor"]
        RC["SyncPolicy<br/>StateFlow&lt;SyncDecision&gt;<br/>Allowed / Blocked(reasons)"]
    end

    subgraph EXEC["Ejecución"]
        FGS["SyncForegroundService<br/>type=specialUse<br/>(sesión intensiva, app visible<br/>o acción del usuario)"]
        WRK["SyncWorker (CoroutineWorker)<br/>ventanas cortas periódicas<br/>+ Constraints nativas"]
        UIDT["UserInitiatedDataTransfer job<br/>(transferencias grandes explícitas)"]
    end

    ENG["SyncEngine<br/>(tu lógica o proceso nativo)"]
    PC["💻 Computador"]

    BOOT --> WRK
    PERIOD --> WRK
    USER --> FGS
    USER --> UIDT
    NET --> RC
    RC --> FGS
    RC --> WRK

    FGS --> ENG
    WRK --> ENG
    UIDT --> ENG
    ENG <--> PC

    style RC fill:#ef6c00,color:#fff
    style FGS fill:#1565c0,color:#fff
    style WRK fill:#2e7d32,color:#fff
```

**Regla de reparto:**
- **WorkManager periódico** es la base que siempre corre: cada 15–30 min, con `Constraints` de red no medida y batería no baja. Sobrevive a reinicios, a Doze y a los límites de FGS porque nunca es un FGS.
- **FGS `specialUse`** se enciende para sesiones intensivas: cuando el usuario tiene la app abierta, o justo después de una acción suya. Se apaga cuando la cola de trabajo se vacía.
- **`NetworkCallback`** sustituye a `CONNECTIVITY_ACTION` (deprecado desde API 28) y es más preciso: te da `NetworkCapabilities` con `NOT_METERED`, `VALIDATED`, `TRANSPORT_WIFI` directamente, sin `NetworkInfo`.

### 6.5 Esqueleto en Kotlin — el `RunConditionMonitor` modernizado

```kotlin
sealed interface SyncDecision {
    data object Allowed : SyncDecision
    data class Blocked(val reasons: List<BlockerReason>) : SyncDecision
}

enum class BlockerReason(@StringRes val message: Int) {
    ON_BATTERY(R.string.blocked_on_battery),
    POWER_SAVING(R.string.blocked_power_saving),
    METERED_NETWORK(R.string.blocked_metered),
    SSID_NOT_ALLOWED(R.string.blocked_ssid),
    NO_NETWORK(R.string.blocked_no_network),
}

class SyncPolicy(
    private val context: Context,
    private val prefs: SyncPreferences,
    scope: CoroutineScope,
) {
    private val cm = context.getSystemService<ConnectivityManager>()!!
    private val pm = context.getSystemService<PowerManager>()!!

    // Reemplazo moderno de CONNECTIVITY_ACTION
    private val network: Flow<NetworkCapabilities?> = callbackFlow {
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) {
                trySend(caps)
            }
            override fun onLost(n: Network) { trySend(null) }
        }
        cm.registerDefaultNetworkCallback(cb)
        awaitClose { cm.unregisterNetworkCallback(cb) }
    }

    private val power: Flow<Intent?> = context.broadcastFlow(
        Intent.ACTION_POWER_CONNECTED,
        Intent.ACTION_POWER_DISCONNECTED,
        PowerManager.ACTION_POWER_SAVE_MODE_CHANGED,
    ).onEach { delay(5_000) }   // mismo settle de 5s que el original

    val decision: StateFlow<SyncDecision> =
        combine(network, power, prefs.flow) { caps, _, p -> evaluate(caps, p) }
            .distinctUntilChanged()          // ← el equals() de RunConditionCheckResult
            .stateIn(scope, SharingStarted.Eagerly, SyncDecision.Blocked(listOf(NO_NETWORK)))

    private fun evaluate(caps: NetworkCapabilities?, p: Prefs): SyncDecision {
        val blockers = buildList {
            if (caps == null || !caps.hasCapability(NET_CAPABILITY_VALIDATED)) add(NO_NETWORK)
            if (p.respectPowerSaving && pm.isPowerSaveMode) add(POWER_SAVING)
            if (p.wifiOnly && caps?.hasTransport(TRANSPORT_WIFI) != true) add(NO_NETWORK)
            if (!p.allowMetered && caps?.hasCapability(NET_CAPABILITY_NOT_METERED) != true) add(METERED_NETWORK)
            if (p.requireCharging && !isCharging()) add(ON_BATTERY)
        }
        return if (blockers.isEmpty()) SyncDecision.Allowed else SyncDecision.Blocked(blockers)
    }
}
```

`distinctUntilChanged()` sobre un `data class` te da gratis exactamente la deduplicación que en Java se conseguía implementando `equals()` a mano en `RunConditionCheckResult`.

### 6.6 Esqueleto del servicio con `onTimeout`

```kotlin
class SyncForegroundService : LifecycleService() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Debe ocurrir en los primeros segundos, igual que en el original
        ServiceCompat.startForeground(
            this, NOTIF_ID, buildNotification(SyncState.Starting),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        )

        lifecycleScope.launch {
            policy.decision.collect { decision ->
                when (decision) {
                    is SyncDecision.Allowed -> engine.start()
                    is SyncDecision.Blocked -> {
                        engine.stop()
                        updateNotification(decision.reasons)   // "Detenido: red de datos móviles"
                    }
                }
            }
        }
        return START_STICKY
    }

    // Android 15+: obligatorio si usas dataSync o mediaProcessing.
    // Con specialUse no aplica hoy, pero implementarlo es barato y te protege.
    override fun onTimeout(startId: Int, fgsType: Int) {
        engine.requestGracefulStop()      // equivalente al SIGINT del original
        WorkManager.getInstance(this).enqueue(     // continuar por la vía deferrable
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints(requiredNetworkType = NetworkType.UNMETERED))
                .build()
        )
        stopSelf()
    }
}
```

```xml
<service
    android:name=".sync.SyncForegroundService"
    android:foregroundServiceType="specialUse"
    android:exported="false">
    <property
        android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        android:value="Peer-to-peer file synchronization with the user's own computer on the local network. Requires a persistent connection to detect and transfer file changes in real time." />
</service>
```

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### 6.7 Tabla de migración pieza por pieza

| syncthing-android (2024) | Equivalente hoy |
|---|---|
| `Service` + `START_STICKY` | Igual, pero con `foregroundServiceType` obligatorio |
| `dataSync` implícito (no había tipos) | `specialUse` con justificación, o `connectedDevice` si aplica |
| `CONNECTIVITY_ACTION` receiver | `ConnectivityManager.registerDefaultNetworkCallback()` |
| `NetworkInfo.getType()` / `isActiveNetworkMetered()` | `NetworkCapabilities.hasTransport()` / `NET_CAPABILITY_NOT_METERED` |
| `WifiManager.getConnectionInfo().getSSID()` | Requiere `ACCESS_FINE_LOCATION` en runtime; en API 31+ usa `NetworkCallback` + `WifiInfo` desde `TransportInfo` |
| `AsyncTask` (`StartupTask`) | `lifecycleScope.launch(Dispatchers.IO)` o `CoroutineWorker` |
| `Handler.postDelayed` para el poll de eventos | `flow { while(true) { emit(...); delay(15.seconds) } }` en `lifecycleScope` |
| Listeners `HashSet<OnServiceStateChangeListener>` | `StateFlow<SyncState>` expuesto desde un repositorio singleton |
| `bindService` + `Binder` | Igual, o mejor: un repositorio compartido por Hilt y nada de binder |
| Dagger 2 manual | Hilt |
| `WRITE_EXTERNAL_STORAGE` / `MANAGE_EXTERNAL_STORAGE` | SAF (`ACTION_OPEN_DOCUMENT_TREE`) + persistencia de permisos URI |
| `PARTIAL_WAKE_LOCK` opcional | Casi nunca necesario: el FGS ya mantiene la CPU mientras corre |
| Diálogo de exención de batería | Igual (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`), pero Play restringe su uso |

---

## 7. Lecciones transferibles (el resumen accionable)

1. **Separa política de mecanismo.** `RunConditionMonitor` no sabe arrancar nada; `SyncthingRunnable` no sabe decidir nada. Toda la complejidad de "cuándo" queda en una clase que devuelve un valor.
2. **La decisión es un valor con `equals()`, no un booleano.** Te da deduplicación de eventos y mensajes de UI honestos con el mismo código.
3. **El servicio vive siempre; el trabajo se enciende y apaga.** Si matas el servicio cuando no hay trabajo, pierdes la capacidad de detectar cuándo vuelve a haberlo.
4. **Un único orquestador con estado bloqueado.** `SyncthingService` es el único que muta `mCurrentState`, siempre bajo `mStateLock`, y siempre notifica desde el hilo principal vía `Handler`.
5. **Todo lo asíncrono tiene su detector de finalización.** Fan-in de 3 peticiones (`checkReadConfigFromRestApiCompleted`), polling hasta 200 OK, `join()` de hilos antes de dar por terminado el shutdown.
6. **Apagado en dos fases con espera.** SIGINT → esperar → SIGKILL. Aplicable a cualquier trabajo que escriba en disco.
7. **Shutdown defensivo antes de cada arranque.** Nunca asumas que el estado previo quedó limpio.
8. **Persiste el punto de continuación en cada ciclo.** El `lastEventId` en `SharedPreferences` hace que sobrevivir a un kill del sistema sea trivial.
9. **La UI es completamente opcional.** El motor arranca, sincroniza y se apaga sin que exista ninguna `Activity`.

---

## 8. Advertencias sobre el repositorio de origen

- El proyecto está **archivado** desde diciembre de 2024. El README lo atribuye a la dificultad de publicar en Google Play y a la falta de mantenimiento activo.
- Existe un fork mantenido, **Syncthing-Fork** de Catfriend1 (`com.github.catfriend1.syncthingandroid`), disponible en F-Droid y Google Play. Si tu objetivo fuera portar en lugar de reimplementar, es el punto de partida más actualizado.
- El código usa APIs deprecadas en varios sitios (`AsyncTask`, `NetworkInfo`, `CONNECTIVITY_ACTION`, `android.preference.PreferenceManager`) y `targetSdk 33`. Léelo como documento de arquitectura, no como plantilla de código.

---

## 9. Índice de archivos de referencia

| Archivo | Líneas | Qué buscar |
|---|---|---|
| `service/SyncthingService.java` | 710 | Máquina de estados, `onStartCommand`, `shutdown()`, `onUpdatedShouldRunDecision()` |
| `service/RunConditionMonitor.java` | 393 | `decideShouldRun()`, receivers dinámicos, detección de red/batería |
| `service/SyncthingRunnable.java` | 467 | `ProcessBuilder`, wake lock, `killSyncthing()`, códigos de salida, variables de entorno |
| `service/NotificationHandler.java` | 305 | `updatePersistentNotification()`, canales, doble ID |
| `service/EventProcessor.java` | 318 | Long-poll de eventos, `lastEventId`, notificaciones de consentimiento |
| `service/RestApi.java` | 730 | `readConfigFromRestApi()`, fan-in de 3 peticiones |
| `service/Constants.java` | 155 | Todas las claves de preferencias y rutas de archivos |
| `model/RunConditionCheckResult.java` | — | El patrón decisión-con-razones |
| `receiver/BootReceiver.java` | 46 | `startServiceCompat()` |
| `http/PollWebGuiAvailableTask.java` | — | Polling a 100 ms |
| `util/ConfigXml.java` | — | Generación de claves en primer arranque, API key |
| `syncthing/build-syncthing.py` | — | Compilación cruzada Go → `libsyncthing.so` |
| `app/src/main/AndroidManifest.xml` | — | Permisos y declaración del servicio |

---

*Documento generado por ingeniería inversa del código fuente en `syncthing/syncthing-android` @ HEAD (rama archivada), septiembre 2026.*
