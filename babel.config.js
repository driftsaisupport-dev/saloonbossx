module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
    env: {
      production: {
        // Strip console.log/info/debug from release builds so nothing sensitive
        // is written to logcat / device logs. warn + error are kept.
        plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]],
      },
    },
  };
};
