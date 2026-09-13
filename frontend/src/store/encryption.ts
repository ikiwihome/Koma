/**
 * API Key 加密存储服务
 * 使用 AES-256-GCM 对称加密，密钥从机器标识派生
 */

const SENSITIVE_KEYS = new Set([
  'apiKey', 'apiSecret', 'token', 'password', 'credential', 'secret',
]);

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const ENCRYPTED_PREFIX = '$ENC$';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

async function deriveKey(machineId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(machineId.padEnd(32, '0').slice(0, 32)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('koma-settings-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptValue(value: string, key: CryptoKey): Promise<string> {
  if (!value) return value;
  if (value.startsWith(ENCRYPTED_PREFIX)) return value;

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(value),
  );

  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);

  return ENCRYPTED_PREFIX + btoa(String.fromCharCode(...combined));
}

async function decryptValue(value: string, key: CryptoKey): Promise<string> {
  if (!value || !value.startsWith(ENCRYPTED_PREFIX)) return value;

  try {
    const raw = value.slice(ENCRYPTED_PREFIX.length);
    const combined = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const iv = combined.slice(0, IV_LENGTH);
    const data = combined.slice(IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      data,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // 解密失败（可能是旧的明文数据），返回空字符串
    return '';
  }
}

async function processObject<T>(
  obj: T,
  processor: (value: string) => Promise<string>,
): Promise<T> {
  if (Array.isArray(obj)) {
    const result = [];
    for (const item of obj) {
      result.push(await processObject(item, processor));
    }
    return result as T;
  }
  if (obj && typeof obj === 'object') {
    const result = { ...obj } as Record<string, any>;
    for (const key of Object.keys(result)) {
      if (isSensitiveKey(key) && typeof result[key] === 'string') {
        result[key] = await processor(result[key]);
      } else if (result[key] && typeof result[key] === 'object') {
        result[key] = await processObject(result[key], processor);
      }
    }
    return result as T;
  }
  return obj;
}

function getMachineId(): string {
  if (typeof window !== 'undefined' && 'electronAPI' in window) {
    // 同步获取缓存的 machineId（由 initEncryption 预加载）
    return _cachedMachineId || 'browser-instance';
  }
  return 'browser-instance';
}

let _cachedMachineId = '';
let _cachedKey: CryptoKey | null = null;

/**
 * 初始化加密模块（应在应用启动时调用一次）
 */
export async function initEncryption(machineId: string): Promise<void> {
  _cachedMachineId = machineId;
  _cachedKey = await deriveKey(machineId);
}

/**
 * 加密设置中的敏感字段
 */
export async function encryptSettings<T>(settings: T): Promise<T> {
  if (!_cachedKey) {
    const id = getMachineId();
    _cachedKey = await deriveKey(id);
  }
  const key = _cachedKey;
  return processObject(settings, (value) => encryptValue(value, key));
}

/**
 * 解密设置中的敏感字段
 */
export async function decryptSettings<T>(settings: T): Promise<T> {
  if (!_cachedKey) {
    const id = getMachineId();
    _cachedKey = await deriveKey(id);
  }
  const key = _cachedKey;
  return processObject(settings, (value) => decryptValue(value, key));
}

export default {
  initEncryption,
  encryptSettings,
  decryptSettings,
};
