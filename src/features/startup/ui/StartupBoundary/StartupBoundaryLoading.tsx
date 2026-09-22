import { Card, cn, Spinner, Typography } from 'heroui-native';
import {
  STARTUP_BOUNDARY_LOADING_DESCRIPTION,
  STARTUP_BOUNDARY_LOADING_TITLE,
  STARTUP_BOUNDARY_SLOW_DESCRIPTION,
} from './startup-boundary.constants';
import type { StartupBoundaryLoadingProps } from './startup-boundary.types';

/** Renders the replaceable startup placeholder while the local database is preparing. */
export function StartupBoundaryLoading({
  isTakingLongerThanExpected,
}: StartupBoundaryLoadingProps) {
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
        {isTakingLongerThanExpected ? (
          <Typography.Paragraph align="center" color="muted">
            {STARTUP_BOUNDARY_SLOW_DESCRIPTION}
          </Typography.Paragraph>
        ) : null}
      </Card.Body>
    </Card>
  );
}
