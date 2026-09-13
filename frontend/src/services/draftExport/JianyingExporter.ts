/**
 * 剪映 (CapCut/Jianying) 导出器
 * 将编辑器时间线导出为剪映草稿格式
 *
 * 参考 pyCapCut 实现，使用模板文件作为基础
 */

import type { Track, Clip } from '../../types/editor';
import type {
  JianyingDraftContent,
  JianyingDraftMetaInfo,
  JianyingTrack,
  JianyingSegment,
  JianyingVideoMaterial,
  JianyingAudioMaterial,
  JianyingTextMaterial,
  JianyingSpeed,
  JianyingMaterials,
  JianyingClipSettings,
} from '../../types/jianying';
import type {
  DraftExporter,
  DraftExportOptions,
  DraftExportResult,
  CanvasSize,
  CoordinateTransformer,
} from './types';
import {
  JianyingCoordinateTransformer,
} from './JianyingCoordinateTransformer';
import {
  generateUUID,
  generateHexId,
  isVideoFile,
} from './coordinateTransform';
import {
  buildKeyframeListsFromClip,
  buildFilter,
  buildAnimations,
  buildAudioFade,
  buildMask,
  buildTransition,
} from './jianyingUtils';
import {
  getTimelineDuration,
  normalizeTrackTransitions,
  resolveTimelineTracks,
  resolveTrackTimeline,
  type ResolvedClipWindow,
} from '../../features/transition/core';

// 导入模板 JSON
import draftContentTemplate from './templates/draft_content_template.json';
import draftMetaInfoTemplate from './templates/draft_meta_info_template.json';

// 剪映版本信息
const JIANYING_VERSION = {
  appId: 359289,
  appSource: 'cc',
  appVersion: '6.7.0',
  os: 'windows',
  version: 360000,
  newVersion: '140.0.0',
};

export class JianyingExporter implements DraftExporter {
  readonly format = 'jianying';
  readonly displayName = '剪映草稿';
  readonly fileExtension = 'folder';

  private transformer: JianyingCoordinateTransformer;

  constructor() {
    this.transformer = new JianyingCoordinateTransformer();
  }

  getTransformer(): CoordinateTransformer {
    return this.transformer;
  }

  canExport(tracks: Track[], _options: DraftExportOptions): boolean {
    if (!tracks.some((track) => track.clips.length > 0)) {
      return false;
    }

    return resolveTimelineTracks(tracks).every(
      (track) => track.invalidTransitions.length === 0
    );
  }

  async export(
    tracks: Track[],
    options: DraftExportOptions,
    canvasSize: CanvasSize
  ): Promise<DraftExportResult> {
    try {
      if (!this.canExport(tracks, options)) {
        throw new Error('存在非法转场关系，无法导出剪映草稿。');
      }

      const warnings: string[] = [];

      // 基于模板生成草稿内容
      const draftContent = this.generateDraftContent(
        tracks,
        options,
        canvasSize,
        warnings
      );
      const draftMetaInfo = this.generateDraftMetaInfo(options, draftContent);

      return {
        success: true,
        outputPath: options.outputPath,
        warnings: warnings.length > 0 ? warnings : undefined,
        draftContent,
        draftMetaInfo,
      } as DraftExportResult & {
        draftContent: JianyingDraftContent;
        draftMetaInfo: JianyingDraftMetaInfo;
      };
    } catch (error) {
      return {
        success: false,
        outputPath: options.outputPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 基于模板生成 draft_content.json
   * 像 pyCapCut 一样，先加载模板再填充数据
   */
  private generateDraftContent(
    tracks: Track[],
    options: DraftExportOptions,
    canvasSize: CanvasSize,
    warnings: string[]
  ): JianyingDraftContent {
    // 深拷贝模板作为基础
    const content = JSON.parse(JSON.stringify(draftContentTemplate)) as JianyingDraftContent;

    const now = Math.floor(Date.now() / 1000);
    const draftId = generateUUID();

    // 提取素材和转换轨道
    const { materials, speedMaterials, clipMaterialRefs } = this.extractMaterials(
      tracks,
      canvasSize,
      warnings
    );
    const jianyingTracks = this.convertTracks(
      tracks,
      canvasSize,
      speedMaterials,
      clipMaterialRefs
    );

    // 计算总时长 (微秒)
    const maxDuration = this.transformer.transformTime(getTimelineDuration(tracks));

    // 在模板基础上填充数据
    content.id = draftId;
    content.name = options.projectName;
    content.duration = maxDuration;
    content.fps = options.fps;
    content.create_time = now;
    content.update_time = now;

    // 画布配置
    content.canvas_config = {
      width: canvasSize.width,
      height: canvasSize.height,
      ratio: 'original',
    };

    // 平台信息
    const platform = {
      app_id: JIANYING_VERSION.appId,
      app_source: JIANYING_VERSION.appSource,
      app_version: JIANYING_VERSION.appVersion,
      os: JIANYING_VERSION.os,
    };
    content.platform = platform;
    content.last_modified_platform = platform;

    // 素材和轨道
    content.materials = this.mergeWithTemplateMaterials(content.materials, materials);
    content.tracks = jianyingTracks;

    return content;
  }

  /**
   * 将提取的素材合并到模板素材结构中
   * 保留模板中的空数组结构，只填充有数据的部分
   */
  private mergeWithTemplateMaterials(
    templateMaterials: any,
    extractedMaterials: JianyingMaterials
  ): JianyingMaterials {
    // 从模板开始，用提取的数据覆盖
    const merged = { ...templateMaterials };

    // 只覆盖有数据的部分
    if (extractedMaterials.videos.length > 0) {
      merged.videos = extractedMaterials.videos;
    }
    if (extractedMaterials.audios.length > 0) {
      merged.audios = extractedMaterials.audios;
    }
    if (extractedMaterials.texts.length > 0) {
      merged.texts = extractedMaterials.texts;
    }
    if (extractedMaterials.speeds.length > 0) {
      merged.speeds = extractedMaterials.speeds;
    }
    if (extractedMaterials.transitions.length > 0) {
      merged.transitions = extractedMaterials.transitions;
    }
    if (extractedMaterials.audio_fades.length > 0) {
      merged.audio_fades = extractedMaterials.audio_fades;
    }
    if (extractedMaterials.material_animations.length > 0) {
      merged.material_animations = extractedMaterials.material_animations;
    }
    if (extractedMaterials.masks.length > 0) {
      merged.masks = extractedMaterials.masks;
    }
    if (extractedMaterials.effects.length > 0) {
      merged.effects = extractedMaterials.effects;
    }

    return merged as JianyingMaterials;
  }

  /**
   * 基于模板生成 draft_meta_info.json
   */
  private generateDraftMetaInfo(
    options: DraftExportOptions,
    draftContent: JianyingDraftContent
  ): JianyingDraftMetaInfo {
    // 深拷贝模板
    const metaInfo = JSON.parse(JSON.stringify(draftMetaInfoTemplate)) as JianyingDraftMetaInfo;

    // 填充关键字段
    metaInfo.draft_id = draftContent.id;
    metaInfo.draft_name = options.projectName;
    metaInfo.draft_root_path = options.outputPath;
    metaInfo.tm_duration = draftContent.duration;

    return metaInfo;
  }

  /**
   * 从轨道中提取素材列表
   */
  private extractMaterials(
    tracks: Track[],
    canvasSize: CanvasSize,
    warnings: string[]
  ): { materials: JianyingMaterials; speedMaterials: Map<string, JianyingSpeed>; clipMaterialRefs: Map<string, string[]> } {
    const videos: JianyingVideoMaterial[] = [];
    const audios: JianyingAudioMaterial[] = [];
    const texts: JianyingTextMaterial[] = [];
    const speedMaterials = new Map<string, JianyingSpeed>();

    // 高级属性素材（剪映专有结构，类型由 buildXxx 工具函数推断）
    const filters: NonNullable<ReturnType<typeof buildFilter>>[] = [];
    const masks: NonNullable<ReturnType<typeof buildMask>>[] = [];
    const audioFades: NonNullable<ReturnType<typeof buildAudioFade>>[] = [];
    const materialAnimations: NonNullable<ReturnType<typeof buildAnimations>>[] = [];
    const transitions: NonNullable<ReturnType<typeof buildTransition>>[] = [];

    // 每个片段的额外素材引用
    const clipMaterialRefs = new Map<string, string[]>();

    const processedMaterialIds = new Set<string>();

    for (const rawTrack of tracks) {
      const track = normalizeTrackTransitions(rawTrack);
      const incomingTransitions = new Map(
        (track.transitions ?? []).map((transition) => [transition.toClipId, transition])
      );

      for (const clip of track.clips) {
        const materialId = clip.assetId || clip.id;
        const extraRefs: string[] = [];

        // 为每个片段创建速度素材
        const speedId = generateHexId();
        speedMaterials.set(clip.id, {
          id: speedId,
          type: 'speed',
          speed: 1.0,
          mode: 0,
          curve_speed: null,
        });
        extraRefs.push(speedId);

        // 处理高级属性
        // 滤镜
        if (clip.filter) {
          const filterMaterial = buildFilter(clip.filter);
          if (filterMaterial) {
            filters.push(filterMaterial);
            extraRefs.push(filterMaterial.id);
          }
        }

        // 蒙版
        if (clip.mask) {
          const maskMaterial = buildMask(clip.mask);
          if (maskMaterial) {
            masks.push(maskMaterial);
            extraRefs.push(maskMaterial.id);
          }
        }

        // 音频淡入淡出
        if (clip.audioFade) {
          const fadeMaterial = buildAudioFade(clip.audioFade);
          if (fadeMaterial) {
            audioFades.push(fadeMaterial);
            extraRefs.push(fadeMaterial.id);
          }
        }

        // 动画
        if (clip.animations && clip.animations.length > 0) {
          const animMaterial = buildAnimations(clip.animations);
          if (animMaterial) {
            materialAnimations.push(animMaterial);
            extraRefs.push(animMaterial.anim_id);
          }
        }

        // 转场
        const incomingTransition = incomingTransitions.get(clip.id);
        if (incomingTransition) {
          const transitionMaterial = buildTransition(incomingTransition);
          if (transitionMaterial) {
            transitions.push(transitionMaterial);
            extraRefs.push(transitionMaterial.id);
          }
        }

        clipMaterialRefs.set(clip.id, extraRefs);

        if (processedMaterialIds.has(materialId)) continue;
        processedMaterialIds.add(materialId);

        if (clip.type === 'VIDEO' || clip.type === 'IMAGE') {
          const isVideo = clip.type === 'VIDEO' || isVideoFile(clip.src);
          videos.push({
            id: materialId,
            type: isVideo ? 'video' : 'photo',
            path: clip.src,
            duration: this.transformer.transformTime(
              clip.sourceDuration || clip.duration
            ),
            width: clip.sourceWidth || canvasSize.width,
            height: clip.sourceHeight || canvasSize.height,
            material_name: clip.name,
            has_audio: isVideo,
            create_time: Math.floor(Date.now() / 1000),
            import_time: Math.floor(Date.now() / 1000),
            import_time_ms: Date.now(),
          });
        } else if (clip.type === 'AUDIO') {
          audios.push({
            id: materialId,
            type: 'music',
            path: clip.src,
            duration: this.transformer.transformTime(
              clip.sourceDuration || clip.duration
            ),
            name: clip.name,
            create_time: Math.floor(Date.now() / 1000),
          });
        } else if (clip.type === 'TEXT') {
          texts.push({
            id: materialId,
            type: 'text',
            content: JSON.stringify({
              text: clip.text || clip.name || '',
              styles: [
                {
                  range: [0, (clip.text || clip.name || '').length],
                  size: clip.fontSize || 48,
                  font: { path: clip.fontFamily || 'Arial' },
                  fill: { content: { color: clip.fontColor || '#FFFFFF' } },
                },
              ],
            }),
          });
        } else {
          warnings.push(`不支持的片段类型: ${clip.type}`);
        }
      }
    }

    // 构建素材对象，包含高级属性素材
    const materials: JianyingMaterials = {
      videos,
      audios,
      texts,
      speeds: Array.from(speedMaterials.values()),
      stickers: [],
      effects: filters,
      transitions,
      canvases: [],
      audio_fades: audioFades,
      material_animations: materialAnimations,
      video_effects: [],
      ai_translates: [],
      audio_balances: [],
      audio_effects: [],
      audio_track_indexes: [],
      beats: [],
      chromas: [],
      color_curves: [],
      digital_humans: [],
      drafts: [],
      flowers: [],
      green_screens: [],
      handwrites: [],
      hsl: [],
      images: [],
      log_color_wheels: [],
      loudnesses: [],
      manual_deformations: [],
      masks,
      material_colors: [],
      multi_language_refs: [],
      placeholders: [],
      plugin_effects: [],
      primary_color_wheels: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      smart_relights: [],
      sound_channel_mappings: [],
      tail_leaders: [],
      text_templates: [],
      time_marks: [],
      video_trackings: [],
      vocal_beautifys: [],
      vocal_separations: [],
    };

    return { materials, speedMaterials, clipMaterialRefs };
  }

  /**
   * 转换轨道
   */
  private convertTracks(
    tracks: Track[],
    canvasSize: CanvasSize,
    speedMaterials: Map<string, JianyingSpeed>,
    clipMaterialRefs: Map<string, string[]>
  ): JianyingTrack[] {
    return tracks.map((track) => {
      const resolvedTrack = resolveTrackTimeline(track);
      const resolvedClipWindows = new Map(
        resolvedTrack.clipWindows.map((window) => [window.clipId, window] as const)
      );
      const jianyingType = this.mapTrackType(track.type);
      const segments = track.clips.map((clip) =>
        this.convertClip(
          clip,
          canvasSize,
          resolvedClipWindows.get(clip.id),
          speedMaterials.get(clip.id),
          clipMaterialRefs.get(clip.id)
        )
      );

      return {
        id: generateHexId(),
        type: jianyingType,
        attribute: track.muted ? 1 : 0,
        flag: 0,
        is_default_name: !track.name,
        name: track.name || '',
        segments,
      };
    });
  }

  /**
   * 转换片段
   */
  private convertClip(
    clip: Clip,
    canvasSize: CanvasSize,
    resolvedClipWindow: ResolvedClipWindow | undefined,
    _speedMaterial?: JianyingSpeed,
    extraMaterialRefsList?: string[]
  ): JianyingSegment {
    const segmentId = generateHexId();
    const materialId = clip.assetId || clip.id;

    // 坐标转换
    const position = this.transformer.transformPosition(
      clip.x,
      clip.y,
      canvasSize.width,
      canvasSize.height
    );
    const scale = this.transformer.transformScale(clip.scale);
    const rotation = this.transformer.transformRotation(clip.rotation);
    const alpha = this.transformer.transformOpacity(clip.opacity);

    const clipSettings: JianyingClipSettings = {
      alpha,
      flip: { horizontal: false, vertical: false },
      rotation,
      scale: { x: scale.scaleX, y: scale.scaleY },
      transform: { x: position.x, y: position.y },
    };

    const targetTimerange = {
      start: this.transformer.transformTime(resolvedClipWindow?.resolvedStart ?? clip.start),
      duration: this.transformer.transformTime(clip.duration),
    };

    const sourceTimerange = {
      start: this.transformer.transformTime(clip.offset || 0),
      duration: this.transformer.transformTime(clip.duration),
    };

    // 使用预先收集的素材引用列表
    const extraMaterialRefs: string[] = extraMaterialRefsList || [];

    // 构建关键帧（从 Clip.keyframes 属性快照派生 per-property timeline）
    const commonKeyframes = buildKeyframeListsFromClip(clip);

    return {
      id: segmentId,
      material_id: materialId,
      target_timerange: targetTimerange,
      source_timerange: sourceTimerange,
      speed: 1.0,
      volume: 1.0,
      clip: clipSettings,
      extra_material_refs: extraMaterialRefs,
      enable_adjust: true,
      enable_color_correct_adjust: false,
      enable_color_curves: true,
      enable_color_match_adjust: false,
      enable_color_wheels: true,
      enable_lut: true,
      enable_smart_color_adjust: false,
      last_nonzero_volume: 1.0,
      reverse: false,
      track_attribute: 0,
      track_render_index: 0,
      visible: true,
      render_index: 0,
      common_keyframes: commonKeyframes,
      keyframe_refs: [],
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    };
  }

  /**
   * 映射轨道类型
   */
  private mapTrackType(
    editorType: 'video' | 'audio' | 'text'
  ): 'video' | 'audio' | 'text' {
    return editorType;
  }
}
