import { describe, expect, it } from 'vitest';
import { compileGrokITV, compileGrokTTI } from './grokImageIndexCompiler';

describe('grok-image-index compiler', () => {
  it('TTI: replaces @char/@scene/@prop mentions with @Image N based on selected asset order', () => {
    const selectedAssets = [
      { type: 'char' as const, assetId: 'char_1774162760773_0', source: 'https://a.example/c.png' },
      { type: 'scene' as const, assetId: 'scene_abc', source: 'https://a.example/s.png' },
      { type: 'prop' as const, assetId: 'prop_999', source: 'https://a.example/p.png' },
    ];

    const prompt = '画面中有 @char_1774162760773_0 站在 @scene_abc 旁边，手持 @prop_999。';
    const { compiledPrompt, compiledReferences, debug } = compileGrokTTI({ prompt, selectedAssets });

    expect(compiledPrompt).toContain('@Image 1');
    expect(compiledPrompt).toContain('@Image 2');
    expect(compiledPrompt).toContain('@Image 3');
    expect(compiledPrompt).not.toContain('@char_');
    expect(compiledPrompt).not.toContain('@scene_');
    expect(compiledPrompt).not.toContain('@prop_');

    expect(compiledReferences).toEqual([
      'https://a.example/c.png',
      'https://a.example/s.png',
      'https://a.example/p.png',
    ]);

    expect(debug.assetToImageIndex).toEqual([
      { type: 'char', assetId: 'char_1774162760773_0', image: '@Image 1' },
      { type: 'scene', assetId: 'scene_abc', image: '@Image 2' },
      { type: 'prop', assetId: 'prop_999', image: '@Image 3' },
    ]);
  });

  it('ITV: reserves @Image 1 for primary image without prepending it to the prompt', () => {
    const selectedAssets = [
      { type: 'char' as const, assetId: 'char_1774162760773_0', source: 'https://a.example/c.png' },
      { type: 'scene' as const, assetId: 'scene_abc', source: 'https://a.example/s.png' },
    ];

    const prompt = '让 @char_1774162760773_0 缓慢转头，背景是 @scene_abc。';
    const { compiledPrompt, compiledAdditionalReferences, debug } = compileGrokITV({
      prompt,
      primaryImage: 'https://a.example/shot.png',
      selectedAssets,
    });

    expect(compiledPrompt.startsWith('@Image 1')).toBe(false);
    expect(compiledPrompt).not.toContain('@Image 1');
    expect(compiledPrompt).toContain('@Image 2');
    expect(compiledPrompt).toContain('@Image 3');

    expect(compiledAdditionalReferences).toEqual([
      'https://a.example/c.png',
      'https://a.example/s.png',
    ]);

    // Primary image is included in debug mapping as @Image 1
    expect(debug.assetToImageIndex[0]?.image).toBe('@Image 1');
    expect(debug.assetToImageIndex[1]?.image).toBe('@Image 2');
    expect(debug.assetToImageIndex[2]?.image).toBe('@Image 3');
  });

  it('TTI: downgrades selected assets without source to readable labels instead of leaking raw ids', () => {
    const selectedAssets = [
      { type: 'char' as const, assetId: 'char_me', name: '我', source: 'https://a.example/me.png' },
      { type: 'prop' as const, assetId: 'prop_meat', name: '红烧肉' },
      { type: 'prop' as const, assetId: 'prop_book', name: '字典' },
    ];

    const prompt = '@char_me 看着 @prop_meat 红烧肉，然后举起 @prop_book。';
    const { compiledPrompt, compiledReferences, debug } = compileGrokTTI({ prompt, selectedAssets });

    expect(compiledPrompt).toBe('@Image 1 看着  红烧肉，然后举起 字典。');
    expect(compiledPrompt).not.toContain('@prop_');
    expect(compiledReferences).toEqual(['https://a.example/me.png']);
    expect(debug.unmappedMentions.map(item => item.fullMatch)).toEqual(['@prop_meat', '@prop_book']);
  });

  it('ITV: strips unknown asset mentions when no readable fallback exists', () => {
    const selectedAssets = [
      { type: 'char' as const, assetId: 'char_me', name: '我', source: 'https://a.example/me.png' },
    ];

    const { compiledPrompt, debug } = compileGrokITV({
      prompt: '@char_me 走向 @prop_unknown 未知道具。',
      primaryImage: 'https://a.example/shot.png',
      selectedAssets,
    });

    expect(compiledPrompt).not.toContain('@Image 1');
    expect(compiledPrompt).toContain('@Image 2');
    expect(compiledPrompt).not.toContain('@prop_unknown');
    expect(debug.unmappedMentions.map(item => item.fullMatch)).toEqual(['@prop_unknown']);
  });

  it('ITV: preserves an explicit primary image mention when the prompt author wrote it', () => {
    const { compiledPrompt } = compileGrokITV({
      prompt: '基于 @Image 1 的末态，让 @char_me 站起。',
      primaryImage: 'https://a.example/shot.png',
      selectedAssets: [
        { type: 'char' as const, assetId: 'char_me', name: '我', source: 'https://a.example/me.png' },
      ],
    });

    expect(compiledPrompt).toBe('基于 @Image 1 的末态，让 @Image 2 站起。');
  });
});
