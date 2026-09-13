const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const code = transformSync(fs.readFileSync('electron/service/settings/komaHostingDefaults.ts', 'utf8'), {
  loader: 'ts', format: 'cjs',
}).code;

const decoderModule = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync('electron/service/settings/distributedCredential.ts', 'utf8'), {
  loader: 'ts', format: 'cjs',
}).code, { module: decoderModule, exports: decoderModule.exports, require, Buffer });
const decode = raw => decoderModule.exports.decryptDistributedCredential(raw, 'hosting');
const crypto = require('node:crypto');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update('com.koma.studio/hosting-defaults/v1').digest(), iv);
const ciphertext = Buffer.concat([cipher.update('test-host-key'), cipher.final()]);
const envelope = { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
const encrypted = JSON.stringify(envelope);
assert.equal(decode(encrypted), 'test-host-key');
ciphertext[0] ^= 1;
assert.throws(() => decode(JSON.stringify({ ...envelope, ciphertext: ciphertext.toString('base64') })));

function harness(existing = [], credential = 'test-host-key', options = {}) {
  const kv = new Map();
  const created = [];
  const updated = [];
  const module = { exports: {} };
  const deps = {
    fs: { existsSync: p => p.endsWith('.enc.json') ? !!options.encrypted : !!credential,
      readFileSync: p => p.endsWith('.enc.json') ? options.encrypted : JSON.stringify({ apiKey: credential }) },
    './distributedCredential': { decryptDistributedCredential: decode },
    path: require('node:path'),
    electron: { app: { getAppPath: () => '/test/app', isPackaged: !!options.packaged } },
    '../storage/SettingsDB': { settingsDB: { transaction: fn => fn() } },
    '../storage/repositories/SqliteAppSettingsKvRepository': {
      SqliteAppSettingsKvRepository: class { get(k) { return kv.get(k); } set(k, v) { kv.set(k, v); } },
    },
    './ChannelConfigService': {
      listChannelConfigs: category => { assert.equal(category, 'image-hosting'); return existing; },
      createChannelConfig: input => created.push(input),
      updateChannelConfig: (id, patch) => updated.push({ id, patch }),
    },
  };
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: {} }, require: key => {
    assert.ok(deps[key], `Unexpected dependency: ${key}`);
    return deps[key];
  } });
  return { run: module.exports.initializeKomaHostingDefaults, created, updated, kv };
}

const fresh = harness();
fresh.run();
assert.equal(fresh.created.length, 1);
assert.equal(fresh.created[0].providerConfig.apiKey, 'test-host-key');
assert.equal(fresh.created[0].providerType, 'qiniu-image-hosting');
assert.equal(fresh.created[0].isDefault, undefined);
fresh.run();
assert.equal(fresh.created.length, 1);

const channel = { id: 'existing-host', pluginId: 'com.koma.qiniu-image-hosting',
  providerType: 'qiniu-image-hosting', updatedAt: 1, providerConfig: { enabled: false, custom: 'keep' } };
const missingKey = harness([channel]);
missingKey.run();
assert.equal(missingKey.created.length, 0);
assert.equal(missingKey.updated[0].id, channel.id);
assert.equal(missingKey.updated[0].patch.providerConfig.enabled, false);
assert.equal(missingKey.updated[0].patch.providerConfig.custom, 'keep');

const configured = harness([{ ...channel, hasApiKey: true }]);
configured.run();
assert.equal(configured.updated.length, 0);
assert.equal(configured.created.length, 0);

const absent = harness([], '');
absent.run();
assert.equal(absent.kv.size, 0);
assert.equal(absent.created.length, 0);
const distributed = harness([], '', { packaged: true, encrypted });
distributed.run();
assert.equal(distributed.created[0].providerConfig.apiKey, 'test-host-key');
const plaintextOnly = harness([], 'must-not-use', { packaged: true });
plaintextOnly.run();
assert.equal(plaintextOnly.created.length, 0);
console.log('PASS: default migration/preservation, portable encrypted credential, tamper rejection, packaged plaintext exclusion');
