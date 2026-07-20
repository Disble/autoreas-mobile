# SDD-05: HeroUI, Split-Screen Constraints y Lista Reactiva

**Estado:** Draft (Pendiente de Revisión Adversarial)
**Track:** Catálogo (Fase 2)

## 1. Objetivo
Definir la arquitectura de la Interfaz de Usuario (UI) para la lista principal de animes, asegurando un rendimiento fluido con bases de datos locales y el cumplimiento estricto de restricciones de layout (Split-Screen).

## 2. Restricciones de Layout (El "Split-Screen" Mandate)
El dispositivo Android se usará casi exclusivamente en modo pantalla dividida (Split-Screen): VLC reproduciendo video a la izquierda, Autoreas Mobile a la derecha.
- **Ancho Máximo Asumido:** ~320dp (equivalente a un iPhone SE o más angosto).
- **Prohibición de Scroll Horizontal:** Todo el contenido debe fluir hacia abajo (`flex-wrap: wrap` para los badges o tags).
- **Accesibilidad Inmediata (1-Click):** Los botones transaccionales (`Cap+`, `Cap-`) deben estar expuestos directamente en la tarjeta de cada anime. No se permite esconderlos detrás de menús contextuales ("tres puntitos") ni modales.
- **Dropdown de Días:** El selector del día de la semana debe ser un componente nativo compacto que no se corte por el límite de la pantalla.

## 3. Arquitectura de Renderizado Reactivo (Drizzle + FlashList)
La lista de animes puede contener cientos de ítems. Un `ScrollView` o `FlatList` estándar de React Native sufrirá problemas de memoria.
- **Lista Virtualizada:** Se debe usar `@shopify/flash-list` en lugar de `FlatList`.
- **Integración Segura con SQLite (SSOT) y Paginación:**
  No se debe usar un `useLiveQuery` global que devuelva los 500+ registros cada vez que un solo anime cambie, porque transferir eso por el Bridge JS saturará el hilo.
  - **Estrategia A (Paginación Live):** El `useLiveQuery` debe incluir `LIMIT` y cargar más mediante el `onEndReached` del FlashList.
  - **Estrategia B (Zustand Optimista):** La tabla en Drizzle alimenta un store de Zustand al inicio. Las mutaciones (Cap+) actualizan Zustand primero (UI instantánea) y delegan la escritura en SQLite al background, evitando depender del re-render de Drizzle para la interacción inmediata.
- **Filtros Locales:** Los filtros (por Día, Estrenos) se aplicarán preferentemente modificando la query SQL.

## 4. Sistema de Diseño (NativeWind)
- **Advertencia:** HeroUI (NextUI) está diseñado para DOM/Web y crashearía en Expo. Se utilizará **NativeWind** (TailwindCSS para React Native) junto con componentes base personalizados para garantizar soporte nativo y Dark Mode.
- **Evitar Re-Renders (Memoización Estricta):** Cada `AnimeCard` usará `React.memo()`. Como Drizzle devuelve nuevos objetos en cada query, el `memo()` DEBE incluir una función de comparación custom: `(prev, next) => prev.anime.id === next.anime.id && prev.anime.nrocapvisto === next.anime.nrocapvisto && prev.anime.estado === next.anime.estado`.
- **Restricciones de Overflow (320dp):**
  - Los títulos de anime DEBEN usar `numberOfLines={2}` y `ellipsizeMode="tail"`.
  - Las imágenes DEBEN tener `aspectRatio` fijo y `flex-shrink: 0` para evitar que títulos muy largos empujen los botones de acción fuera de la pantalla.

## 5. Visibilidad de calificación de temporada después de activación (Season-mode rating visibility after activation)

El sistema DEBE mostrar la calificación existente del bridge o la acción de calificación en las tarjetas de anime en season mode una vez que los datos actualizados de proyección de temporada activa marcan al anime como candidato a calificación declarado por el bridge.

### Escenario: Tarjeta de temporada refrescada muestra estado de calificación del bridge
- DADO que season mode fue habilitado por las preferencias del bridge
- Y la proyección de temporada activa refrescada marca a un anime como calificable o ya calificado
- CUANDO la tarjeta se renderiza en season mode
- ENTONCES DEBE mostrar la acción de calificación para animes elegibles sin calificar, o la calificación actual del bridge para animes ya calificados

### Escenario: Tarjeta de temporada no candidata permanece sin cambios
- DADO que season mode está habilitado
- Y la proyección de temporada activa refrescada NO declara al anime como candidato a calificación
- CUANDO la tarjeta se renderiza
- ENTONCES la tarjeta DEBE preservar las reglas de presentación existentes sin calificación