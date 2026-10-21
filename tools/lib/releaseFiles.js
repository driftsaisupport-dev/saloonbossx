/**
 * What may and may not leave this computer in a release package.
 *
 * keys/private.key is the licence SIGNING key: anyone holding it can mint
 * unlimited valid licence keys. It must never be zipped, uploaded or committed.
 * Shared by tools/package-release.js and tools/preflight.js (and tested in
 * tests/release.test.js).
 */
const path = require('path');

/** Directories never walked into. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'android', 'ios', 'keys', '.idea', '.vscode']);

/** Files that must never be packaged, whatever folder they are in. */
function isForbidden(rel) {
  const p = rel.split(path.sep).join('/');
  const base = p.split('/').pop() || '';
  if (/^keys\//.test(p) && base !== '.gitkeep') return true;   // the whole keys folder (placeholder aside)
  if (/\.key$/i.test(base) && base !== 'license-public.key') return true;
  if (/^\.env(\..*)?$/.test(base) && base !== '.env.example') return true;
  if (/\.(jks|keystore|p12|pem|p8|mobileprovision)$/i.test(base)) return true;
  if (/^(credentials\.json|google-services\.json|GoogleService-Info\.plist)$/.test(base)) return true;
  if (/^generate-license-key\.js$/.test(base)) return true;   // legacy unsigned key generator
  return false;
}

/** Every file under `root` that may go into a release package, as relative paths. */
function releaseFiles(root, fs = require('fs')) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) && path.dirname(rel) === '.') continue;
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        walk(abs);
      } else if (ent.isFile() && !isForbidden(rel)) {
        out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** .gitignore must cover the signing key. Returns a problem string or ''. */
function gitignoreProblem(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const covered = lines.some((l) => ['keys/*.key', 'keys/', 'keys', '/keys/', '/keys/*.key', '*.key'].includes(l));
  return covered ? '' : '.gitignore does not cover keys/*.key — add the line "keys/*.key".';
}

module.exports = { isForbidden, releaseFiles, gitignoreProblem, SKIP_DIRS };
