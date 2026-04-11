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
          compileSdkVersion: 36,
          targetSdkVersion: 35,
          usesCleartextTraffic: true,
        },
      },
    ]);
  });
});
