const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro'); 
 
const config = getDefaultConfig(__dirname);

if (!config.resolver.sourceExts.includes('sql')) {
  config.resolver.sourceExts.push('sql');
}
 
module.exports = withUniwindConfig(config, {  
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
  extraThemes: [
    'lavender-light',
    'lavender-dark',
    'mint-light',
    'mint-dark',
    'sky-light',
    'sky-dark',
  ],
});
