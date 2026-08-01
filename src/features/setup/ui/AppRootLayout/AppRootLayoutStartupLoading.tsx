import { Card, cn, Spinner, Typography } from 'heroui-native';
import {
  APP_ROOT_LAYOUT_STARTUP_LOADING_DESCRIPTION,
  APP_ROOT_LAYOUT_STARTUP_LOADING_TITLE,
} from './app-root-layout.constants';

/** Renders the replaceable startup placeholder while the local database is preparing. */
export function AppRootLayoutStartupLoading() {
  return (
    <Card className={cn('flex-1 items-center justify-center rounded-none')}>
      <Card.Body className={cn('items-center justify-center gap-4 px-8')}>
        <Spinner accessibilityLabel={APP_ROOT_LAYOUT_STARTUP_LOADING_TITLE} size="lg" />
        <Typography.Heading align="center" type="h3">
          {APP_ROOT_LAYOUT_STARTUP_LOADING_TITLE}
        </Typography.Heading>
        <Typography.Paragraph align="center" color="muted">
          {APP_ROOT_LAYOUT_STARTUP_LOADING_DESCRIPTION}
        </Typography.Paragraph>
      </Card.Body>
    </Card>
  );
}
