import { useSeasonModeStore } from '../../../src/infrastructure/store/season-mode-store';

describe('season mode store', () => {
  beforeEach(() => {
    useSeasonModeStore.setState({ seasonMode: false });
  });

  it('defaults season mode to false (matches the bridge missing-row sentinel)', () => {
    expect(useSeasonModeStore.getState().seasonMode).toBe(false);
  });

  it('updates season mode via setSeasonMode', () => {
    useSeasonModeStore.getState().setSeasonMode(true);

    expect(useSeasonModeStore.getState().seasonMode).toBe(true);
  });

  it('toggles back to false', () => {
    useSeasonModeStore.getState().setSeasonMode(true);
    useSeasonModeStore.getState().setSeasonMode(false);

    expect(useSeasonModeStore.getState().seasonMode).toBe(false);
  });
});
