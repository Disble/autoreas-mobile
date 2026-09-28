import { Alert, Button, Card, cn } from 'heroui-native';
import { View } from 'react-native';
import {
  STARTUP_BOUNDARY_FAILURE_DESCRIPTION,
  STARTUP_BOUNDARY_FAILURE_DIAGNOSTIC_TITLE,
  STARTUP_BOUNDARY_FAILURE_RECOVERY_TITLE,
  STARTUP_BOUNDARY_FAILURE_TITLE,
  STARTUP_BOUNDARY_RECOVERY_LAST_RESORT_TITLE,
} from './startup-boundary.constants';
import { StartupDatabaseResetDialog } from './StartupDatabaseResetDialog';
import type { StartupBoundaryFallbackProps } from './startup-boundary-fallback.types';
import type { StartupBoundaryRecovery } from './startup-boundary.types';
import type { StartupResetConfirmation } from '../../recovery/recovery.types';
import type { StartupFailure } from '../../startup.types';

/** Renders the safe diagnosis of the failure that stopped local startup. */
function StartupBoundaryDiagnostic(props: Readonly<{ failure: StartupFailure }>) {
  return (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{STARTUP_BOUNDARY_FAILURE_DIAGNOSTIC_TITLE}</Alert.Title>
        <Alert.Description>{props.failure.diagnosticMessage}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Renders the warning alert that carries the safe recovery hint for a failure. */
function StartupBoundaryRecoveryHintAlert(props: Readonly<{ hint: string }>) {
  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{STARTUP_BOUNDARY_FAILURE_RECOVERY_TITLE}</Alert.Title>
        <Alert.Description>{props.hint}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Renders the warning alert that explains the last-resort manual path after a failed reset. */
function StartupBoundaryLastResortAlert(props: Readonly<{ description: string; warning: string }>) {
  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{STARTUP_BOUNDARY_RECOVERY_LAST_RESORT_TITLE}</Alert.Title>
        <Alert.Description>{props.description}</Alert.Description>
        <Alert.Description>{props.warning}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Renders the primary reset offer plus its non-destructive decline action. */
function StartupBoundaryResetActions(
  props: Readonly<{
    onCancelReset: () => void;
    onRequestReset: () => void;
    primaryActionLabel: string;
    secondaryActionLabel: string;
  }>,
) {
  return (
    <View className={cn('gap-3')}>
      <Button onPress={props.onRequestReset} variant="primary">
        <Button.Label>{props.primaryActionLabel}</Button.Label>
      </Button>
      <Button onPress={props.onCancelReset} variant="tertiary">
        <Button.Label>{props.secondaryActionLabel}</Button.Label>
      </Button>
    </View>
  );
}

/** Renders the retry and last-resort app-settings actions offered after a failed reset. */
function StartupBoundaryFailedResetActions(
  props: Readonly<{
    actionLabel: string;
    onOpenAppSettings: () => void;
    onRetryReset: () => void;
    retryActionLabel: string;
  }>,
) {
  return (
    <View className={cn('gap-3')}>
      <Button onPress={props.onRetryReset} variant="secondary">
        <Button.Label>{props.retryActionLabel}</Button.Label>
      </Button>
      <Button onPress={props.onOpenAppSettings} variant="tertiary">
        <Button.Label>{props.actionLabel}</Button.Label>
      </Button>
    </View>
  );
}

/** Renders the transient retry action shown only when the caller can mount a fresh provider. */
function StartupBoundaryRetryButton(
  props: Readonly<{ label: string; onRetryStartup: () => void }>,
) {
  return (
    <Button onPress={props.onRetryStartup} variant="secondary">
      <Button.Label>{props.label}</Button.Label>
    </Button>
  );
}

/** Renders the reset offer together with the single destructive confirmation it opens. */
function StartupBoundaryDamageSection(
  props: Readonly<{
    confirmation: StartupResetConfirmation;
    isResetConfirmationVisible: boolean;
    onCancelReset: () => void;
    onConfirmReset: () => void;
    onRequestReset: () => void;
    primaryActionLabel: string;
    secondaryActionLabel: string;
  }>,
) {
  return (
    <>
      <StartupBoundaryResetActions
        onCancelReset={props.onCancelReset}
        onRequestReset={props.onRequestReset}
        primaryActionLabel={props.primaryActionLabel}
        secondaryActionLabel={props.secondaryActionLabel}
      />
      <StartupDatabaseResetDialog
        confirmation={props.confirmation}
        isVisible={props.isResetConfirmationVisible}
        onCancel={props.onCancelReset}
        onConfirm={props.onConfirmReset}
      />
    </>
  );
}

/** Renders the failed-reset explanation with its retry and last-resort actions. */
function StartupBoundaryFailedResetSection(
  props: Readonly<{
    actionLabel: string;
    description: string;
    onOpenAppSettings: () => void;
    onRetryReset: () => void;
    retryActionLabel: string;
    warning: string;
  }>,
) {
  return (
    <>
      <StartupBoundaryLastResortAlert description={props.description} warning={props.warning} />
      <StartupBoundaryFailedResetActions
        actionLabel={props.actionLabel}
        onOpenAppSettings={props.onOpenAppSettings}
        onRetryReset={props.onRetryReset}
        retryActionLabel={props.retryActionLabel}
      />
    </>
  );
}

/**
 * Renders one terminal recovery state: its own copy and the only actions that state authorized.
 *
 * Every action below is a callback the recovery logic exposed for that state, so a state that
 * authorized nothing cannot render a button at all -- "no destructive action outside confirmed
 * corruption" is decided upstream and merely displayed here.
 */
function StartupBoundaryRecoveryCard(
  props: Readonly<{ failure: StartupFailure; recovery: StartupBoundaryRecovery }>,
) {
  const { failure, recovery } = props;
  const { actions, state } = recovery;

  return (
    <>
      <Card.Title>{state.title}</Card.Title>
      <Card.Description>{state.description}</Card.Description>
      <StartupBoundaryDiagnostic failure={failure} />

      {state.kind === 'transient' ? (
        <StartupBoundaryRecoveryHintAlert hint={state.closeAndReopenHint} />
      ) : null}

      {state.kind === 'damage' ? (
        <StartupBoundaryDamageSection
          confirmation={state.confirmation}
          isResetConfirmationVisible={actions.isResetConfirmationVisible}
          onCancelReset={actions.cancelReset}
          onConfirmReset={actions.confirmReset}
          onRequestReset={actions.requestReset}
          primaryActionLabel={state.primaryActionLabel}
          secondaryActionLabel={state.secondaryActionLabel}
        />
      ) : null}

      {state.kind === 'transient' && state.retryActionLabel !== null ? (
        <StartupBoundaryRetryButton
          label={state.retryActionLabel}
          onRetryStartup={actions.retryStartup}
        />
      ) : null}

      {state.kind === 'reset_failed' ? (
        <StartupBoundaryFailedResetSection
          actionLabel={state.lastResort.actionLabel}
          description={state.lastResort.description}
          onOpenAppSettings={actions.openAppSettings}
          onRetryReset={actions.retryReset}
          retryActionLabel={state.retryActionLabel}
          warning={state.lastResort.warning}
        />
      ) : null}
    </>
  );
}

/** Renders the generic failure card shown when the failure has no recovery presentation. */
function StartupBoundaryGenericFailure(props: Readonly<{ failure: StartupFailure }>) {
  return (
    <>
      <Card.Title>{STARTUP_BOUNDARY_FAILURE_TITLE}</Card.Title>
      <Card.Description>{STARTUP_BOUNDARY_FAILURE_DESCRIPTION}</Card.Description>
      <StartupBoundaryDiagnostic failure={props.failure} />
      <StartupBoundaryRecoveryHintAlert hint={props.failure.recoveryHint} />
    </>
  );
}

/** Renders the startup fallback shown when the local bootstrap fails. */
export function StartupBoundaryFallback(
  props: Readonly<StartupBoundaryFallbackProps>,
) {
  const { failure, recovery } = props;

  return (
    <Card className={cn('mx-5 mt-10')} variant="secondary">
      <Card.Body className={cn('gap-4 p-5')}>
        {recovery === null ? (
          <StartupBoundaryGenericFailure failure={failure} />
        ) : (
          <StartupBoundaryRecoveryCard failure={failure} recovery={recovery} />
        )}
      </Card.Body>
    </Card>
  );
}
