/* global module, require */

const {
  AndroidConfig,
  withGradleProperties,
} = require('expo/config-plugins');

const GRADLE_JVM_ARGS =
  '-Xmx2g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8';

module.exports = function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (configWithGradleProperties) => {
    configWithGradleProperties.modResults =
      AndroidConfig.BuildProperties.updateAndroidBuildProperty(
        configWithGradleProperties.modResults,
        'org.gradle.jvmargs',
        GRADLE_JVM_ARGS,
      );

    return configWithGradleProperties;
  });
};
