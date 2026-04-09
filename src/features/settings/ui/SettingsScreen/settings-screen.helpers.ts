import { SettingsScreenDefaultLabel } from './settings-screen.constants';

/**
 * Resolves the fallback label shown by the scaffolded component.
 * This keeps even placeholder presentation logic out of the hook body.
 */
export function getSettingsScreenLabel(label?: string) {
  return label ?? SettingsScreenDefaultLabel;
}
