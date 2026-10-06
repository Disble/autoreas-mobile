import type {
  BatteryExemptionPromptCopy,
  BatteryExemptionPromptVariant,
} from './battery-exemption-prompt.types';

/** User-facing copy (neutral Spanish) for each battery-exemption dialog variant. */
export const BATTERY_EXEMPTION_PROMPT_COPY: Readonly<
  Record<BatteryExemptionPromptVariant, BatteryExemptionPromptCopy>
> = {
  prompt: {
    title: 'Mantén la sincronización activa',
    description:
      'Android puede detener la sincronización en segundo plano para ahorrar batería. Si permites la excepción, tus capítulos se seguirán sincronizando aunque la app esté cerrada.',
    allowActionLabel: 'Permitir',
    dismissActionLabel: 'Ahora no',
  },
  reminder: {
    title: 'La sincronización en segundo plano se detuvo',
    description:
      'Android detuvo la sincronización para ahorrar batería. Este es el último aviso: también puedes activar la excepción más adelante desde Ajustes.',
    allowActionLabel: 'Permitir',
    dismissActionLabel: 'Cerrar',
  },
};
