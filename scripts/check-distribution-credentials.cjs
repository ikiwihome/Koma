const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

function loadTs(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code,
    { module, exports: module.exports, Buffer, process: { env: {} },
      require: id => dependencies[id] || require(id) });
  return module.exports;
}
let decode = loadTs('electron/service/settings/distributedCredential.ts').decryptDistributedCredential;
const archivePath = process.argv[2];
const asar = archivePath ? require('@electron/asar') : null;
const archive = archivePath ? fs.readFileSync(archivePath) : null;
if (asar) {
  // Verify the decoder that actually ships, including the production obfuscation.
  const module = { exports: {} };
  vm.runInNewContext(asar.extractFile(archivePath, path.join('public', 'electron', 'service', 'settings', 'distributedCredential.js')).toString(),
    { module, exports: module.exports, require, Buffer });
  decode = module.exports.decryptDistributedCredential;
}
for (const [name, purpose, env] of [
  ['agnes-defaults', 'agnes', 'AGNES_API_KEY'],
  ['koma-hosting-defaults', 'hosting', 'KOMA_IMAGE_HOSTING_API_KEY'],
]) {
  const expected = process.env[env]?.trim() || JSON.parse(fs.readFileSync(`resources/${name}.local.json`, 'utf8')).apiKey.trim();
  const encrypted = asar ? asar.extractFile(archivePath, path.join('resources', `${name}.enc.json`)).toString()
    : fs.readFileSync(`resources/${name}.enc.json`, 'utf8');
  assert.ok(decode(encrypted, purpose) === expected, `${purpose}: credential mismatch`);
  assert.ok(!encrypted.includes(expected), `${purpose}: plaintext in envelope`);
  assert.throws(() => decode(encrypted, purpose === 'agnes' ? 'hosting' : 'agnes'));
  if (asar) {
    assert.throws(() => asar.statFile(archivePath, path.join('resources', `${name}.local.json`)));
    assert.ok(!archive.includes(Buffer.from(expected)), `${purpose}: plaintext in app archive`);
  }
}

// Packaged Agnes bootstrap must read encrypted defaults and only seed once.
const kv = new Map();
const created = [];
const mediaDefaults = [];
const deps = {
  electron: { app: { getAppPath: () => process.cwd(), isPackaged: true } },
  './distributedCredential': { decryptDistributedCredential: decode },
  '../storage/SettingsDB': { settingsDB: { transaction: fn => fn() } },
  '../storage/repositories/SqliteAppSettingsKvRepository': {
    SqliteAppSettingsKvRepository: class { get(k) { return kv.get(k); } set(k, v) { kv.set(k, v); } },
  },
  './ChannelConfigService': {
    getChannelConfig: () => undefined,
    createChannelConfig: input => created.push(input),
    setMediaDefault: (...args) => mediaDefaults.push(args),
  },
};
const { initializeAgnesDefaults } = loadTs('electron/service/settings/agnesDefaults.ts', deps);
initializeAgnesDefaults();
assert.equal(created.length, 3);
assert.equal(mediaDefaults.length, 3);
assert.ok(created.every(c => c.providerConfig.apiKey === decode(fs.readFileSync('resources/agnes-defaults.enc.json', 'utf8'), 'agnes')));
initializeAgnesDefaults();
assert.equal(created.length, 3);
assert.equal(mediaDefaults.length, 3);
console.log(`PASS: both encrypted credentials, separate contexts, Agnes bootstrap/idempotence${asar ? ', shipped decoder and no plaintext keys in app archive' : ''}`);
