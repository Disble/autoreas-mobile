import { buildAnimeMutationFailureFeedback } from '../../anime-mutation-failure.helpers';
import { beginChapterAction } from '../../chapter-action-diagnostics.helpers';
import type { ChapterActionLabel } from '../../chapter-action-diagnostics.types';
import { buildRefreshFailureFeedback } from './anime-list-screen.helpers';
import type {
  AnimeListScreenChapterActionRunner,
  AnimeListScreenChapterMutationDeps,
  AnimeListScreenManualRefreshDeps,
} from './anime-list-screen.types';

/**
 * Runs one chapter gesture and reports its failure, without holding anything back meanwhile.
 *
 * There is no same-anime lock, by design: a write that is still pending may not disable a control
 * or discard a valid tap. Ordering belongs to the write door the mutation goes through, and the
 * values the card shows while that write settles belong to the mutation projection -- neither needs
 * a UI guard, and a guard here would only turn a fast double tap into a single one.
 *
 * Lives outside the hook because React Compiler bailed on this statement inside the hook body:
 * `react-hooks-js/todo` was reported at the chapter mutation's `try`, and a bail-out that deep
 * costs the whole hook its automatic memoization. The toast has exactly one home: the rejection
 * must be narrated after a failed write, and after a toast that throws while narrating it, without
 * ever escaping to the caller.
 *
 * `handleRefresh` had the same problem later (`runManualRefresh` below): the compiler does not lower a
 * `try` with a `finally` clause at all, so any such statement in a hook body bails out the whole hook.
 *
 * The `received` observation is opened first, because this is the only point that can answer "did the
 * tap reach JS at all": a disabled button never gets here, and neither does a tap swallowed by a dead
 * JS thread. The switch is resolved once, here, by `beginChapterAction`.
 */
export async function runChapterMutation(
  animeId: string,
  actionLabel: ChapterActionLabel,
  action: AnimeListScreenChapterActionRunner,
  deps: AnimeListScreenChapterMutationDeps,
): Promise<void> {
  const actionContext = beginChapterAction(actionLabel, {
    isTelemetryEnabled: deps.isTelemetryEnabled,
  });

  try {
    await action(animeId, actionContext);
  } catch (error) {
    // Callers fire this through `void handleCapPlus(...)`, so an escaping rejection would become
    // an unhandled promise and the button would just look dead. Surface it instead.
    console.warn('[AnimeListScreen] Anime mutation failed:', error);
    const feedback = buildAnimeMutationFailureFeedback(error);

    try {
      deps.toast.show({
        variant: 'danger',
        label: feedback.label,
        description: feedback.description,
        duration: 4000,
      });
    } catch (toastError) {
      // A throwing toast would escape into the caller's `void handleCapPlus(id)` and become an
      // unhandled rejection -- the exact failure this catch block removes.
      console.warn('[AnimeListScreen] Failed to show mutation failure toast:', toastError);
    }
  }
}

/**
 * Runs one manual refresh from the list: the spinner is on while the sync runs and always off after it,
 * and a failed sync becomes a warning toast worded from the sync facts of the render that asked.
 *
 * Lives outside `useAnimeListScreen` because React Compiler cannot lower a `try` with a `finally`
 * clause; inside the hook that statement cost the whole hook its automatic memoization.
 */
export async function runManualRefresh(deps: AnimeListScreenManualRefreshDeps): Promise<void> {
  deps.setIsRefreshing(true);

  try {
    await deps.manualSync();
  } catch (error) {
    console.warn('[AnimeListScreen] Manual refresh failed:', error);
    const feedback = buildRefreshFailureFeedback(deps.syncFacts);

    deps.toast.show({
      variant: 'warning',
      label: feedback.label,
      description: feedback.description,
      duration: 4000,
    });
  } finally {
    deps.setIsRefreshing(false);
  }
}
