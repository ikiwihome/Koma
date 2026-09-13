/**
 * 导出器注册表 - 管理所有可用的草稿导出器
 */

import type { DraftExporter } from './types';

class ExporterRegistry {
  private exporters: Map<string, DraftExporter> = new Map();

  register(exporter: DraftExporter): void {
    this.exporters.set(exporter.format, exporter);
  }

  unregister(format: string): void {
    this.exporters.delete(format);
  }

  get(format: string): DraftExporter | undefined {
    return this.exporters.get(format);
  }

  getAll(): DraftExporter[] {
    return Array.from(this.exporters.values());
  }

  getFormats(): string[] {
    return Array.from(this.exporters.keys());
  }

  has(format: string): boolean {
    return this.exporters.has(format);
  }
}

// 单例导出器注册表
export const exporterRegistry = new ExporterRegistry();
