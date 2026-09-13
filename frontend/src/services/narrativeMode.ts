export type ProjectNarrativeMode = 'drama' | 'narration';

export function normalizeProjectNarrativeMode(mode: unknown): ProjectNarrativeMode {
  return mode === 'narration' ? 'narration' : 'drama';
}

export function formatProjectNarrativeMode(mode: ProjectNarrativeMode): string {
  return mode === 'narration' ? '解说模式' : '剧情模式';
}

export function buildShotBreakdownDialogueModeDirective(mode: ProjectNarrativeMode): string {
  if (mode === 'narration') {
    return [
      '【项目叙事模式：解说模式】',
      '- 分镜主要承载推文第一人称解说画面，dialogue 字段只填写原文明确出现的角色对白，或极少量必须同步口型的短反应。',
      '- 第一人称推文解说、心理判断、剧情概括不要主动改成大段角色对白；没有明确对白时 dialogue 写“无”。',
      '- scriptLineIndices 仍必须完整覆盖原字幕行，解说文本保留在 scriptLines 中由下游解说链路消费。',
    ].join('\n');
  }

  return [
    '【项目叙事模式：剧情模式】',
    '- 分镜需要脱离解说也能让观众看懂剧情。dialogue 字段可以把第一人称推文解说中的“认知、决定、质问、反应、转述”改写成少量主角独白或角色对白。',
    '- 改写后的台词必须像角色当场会说的话：短、口语化、符合人称和角色立场；禁止照搬“她自称/我意识到/我觉得/我心想”等来源叙述。',
    '- 每个分镜原则上 0-2 句 dialogue；无必要则写“无”。不要为了加台词破坏原文行号连续覆盖。',
  ].join('\n');
}

export function buildVideoDialogueModeDirective(mode: ProjectNarrativeMode): string {
  if (mode === 'narration') {
    return [
      '【项目叙事模式：解说模式】',
      '当前视频可依赖上游推文解说/字幕承载剧情，不要主动把第一人称解说改成大量角色对白。对白提示词只保留显式直接对白，或每单元 0-1 句确实需要口型同步的短反应；无则写“无”。',
    ].join('\n');
  }

  return [
    '【项目叙事模式：剧情模式】',
    '当前视频需要脱离解说也能看懂剧情。允许把第一人称推文解说中的认知、决定、质问、反应、转述改写成少量主角独白或角色对白，并放入对白提示词；台词必须短、当场可说、人称正确，禁止照搬来源叙述句或输出转换说明。',
  ].join('\n');
}
