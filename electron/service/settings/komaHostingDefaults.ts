import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { settingsDB } from '../storage/SettingsDB';
import { SqliteAppSettingsKvRepository } from '../storage/repositories/SqliteAppSettingsKvRepository';
import { createChannelConfig, listChannelConfigs, updateChannelConfig } from './ChannelConfigService';
import { decryptDistributedCredential } from './distributedCredential';

/** Seed a dedicated Koma hosting credential without changing media defaults. */
export function initializeKomaHostingDefaults(): void {
  const kv = new SqliteAppSettingsKvRepository();
  const marker = 'koma-hosting-defaults-v1';
  if (kv.get(marker)) return;
  const credentialPath = path.join(app.getAppPath(), 'resources', 'koma-hosting-defaults.local.json');
  const encryptedPath = path.join(app.getAppPath(), 'resources', 'koma-hosting-defaults.enc.json');
  const apiKey = process.env.KOMA_IMAGE_HOSTING_API_KEY?.trim()
    || (fs.existsSync(encryptedPath) ? decryptDistributedCredential(fs.readFileSync(encryptedPath, 'utf8'), 'hosting') : '')
    || (!app.isPackaged && fs.existsSync(credentialPath) ? JSON.parse(fs.readFileSync(credentialPath, 'utf8')).apiKey?.trim() : '');
  if (!apiKey) return;

  settingsDB.transaction(() => {
    const existing = listChannelConfigs('image-hosting')
      .filter(channel => channel.pluginId === 'com.koma.qiniu-image-hosting'
        && channel.providerType === 'qiniu-image-hosting')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (existing) {
      if (!existing.hasApiKey) {
        updateChannelConfig(existing.id, { providerConfig: { ...existing.providerConfig, apiKey } });
      }
    } else {
      createChannelConfig({
        category: 'image-hosting', providerType: 'qiniu-image-hosting',
        name: '七牛云图床（内置）', source: 'plugin', pluginId: 'com.koma.qiniu-image-hosting',
        enabled: true, models: [], capabilities: ['image-hosting'],
        providerConfig: { enabled: true, apiKey },
      });
    }
    kv.set(marker, 'true');
  });
}
