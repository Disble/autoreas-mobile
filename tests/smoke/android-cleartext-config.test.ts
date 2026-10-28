/** The real `app.json`, read as data so the test pins the Android build properties it declares. */
const appConfig = jest.requireActual('../../app.json') as {
  expo: {
    plugins: (
      | string
      | [string, { android?: { usesCleartextTraffic?: boolean; compileSdkVersion?: number; targetSdkVersion?: number } }]
    )[];
  };
};

describe('android cleartext bootstrap config', () => {
  it('enables cleartext traffic through expo-build-properties', () => {
    const buildPropertiesEntry = appConfig.expo.plugins.find(
      (
        plugin
      ): plugin is [
        string,
        { android?: { usesCleartextTraffic?: boolean; compileSdkVersion?: number; targetSdkVersion?: number } },
      ] =>
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildPropertiesEntry).toEqual([
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 37,
          targetSdkVersion: 36,
          usesCleartextTraffic: true,
        },
      },
    ]);
  });
});
