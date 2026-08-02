import { Card, cn, Spinner, Typography } from 'heroui-native';
import {
  STARTUP_BOUNDARY_LOADING_DESCRIPTION,
  STARTUP_BOUNDARY_LOADING_TITLE,
} from './startup-boundary.constants';

/** Renders the replaceable startup placeholder while the local database is preparing. */
export function StartupBoundaryLoading() {
  return (
    <Card className={cn('flex-1 items-center justify-center rounded-none')}>
      <Card.Body className={cn('items-center justify-center gap-4 px-8')}>
        <Spinner accessibilityLabel={STARTUP_BOUNDARY_LOADING_TITLE} size="lg" />
        <Typography.Heading align="center" type="h3">
          {STARTUP_BOUNDARY_LOADING_TITLE}
        </Typography.Heading>
        <Typography.Paragraph align="center" color="muted">
          {STARTUP_BOUNDARY_LOADING_DESCRIPTION}
        </Typography.Paragraph>
      </Card.Body>
    </Card>
  );
}
