const appConfig = jest.requireActual('../../app.json') as {
  expo: {
    plugins: (string | [string, { android?: { usesCleartextTraffic?: boolean } }])[];
  };
};

describe('android cleartext bootstrap config', () => {
  it('enables cleartext traffic through expo-build-properties', () => {
    const buildPropertiesEntry = appConfig.expo.plugins.find(
      (
        plugin
      ): plugin is [string, { android?: { usesCleartextTraffic?: boolean } }] =>
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
    );

    expect(buildPropertiesEntry).toEqual([
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ]);
  });
});
