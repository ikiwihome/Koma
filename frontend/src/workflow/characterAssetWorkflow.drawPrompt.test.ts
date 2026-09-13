import { describe, expect, it, vi } from 'vitest';
import type { Character } from '../types';

vi.mock('../store/settings/mediaConfig', () => ({
  getActiveITVConfig: vi.fn(),
}));

vi.mock('../providers', () => ({
  getProjectITVProvider: vi.fn(),
}));

vi.mock('../services/MediaGenerationService', () => ({
  mediaGenerationService: {
    generateImage: vi.fn(),
    generateImages: vi.fn(),
    generateVideo: vi.fn(),
  },
}));

vi.mock('../store/promptTemplates', () => ({
  resolvePromptTemplate: vi.fn(),
}));

vi.mock('../config/themePresets', () => ({
  getThemeStylePrefix: vi.fn(() => 'theme-style'),
  getThemeStylePrefixAsync: vi.fn(async () => 'theme-style'),
}));

import {
  appendFaceCandidateVariationPrompt,
  appendSelectedFaceReferencePrompt,
  buildCharacterFaceCandidatePrompt,
  generateCharacterFaceCandidatesBatch,
} from './characterAssetWorkflow';

function createCharacter(partial?: Partial<Character>): Character {
  return {
    id: 'char-1',
    name: '林夏',
    role: 'protagonist',
    prompt: '灵异调查员，短发，旧风衣，神情冷静',
    age: '28',
    gender: 'female',
    description: '能看见鬼魂的私家侦探',
    appearance: '短发，冷静，风衣领口',
    media: {},
    ...partial,
  };
}

function expectPromptToContain(prompt: string, clauses: string[]): void {
  for (const clause of clauses) {
    expect(prompt).toContain(clause);
  }
}

function expectPromptNotToContain(prompt: string, clauses: string[]): void {
  for (const clause of clauses) {
    expect(prompt).not.toContain(clause);
  }
}

describe('characterAssetWorkflow draw prompts', () => {
  it('人脸候选 prompt 明确身份维度差异化，并禁止三视图/全身/最终定妆照', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter(),
      'cinematic anime concept art',
      'round face, almond eyes, straight brows, small nose, restrained temperament',
    );

    expectPromptToContain(prompt, [
      'P0 face-candidate stage',
      'single head-and-shoulders or bust portrait',
      'candidate-to-candidate diversity is mandatory',
      'not the same face with only a different seed',
      'do not rely on random seed variation as the identity mechanism',
      'face shape',
      'eye shape',
      'eyebrow shape',
      'nose bridge/tip',
      'mouth/lip shape',
      'cheekbones',
      'jawline/chin',
      'age impression',
      'temperament/personality',
      'hairline/hair silhouette',
      'distinctive facial marks',
      'not a three-view sheet',
      'not a full-body image',
      'not the final costume/model sheet',
      'no three-view turnaround',
      'no full body',
      'no final costume sheet',
    ]);
  });

  it('variation prompt 被标记为候选专属身份方向，同时保留原角色设定', () => {
    const prompt = appendFaceCandidateVariationPrompt(
      'base face prompt',
      'long narrow face, sharp hooded eyes, arched brows, prominent nose, wary temperament',
    );

    expectPromptToContain(prompt, [
      'Candidate-specific face identity direction',
      'MANDATORY, not optional decoration',
      'Treat this variation as the required identity blueprint',
      'Apply this direction as the core identity',
      'long narrow face',
      'same role brief',
      'occupation/profession',
      'gender, age range and project style',
      'do not change this into another profession',
      'not a new role',
    ]);
  });

  it('male + 中文年龄在人脸候选 prompt 中形成性别年龄硬锁', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter({ gender: 'male', age: '30岁' }),
      'cinematic anime concept art',
      'soft delicate refined face, smooth flowing hair silhouette',
    );

    expect(prompt).toMatch(/adult male|adult man/);
    expectPromptToContain(prompt, [
      'Structured gender and age lock',
      '30 years old',
      'clearly read as male',
      'not female',
      'not woman',
      'not girl',
      'not female-coded',
      'not feminine body',
      'not female clothing',
      'Do not age up, age down, or switch age class.',
      'Structured gender/age fields override conflicting free-text details',
    ]);
    expect(prompt).not.toContain('30 years old years old');
  });

  it('female + 中文年龄在人脸候选 prompt 中形成反向性别年龄硬锁', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter({ gender: 'female', age: '30 岁' }),
      'cinematic anime concept art',
      'angular resolute face, firm jaw, severe temperament',
    );

    expect(prompt).toMatch(/adult female|adult woman/);
    expectPromptToContain(prompt, [
      'Structured gender and age lock',
      '30 years old',
      'clearly read as female',
      'not male',
      'not man',
      'not boy',
      'not male-coded',
      'not masculine body',
      'not male clothing',
      'Do not age up, age down, or switch age class.',
    ]);
  });

  it('male + 未成年年龄在人脸候选 prompt 中不强加 adult', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter({ gender: 'male', age: '12岁' }),
      'cinematic anime concept art',
      'soft delicate refined face, smooth flowing hair silhouette',
    );

    expectPromptToContain(prompt, [
      'Structured gender and age lock',
      'male character',
      '12 years old',
      'clearly read as male',
      'not female',
      'not woman',
      'not girl',
      'not female-coded',
      'not feminine body',
      'not female clothing',
      'Do not age up, age down, or switch age class.',
    ]);
    expectPromptNotToContain(prompt, ['adult male', 'adult man']);
  });

  it('female + unknown age 在人脸候选 prompt 中不强加 adult', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter({ gender: 'female', age: 'unknown' }),
      'cinematic anime concept art',
      'angular resolute face, firm jaw, severe temperament',
    );

    expectPromptToContain(prompt, [
      'Structured gender and age lock',
      'female character',
      'clearly read as female',
      'not male',
      'not man',
      'not boy',
      'not male-coded',
      'not masculine body',
      'not male clothing',
      'Do not age up, age down, or switch age class.',
    ]);
    expectPromptNotToContain(prompt, ['adult female', 'adult woman']);
  });

  it('neutral 分支使用中性/双性表达且不加入二元互斥 negative', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter({ gender: 'neutral', age: '30' }),
      'cinematic anime concept art',
      'gentle refined and balanced face',
    );

    expect(prompt).toMatch(/gender-neutral|androgynous presentation/);
    expect(prompt).toContain('30 years old');
    expectPromptNotToContain(prompt, ['not female', 'not male']);
  });

  it('unknown 分支不强推二元或中性性别，但保留年龄锁定', () => {
    const prompt = buildCharacterFaceCandidatePrompt(
      createCharacter({ gender: 'unknown', age: '30 years old' }),
      'cinematic anime concept art',
      'elegant delicate face with flowing hair',
    );

    expectPromptToContain(prompt, [
      'gender unspecified',
      '30 years old',
      'do not infer, rewrite, or change gender from candidate variation aesthetics',
    ]);
    expectPromptNotToContain(prompt, [
      'adult male',
      'adult man',
      'adult female',
      'adult woman',
      'gender-neutral',
      'androgynous presentation',
      '30 years old years old',
    ]);
  });

  it('variation 之后会再次追加 gender/age guardrail 收束', () => {
    const prompt = appendFaceCandidateVariationPrompt(
      'base face prompt',
      'soft delicate refined face with smooth flowing hair silhouette',
      'Structured gender and age lock (MANDATORY): adult male / adult man, adult age lock: 30 years old; the face must clearly read as male. Negative gender lock: not female, not woman, not girl, not female-coded, not feminine body, not female clothing. Do not age up, age down, or switch age class.',
    );

    const variationIndex = prompt.indexOf('soft delicate refined face');
    const guardrailIndex = prompt.lastIndexOf('Structured gender and age lock');

    expect(variationIndex).toBeGreaterThan(-1);
    expect(guardrailIndex).toBeGreaterThan(variationIndex);
    expect(prompt).toContain('interpret them only inside the structured gender and age lock');
    expectPromptToContain(prompt.slice(guardrailIndex), [
      '30 years old',
      'clearly read as male',
      'not female-coded',
      'not female clothing',
      'Do not age up, age down, or switch age class.',
    ]);
  });

  it('正式三视图 reference prompt 强调 selected face identity anchor 与 same person preservation', () => {
    const prompt = appendSelectedFaceReferencePrompt('official costume sheet prompt');

    expectPromptToContain(prompt, [
      'selected face reference',
      'identity anchor',
      'binding identity anchor',
      'not as a generic style reference',
      'front/side/back three-view costume sheet',
      'preserving the same person across all views',
      'Preserve selected face identity',
      'same face shape',
      'eye shape',
      'nose bridge/tip',
      'mouth/lip shape',
      'jawline/chin',
      'hairline and hair silhouette',
      'Do not re-randomize the face',
      'redesign the face',
      'drift toward a generic face',
      're-sample identity for each view',
      'If the image reference is ambiguous or unstable',
      'instead of inventing a new face',
    ]);
  });

  it('批量人脸候选会一次请求 9 张独立图片，并使用强角色约束 prompt', async () => {
    const { mediaGenerationService } = await import('../services/MediaGenerationService');
    const batchCount = 9;
    const seeds = Array.from({ length: batchCount }, (_, index) => 101 + index);
    const destPaths = Array.from({ length: batchCount }, (_, index) => `/tmp/face-${index + 1}.png`);
    const variations = Array.from({ length: batchCount }, (_, index) => ({
      label: `Variation ${index + 1}`,
      prompt: `identity direction ${index + 1}`,
    }));
    const mockAssets = destPaths.map((destPath, index) => ({
      kind: 'image' as const,
      localPath: destPath,
      remoteUrl: `https://cdn.example.com/face-${index + 1}.png`,
      createdAt: index + 1,
    }));

    (mediaGenerationService.generateImages as any).mockResolvedValue(mockAssets);

    const results = await generateCharacterFaceCandidatesBatch({
      projectId: 'project-1',
      character: createCharacter(),
      stylePrompt: 'cinematic anime concept art',
      ttiSelection: 'tti-main::grok-imagine',
      batchCount,
      seeds,
      destPaths,
      variations,
      bindOwner: false,
      normalizeRemoteUrl: false,
    });

    expect(mediaGenerationService.generateImages).toHaveBeenCalledTimes(1);
    const call = (mediaGenerationService.generateImages as any).mock.calls[0][0];
    expect(call.request.count).toBe(9);
    expect(call.request.prompt).toContain('This is a single-output prompt.');
    expect(call.request.prompt).toContain('Generate exactly one standalone single-character portrait per API output.');
    expect(call.request.prompt).toContain('The API request count creates multiple separate image files');
    expect(call.request.prompt).not.toContain('batch stage');
    expect(call.request.prompt).toContain('For each generated output, choose exactly one variation option as sampling guidance; never combine multiple options in one image.');
    expect(call.request.prompt).toContain('Variation option 1');
    expect(call.request.prompt).not.toContain('Returned image 1');
    expect(call.request.prompt).not.toContain('Returned-image variation directions');
    expect(call.request.prompt).toContain('character name: 林夏');
    expect(call.request.prompt).toContain('story role: protagonist');
    expect(call.request.prompt).toContain('gender: female');
    expect(call.request.prompt).toContain('age: 28 years old');
    expect(call.request.prompt).toContain('brief: 能看见鬼魂的私家侦探');
    expect(call.request.prompt).toContain('appearance note: 短发，冷静，风衣领口');
    expect(call.request.prompt).toContain('not male-coded');
    expect(call.request.prompt).toContain('not masculine body');
    expect(call.request.prompt).toContain('not male clothing');
    expect(call.request.prompt).toContain('no 3x3 grid');
    expect(call.request.prompt).toContain('no nine-grid');
    expect(call.request.prompt).toContain('no collage');
    expect(call.request.prompt).toContain('no contact sheet');
    expect(call.request.prompt).toContain('no montage');
    expect(call.request.prompt).toContain('no puzzle');
    expect(call.request.prompt).toContain('no tiled layout');
    expect(call.request.prompt).toContain('no split-screen');
    expect(call.request.prompt).toContain('no multiple people');
    expect(call.request.prompt).toContain('no group shot');
    expect(call.request.prompt).toContain('no multi-panel');
    expect(call.request.prompt).toContain('no duplicate same face');
    expect(call.request.prompt).toContain('no visual noise');
    expect(call.request.prompt).toContain('no TV static');
    expect(call.request.prompt).toContain('no glitch');
    expect(call.request.prompt).toContain('no corrupted image');
    expect(call.request.prompt).toContain('no abstract texture-only output');
    expect(call.request.prompt).toContain('no random pixel pattern');
    expect(call.destPath(0)).toBe('/tmp/face-1.png');
    expect(call.destPath(8)).toBe('/tmp/face-9.png');
    expect(results).toEqual(mockAssets.map((asset, index) => ({
      success: true,
      path: asset.localPath,
      url: asset.remoteUrl,
      seed: seeds[index],
    })));
  });
});
