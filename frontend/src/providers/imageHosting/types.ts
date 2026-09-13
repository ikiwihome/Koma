/**
 * Image Hosting Provider contract (pluggable via channelConfig + ProviderRegistry).
 *
 * This is intentionally small: providers accept bytes and return a remote URL.
 * Any source-shape compatibility (local path / data-url / blob-url) is handled
 * in a dedicated service layer to avoid scattered compat code.
 */

export interface ImageHostingUploadOptions {
  filename?: string;
  outputFormat?: string;
  cdnDomain?: string;
}

export interface ImageHostingUploadResult {
  success: boolean;
  url?: string;
  error?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ImageHostingProvider {
  type: string;
  validate(): boolean;
  testConnection(): Promise<boolean>;

  uploadImage(
    bytes: ArrayBuffer | Uint8Array,
    options?: ImageHostingUploadOptions
  ): Promise<ImageHostingUploadResult>;
}

