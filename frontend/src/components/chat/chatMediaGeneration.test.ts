import { describe, expect, it } from 'vitest';
import {
  createChatImageRefs,
  detectChatMediaMode,
  extractChatImageMentionLabels,
  resolveChatImageReferences,
  stripChatImageMentions,
} from './chatMediaGeneration';

const imageAttachment = {
  id: 'a1',
  file: new File(['x'], 'product.png', { type: 'image/png' }),
  type: 'image' as const,
};

describe('chatMediaGeneration', () => {
  it('detects text-to-image mode without image attachments', () => {
    expect(detectChatMediaMode('文生图：画一张赛博城市', [])).toBe('text-to-image');
  });

  it('detects image-to-image mode with uploaded images', () => {
    expect(detectChatMediaMode('参考这张图生图，换背景', [imageAttachment])).toBe('image-to-image');
  });

  it('detects image-to-video mode with uploaded images', () => {
    expect(detectChatMediaMode('用这张图生视频，镜头缓慢推近', [imageAttachment])).toBe('image-to-video');
  });

  it('keeps normal chat when no media intent exists', () => {
    expect(detectChatMediaMode('帮我分析这个营销策略', [imageAttachment])).toBe('chat');
  });

  it('extracts and strips @图片 references', () => {
    expect(extractChatImageMentionLabels('用 @图片1 和 @图片3 做图生视频')).toEqual(['图片1', '图片3']);
    expect(stripChatImageMentions('用 @图片1 做一张图')).toBe('用 做一张图');
  });

  it('resolves @图片 references before uploaded attachments', () => {
    const refs = createChatImageRefs({
      sources: ['data:image/png;base64,old'],
      origin: 'generated',
      existingCount: 0,
    });
    expect(resolveChatImageReferences({
      text: '用 @图片1 图生视频',
      attachments: [imageAttachment],
      imageRefs: refs,
      attachmentDataUrls: ['data:image/png;base64,new'],
    })).toEqual(['data:image/png;base64,old']);
  });
});
