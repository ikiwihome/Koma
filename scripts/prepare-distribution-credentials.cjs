const fs = require('node:fs');
const path = require('node:path');
const { createCipheriv, createHash, randomBytes } = require('node:crypto');

function prepareDistributionCredentials() {
  const root = path.resolve(__dirname, '..');
  const credentials = [
    { name: 'koma-hosting-defaults', env: 'KOMA_IMAGE_HOSTING_API_KEY', purpose: 'hosting' },
    { name: 'agnes-defaults', env: 'AGNES_API_KEY', purpose: 'agnes' },
  ].map(config => {
    const input = path.join(root, 'resources', `${config.name}.local.json`);
    const apiKey = process.env[config.env]?.trim()
      || (fs.existsSync(input) ? JSON.parse(fs.readFileSync(input, 'utf8')).apiKey?.trim() : '');
    if (!apiKey) throw new Error(`Provide ${config.env} or resources/${config.name}.local.json before building`);
    return { ...config, apiKey };
  });
  for (const { name, purpose, apiKey } of credentials) {
    const key = createHash('sha256').update(`com.koma.studio/${purpose}-defaults/v1`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const envelope = { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
    fs.writeFileSync(path.join(root, 'resources', `${name}.enc.json`), JSON.stringify(envelope) + '\n');
  }
  console.log('[defaults] Encrypted Agnes and Koma distribution credentials prepared');
}

module.exports = prepareDistributionCredentials;
if (require.main === module) prepareDistributionCredentials();
