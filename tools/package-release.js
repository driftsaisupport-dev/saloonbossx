#!/usr/bin/env node
/**
 * Zip the project SOURCE for hand-over / archiving:  npm run package:release
 *   → dist/SaloonBossX-<version>-source.zip
 *
 * Refuses to include the licence signing key (keys/private.key), .env files,
 * keystores or any other secret (see tools/lib/releaseFiles.js), and re-checks
 * the finished archive before it is kept. node_modules / .git / build output
 * are left out.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { releaseFiles, isForbidden } = require('./lib/releaseFiles');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (deflate), enough for a source archive. */
function buildZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Names inside a ZIP buffer (central directory), used to double-check the result. */
function zipNames(buf) {
  const names = [];
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (i < 0) return names;
  let p = buf.readUInt32LE(i + 16);
  const count = buf.readUInt16LE(i + 10);
  for (let n = 0; n < count; n++) {
    const len = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    names.push(buf.slice(p + 46, p + 46 + len).toString('utf8'));
    p += 46 + len + extra + comment;
  }
  return names;
}

function main() {
  const files = releaseFiles(root);
  const bad = files.filter(isForbidden);
  if (bad.length) { console.error('Refusing to package secrets:', bad.join(', ')); process.exit(1); }
  const entries = files.map((rel) => ({ name: rel.split(path.sep).join('/'), data: fs.readFileSync(path.join(root, rel)) }));
  const zip = buildZip(entries);
  const leaked = zipNames(zip).filter(isForbidden);
  if (leaked.length) { console.error('Archive check failed — secret files found:', leaked.join(', ')); process.exit(1); }
  const outDir = path.join(root, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `SaloonBossX-${version}-source.zip`);
  fs.writeFileSync(out, zip);
  console.log(`Wrote ${path.relative(root, out)} (${entries.length} files, ${Math.round(zip.length / 1024)} KB). keys/ and secrets excluded.`);
}

if (require.main === module) main();
module.exports = { buildZip, zipNames };
