import type { LayoutMode } from '../../../../hooks/responsive-layout.types';
import type {
  SettingsBackgroundIssue,
  SettingsBackgroundIssueId,
  SettingsTone,
} from './settings-screen.types';

/** Maps responsive layout modes to the Settings content width class. */
export const SETTINGS_CONTAINER_WIDTH_CLASS: Readonly<Record<LayoutMode, string>> = {
  phone: 'max-w-full',
  'tablet-portrait': 'max-w-[760px]',
  'tablet-landscape': 'max-w-[1120px]',
};

/** Tints the status card icon badge with the soft variant of its tone. */
export const SETTINGS_STATUS_ICON_BG_CLASS: Readonly<Record<SettingsTone, string>> = {
  default: 'bg-surface-secondary',
  accent: 'bg-accent/15',
  success: 'bg-success/15',
  warning: 'bg-warning/15',
  danger: 'bg-danger/15',
};

/** Colors the status title only when the state asks for attention; calm states stay foreground. */
export const SETTINGS_STATUS_TITLE_CLASS: Readonly<Record<SettingsTone, string>> = {
  default: 'text-foreground',
  accent: 'text-foreground',
  success: 'text-foreground',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Separator between the parts of the status card meta line. */
export const SETTINGS_STATUS_META_SEPARATOR = ' · ';

/** User-facing copy (neutral Spanish) for the status card's contextual actions. */
export const SETTINGS_STATUS_ACTION_LABELS = {
  goToSetup: 'Emparejar PC',
  retry: 'Reintentar ahora',
  syncNow: 'Sincronizar ahora',
} as const;

/** User-facing copy (neutral Spanish) for the connection card. */
export const SETTINGS_CONNECTION_COPY = {
  title: 'Conexión con la PC',
  hostLabel: 'PC',
  deviceIdLabel: 'Este dispositivo',
  missingIp: 'Sin IP',
  missingPort: 'Sin puerto',
  rePairTitle: 'Re-emparejar',
  rePairDescription: 'Úsalo si cambiaste de PC o se reinstaló el bridge.',
  rePairLabel: 'Re-emparejar',
  rePairingLabel: 'Re-emparejando...',
} as const;

/** User-facing copy (neutral Spanish) for the background card. */
export const SETTINGS_BACKGROUND_COPY = {
  title: 'Segundo plano',
  okTitle: 'Sync automático activo',
  okDescription: 'Sigue funcionando con la app cerrada.',
  inactiveDescription: 'Se activa al emparejar una PC.',
} as const;

/** Copy and fix for each background-sync item that can need the user's attention. */
export const SETTINGS_BACKGROUND_ISSUES: Readonly<
  Record<SettingsBackgroundIssueId, SettingsBackgroundIssue>
> = {
  background_unsupported: {
    id: 'background_unsupported',
    title: 'Segundo plano no disponible',
    description:
      'Este dispositivo no permite el sync con la app cerrada. Se sincroniza mientras la app está abierta.',
    action: null,
  },
  background_service: {
    id: 'background_service',
    title: 'El sync automático no está activo',
    description:
      'El servicio en segundo plano no está corriendo. Revisa que la app pueda funcionar en segundo plano.',
    action: { kind: 'open_app_settings', label: 'Abrir ajustes' },
  },
  battery_exemption: {
    id: 'battery_exemption',
    title: 'El sync puede pausarse con la app cerrada',
    description: 'Android limita la batería de esta app. Permítele funcionar en segundo plano.',
    action: { kind: 'request_battery_exemption', label: 'Permitir' },
  },
  notification_permission: {
    id: 'notification_permission',
    title: 'Notificación persistente desactivada',
    description:
      'Permite las notificaciones de la app para que Android mantenga el sync activo con la app cerrada.',
    action: { kind: 'open_app_settings', label: 'Abrir ajustes' },
  },
};

/** User-facing copy (neutral Spanish) for the privacy card. */
export const SETTINGS_PRIVACY_COPY = {
  title: 'Privacidad',
  telemetryLabel: 'Enviar diagnóstico a la PC',
  telemetryDescription:
    'Ayuda a encontrar fallas de sync sin conectar el cable. Solo viajan códigos y contadores: ningún título, ruta ni dato tuyo.',
} as const;
