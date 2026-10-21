// Resolve hook: expo modules → mocks; extensionless relative TS imports → .ts.
const here = new URL('./', import.meta.url).href;
const MAP = {
  'expo-sqlite': 'sqlite.mjs', 'expo-secure-store': 'securestore.mjs', 'expo-crypto': 'crypto.mjs',
  'expo-file-system/legacy': 'fs.mjs', 'expo-print': 'print.mjs', 'expo-sharing': 'print.mjs',
};
export async function resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: here + MAP[spec], shortCircuit: true };
  if (/^crypto-js\/[a-z0-9-]+$/.test(spec)) return next(spec + '.js', ctx);
  if ((spec.startsWith('./') || spec.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch { /* fall through */ }
  }
  return next(spec, ctx);
}
