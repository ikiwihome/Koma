/**
 * 项目控制器 - 含实体 CRUD
 */
import { BaseController } from './base';
import { services } from '../service';
import { ensureServicesReady } from '../service';
import type { ProjectMeta, ExportOptions, ProjectsIndex } from '../service/project';
import type {
  CharacterRow, SceneRow, PropRow, ShotRow, ShotVersionRow,
  AssetRow, EpisodeRow, TrackRow, ClipRow,
} from '../service/storage';

class ProjectController extends BaseController {

  async setStorageRoot(args: { rootPath: string }): Promise<{ success: boolean; rootPath: string }> {
    await ensureServicesReady();
    const rootPath = await services.project.setStorageRoot(args.rootPath);
    services.diagnostics.setStorageRoot(rootPath);
    services.ffmpeg.init(`${rootPath}/cache/ffmpeg`).catch(() => undefined);
    return { success: true, rootPath };
  }

  // ========== 项目 ==========

  async list(): Promise<ProjectMeta[]> {
    await ensureServicesReady();
    return services.project.listProjects();
  }

  async create(args: ProjectMeta): Promise<ProjectMeta> {
    await ensureServicesReady();
    return services.project.createProject(args);
  }

  async load(args: { projectId: string }): Promise<ProjectMeta> {
    await ensureServicesReady();
    return services.project.loadProject(args.projectId);
  }

  async loadFull(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.loadProjectFull(args.projectId);
  }

  async save(args: { projectId: string; data: any }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    return services.project.saveProject(args.projectId, args.data);
  }

  async update(args: { projectId: string; updates: Partial<ProjectMeta> }): Promise<ProjectMeta> {
    await ensureServicesReady();
    return services.project.updateProject(args.projectId, args.updates);
  }

  async delete(args: { projectId: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    return services.project.deleteProject(args.projectId);
  }

  async rebuildIndex(): Promise<ProjectsIndex> {
    await ensureServicesReady();
    return services.project.rebuildIndex();
  }

  async export(args: {
    projectId: string; destPath: string; options?: ExportOptions;
  }): Promise<{ success: boolean; path: string }> {
    await ensureServicesReady();
    return services.project.exportProject(args.projectId, args.destPath, args.options);
  }

  async import(args: {
    zipPath: string; newProjectId?: string;
  }): Promise<{ success: boolean; projectId: string; meta: ProjectMeta }> {
    await ensureServicesReady();
    return services.project.importProject(args.zipPath, args.newProjectId);
  }

  // ========== 批量实体操作（前端类型透传） ==========

  async saveAllCharacters(args: { projectId: string; items: any[] }) {
    await ensureServicesReady();
    services.project.saveAllCharacters(args.projectId, args.items);
    return { success: true };
  }

  async loadAllCharacters(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.loadAllCharacters(args.projectId);
  }

  async saveAllScenes(args: { projectId: string; items: any[] }) {
    await ensureServicesReady();
    services.project.saveAllScenes(args.projectId, args.items);
    return { success: true };
  }

  async loadAllScenes(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.loadAllScenes(args.projectId);
  }

  async saveAllProps(args: { projectId: string; items: any[] }) {
    await ensureServicesReady();
    services.project.saveAllProps(args.projectId, args.items);
    return { success: true };
  }

  async loadAllProps(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.loadAllProps(args.projectId);
  }

  async saveAllShots(args: { projectId: string; items: any[] }) {
    await ensureServicesReady();
    services.project.saveAllShots(args.projectId, args.items);
    return { success: true };
  }

  async loadAllShots(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.loadAllShots(args.projectId);
  }

  async saveShotMeta(args: { projectId: string; shotId: string; meta: any }) {
    await ensureServicesReady();
    services.project.saveShotMeta(args.projectId, args.shotId, args.meta);
    return { success: true };
  }

  async loadShotMeta(args: { projectId: string; shotId: string }) {
    await ensureServicesReady();
    return services.project.loadShotMeta(args.projectId, args.shotId);
  }

  async listShotMetas(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.listShotMetas(args.projectId);
  }

  async saveAnalysis(args: { projectId: string; episodeId: string; analysis: any }) {
    await ensureServicesReady();
    services.project.saveEpisodeAnalysis(args.projectId, args.episodeId, args.analysis);
    return { success: true };
  }

  async loadAnalysis(args: { projectId: string; episodeId: string }) {
    await ensureServicesReady();
    return services.project.loadEpisodeAnalysis(args.projectId, args.episodeId);
  }

  async saveProjectTimeline(args: { projectId: string; timeline: any }) {
    await ensureServicesReady();
    services.project.saveProjectTimeline(args.projectId, args.timeline);
    return { success: true };
  }

  async loadProjectTimeline(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.loadProjectTimeline(args.projectId);
  }

  async saveEpisodeTimeline(args: { projectId: string; episodeId: string; timeline: any }) {
    await ensureServicesReady();
    services.project.saveEpisodeTimeline(args.projectId, args.episodeId, args.timeline);
    return { success: true };
  }

  async loadEpisodeTimeline(args: { projectId: string; episodeId: string }) {
    await ensureServicesReady();
    return services.project.loadEpisodeTimeline(args.projectId, args.episodeId);
  }

  // ========== 角色 ==========

  async characterList(args: { projectId: string }): Promise<CharacterRow[]> {
    await ensureServicesReady();
    return services.project.characterRepo.list(args.projectId);
  }

  async characterGet(args: { id: string }): Promise<CharacterRow | undefined> {
    await ensureServicesReady();
    return services.project.characterRepo.getById(args.id);
  }

  async characterCreate(args: CharacterRow): Promise<CharacterRow> {
    await ensureServicesReady();
    services.project.characterRepo.create(args);
    return args;
  }

  async characterUpdate(args: { id: string; data: Partial<CharacterRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.characterRepo.update(args.id, args.data);
    return { success: true };
  }

  async characterDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    const row = services.project.characterRepo.getById(args.id);
    services.project.characterRepo.delete(args.id);
    if (row) {
      const { taskService } = await import('../service/tasks/TaskService');
      taskService.removeByTarget(`project:${row.project_id}`, 'character', args.id);
    }
    return { success: true };
  }

  // ========== 场景 ==========

  async sceneList(args: { projectId: string }): Promise<SceneRow[]> {
    await ensureServicesReady();
    return services.project.sceneRepo.list(args.projectId);
  }

  async sceneGet(args: { id: string }): Promise<SceneRow | undefined> {
    await ensureServicesReady();
    return services.project.sceneRepo.getById(args.id);
  }

  async sceneCreate(args: SceneRow): Promise<SceneRow> {
    await ensureServicesReady();
    services.project.sceneRepo.create(args);
    return args;
  }

  async sceneUpdate(args: { id: string; data: Partial<SceneRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.sceneRepo.update(args.id, args.data);
    return { success: true };
  }

  async sceneDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    const row = services.project.sceneRepo.getById(args.id);
    services.project.sceneRepo.delete(args.id);
    if (row) {
      const { taskService } = await import('../service/tasks/TaskService');
      taskService.removeByTarget(`project:${row.project_id}`, 'scene', args.id);
    }
    return { success: true };
  }

  // ========== 道具 ==========

  async propList(args: { projectId: string }): Promise<PropRow[]> {
    await ensureServicesReady();
    return services.project.propRepo.list(args.projectId);
  }

  async propGet(args: { id: string }): Promise<PropRow | undefined> {
    await ensureServicesReady();
    return services.project.propRepo.getById(args.id);
  }

  async propCreate(args: PropRow): Promise<PropRow> {
    await ensureServicesReady();
    services.project.propRepo.create(args);
    return args;
  }

  async propUpdate(args: { id: string; data: Partial<PropRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.propRepo.update(args.id, args.data);
    return { success: true };
  }

  async propDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    const row = services.project.propRepo.getById(args.id);
    services.project.propRepo.delete(args.id);
    if (row) {
      const { taskService } = await import('../service/tasks/TaskService');
      taskService.removeByTarget(`project:${row.project_id}`, 'prop', args.id);
    }
    return { success: true };
  }

  // ========== 分镜 ==========

  async shotList(args: { projectId: string }): Promise<ShotRow[]> {
    await ensureServicesReady();
    return services.project.shotRepo.list(args.projectId);
  }

  async shotGet(args: { id: string }): Promise<ShotRow | undefined> {
    await ensureServicesReady();
    return services.project.shotRepo.getById(args.id);
  }

  async shotCreate(args: ShotRow): Promise<ShotRow> {
    await ensureServicesReady();
    services.project.shotRepo.create(args);
    return args;
  }

  async shotUpdate(args: { id: string; data: Partial<ShotRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.shotRepo.update(args.id, args.data);
    return { success: true };
  }

  async shotDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    const row = services.project.shotRepo.getById(args.id);
    services.project.shotRepo.delete(args.id);
    if (row) {
      const { taskService } = await import('../service/tasks/TaskService');
      taskService.removeByTarget(`project:${row.project_id}`, 'shot', args.id);
    }
    return { success: true };
  }

  async shotVersionList(args: { shotId: string }): Promise<ShotVersionRow[]> {
    await ensureServicesReady();
    return services.project.shotRepo.listVersions(args.shotId);
  }

  async shotVersionCreate(args: ShotVersionRow): Promise<ShotVersionRow> {
    await ensureServicesReady();
    services.project.shotRepo.createVersion(args);
    return args;
  }

  async shotVersionDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.shotRepo.deleteVersion(args.id);
    return { success: true };
  }

  async shotSetVersion(args: { shotId: string; versionNumber: number }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.shotRepo.setCurrentVersion(args.shotId, args.versionNumber);
    return { success: true };
  }

  // ========== 资产 ==========

  async assetList(args: { projectId: string }): Promise<AssetRow[]> {
    await ensureServicesReady();
    return services.project.assetRepo.list(args.projectId);
  }

  async assetGet(args: { id: string }): Promise<AssetRow | undefined> {
    await ensureServicesReady();
    return services.project.assetRepo.getById(args.id);
  }

  async assetCreate(args: AssetRow): Promise<AssetRow> {
    await ensureServicesReady();
    services.project.assetRepo.create(args);
    return args;
  }

  async assetUpdate(args: { id: string; data: Partial<AssetRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.assetRepo.update(args.id, args.data);
    return { success: true };
  }

  async assetDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.assetRepo.delete(args.id);
    return { success: true };
  }

  async assetFindByFingerprint(args: { projectId: string; fingerprint: string }): Promise<AssetRow | undefined> {
    await ensureServicesReady();
    return services.project.assetRepo.findByFingerprint(args.projectId, args.fingerprint);
  }

  async assetListUnreferenced(args: { projectId: string }): Promise<AssetRow[]> {
    await ensureServicesReady();
    return services.project.assetRepo.listUnreferenced(args.projectId);
  }

  // ========== 集数 ==========

  async episodeList(args: { projectId: string }): Promise<EpisodeRow[]> {
    await ensureServicesReady();
    return services.project.episodeRepo.list(args.projectId);
  }

  async episodeGet(args: { id: string }): Promise<EpisodeRow | undefined> {
    await ensureServicesReady();
    return services.project.episodeRepo.getById(args.id);
  }

  async episodeCreate(args: EpisodeRow): Promise<EpisodeRow> {
    await ensureServicesReady();
    services.project.episodeRepo.create(args);
    return args;
  }

  async episodeUpdate(args: { id: string; data: Partial<EpisodeRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.episodeRepo.update(args.id, args.data);
    return { success: true };
  }

  async episodeDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    // 删 episode 之前先收集 shot ids，删完再统一清任务记录（episode + shots）
    const episode = services.project.episodeRepo.getById(args.id);
    const shotIds = episode
      ? services.project.shotRepo.listByEpisode(episode.project_id, args.id).map(s => s.id)
      : [];

    const result = services.project.deleteEpisode(args.id);

    if (episode && result.success) {
      const { taskService } = await import('../service/tasks/TaskService');
      const scope = `project:${episode.project_id}`;
      taskService.removeByTarget(scope, 'episode', args.id);
      for (const shotId of shotIds) {
        taskService.removeByTarget(scope, 'shot', shotId);
      }
    }
    return result;
  }

  async bindOwnerRefMedia(args: { projectId: string; ownerRef: any; asset: any }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    return services.project.bindOwnerRefMedia(args.projectId, args.ownerRef, args.asset);
  }

  // ========== 时间线 ==========

  async timelineGet(args: { projectId: string }) {
    await ensureServicesReady();
    return services.project.timelineRepo.getProjectTimeline(args.projectId);
  }

  async timelineUpdate(args: { id: string; data: any }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.timelineRepo.updateTimeline(args.id, args.data);
    return { success: true };
  }

  async trackAdd(args: TrackRow): Promise<TrackRow> {
    await ensureServicesReady();
    services.project.timelineRepo.addTrack(args);
    return args;
  }

  async trackUpdate(args: { id: string; data: Partial<TrackRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.timelineRepo.updateTrack(args.id, args.data);
    return { success: true };
  }

  async trackDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.timelineRepo.deleteTrack(args.id);
    return { success: true };
  }

  async clipAdd(args: ClipRow): Promise<ClipRow> {
    await ensureServicesReady();
    services.project.timelineRepo.addClip(args);
    return args;
  }

  async clipUpdate(args: { id: string; data: Partial<ClipRow> }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.timelineRepo.updateClip(args.id, args.data);
    return { success: true };
  }

  async clipDelete(args: { id: string }): Promise<{ success: boolean }> {
    await ensureServicesReady();
    services.project.timelineRepo.deleteClip(args.id);
    return { success: true };
  }
}

export = ProjectController;
