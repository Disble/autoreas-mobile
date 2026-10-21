/** Expo's Metro configuration factory, resolved against this project root. */
const { getDefaultConfig } = require('expo/metro-config');
/** Uniwind's Metro wrapper, which compiles global.css and writes the theme declaration. */
const { withUniwindConfig } = require('uniwind/metro');

/** Metro configuration: Expo defaults, extended so SQL migrations bundle as assets. */
const config = getDefaultConfig(__dirname);

if (!config.resolver.sourceExts.includes('sql')) {
  config.resolver.sourceExts.push('sql');
}

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
