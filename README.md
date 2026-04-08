# Autoreas Mobile

Aplicación mobile de Autoreas construida con Expo Router, React Native, Expo SQLite, Drizzle ORM, React Query y HeroUI Native.

## Stack

- Expo SDK 55
- React Native 0.83
- Expo Router
- Expo SQLite
- Drizzle ORM
- React Query
- Jest + Testing Library
- Bun como package manager principal

## Requisitos

- Bun
- Node.js
- EAS CLI (`npm i -g eas-cli` o `bunx eas --version`)
- Android Studio si vas a correr Android local
- Cuenta de Expo iniciada (`eas login`) para builds remotos

## Importante: SQLite y Android

Este proyecto usa `expo-sqlite` nativo.

Eso significa que **no alcanza con Expo Go puro** para probar todo el flujo real de la app. Si corrés un binario que no incluye `expo-sqlite`, vas a ver el fallback de SQLite no disponible o errores como `Cannot find native module 'ExpoSQLite'`.

Para desarrollo Android real usá un **development build** o un binario generado con EAS.

## Instalación

```bash
bun install
```

## Comandos de desarrollo

### Levantar Metro

```bash
bun run start
```

Equivalente:

```bash
bunx expo start -c
```

### Abrir Android desde Metro

```bash
bun run android
```

### Abrir iOS desde Metro

```bash
bun run ios
```

### Abrir Web

```bash
bun run web
```

## Calidad y verificación

### Lint

```bash
bun run lint
```

### Typecheck

```bash
bun run typecheck
```

Equivalente:

```bash
bunx tsc --noEmit
```

### Tests

```bash
bun run test
```

### Tests en watch

```bash
bun run test:watch
```

### Coverage

```bash
bun run test:coverage
```

### Verificar flujo de pre-commit fallido

```bash
bun run verify:precommit-fail-path
```

## Hooks de Git

Instalar hooks locales:

```bash
bun run prepare
```

## Base de datos y Drizzle

La configuración de Drizzle está en `drizzle.config.ts` y las migraciones salen a `src/infrastructure/db/migrations`.

### Generar migraciones

```bash
bunx drizzle-kit generate
```

### Alternativa explícita con config

```bash
bunx drizzle-kit generate --config=drizzle.config.ts
```

Nota:

Las migraciones se aplican en runtime desde `src/app/_layout.tsx` usando `SQLiteProvider` y `runMigrations()`.

## Android local con binario nativo

Si querés probar SQLite real, cleartext HTTP local y wiring nativo, necesitás un build nativo.

### Opción 1: development build remoto con EAS

```bash
eas build --platform android --profile development
```

Ese es el comando que necesitábamos documentar para este repo.

### Opción 2: preview build remoto

```bash
eas build --platform android --profile preview
```

### Opción 3: production build remoto

```bash
eas build --platform android --profile production
```

## Instalar y abrir development build

Después de generar el build Android development, instalá el APK/AAB resultante en el dispositivo o emulador y luego levantá Metro:

```bash
bun run start
```

Si el development client ya está instalado, podés abrirlo contra el bundler local.

## Submit / deploy

### Enviar build de producción con EAS Submit

```bash
eas submit --platform android --profile production
```

Nota:

`eas.json` ya tiene definida la sección `submit.production`.

## Comandos útiles de Expo / EAS

### Verificar config pública resuelta

```bash
npx expo config --type public
```

### Revisar dependencias y salud del proyecto

```bash
npx expo-doctor
```

### Revisar upgrades recomendados por Expo

```bash
npx expo install --check
```

## Flujo sugerido de desarrollo

### Trabajo diario sin build nativo nuevo

```bash
bun install
bun run start
bun run test
bun run typecheck
```

### Cuando cambian plugins nativos o SQLite

```bash
eas build --platform android --profile development
```

### Antes de cerrar una tarea

```bash
bun run lint
bun run test
bun run typecheck
```

## Troubleshooting

### Error: `Cannot find native module 'ExpoSQLite'`

Causa:

Estás corriendo la app en un binario que no incluye `expo-sqlite` nativo.

Pasa típicamente cuando:

- usás Expo Go para un flujo que requiere SQLite nativo
- instalaste un dev client viejo
- agregaste o cambiaste plugins nativos y no regeneraste el build

Solución:

```bash
eas build --platform android --profile development
```

Después instalá ese build nuevo en el dispositivo o emulador y levantá Metro:

```bash
bun run start
```

### Error de red contra IP local en Android

Síntoma:

- pairing falla contra `http://192.168.x.x:puerto`
- sync falla aunque el bridge esté levantado

Causa posible:

Android bloquea tráfico HTTP cleartext si el binario no fue generado con la config nativa correcta.

En este repo, eso ya está declarado en `app.json` mediante `expo-build-properties` con `usesCleartextTraffic: true`, pero necesitás recompilar el binario para que aplique.

Solución:

```bash
eas build --platform android --profile development
```

### Reinstalar dev client correctamente

Cuando cambies plugins nativos, SQLite, permisos o config Android, hacé este flujo:

```bash
eas build --platform android --profile development
```

Luego:

1. Desinstalá la versión anterior de la app o dev client si sigue usando binarios viejos.
2. Instalá el nuevo APK/AAB generado por EAS.
3. Levantá Metro con `bun run start`.
4. Abrí la app instalada y conectala al bundler local.

### Warnings de Expo Router sobre `missing default export`

Si ves warnings como estos:

```text
Route "./(home)/index.tsx" is missing the required default export
Route "./(tabs)/index.tsx" is missing the required default export
```

No asumas que el export está mal.

En este proyecto, ese warning puede ser secundario a un crash durante la evaluación del módulo, especialmente si también aparece un error de `ExpoSQLite`. Primero resolvé el problema nativo.

## Release checklist

### Preview Android

1. Instalar dependencias:

```bash
bun install
```

2. Verificar calidad:

```bash
bun run lint
bun run test
bun run typecheck
```

3. Generar build preview:

```bash
eas build --platform android --profile preview
```

4. Instalar el build en dispositivo y validar:

- arranque de app
- setup / pairing
- acceso SQLite
- sync contra bridge local
- navegación principal

### Production Android

1. Instalar dependencias:

```bash
bun install
```

2. Verificar calidad:

```bash
bun run lint
bun run test
bun run typecheck
```

3. Generar build production:

```bash
eas build --platform android --profile production
```

4. Enviar a distribución:

```bash
eas submit --platform android --profile production
```

### Checklist mínima antes de cualquier build

- confirmar que el cambio no requiere regenerar secretos o credenciales fuera del repo
- confirmar que el bridge local sigue respondiendo si tocaste pairing o sync
- si cambiaste SQLite, plugins Expo o permisos Android, usar build nuevo; no reutilizar un dev client viejo

## Estructura relevante

- `src/app/` — rutas Expo Router
- `src/infrastructure/db/` — cliente SQLite, schema y migraciones Drizzle
- `src/features/` — hooks y lógica de negocio
- `tests/` — smoke, unit e integration-style tests
- `docs/specs/` — specs funcionales del proyecto

## Referencias del proyecto

- `app.json` — configuración Expo y plugins nativos
- `eas.json` — perfiles de build y submit
- `drizzle.config.ts` — configuración Drizzle Kit
