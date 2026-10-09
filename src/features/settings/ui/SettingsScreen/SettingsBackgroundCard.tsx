import { Button, Card } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { SETTINGS_BACKGROUND_COPY } from './settings-screen.constants';
import type {
  SettingsBackgroundCardProps,
  SettingsBackgroundIssueRowProps,
} from './settings-screen.types';

/** Renders one failing background item with its fix button, when it has one. */
function SettingsBackgroundIssueRow(props: Readonly<SettingsBackgroundIssueRowProps>) {
  const { issue, backgroundIssueActionHandlers } = props;
  const { action } = issue;

  return (
    <View
      className="flex-row items-center gap-3 rounded-2xl bg-warning/10 px-3 py-2.5"
      testID={`settings-background-issue-${issue.id}`}
    >
      <View className="flex-1 gap-0.5">
        <AppText className="text-sm font-semibold text-warning">{issue.title}</AppText>
        <AppText className="text-xs leading-snug text-muted">{issue.description}</AppText>
      </View>
      {action ? (
        <Button onPress={backgroundIssueActionHandlers[action.kind]} size="sm" variant="secondary">
          <Button.Label>{action.label}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

/** Renders the single line shown while background sync works. */
function SettingsBackgroundOkLine() {
  return (
    <View className="gap-0.5">
      <AppText className="text-sm font-medium text-foreground">
        {SETTINGS_BACKGROUND_COPY.okTitle}
      </AppText>
      <AppText className="text-xs leading-snug text-muted">
        {SETTINGS_BACKGROUND_COPY.okDescription}
      </AppText>
    </View>
  );
}

/** Renders the background card: one line when all works, only the failing items otherwise. */
export function SettingsBackgroundCard(props: Readonly<SettingsBackgroundCardProps>) {
  const { status, backgroundIssueActionHandlers } = props;

  return (
    <Card testID="settings-background-card">
      <Card.Header>
        <AppText className="text-xs font-semibold uppercase tracking-wider text-muted">
          {SETTINGS_BACKGROUND_COPY.title}
        </AppText>
      </Card.Header>
      <Card.Body className="gap-2.5 pt-3">
        {status.kind === 'inactive' ? (
          <AppText className="text-sm text-muted">
            {SETTINGS_BACKGROUND_COPY.inactiveDescription}
          </AppText>
        ) : null}
        {status.kind === 'ok' ? <SettingsBackgroundOkLine /> : null}
        {status.kind === 'needs_attention'
          ? status.issues.map((issue) => (
              <SettingsBackgroundIssueRow
                backgroundIssueActionHandlers={backgroundIssueActionHandlers}
                issue={issue}
                key={issue.id}
              />
            ))
          : null}
      </Card.Body>
    </Card>
  );
}
