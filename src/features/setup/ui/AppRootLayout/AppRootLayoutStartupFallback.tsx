import { Alert, Card, cn } from 'heroui-native';
import {
  APP_ROOT_LAYOUT_STARTUP_FAILURE_DESCRIPTION,
  APP_ROOT_LAYOUT_STARTUP_FAILURE_DIAGNOSTIC_TITLE,
  APP_ROOT_LAYOUT_STARTUP_FAILURE_RECOVERY_TITLE,
  APP_ROOT_LAYOUT_STARTUP_FAILURE_TITLE,
} from './app-root-layout.constants';
import type { AppRootLayoutStartupFallbackProps } from './app-root-layout-startup-fallback.types';

/** Renders the startup fallback shown when the local bootstrap fails. */
export function AppRootLayoutStartupFallback(
  props: Readonly<AppRootLayoutStartupFallbackProps>,
) {
  return (
    <Card className={cn('mx-5 mt-10')} variant="secondary">
      <Card.Body className={cn('gap-4 p-5')}>
        <Card.Title>{APP_ROOT_LAYOUT_STARTUP_FAILURE_TITLE}</Card.Title>
        <Card.Description>{APP_ROOT_LAYOUT_STARTUP_FAILURE_DESCRIPTION}</Card.Description>

        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{APP_ROOT_LAYOUT_STARTUP_FAILURE_DIAGNOSTIC_TITLE}</Alert.Title>
            <Alert.Description>{props.failure.diagnosticMessage}</Alert.Description>
          </Alert.Content>
        </Alert>

        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{APP_ROOT_LAYOUT_STARTUP_FAILURE_RECOVERY_TITLE}</Alert.Title>
            <Alert.Description>{props.failure.recoveryHint}</Alert.Description>
          </Alert.Content>
        </Alert>
      </Card.Body>
    </Card>
  );
}
