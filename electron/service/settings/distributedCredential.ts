import { createDecipheriv, createHash } from 'crypto';

// Portable packaging protection only: the desktop app necessarily includes the
// material needed to decrypt this envelope. Per-user storage uses safeStorage.
export function decryptDistributedCredential(raw: string, purpose: 'hosting' | 'agnes'): string {
  const distributionKey = createHash('sha256').update(`com.koma.studio/${purpose}-defaults/v1`).digest();
  const envelope = JSON.parse(raw);
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported bundled credential format');
  }
  const decipher = createDecipheriv('aes-256-gcm', distributionKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final(),
  ]).toString('utf8').trim();
}
