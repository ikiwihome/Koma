/**
 * Koma release signing public key (ed25519, SPKI PEM, base64-encoded).
 *
 * 用于验签：
 *   - 主程序更新 manifest (koma-update-manifest.json + .sig)
 *   - 插件 marketplace 注册表 (plugin-registry.json 内 signature 字段)
 *   - 插件 manifest.json 内 signature 字段
 *
 * 对应私钥仅存在于 GitHub Secrets `KOMA_UPDATE_SIGN_KEY` + 本地备份
 * (~/.koma-release-key/private.pem)，永不入仓。
 *
 * 密钥轮换：替换此常量需要同步替换 Secrets 中的私钥并发新版本；
 * 否则旧客户端无法验签新 manifest，更新链路会断。
 */

export const KOMA_PUBLIC_KEY_PEM_B64 =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQWg1ajVFUDBOWE9SRTBGMjhMaGtQOUIvZWppd3pxdDVFYUZqeU1BamloQkk9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=';

export function getPublicKeyPem(): string {
  return Buffer.from(KOMA_PUBLIC_KEY_PEM_B64, 'base64').toString('utf8');
}
