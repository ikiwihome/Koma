import { describe, expect, it } from 'vitest';
import { normalizePolishedScriptOutput, validatePolishedScriptOutput } from './polishedScriptOutput';

const POLISHED_RESPONSE = `当然可以。以下是在**保持原有故事结构不变**的基础上，对剧本进行的润色版本。

---

# 第一集
## 1-1 纯黑环境 夜内
**人物：宁卓、黑衣人**

宁卓：抓住你了。`;

describe('polishedScriptOutput', () => {
  it('移除前言和 markdown 装饰', () => {
    const normalized = normalizePolishedScriptOutput(POLISHED_RESPONSE);

    expect(normalized.startsWith('第一集')).toBe(true);
    expect(normalized).not.toContain('当然可以');
    expect(normalized).not.toContain('**');
    expect(normalized).not.toContain('# ');
  });

  it('校验并返回纯正文', () => {
    const validated = validatePolishedScriptOutput(POLISHED_RESPONSE);

    expect(validated).toContain('第一集');
    expect(validated).toContain('宁卓：抓住你了。');
  });

  it('拒绝空结果', () => {
    expect(() => validatePolishedScriptOutput('---')).toThrow('润色结果为空');
  });
});
