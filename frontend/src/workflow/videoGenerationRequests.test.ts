import { describe, expect, it } from 'vitest';
import type { Character, Prop, Scene, Shot, StoredMediaAsset } from '../types';
import { isReferenceToVideoRequest } from '../types';
import { collectShotVideoPlan } from './shotVideoPlan';
import { compileShotVideoGenerationRequest } from './videoGenerationRequests';

function image(remoteUrl: string): StoredMediaAsset {
  return {
    kind: 'image',
    remoteUrl,
    createdAt: 1,
  };
}

function createShot(partial?: Partial<Shot>): Shot {
  return {
    id: 'shot-1',
    scriptLines: [{ id: 'line-1', text: '镜头描述' }],
    shotType: 'medium',
    cameraMovement: 'static',
    duration: 15,
    imagePrompt: '',
    videoPrompt: '',
    characters: [],
    scenes: [],
    props: [],
    media: {},
    ...partial,
  };
}

describe('compileShotVideoGenerationRequest', () => {
  it('用单一 bundle 顺序编译 grid_anchor / 角色 / 场景 / 道具，并保持 request 引用顺序一致', () => {
    const gridImage = image('https://example.com/grid.png');
    const sceneImage = image('https://example.com/scene.png');
    const charImage = image('https://example.com/char.png');
    const propImage = image('https://example.com/prop.png');
    const scene: Scene = {
      id: 'scene_1778207015305_2',
      name: '深山木屋内部',
      media: { previewImage: sceneImage },
    } as unknown as Scene;
    const character: Character = {
      id: 'char_1778207028644_0',
      name: '我',
      media: { costumePhoto: charImage },
    } as unknown as Character;
    const prop: Prop = {
      id: 'prop_1778207006838_1',
      name: '红烧肉',
      media: { previewImage: propImage },
    } as unknown as Prop;
    const shot = createShot({
      imageMode: 'grid-4',
      videoMode: 'multi-ref',
      scenes: [scene.id],
      characters: [character.id],
      props: [prop.id],
      media: {
        images: [gridImage],
        currentImageIndex: 0,
      },
    });
    const plan = collectShotVideoPlan({
      shot,
      characters: [character],
      scenes: [scene],
      props: [prop],
      modelCapabilities: ['video.reference-to-video', 'video.image-to-video'],
    });

    const compiled = compileShotVideoGenerationRequest({
      plan,
      prompt: '画面描述：基于 @grid_anchor，@scene_1778207015305_2 中 @char_1778207028644_0 看向 @prop_1778207006838_1；旧写法 @图片1 也要统一。',
      aspectRatio: '16:9',
      duration: 15,
      capability: 'video.reference-to-video',
      providerType: 'koma-suihe-itv',
    });

    expect(compiled.prompt.startsWith('@Image 1')).toBe(false);
    expect(compiled.prompt).toContain('基于 @Image 1');
    expect(compiled.prompt).toContain('@Image 2 中 @Image 3 看向 @Image 4');
    expect(compiled.prompt).toContain('旧写法 @Image 1 也要统一');
    expect(compiled.prompt).not.toContain('@grid_anchor');
    expect(compiled.prompt).not.toContain('@prop_');
    expect(compiled.prompt).not.toContain('@图片');
    expect(isReferenceToVideoRequest(compiled.request)).toBe(true);
    if (!isReferenceToVideoRequest(compiled.request)) return;
    expect(compiled.request.referenceImages).toEqual([
      gridImage,
      sceneImage,
      charImage,
      propImage,
    ]);
  });
});
