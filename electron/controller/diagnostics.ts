import { BaseController } from './base';
import { ensureServicesReady, services } from '../service';
import type {
  DiagnosticsExportResult,
  DiagnosticsLogSummary,
  DiagnosticsUsageSummary,
  RendererLogPayload,
} from '../service/diagnostics';

class DiagnosticsController extends BaseController {
  async appendRendererLog(args: RendererLogPayload): Promise<{ success: true }> {
    await ensureServicesReady();
    return services.diagnostics.appendRendererLog(args);
  }

  async listLogs(): Promise<DiagnosticsLogSummary> {
    await ensureServicesReady();
    return services.diagnostics.listLogs();
  }

  async getUsage(): Promise<DiagnosticsUsageSummary> {
    await ensureServicesReady();
    return services.diagnostics.getUsage();
  }

  async clearLogs(): Promise<{ success: true; removed: number }> {
    await ensureServicesReady();
    return services.diagnostics.clearLogs();
  }

  async clearRendererLogs(): Promise<{ success: true; removed: number }> {
    await ensureServicesReady();
    return services.diagnostics.clearRendererLogs();
  }

  async exportLogs(args: { destPath: string }): Promise<DiagnosticsExportResult> {
    await ensureServicesReady();
    return services.diagnostics.exportLogs(args.destPath);
  }
}

export = DiagnosticsController;
