# Delta for fix-season-rating-visibility

## Domain: 03-optimistic-ignorance

### MODIFIED Requirements

### Requirement: Preferences-driven season activation refresh

The system MUST refresh the active-season projection when a WebSocket `preferences_changed` event changes `season_mode` from disabled to enabled, and it MUST keep this refresh inside the existing sync runtime and BridgeClient-owned transport flow.

(Previously: `preferences_changed` changed the season-mode flag without requiring an immediate active-season refresh.)

#### Scenario: Season mode becomes enabled from bridge preferences
- GIVEN the app is browsing normally and the active-season projection is stale or empty
- WHEN sync runtime receives `preferences_changed` with `season_mode = true`
- THEN the runtime MUST request the active-season refresh immediately
- AND downstream list state MUST receive refreshed season projection data for the current bridge season

#### Scenario: Disabled season mode preserves normal browsing
- GIVEN the user is in normal browsing mode
- WHEN sync runtime receives `preferences_changed` that keeps `season_mode = false`
- THEN the system MUST preserve normal browsing behavior
- AND it MUST NOT require season-projection data to render rating state

#### Scenario: Bridge boundary remains unchanged
- GIVEN the season-mode refresh is triggered from feature code
- WHEN the runtime performs the refresh
- THEN the feature flow MUST stay behind existing BridgeClient and sync runtime seams
- AND it MUST NOT introduce raw `fetch`, raw `WebSocket`, or feature-owned bridge URLs

## Domain: 05-ui-split-screen

### MODIFIED Requirements

### Requirement: Season-mode rating visibility after activation

The system MUST show the existing bridge rating or the rating action on season-mode anime cards once refreshed active-season projection data marks the anime as a bridge-declared rating candidate.

(Previously: season-mode cards could remain without rating state after season mode was enabled until a later season refresh happened through another path.)

#### Scenario: Refreshed season card shows bridge rating state
- GIVEN season mode was just enabled by bridge preferences
- AND the refreshed active-season projection marks an anime as rateable or already rated
- WHEN the card renders in season mode
- THEN it MUST show the rating action for eligible unrated anime or the current bridge rating for rated anime

#### Scenario: Non-candidate season card stays unchanged
- GIVEN season mode is enabled
- AND the refreshed active-season projection does not declare the anime as a rating candidate
- WHEN the card renders
- THEN the card MUST preserve the existing non-rating presentation rules
