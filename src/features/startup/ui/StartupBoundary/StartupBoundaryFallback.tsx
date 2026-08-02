import { Alert, Card, cn } from 'heroui-native';
import {
  STARTUP_BOUNDARY_FAILURE_DESCRIPTION,
  STARTUP_BOUNDARY_FAILURE_DIAGNOSTIC_TITLE,
  STARTUP_BOUNDARY_FAILURE_RECOVERY_TITLE,
  STARTUP_BOUNDARY_FAILURE_TITLE,
} from './startup-boundary.constants';
import type { StartupBoundaryFallbackProps } from './startup-boundary-fallback.types';

/** Renders the startup fallback shown when the local bootstrap fails. */
export function StartupBoundaryFallback(
  props: Readonly<StartupBoundaryFallbackProps>,
) {
  return (
    <Card className={cn('mx-5 mt-10')} variant="secondary">
      <Card.Body className={cn('gap-4 p-5')}>
        <Card.Title>{STARTUP_BOUNDARY_FAILURE_TITLE}</Card.Title>
        <Card.Description>{STARTUP_BOUNDARY_FAILURE_DESCRIPTION}</Card.Description>

        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{STARTUP_BOUNDARY_FAILURE_DIAGNOSTIC_TITLE}</Alert.Title>
            <Alert.Description>{props.failure.diagnosticMessage}</Alert.Description>
          </Alert.Content>
        </Alert>

        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{STARTUP_BOUNDARY_FAILURE_RECOVERY_TITLE}</Alert.Title>
            <Alert.Description>{props.failure.recoveryHint}</Alert.Description>
          </Alert.Content>
        </Alert>
      </Card.Body>
    </Card>
  );
}
