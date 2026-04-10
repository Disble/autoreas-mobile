import {
  BACKGROUND_SYNC_REGISTRATION_LABELS,
  BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS,
} from './settings-screen.constants';
import type {
  BackgroundSyncRow,
  BackgroundSyncSection,
  BuildBackgroundSyncSectionInput,
} from './settings-screen.types';

/**
 * Formats runtime timestamps into a stable, readable UTC label for the Settings surface.
 * Using a deterministic formatter keeps tests and diagnostics aligned across devices.
 */
export function formatBackgroundSyncTimestamp(timestamp: number | null) {
  if (timestamp === null) {
    return 'Sin datos';
  }

  const date = new Date(timestamp);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')} UTC`;
}

/**
 * Maps the persisted runtime snapshot into presentation copy for Settings.
 * This keeps status wording centralized so the TSX stays a pure render function.
 */
export function buildBackgroundSyncSection({
  isConfigured,
  snapshot,
}: BuildBackgroundSyncSectionInput): BackgroundSyncSection {
  if (!isConfigured) {
    return {
      title: 'Sync en segundo plano inactivo',
      description:
        'Emparejá un bridge para habilitar el runtime de sync y exponer estado real en segundo plano.',
      status: 'Sin bridge emparejado',
      statusTone: 'warning',
      rows: [
        {
          label: 'Registro',
          value: 'No disponible sin bridge emparejado',
        },
      ],
    };
  }

  if (snapshot.registrationStatus === 'unsupported') {
    return {
      title: 'Sync en segundo plano no soportado',
      description:
        'Este binario no expone SQLite/Background Task, así que la app no puede registrar el sync periódico.',
      status: 'No soportado',
      statusTone: 'warning',
      rows: [{ label: 'Registro', value: 'No soportado' }],
    };
  }

  const rows: BackgroundSyncRow[] = [
    {
      label: 'Registro',
      value: BACKGROUND_SYNC_REGISTRATION_LABELS[snapshot.registrationStatus],
    },
  ];

  if (snapshot.lastAttemptAt !== null) {
    rows.push({
      label: 'Último intento',
      value: formatBackgroundSyncTimestamp(snapshot.lastAttemptAt),
    });
  }

  if (snapshot.lastSuccessAt !== null) {
    rows.push({
      label: 'Último éxito',
      value: formatBackgroundSyncTimestamp(snapshot.lastSuccessAt),
    });
  }

  if (snapshot.lastFailureMessage) {
    rows.push({
      label: 'Último fallo',
      value: snapshot.lastFailureMessage,
    });
  }

  if (snapshot.lastTriggerSource) {
    rows.push({
      label: 'Último origen',
      value: BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS[snapshot.lastTriggerSource],
    });
  }

  rows.push({
    label: 'Últimas operaciones confirmadas',
    value: String(snapshot.lastSyncedCount),
  });

  if (snapshot.lastFailureMessage) {
    return {
      title: 'Último sync con error',
      description:
        'La app guarda el último fallo conocido para que puedas entender el estado sin abrir logs ni debugger.',
      status: BACKGROUND_SYNC_REGISTRATION_LABELS[snapshot.registrationStatus],
      statusTone: 'danger',
      rows,
    };
  }

  if (snapshot.registrationStatus === 'registered' && snapshot.lastSuccessAt !== null) {
    return {
      title: 'Sync en segundo plano operativo',
      description:
        'El task periódico figura registrado y el snapshot local ya tiene al menos un ciclo exitoso.',
      status: 'Registrado',
      statusTone: 'success',
      rows,
    };
  }

  if (snapshot.registrationStatus === 'registered') {
    return {
      title: 'Sync en segundo plano pendiente',
      description:
        'El task está registrado, pero todavía no hay un ciclo exitoso observado en este dispositivo.',
      status: 'Registrado',
      statusTone: 'accent',
      rows,
    };
  }

  return {
    title: 'Sync en segundo plano no registrado',
    description:
      'La app está emparejada, pero todavía no observa un registro activo del task periódico.',
    status: 'No registrado',
    statusTone: 'warning',
    rows,
  };
}
