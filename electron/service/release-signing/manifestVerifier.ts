import { createHash, createPublicKey, verify as ed25519Verify } from 'node:crypto';
import { getPublicKeyPem } from './publicKey';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

let cachedPublicKey: ReturnType<typeof createPublicKey> | null = null;
function publicKey() {
  if (!cachedPublicKey) cachedPublicKey = createPublicKey(getPublicKeyPem());
  return cachedPublicKey;
}

export function verifyEd25519(payload: Buffer | string, sigBase64: string): boolean {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const sig = Buffer.from(sigBase64, 'base64');
  try {
    return ed25519Verify(null, data, publicKey(), sig);
  } catch {
    return false;
  }
}

export interface UpdateManifest {
  version: string;
  releasedAt: string;
  minVersion?: string;
  channel?: 'stable' | 'beta';
  critical?: boolean;
  platforms: Record<string, { file: string; sha512: string; size: number }>;
  notes?: { zh?: string; en?: string };
}

export function verifyAppManifest(
  manifestJson: string,
  sigBase64: string,
  lastInstalledVersion: string | null,
): VerifyResult {
  if (!verifyEd25519(manifestJson, sigBase64)) {
    return { ok: false, reason: 'signature-invalid' };
  }
  let m: UpdateManifest;
  try {
    m = JSON.parse(manifestJson);
  } catch {
    return { ok: false, reason: 'manifest-malformed' };
  }
  if (!m.version || !m.releasedAt) {
    return { ok: false, reason: 'manifest-missing-fields' };
  }
  const releasedAt = Date.parse(m.releasedAt);
  if (Number.isNaN(releasedAt)) {
    return { ok: false, reason: 'manifest-bad-released-at' };
  }
  if (Date.now() - releasedAt > THIRTY_DAYS_MS) {
    return { ok: false, reason: 'manifest-expired' };
  }
  if (lastInstalledVersion && compareSemver(m.version, lastInstalledVersion) <= 0) {
    return { ok: false, reason: 'downgrade-rejected' };
  }
  return { ok: true };
}

export interface PluginRegistry {
  registryVersion: number;
  updatedAt: string;
  plugins: Array<{
    id: string;
    name: string;
    latestVersion: string;
    category?: string;
    iconUrl?: string;
    description?: string;
    downloadUrl: string;
    sha512: string;
    engine?: { minAppVersion?: string; maxAppVersion?: string; apiVersion?: string };
  }>;
  signature: string;
}

export function verifyPluginRegistry(rawJson: string): VerifyResult & { registry?: PluginRegistry } {
  let parsed: PluginRegistry;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, reason: 'registry-malformed' };
  }
  if (!parsed.signature) return { ok: false, reason: 'registry-unsigned' };
  // 重组未签名时的规范 JSON：排除 signature 字段后稳定序列化
  const { signature, ...rest } = parsed;
  const canonical = canonicalJsonStringify(rest);
  if (!verifyEd25519(canonical, signature)) {
    return { ok: false, reason: 'registry-signature-invalid' };
  }
  const updatedAt = Date.parse(parsed.updatedAt);
  if (Number.isNaN(updatedAt)) return { ok: false, reason: 'registry-bad-updated-at' };
  if (Date.now() - updatedAt > SEVEN_DAYS_MS) {
    return { ok: false, reason: 'registry-expired' };
  }
  return { ok: true, registry: parsed };
}

export function verifyPluginManifest(
  manifestObjectWithSignature: Record<string, unknown>,
  lastInstalledVersion: string | null,
): VerifyResult {
  const signature = manifestObjectWithSignature.signature;
  if (typeof signature !== 'string') {
    return { ok: false, reason: 'manifest-unsigned' };
  }
  const { signature: _omit, ...rest } = manifestObjectWithSignature;
  const canonical = canonicalJsonStringify(rest);
  if (!verifyEd25519(canonical, signature)) {
    return { ok: false, reason: 'manifest-signature-invalid' };
  }
  const version = manifestObjectWithSignature.version;
  if (typeof version !== 'string') return { ok: false, reason: 'manifest-missing-version' };
  if (lastInstalledVersion && compareSemver(version, lastInstalledVersion) <= 0) {
    return { ok: false, reason: 'downgrade-rejected' };
  }
  return { ok: true };
}

export function sha512Hex(buf: Buffer): string {
  return createHash('sha512').update(buf).digest('hex');
}

export function sha512Base64(buf: Buffer): string {
  return createHash('sha512').update(buf).digest('base64');
}

/**
 * Stable, deterministic JSON for signing.
 * 必须与签名脚本端 (`scripts/sign-*.cjs`) 使用完全相同的序列化方式。
 */
export function canonicalJsonStringify(obj: unknown): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] - pb.parts[i];
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre.localeCompare(pb.pre);
  return 0;
}

function parseSemver(v: string): { parts: [number, number, number]; pre?: string } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(v);
  if (!m) return null;
  return { parts: [+m[1], +m[2], +m[3]], pre: m[4] };
}
