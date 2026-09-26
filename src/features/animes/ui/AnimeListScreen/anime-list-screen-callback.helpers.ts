import { buildAnimeMutationFailureFeedback } from '../../anime-mutation-failure.helpers';
import {
  beginChapterAction,
  recordChapterActionSkipped,
} from '../../chapter-action-diagnostics.helpers';
import type { ChapterActionLabel } from '../../chapter-action-diagnostics.types';
import type {
  AnimeListScreenChapterActionRunner,
  AnimeListScreenChapterMutationDeps,
} from './anime-list-screen.types';

/**
 * Runs one chapter gesture through the list screen's shared same-anime lock.
 *
 * Lives outside the hook because React Compiler bailed on this statement inside the hook body:
 * `react-hooks-js/todo` was reported at the chapter mutation's `try`, and a bail-out that deep
 * costs the whole hook its automatic memoization. The release guarantee is exactly a finalizer --
 * the same-anime entry must be cleared after a success, after a rejected write, and after a toast
 * that throws while reporting that rejection -- and a module-level function is not memoized, so it
 * is the compiler-safe home for that statement.
 *
 * `handleRefresh` in the hook keeps its own, simpler `try/catch/finally`: the same compiler accepts
 * that shape, so only this one had to move.
 *
 * The `received` observation is opened BEFORE the guard, because this is the only point that can
 * answer "did the tap reach JS at all": a disabled button never gets here, and neither does a tap
 * swallowed by a dead JS thread. Everything after this line is attributable to a callback that
 * ran. The switch is resolved once here, by `beginChapterAction`, and restated at the guard so both
 * observations of one tap come from the same render.
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

  if (deps.mutatingAnimeByIdRef.current[animeId]) {
    // The callback ran and the same-anime guard dropped it. Distinct from a failure: nothing was
    // attempted, so nothing can have been lost.
    recordChapterActionSkipped(actionContext, 'in_flight', {
      isTelemetryEnabled: deps.isTelemetryEnabled,
    });
    return;
  }

  const nextMutatingState = {
    ...deps.mutatingAnimeByIdRef.current,
    [animeId]: true,
  };
  deps.mutatingAnimeByIdRef.current = nextMutatingState;
  deps.setIsMutatingAnimeById(nextMutatingState);

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
      // A throwing toast would escape past `finally` into the caller's `void handleCapPlus(id)`
      // and become an unhandled rejection -- the exact failure this catch block removes.
      console.warn('[AnimeListScreen] Failed to show mutation failure toast:', toastError);
    }
  } finally {
    const releasedState = { ...deps.mutatingAnimeByIdRef.current };
    delete releasedState[animeId];
    deps.mutatingAnimeByIdRef.current = releasedState;
    deps.setIsMutatingAnimeById(releasedState);
  }
}
