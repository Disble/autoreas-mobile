# Delta for Android Foreground Sync Service

## ADDED Requirements

### Requirement: Android foreground sync mode

The system MUST support an Android-specific foreground sync mode for users who need stronger continuity than best-effort background tasks.

#### Scenario: Foreground mode enabled
- GIVEN the device runs Android and supports the required native integration
- WHEN the user enables continuous sync mode
- THEN the app MUST start a foreground service with a persistent notification
- AND reconcile eligibility MUST continue while that service remains active
- AND the implementation MUST declare the Android foreground service as a data sync service

#### Scenario: User stops the foreground service
- GIVEN the foreground sync service is running
- WHEN the user stops it from the notification or Settings
- THEN the app MUST stop the persistent service
- AND the system MUST fall back to the best-effort background model

### Requirement: Honest operational visibility

The system MUST communicate the effective sync mode and guarantees clearly in Settings.

#### Scenario: Best-effort mode copy
- GIVEN the app is using Expo background task mode only
- WHEN the user opens Settings
- THEN the screen MUST state that sync after manual app termination is not guaranteed

#### Scenario: Foreground service mode copy
- GIVEN Android foreground sync mode is active
- WHEN the user opens Settings
- THEN the screen MUST state that continuous sync is backed by a persistent Android service
- AND it MUST expose the running/stopped state clearly

### Requirement: Android foreground service permissions

The system MUST declare the Android permissions and service type required for a data sync foreground service.

#### Scenario: Android 14+ service declaration
- GIVEN the app enables Android foreground sync mode
- WHEN the Android build is generated
- THEN the manifest MUST include `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC`
- AND the foreground service type MUST be compatible with data synchronization work

#### Scenario: Notification permission on Android 13+
- GIVEN the device runs Android 13+
- WHEN the app enables foreground sync mode
- THEN the product MUST request or validate notification permission as needed for the persistent notification UX

## MODIFIED Requirements

### Requirement: Background sync guarantee language

The system MUST describe Expo background-task sync as best-effort and SHALL NOT promise continuation after an explicit user kill.

#### Scenario: Manual app termination under best-effort mode
- GIVEN the app uses only periodic background tasks
- WHEN the user explicitly kills the app process
- THEN the product MUST treat sync continuity as not guaranteed until the next launch
