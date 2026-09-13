/**
 * SSRF 防护：私有 IP / 内网地址过滤
 */
import { lookup } from 'dns/promises';

/** 私有/保留 IP 段定义 [network, mask] */
const BLOCKED_RANGES: Array<[number, number]> = [
  // 127.0.0.0/8 — loopback
  [0x7F000000, 0xFF000000],
  // 10.0.0.0/8 — private
  [0x0A000000, 0xFF000000],
  // 172.16.0.0/12 — private
  [0xAC100000, 0xFFF00000],
  // 192.168.0.0/16 — private
  [0xC0A80000, 0xFFFF0000],
  // 169.254.0.0/16 — link-local
  [0xA9FE0000, 0xFFFF0000],
  // 0.0.0.0/8 — current network
  [0x00000000, 0xFF000000],
];

function ipToUint32(ip: string): number {
  const parts = ip.split('.').map(Number);
  // 使用无符号右移确保结果为无符号 32 位整数
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPv4(address: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // loopback
  if (normalized === '::1' || normalized === '::') return true;
  // IPv4-mapped  ::ffff:x.x.x.x
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7);
    if (isIPv4(mapped)) return isBlockedIP(mapped);
    return true;
  }
  // link-local  fe80::/10
  if (normalized.startsWith('fe80:')) return true;
  // unique local  fc00::/7 (fd00:: 也属于此范围)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // 公网 IPv6 — 放行
  return false;
}

export function isBlockedIP(ip: string): boolean {
  if (!isIPv4(ip)) {
    return isBlockedIPv6(ip);
  }

  const addr = ipToUint32(ip);
  return BLOCKED_RANGES.some(([network, mask]) => (addr & mask) === network);
}

/**
 * 校验 URL 是否安全（非 SSRF 目标）
 * 1. 仅允许 http/https
 * 2. DNS 解析后检查 IP 是否为私有地址
 */
export async function validateUrl(url: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }

  const hostname = parsed.hostname;

  // 如果 hostname 直接是 IP
  if (isIPv4(hostname)) {
    if (isBlockedIP(hostname)) {
      throw new Error(`Access to private/reserved IP address is blocked: ${hostname}`);
    }
    return;
  }

  // 域名 → DNS 解析后检查
  try {
    const { address } = await lookup(hostname);
    if (isBlockedIP(address)) {
      throw new Error(`Domain "${hostname}" resolves to blocked IP: ${address}`);
    }
  } catch (err: any) {
    if (err.message?.includes('blocked')) throw err;
    throw new Error(`DNS resolution failed for "${hostname}": ${err.message}`);
  }
}
