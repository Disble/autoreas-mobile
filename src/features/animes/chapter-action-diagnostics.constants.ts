/**
 * Wire vocabulary for the chapter-control action feed.
 *
 * Every value here is a closed token, because the bridge stores request bodies verbatim: an
 * action label, an anime id or a raw error message would persist at rest and travel with backups.
 * Anything outside this file's vocabulary is dropped by the recorder instead of being forwarded
 * "in case it is harmless".
 *
 * The feed uses ONE event kind with a `phase` dimension rather than one event name per milestone.
 * New diagnostics for these controls add a vocabulary value here; they do not need a new event
 * name, and the native courier that delivers the stored payload never learns any of them.
 *
 * The kind token is the bridge's, not ours: `episode_action` is the declared name of the body it
 * accepts, and the bridge retires the word `chapter` in its own domain. That retirement is about
 * the WIRE only -- the mobile identifiers around this file (`ChapterAction*`, `capPlus`, the file
 * names) stay as they are, and the translation happens once, in the payload builder.
 */
export const CHAPTER_ACTION_EVENT_KIND = 'episode_action';

/**
 * The four chapter gestures, mapped from the in-app label to a stable wire token. The keys match
 * the labels `useMutateAnime` already passes to the mutation helpers, so no second naming layer
 * can drift from the first; only the VALUES are the bridge's vocabulary, and they name the
 * episode number rather than the tap that changed it.
 */
export const CHAPTER_ACTION_WIRE_ACTIONS = {
  capPlus: 'episode_plus_one',
  capMinus: 'episode_minus_one',
  capPlusHalf: 'episode_plus_half',
  capMinusHalf: 'episode_minus_half',
} as const;

/**
 * The milestones of one action, one question each: did the JS callback run (`received`), was the
 * action dropped or produce no change (`skipped`), did the local write commit or fail
 * (`finished`), and did the immediate push to the bridge succeed or fail (`sync`).
 */
export const CHAPTER_ACTION_PHASES = ['received', 'skipped', 'finished', 'sync'] as const;

/**
 * Closed reasons an action produced no local change. `in_flight` is the list screen's own
 * same-anime guard; `anime_missing` is the mutation helper finding no row to update;
 * `db_unavailable` is the mutation hook finding no SQLite context at all, where the write door
 * never opened -- reported as a skip rather than a `finished`/`failed` because nothing was
 * attempted, so claiming either outcome would overstate what the device actually knows.
 */
export const CHAPTER_ACTION_SKIPPED_REASONS = [
  'in_flight',
  'anime_missing',
  'db_unavailable',
] as const;

/** Closed outcomes for the local write itself. `committed` means the row and its operation landed. */
export const CHAPTER_ACTION_FINISHED_OUTCOMES = ['committed', 'failed'] as const;

/** Closed outcomes for the fire-and-forget push that follows a committed write. */
export const CHAPTER_ACTION_SYNC_OUTCOMES = ['ok', 'failed'] as const;

/**
 * The outcome vocabulary each phase declares, and the whole of it: the one cross-field table that
 * pairs `outcome` with `phase`.
 *
 * `received` and `skipped` declare an EMPTY vocabulary rather than being absent from the map, which
 * is how "this body carries no `outcome` key at all" is stated in one place: every phase answers
 * the question, and two of them answer "none". Both real vocabularies contain `failed`, which is
 * exactly why this cannot be two independent membership checks -- only the lookup by phase can tell
 * a `failed` write from a `failed` push.
 */
export const CHAPTER_ACTION_PHASE_OUTCOMES = {
  received: [],
  skipped: [],
  finished: CHAPTER_ACTION_FINISHED_OUTCOMES,
  sync: CHAPTER_ACTION_SYNC_OUTCOMES,
} as const;

/**
 * Every phase-specific field an observation may carry, named as on `ChapterActionObservation`.
 *
 * Listed once so the recorder can assert "this observation carries NOTHING besides what its own
 * phase allows" without re-enumerating the omissions at each phase -- an enumeration that would
 * need editing every time a phase gains a field, and would silently stop guarding the moment it
 * drifted from the type it claims to describe.
 */
export const CHAPTER_ACTION_OPTIONAL_FIELDS = [
  'outcome',
  'reason',
  'cause',
  'durationMs',
] as const;
