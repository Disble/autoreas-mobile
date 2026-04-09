# Delta for Mis Animes

## ADDED Requirements

### Requirement: Day-based primary navigation

The system MUST render `Mis Animes` with a primary selector based on weekly days plus Estrenos pseudo-days, not status tabs.

#### Scenario: Default selected day on open
- GIVEN the user opens `Mis Animes`
- WHEN the screen resolves its initial filter
- THEN it MUST select the current weekday by default
- AND it MUST NOT default to `viendo`, `estrenos`, or `todos`

#### Scenario: Switching active day
- GIVEN the current filter is `Jueves`
- WHEN the user selects `Viernes`
- THEN the screen MUST update the visible list using `Viernes`
- AND it MUST preserve offline rendering from SQLite

### Requirement: Intra-day legacy ordering

The system MUST order visible animes by the `orden` associated with the selected `dias[].dia` entry.

#### Scenario: Ordered day list
- GIVEN multiple active animes contain `dias: [{ dia: "Jueves", orden: n }]`
- WHEN `Jueves` is selected
- THEN the list MUST be sorted by `orden` ascending
- AND it MUST NOT use `fechaUltCapVisto` as the primary order

#### Scenario: Anime without selected day mapping
- GIVEN an anime lacks an entry for the selected day
- WHEN the list is computed
- THEN that anime MUST be excluded from the result

### Requirement: Estrenos pseudo-day filtering

The system MUST support Estrenos as a dedicated filter group driven by the anime `dias` values provided by Bridge.

#### Scenario: Estrenos pseudo-day selection
- GIVEN an anime contains `dias` entries such as `Sin ver`, `Ver hoy`, or `Visto`
- WHEN the user selects one of those values
- THEN the screen MUST show only matching animes
- AND it MUST preserve `orden` within that pseudo-day

### Requirement: Manual refresh for Mis Animes

The system MUST provide a manual refresh action that requests sync and repaints the current filter without resetting navigation state.

#### Scenario: Refresh keeps selected filter
- GIVEN the active filter is `Jueves`
- WHEN the user triggers refresh successfully
- THEN sync MUST run against the Bridge/local store
- AND the screen MUST stay on `Jueves`

#### Scenario: Refresh failure
- GIVEN the active filter is any day or pseudo-day
- WHEN refresh fails due to network or Bridge unavailability
- THEN the current local list MUST remain visible
- AND the active filter MUST remain unchanged

## MODIFIED Requirements

### Requirement: Split-screen list controls

`Mis Animes` MUST keep a compact day/estrenos selector and direct `Cap+` / `Cap-` controls within split-screen constraints.

#### Scenario: Narrow layout
- GIVEN the app runs near 320dp width
- WHEN the selector and list are rendered together
- THEN the selector MUST remain usable without horizontal scroll
- AND action buttons MUST remain one tap away on each card
