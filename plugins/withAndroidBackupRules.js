/**
 * Applies android-config/*.xml during every build (EAS or local prebuild).
 *
 * Before this plugin the rules only existed as files you had to copy by hand
 * after `expo prebuild`. EAS cloud builds never did that, so Android used its
 * default rules and backed up the encrypted database — which cannot be opened
 * on a new phone because its key stays in the old phone's Keystore.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const FILES = ['backup_rules.xml', 'data_extraction_rules.xml'];

module.exports = function withAndroidBackupRules(config) {
  config = withDangerousMod(config, ['android', async (cfg) => {
    const src = path.join(cfg.modRequest.projectRoot, 'android-config');
    const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
    fs.mkdirSync(dest, { recursive: true });
    for (const f of FILES) fs.copyFileSync(path.join(src, f), path.join(dest, f));
    return cfg;
  }]);

  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application && cfg.modResults.manifest.application[0];
    if (app) {
      app.$['android:allowBackup'] = 'true';
      app.$['android:fullBackupContent'] = '@xml/backup_rules';
      app.$['android:dataExtractionRules'] = '@xml/data_extraction_rules';
      const tools = cfg.modResults.manifest.$;
      if (!tools['xmlns:tools']) tools['xmlns:tools'] = 'http://schemas.android.com/tools';
      const replace = new Set(String(app.$['tools:replace'] || '').split(',').filter(Boolean));
      ['android:allowBackup', 'android:fullBackupContent', 'android:dataExtractionRules'].forEach((a) => replace.add(a));
      app.$['tools:replace'] = Array.from(replace).join(',');
    }
    return cfg;
  });

  return config;
};
