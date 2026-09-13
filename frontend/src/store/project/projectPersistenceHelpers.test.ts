import { describe, expect, it } from 'vitest';
import {
  EasingType,
  MediaType,
  type TimelineData,
} from '../../types/editor';
import {
  animationToRow,
  assetRowToAsset,
  buildTimelineData,
  buildEpisodeAnalysis,
  buildShotMeta,
  characterRowToEntity,
  characterToRow,
  clipToRow,
  episodeRowToEntity,
  episodeToRow,
  keyframeToRow,
  parseShotIdsCsv,
  propRowToEntity,
  propToRow,
  sceneRowToEntity,
  sceneToRow,
  serializeShotIdsCsv,
  shotRowToEntity,
  shotToRow,
  shotVersionRowToEntity,
  storedMediaAssetToShotEntry,
  storedMediaAssetToShotVersionEntry,
  timelineToRow,
  trackToRow,
  transitionToRow,
} from '../../../../electron/service/storage/projectPersistenceHelpers';

describe('projectPersistenceHelpers', () => {
  it('round-trips entity rows without metadata_json blobs', () => {
    const now = 1700000000000;
    const characterRow = characterToRow({
      id: 'char-1',
      name: '主角',
      role: 'protagonist',
      prompt: '黑色风衣',
      description: '冷静',
      voiceId: 'voice-a',
      timestampRange: { start: 3, end: 8 },
      episodeRefs: [],
      media: {
        costumePhoto: {
          kind: 'image',
          localPath: '/tmp/costume.png',
          createdAt: now,
        },
      },
    }, 'project-1', 0, now);
    const character = characterRowToEntity(characterRow, [{
      entity_type: 'character',
      entity_id: 'char-1',
      episode_id: 'episode-1',
      episode_name: '第一集',
      first_appearance: 1,
      shot_ids_csv: 'shot-1,shot-2',
      sort_order: 0,
    }]);

    expect(characterRow.metadata_json).toBeUndefined();
    expect(character).toEqual(expect.objectContaining({
      id: 'char-1',
      name: '主角',
      prompt: '黑色风衣',
      voiceId: 'voice-a',
      timestampRange: { start: 3, end: 8 },
      episodeRefs: [
        expect.objectContaining({
          episodeId: 'episode-1',
          shotIds: ['shot-1', 'shot-2'],
        }),
      ],
    }));

    const scene = sceneRowToEntity(sceneToRow({
      id: 'scene-1',
      name: '楼道',
      prompt: '潮湿楼道',
      location: '废弃公寓',
      time: 'night',
      mood: '压抑',
    }, 'project-1', 1, now));
    expect(scene).toEqual(expect.objectContaining({
      id: 'scene-1',
      prompt: '潮湿楼道',
      location: '废弃公寓',
      time: 'night',
    }));

    const prop = propRowToEntity(propToRow({
      id: 'prop-1',
      name: '手枪',
      prompt: '旧式手枪',
      type: 'weapon',
      timestampRange: { start: 1, end: 2 },
    }, 'project-1', 2, now));
    expect(prop).toEqual(expect.objectContaining({
      id: 'prop-1',
      prompt: '旧式手枪',
      type: 'weapon',
      timestampRange: { start: 1, end: 2 },
    }));
  });

  it('maps shots and versions through normalized media entry records', () => {
    const shotRow = shotToRow({
      id: 'shot-1',
      scriptLines: [{ id: 'l1', text: '主角靠墙喘息' }],
      shotType: 'medium',
      cameraMovement: 'static',
      duration: 4,
      imageMode: 'storyboard',
      inheritPreviousStoryboard: false,
      characters: ['char-1'],
      scenes: ['scene-1'],
      props: ['prop-1'],
      currentVersion: 1,
      media: {
        images: [{
          kind: 'image',
          localPath: '/tmp/shot.png',
          createdAt: 11,
          metadata: {
            prompt: '主角靠墙',
          },
        }],
        currentImageIndex: 0,
      },
    }, 'project-1', 0);

    const imageEntry = storedMediaAssetToShotEntry('shot-1', 'image', {
      kind: 'image',
      localPath: '/tmp/shot.png',
      createdAt: 11,
      metadata: {
        prompt: '主角靠墙',
      },
    }, 0);

    const shot = shotRowToEntity(
      shotRow,
      [{ shot_id: 'shot-1', entity_id: 'char-1', sort_order: 0 }],
      [{ shot_id: 'shot-1', entity_id: 'scene-1', sort_order: 0 }],
      [{ shot_id: 'shot-1', entity_id: 'prop-1', sort_order: 0 }],
      [imageEntry],
    );

    expect(shot).toEqual(expect.objectContaining({
      id: 'shot-1',
      scriptLines: [expect.objectContaining({ text: '主角靠墙喘息' })],
      imageMode: 'storyboard',
      inheritPreviousStoryboard: false,
      characters: ['char-1'],
      scenes: ['scene-1'],
      props: ['prop-1'],
      media: expect.objectContaining({
        currentImageIndex: 0,
        images: [
          expect.objectContaining({
            localPath: '/tmp/shot.png',
            metadata: expect.objectContaining({
              prompt: '主角靠墙',
            }),
          }),
        ],
      }),
    }));

    const versionRow = {
      id: 'shot-1-v1',
      shot_id: 'shot-1',
      version_number: 1,
      prompt: '镜头一提示词',
      seed: 42,
      model: 'seedance-2.5',
      created_at: 22,
    };
    const versionMedia = storedMediaAssetToShotVersionEntry('shot-1-v1', 'video', {
      kind: 'video',
      localPath: '/tmp/shot-1.mp4',
      remoteUrl: 'https://cdn.example.com/shot-1.mp4',
      createdAt: 22,
      metadata: {
        thumbnailPath: '/tmp/shot-1.jpg',
        aspectRatio: '16:9',
      },
    });
    const version = shotVersionRowToEntity(versionRow as any, [versionMedia]);
    const shotMeta = buildShotMeta({
      ...shotRow,
      meta_prompt: '镜头一提示词',
      meta_seed: 42,
      meta_model: 'seedance-2.5',
      current_version: 1,
    }, [version]);

    expect(version).toEqual(expect.objectContaining({
      version: 1,
      media: expect.objectContaining({
        video: expect.objectContaining({
          localPath: '/tmp/shot-1.mp4',
          remoteUrl: 'https://cdn.example.com/shot-1.mp4',
          metadata: expect.objectContaining({
            thumbnailPath: '/tmp/shot-1.jpg',
            aspectRatio: '16:9',
          }),
        }),
      }),
    }));
    expect(shotMeta).toEqual(expect.objectContaining({
      id: 'shot-1',
      prompt: '镜头一提示词',
      seed: 42,
      model: 'seedance-2.5',
      currentVersion: 1,
    }));
  });

  it('builds episodes, analysis, assets and csv refs with structured semantics', () => {
    const episodeRow = episodeToRow({
      id: 'episode-1',
      projectId: 'project-1',
      number: 1,
      title: '第一集',
      status: 'storyboard',
      stepProgress: {
        assets: 'completed',
        storyboard: 'completed',
        video: 'pending',
      },
      hasAnalysis: true,
      createdAt: 1,
      updatedAt: 2,
    }, 'project-1');

    expect(episodeRow.metadata_json).toBeUndefined();
    expect(episodeRow.has_analysis).toBe(1);
    expect(episodeRowToEntity(episodeRow)).toEqual(expect.objectContaining({
      id: 'episode-1',
      status: 'storyboard',
      hasAnalysis: true,
      stepProgress: {
        assets: 'completed',
        storyboard: 'completed',
        video: 'pending',
      },
    }));

    const analysis = buildEpisodeAnalysis(
      'episode-1',
      [{
        id: 'shot-1',
        scriptLines: [{ id: 'l1', text: '镜头一' }],
        shotType: 'medium',
        cameraMovement: 'static',
        duration: 4,
        characters: [],
      }],
      {
        characters: [{
          entity_type: 'character',
          entity_id: 'char-1',
          episode_id: 'episode-1',
          episode_name: '第一集',
          first_appearance: 1,
          shot_ids_csv: 'shot-1',
          sort_order: 0,
        }],
        scenes: [],
        props: [],
      },
      episodeRow,
    );

    expect(analysis).toEqual(expect.objectContaining({
      episodeId: 'episode-1',
      characterRefs: ['char-1'],
      completedStages: expect.arrayContaining(['characters', 'scenes', 'props', 'shots']),
    }));

    expect(serializeShotIdsCsv(['shot-1', 'shot-2'])).toBe('shot-1,shot-2');
    expect(parseShotIdsCsv('shot-1,shot-2')).toEqual(['shot-1', 'shot-2']);

    expect(assetRowToAsset({
      id: 'asset-1',
      project_id: 'project-1',
      kind: 'image',
      name: '封面',
      local_path: '/tmp/a.png',
      thumbnail_path: '/tmp/a-thumb.png',
      file_size: 123,
      fingerprint: 'md5-a',
      ref_count: 3,
      created_at: 99,
    } as any)).toEqual(expect.objectContaining({
      id: 'asset-1',
      name: '封面',
      path: '/tmp/a.png',
      thumbnailPath: '/tmp/a-thumb.png',
      size: 123,
      md5: 'md5-a',
      refCount: 3,
    }));
  });

  it('round-trips timeline rows through normalized relational mappings', () => {
    const timeline: TimelineData = {
      version: 1,
      createdAt: 10,
      updatedAt: 20,
      tracks: [
        {
          id: 'track-video',
          type: 'video' as const,
          order: 0,
          isMainTrack: true,
          name: '主视频',
          muted: false,
          hidden: false,
          transitions: [
            {
              id: 'transition-1',
              fromClipId: 'clip-video-1',
              toClipId: 'clip-video-2',
              type: 'fade' as const,
              duration: 0.4,
            },
          ],
          clips: [
            {
              id: 'clip-video-1',
              assetId: 'asset-1',
              trackId: 'track-video',
              start: 0,
              duration: 3,
              offset: 0.2,
              sourceDuration: 3.2,
              sourceWidth: 1920,
              sourceHeight: 1080,
              name: '镜头一',
              type: MediaType.IMAGE,
              src: '/tmp/shot-1.png',
              x: 10,
              y: 20,
              scale: 1.1,
              rotation: 3,
              opacity: 0.9,
              keyframes: [
                {
                  id: 'kf-1',
                  time: 0.5,
                  x: 11,
                  y: 22,
                  scale: 1.2,
                  rotation: 4,
                  opacity: 0.8,
                  easing: EasingType.EASE_IN_OUT,
                },
              ],
              filter: {
                id: 'filter-a',
                name: '冷调',
                resourceId: 'res-filter-a',
                intensity: 70,
              },
              animations: [
                {
                  type: 'in',
                  effectId: 'anim-in',
                  name: '淡入',
                  duration: 0.3,
                },
              ],
              audioFade: {
                fadeIn: 0.1,
                fadeOut: 0.2,
              },
              mask: {
                type: 'circle',
                centerX: 0.5,
                centerY: 0.4,
                size: 0.8,
                feather: 30,
              },
            },
            {
              id: 'clip-video-2',
              assetId: 'asset-2',
              trackId: 'track-video',
              start: 3,
              duration: 2,
              offset: 0,
              name: '镜头二',
              type: MediaType.VIDEO,
              src: '/tmp/shot-2.mp4',
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              opacity: 1,
            },
          ],
        },
        {
          id: 'track-text',
          type: 'text' as const,
          order: 1,
          name: '字幕轨',
          muted: false,
          hidden: false,
          clips: [
            {
              id: 'clip-text-1',
              assetId: 'text-asset-1',
              trackId: 'track-text',
              start: 0,
              duration: 3,
              offset: 0,
              name: '字幕一',
              type: MediaType.TEXT,
              src: '你好',
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              opacity: 1,
              text: '你好',
              fontSize: 42,
              fontColor: '#FFFFFF',
              textPosition: 'bottom' as const,
              textAlign: 'center' as const,
            },
          ],
        },
      ],
    };

    const timelineRow = timelineToRow('project-1', 'episode', 'episode-1', timeline);
    const trackRows = timeline.tracks.map((track, index) => trackToRow(timelineRow.id, track as any, index));
    const clipRows = timeline.tracks.flatMap(track =>
      track.clips.map((clip, index) => clipToRow(track.id, clip as any, index))
    );
    const transitionRows = timeline.tracks.flatMap(track =>
      (track.transitions || []).map((transition, index) => transitionToRow(track.id, transition, index))
    );
    const keyframeRows = timeline.tracks.flatMap(track =>
      track.clips.flatMap(clip =>
        (clip.keyframes || []).map((frame, index) => keyframeToRow(clip.id, frame, index))
      )
    );
    const animationRows = timeline.tracks.flatMap(track =>
      track.clips.flatMap(clip =>
        (clip.animations || []).map((animation, index) => animationToRow(clip.id, animation, index))
      )
    );
    const rebuilt = buildTimelineData(
      timelineRow,
      trackRows,
      clipRows,
      transitionRows,
      keyframeRows,
      animationRows,
    );

    expect(timelineRow.scope_type).toBe('episode');
    expect(trackRows[1].kind).toBe('text');
    expect(trackRows[1].type).toBe('subtitle');
    expect(clipRows[0].asset_ref_id).toBe('asset-1');
    expect(rebuilt).toEqual(expect.objectContaining({
      version: 1,
      createdAt: 10,
      updatedAt: 20,
    }));

    expect(rebuilt.tracks).toHaveLength(2);
    expect(rebuilt.tracks[0]).toEqual(expect.objectContaining({
      id: 'track-video',
      type: 'video',
      transitions: [
        expect.objectContaining({
          id: 'transition-1',
          fromClipId: 'clip-video-1',
          toClipId: 'clip-video-2',
        }),
      ],
    }));
    expect(rebuilt.tracks[0].clips[0]).toEqual(expect.objectContaining({
      id: 'clip-video-1',
      assetId: 'asset-1',
      filter: expect.objectContaining({ id: 'filter-a' }),
      animations: [expect.objectContaining({ effectId: 'anim-in' })],
      mask: expect.objectContaining({ type: 'circle' }),
    }));
    expect(rebuilt.tracks[1]).toEqual(expect.objectContaining({
      id: 'track-text',
      type: 'text',
    }));
    expect(rebuilt.tracks[1].clips[0]).toEqual(expect.objectContaining({
      id: 'clip-text-1',
      text: '你好',
      fontSize: 42,
      textPosition: 'bottom',
    }));
  });
});
