/* eslint-disable react-doctor/jsx-max-depth -- `Card > Card.Body > list > row > AppText` is the floor
 * of a listed folder inside the mandated HeroUI Native card.
 */
import { Stack } from 'expo-router';
import { Card, Chip, cn } from 'heroui-native';
import { View } from 'react-native';
import { AppText } from '../../../../components/app-text';
import { ScreenScrollView } from '../../../../components/screen-scroll-view';
import {
  ANIME_FOLDERS_DETAIL_COPY,
  ANIME_FOLDERS_DETAIL_SCREEN_OPTIONS,
} from './anime-folders-detail-screen.constants';
import type { AnimeFoldersDetailContentProps } from './anime-folders-detail-screen.types';
import { useAnimeFoldersDetailScreen } from './use-anime-folders-detail-screen';

/** Renders one total of the "EN ESTA TABLET" section. */
function AnimeFoldersTotal({ value, label, className }: Readonly<{ value: number; label: string; className: string }>) {
  return (
    <View className={cn('flex-1 rounded-xl px-3 py-2.5', className)}>
      <AppText className="text-xl font-semibold text-foreground">{value}</AppText>
      <AppText className="text-xs text-muted">{label}</AppText>
    </View>
  );
}

/** Renders the detail content; dumb so every state can be rendered directly. */
export function AnimeFoldersDetailContent(props: Readonly<AnimeFoldersDetailContentProps>) {
  const { rootLabel, view, statusLabel, isWide } = props;

  return (
    <ScreenScrollView contentContainerClassName="pb-10">
      <View className={cn('mx-auto w-full max-w-[1120px] gap-4 px-4 pt-4', isWide && 'flex-row items-start')}>
        <View className={cn('gap-4', isWide && 'flex-1')}>
          <Card>
            <Card.Body className="gap-2">
              <AppText className="text-xs font-semibold tracking-wider text-muted">
                {ANIME_FOLDERS_DETAIL_COPY.rootSection}
              </AppText>
              <AppText className="text-base text-foreground">{rootLabel ?? '—'}</AppText>
              {view ? (
                <>
                  <View className="flex-row gap-2 pt-1">
                    <AnimeFoldersTotal value={view.totals.folders} label={ANIME_FOLDERS_DETAIL_COPY.foldersTotal} className="bg-surface-secondary" />
                    <AnimeFoldersTotal value={view.totals.withAnime} label={ANIME_FOLDERS_DETAIL_COPY.withAnimeTotal} className="bg-success/15" />
                    <AnimeFoldersTotal value={view.totals.withoutAnime} label={ANIME_FOLDERS_DETAIL_COPY.withoutAnimeTotal} className="bg-warning/15" />
                  </View>
                  <AppText className="text-xs text-muted">{ANIME_FOLDERS_DETAIL_COPY.scanNote}</AppText>
                </>
              ) : (
                <AppText className="text-sm text-muted">{statusLabel}</AppText>
              )}
            </Card.Body>
          </Card>

          {view ? (
            <>
              <Card>
                <Card.Body className="gap-2">
                  <AppText className="text-xs font-semibold tracking-wider text-warning">{view.unmatchedTitle}</AppText>
                  {view.unmatchedFolders.length === 0 ? (
                    <AppText className="text-sm text-muted">{ANIME_FOLDERS_DETAIL_COPY.none}</AppText>
                  ) : (
                    view.unmatchedFolders.map((name) => (
                      <View key={name} className="bg-surface-secondary gap-1 rounded-xl p-3">
                        <AppText className="text-sm text-foreground">{name}</AppText>
                        <AppText className="text-xs text-muted">{ANIME_FOLDERS_DETAIL_COPY.unmatchedHint}</AppText>
                      </View>
                    ))
                  )}
                </Card.Body>
              </Card>

              <Card>
                <Card.Body className="gap-2">
                  <AppText className="text-xs font-semibold tracking-wider text-muted">{view.sharedTitle}</AppText>
                  {view.sharedFolders.map((name) => (
                    <AppText key={name} className="text-sm text-foreground">{name}</AppText>
                  ))}
                  <AppText className="text-sm text-muted">
                    {view.sharedFolders.length === 0
                      ? `${ANIME_FOLDERS_DETAIL_COPY.none} ${ANIME_FOLDERS_DETAIL_COPY.sharedHint}`
                      : ANIME_FOLDERS_DETAIL_COPY.sharedHint}
                  </AppText>
                </Card.Body>
              </Card>
            </>
          ) : null}
        </View>

        {view ? (
          <Card className={cn(isWide && 'flex-1')}>
            <Card.Body className="gap-1">
              <AppText className="text-xs font-semibold tracking-wider text-success">{view.matchedTitle}</AppText>
              {view.matchedFolders.map((row) => (
                <View key={row.name} className="border-border flex-row items-center gap-3 border-b py-2">
                  <AppText className="flex-1 text-sm text-foreground" numberOfLines={1}>
                    {row.name}
                  </AppText>
                  <Chip size="sm" color="success" variant="secondary">
                    <Chip.Label>{row.methodLabel}</Chip.Label>
                  </Chip>
                </View>
              ))}
            </Card.Body>
          </Card>
        ) : null}
      </View>
    </ScreenScrollView>
  );
}

/** Renders the read-only "Carpetas de anime" detail screen (canvas 08). */
export function AnimeFoldersDetailScreen() {
  const { rootLabel, view, statusLabel, isWide } = useAnimeFoldersDetailScreen();

  return (
    <>
      <Stack.Screen options={ANIME_FOLDERS_DETAIL_SCREEN_OPTIONS} />
      <AnimeFoldersDetailContent rootLabel={rootLabel} view={view} statusLabel={statusLabel} isWide={isWide} />
    </>
  );
}
