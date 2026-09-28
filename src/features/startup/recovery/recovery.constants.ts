import type { ResetRefusalReason } from '../../../infrastructure/db/recovery';

/**
 * Groups every user-visible string of the startup recovery layer by the state that renders it.
 *
 * The copy is grouped, not flattened into dozens of one-line exports, on purpose: a flat list of
 * near-identical `export const` string declarations is a structural clone (the duplication detector
 * flagged exactly that shape against `setup-screen.constants.ts`), and a grouped object keyed by
 * state also reads as what it is -- one card's whole copy in one place. Every string below is
 * product copy: changing one means changing what a user reads, so the tests pin the load-bearing
 * ones verbatim (the damage title, the two damage actions, the unsent-changes warning and the
 * last-resort storage warning).
 */

/**
 * Copy of the damage card: the only state that carries a destructive action.
 *
 * Rendered for confirmed physical corruption alone -- the presentation helper derives the state
 * from `decideDatabaseReset`, so a non-corruption classification can never reach this copy.
 */
export const STARTUP_RECOVERY_DAMAGE_COPY = {
  description: 'La base de datos local no pasó la verificación de integridad y la app no puede abrirla.',
  primaryActionLabel: 'Volver a configurar Mobile',
  secondaryActionLabel: 'Ahora no',
  title: 'Los datos locales de este dispositivo están dañados',
} as const;

/**
 * Copy of the single destructive confirmation.
 *
 * The description states the loss as a possibility (`pueden perderse`) and says explicitly that the
 * Bridge does not hold those changes: the app has no way to prove the Bridge received anything the
 * user wrote locally, so the copy must never imply the Bridge already has them.
 */
export const STARTUP_RECOVERY_CONFIRM_COPY = {
  cancelActionLabel: 'Cancelar',
  confirmActionLabel: 'Borrar y volver a configurar',
  description:
    'Se borra la base local dañada y Mobile queda como en su primera vez. Los cambios locales que todavía no llegaron al Bridge pueden perderse: el Bridge no los tiene. Después vas a tener que emparejar el Bridge otra vez.',
  title: '¿Volver a configurar Mobile?',
} as const;

/** Copy of the explanation shown after the user declines the reset for this attempt. */
export const STARTUP_RECOVERY_DECLINED_COPY = {
  description:
    'Dejamos tus datos locales como están. Si quieres volver a configurar Mobile, cierra y vuelve a abrir la app: la opción vuelve a aparecer al iniciar.',
  title: 'No volvimos a configurar Mobile',
} as const;

/** Copy of the transient guidance for a `busy` startup failure, including its optional retry. */
export const STARTUP_RECOVERY_TRANSIENT_COPY = {
  closeAndReopenHint: 'Cierra y vuelve a abrir la app para liberar la base local.',
  retryActionLabel: 'Reintentar',
  title: 'La base local está ocupada',
} as const;

/** Copy of the card shown while a confirmed reset is running. */
export const STARTUP_RECOVERY_RESETTING_COPY = {
  description: 'Estamos borrando la base local dañada y preparando una nueva. No cierres la app.',
  title: 'Volviendo a configurar Mobile',
} as const;

/** Copy of the card shown once the fresh database is prepared. */
export const STARTUP_RECOVERY_RESET_COMPLETED_COPY = {
  description: 'Ya puedes volver a configurar Mobile y emparejar tu Bridge.',
  title: 'Mobile quedó como nueva',
} as const;

/** Copy of the card shown when the reset could not finish, including its retry label. */
export const STARTUP_RECOVERY_FAILED_COPY = {
  description:
    'La app no pudo terminar de restablecer la base local. Puedes intentarlo de nuevo y, si vuelve a fallar, cierra y vuelve a abrir la app: el restablecimiento se retoma solo.',
  retryActionLabel: 'Reintentar',
  title: 'No pudimos volver a configurar Mobile',
} as const;

/**
 * Copy of the last-resort escape hatch offered after a failed reset.
 *
 * The warning states what clearing the application storage destroys (ALL app data and settings,
 * the damaged database included) and that clearing the cache is not a repair for this database.
 */
export const STARTUP_RECOVERY_LAST_RESORT_COPY = {
  actionLabel: 'Abrir ajustes de la app',
  description: 'Si no puedes avanzar, abre los ajustes de Android para esta app y borra sus datos manualmente.',
  warning:
    'Ojo: borrar los datos de la app elimina TODOS los datos y ajustes locales, incluida la base dañada. Borrar la caché no repara la base local.',
} as const;

/** Title of every explanatory state that must not offer a reset; the description is per-reason. */
export const STARTUP_RECOVERY_NO_RESET_COPY = {
  title: 'No hace falta borrar tus datos',
} as const;

/** Copy of the ordinary setup path shown when no Bridge is configured yet. */
export const STARTUP_RECOVERY_SETUP_COPY = {
  description:
    'Todavía no hay un Bridge configurado en este dispositivo. La app abre la pantalla de configuración y puedes emparejarlo cuando quieras.',
} as const;

/**
 * Explains each refusal so the user knows the local data stays intact, keyed by the reset
 * boundary's own refusal vocabulary.
 *
 * Every reason maps to copy here: a new refusal reason cannot be added without this record gaining
 * a member, so no classification can silently reach a state with no explanation. `busy` is the
 * transient state's description, which is why it lives in the same record.
 */
export const STARTUP_RECOVERY_REFUSAL_DESCRIPTIONS: Readonly<Record<ResetRefusalReason, string>> = {
  busy: 'La app no pudo preparar la base local porque otra operación la estaba usando en ese momento.',
  incompatible_schema:
    'La base local es de otra versión de la app. Tus datos siguen intactos: no hace falta borrar nada.',
  schema_validation:
    'La base local no cumple las reglas del esquema actual. Tus datos siguen intactos: no hace falta borrar nada.',
  sqlite:
    'La base local respondió con un error de SQLite, no con una base dañada. Tus datos siguen intactos: no hace falta borrar nada.',
  unknown:
    'La app no pudo identificar qué falló en la base local. Tus datos siguen intactos: no hace falta borrar nada.',
};
