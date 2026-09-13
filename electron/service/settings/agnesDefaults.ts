import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { settingsDB } from '../storage/SettingsDB';
import { SqliteAppSettingsKvRepository } from '../storage/repositories/SqliteAppSettingsKvRepository';
import { createChannelConfig, getChannelConfig, setMediaDefault, type ChannelConfigInput } from './ChannelConfigService';
import { decryptDistributedCredential } from './distributedCredential';

/** Seed once; keep existing channels, hosting credentials and later user edits. */
export function initializeAgnesDefaults(): void {
  const kv = new SqliteAppSettingsKvRepository();
  if (kv.get('agnes-defaults-v1')) return;
  const resourceDir = path.join(app.getAppPath(), 'resources');
  const credentialPath = path.join(resourceDir, 'agnes-defaults.local.json');
  const encryptedPath = path.join(resourceDir, 'agnes-defaults.enc.json');
  const apiKey = process.env.AGNES_API_KEY?.trim()
    || (fs.existsSync(encryptedPath) ? decryptDistributedCredential(fs.readFileSync(encryptedPath, 'utf8'), 'agnes') : '')
    || (!app.isPackaged && fs.existsSync(credentialPath) ? JSON.parse(fs.readFileSync(credentialPath, 'utf8')).apiKey?.trim() : '');
  if (!apiKey) return;
  const configs = JSON.parse(fs.readFileSync(path.join(resourceDir, 'agnes-models.json'), 'utf8')) as ChannelConfigInput[];
  settingsDB.transaction(() => {
    for (const config of configs) {
      if (!getChannelConfig(config.id!)) {
        createChannelConfig({ ...config, source: 'builtin', enabled: true,
          providerConfig: { ...config.providerConfig, apiKey, managedBy: 'agnes-activation' } });
      }
      setMediaDefault(config.category, config.id!, config.defaultModelId);
    }
    const now = Date.now();
    kv.set('agnes-activation', JSON.stringify({ activatedAt: now, lastValidatedAt: now,
      maskedKey: `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`,
      defaultChannelIds: { llm: 'agnes-default-llm', tti: 'agnes-default-tti', itv: 'agnes-default-itv' } }));
    kv.set('agnes-defaults-v1', 'true');
  });
}
