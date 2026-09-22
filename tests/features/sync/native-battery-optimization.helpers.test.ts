import { createNativeBatteryOptimizationExemption } from '../../../src/features/sync/native-battery-optimization.helpers';
import type { NativeBatteryOptimizationModule } from '../../../src/features/sync/native-battery-optimization.types';

describe('native-battery-optimization', () => {
  function buildNativeModule(
    overrides: Partial<NativeBatteryOptimizationModule> = {},
  ): NativeBatteryOptimizationModule {
    return {
      isIgnoringBatteryOptimizations: jest.fn().mockReturnValue(false),
      requestIgnoreBatteryOptimizations: jest.fn().mockReturnValue(false),
      ...overrides,
    };
  }

  it('degrades to false for both operations when the native module is unavailable', () => {
    const exemption = createNativeBatteryOptimizationExemption({
      requireOptionalNativeModule: () => null,
    });

    expect(() => exemption.isExempt()).not.toThrow();
    expect(exemption.isExempt()).toBe(false);
    expect(() => exemption.requestExemption()).not.toThrow();
    expect(exemption.requestExemption()).toBe(false);
  });

  it('reports the native exemption state through isExempt', () => {
    const module = buildNativeModule({
      isIgnoringBatteryOptimizations: jest.fn().mockReturnValue(true),
    });
    const exemption = createNativeBatteryOptimizationExemption({
      requireOptionalNativeModule: () => module,
    });

    expect(exemption.isExempt()).toBe(true);
    expect(module.isIgnoringBatteryOptimizations).toHaveBeenCalledTimes(1);
  });

  it('requests the exemption through the native module and reports whether the intent launched', () => {
    const module = buildNativeModule({
      requestIgnoreBatteryOptimizations: jest.fn().mockReturnValue(true),
    });
    const exemption = createNativeBatteryOptimizationExemption({
      requireOptionalNativeModule: () => module,
    });

    expect(exemption.requestExemption()).toBe(true);
    expect(module.requestIgnoreBatteryOptimizations).toHaveBeenCalledTimes(1);
  });

  it('reports false when the native module refuses to launch the exemption request', () => {
    const module = buildNativeModule({
      requestIgnoreBatteryOptimizations: jest.fn().mockReturnValue(false),
    });
    const exemption = createNativeBatteryOptimizationExemption({
      requireOptionalNativeModule: () => module,
    });

    expect(exemption.requestExemption()).toBe(false);
  });

  it('treats an unexpected native module lookup error as unavailable instead of throwing', () => {
    const exemption = createNativeBatteryOptimizationExemption({
      requireOptionalNativeModule: () => {
        throw new Error('bridge not ready');
      },
    });

    expect(() => exemption.isExempt()).not.toThrow();
    expect(exemption.isExempt()).toBe(false);
    expect(() => exemption.requestExemption()).not.toThrow();
    expect(exemption.requestExemption()).toBe(false);
  });
});
