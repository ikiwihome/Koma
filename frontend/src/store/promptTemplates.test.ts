import { describe, expect, it } from 'vitest';
import { getDefaultTemplate } from './promptTemplates';
import type { PromptTemplateType } from './promptTemplates';

describe('default shot breakdown prompt templates', () => {
  it('使用运行时变量 durationConstraint / durationDefault 注入时长约束', () => {
    const systemTemplate = getDefaultTemplate('shot_breakdown_system').template;
    const userTemplate = getDefaultTemplate('shot_breakdown').template;
    const combined = `${systemTemplate}\n${userTemplate}`;

    // 模板里不再硬编码 grok 风格枚举，改为占位符；具体允许值由调用方按当前
    // ITV 渠道的 VideoDurationSpec 在编译模板时注入
    expect(systemTemplate).not.toContain('6、10、12、16、20');
    expect(userTemplate).not.toContain('6、10、12、16、20');

    expect(systemTemplate).toContain('{{durationConstraint}}');
    expect(systemTemplate).toContain('{{durationDefault}}');
    expect(userTemplate).toContain('{{durationConstraint}}');
    expect(userTemplate).toContain('{{durationDefault}}');

    // 历史回归保护：不应该出现历史"15 秒"等旧约束遗留
    expect(combined).not.toContain('15 秒以内');
    expect(combined).not.toContain('最大 15 秒');
    expect(combined).not.toContain('"duration": 15');
  });

  it('shot_breakdown_system 模板声明了 durationConstraint / durationDefault 变量', () => {
    const tpl = getDefaultTemplate('shot_breakdown_system');
    const names = tpl.variables.map((v) => v.name);
    expect(names).toContain('durationConstraint');
    expect(names).toContain('durationDefault');
    expect(names).toContain('dialogueModeDirective');
  });

  it('shot_breakdown 模板声明了 durationConstraint / durationDefault 变量', () => {
    const tpl = getDefaultTemplate('shot_breakdown');
    const names = tpl.variables.map((v) => v.name);
    expect(names).toContain('durationConstraint');
    expect(names).toContain('durationDefault');
    expect(names).toContain('projectNarrativeMode');
    expect(names).toContain('dialogueModeDirective');
  });

  it('默认模板要求完整覆盖剧本，避免摘要式合并丢细节', () => {
    const systemTemplate = getDefaultTemplate('shot_breakdown_system').template;
    const userTemplate = getDefaultTemplate('shot_breakdown').template;

    expect(systemTemplate).toContain('不能跳段');
    expect(systemTemplate).toContain('不能摘要式合并中间动作');
    expect(systemTemplate).toContain('宁可分镜多，也不要丢失细节');
    expect(userTemplate).toContain('禁止改写、合并、压缩、概括、补充任何字幕行原文');
    expect(userTemplate).toContain('必须按字幕行号顺序、连续、不重不漏地覆盖全部行');
    expect(userTemplate).toContain('无遗漏、无重复、无乱序');
  });

  it('分镜拆解模板按项目叙事模式约束 dialogue 字段', () => {
    const systemTemplate = getDefaultTemplate('shot_breakdown_system').template;
    const userTemplate = getDefaultTemplate('shot_breakdown').template;

    expect(systemTemplate).toContain('{{dialogueModeDirective}}');
    expect(userTemplate).toContain('项目叙事模式：{{projectNarrativeMode}}');
    expect(userTemplate).toContain('{{dialogueModeDirective}}');
    expect(userTemplate).toContain('剧情模式可从第一人称推文解说改写少量真实对白');
    expect(userTemplate).toContain('解说模式只保留显式对白或极少必要短反应');
  });
});

describe('storyboard image/video prompt visual templates', () => {
  const videoTemplateTypes: PromptTemplateType[] = [
    'shot_video_6s_multi',
    'shot_video_10s_multi',
    'shot_video_15s_multi',
    'shot_video_20s_multi',
    'shot_video_6s_firstframe',
    'shot_video_10s_firstframe',
    'shot_video_16s_firstframe',
    'shot_video_20s_firstframe',
  ];

  it('生图模板输出与视频模板对应的画面结构字段', () => {
    const imageTemplate = getDefaultTemplate('shot_image_prompt_generation').template;

    expect(imageTemplate).toContain('景别构图');
    expect(imageTemplate).toContain('画面描述');
    expect(imageTemplate).toContain('角色提示词');
    expect(imageTemplate).toContain('道具提示词');
    expect(imageTemplate).toContain('对白视觉提示词');
    expect(imageTemplate).toContain('光影氛围提示词');
    expect(imageTemplate).toContain('呼应提示词');
    expect(imageTemplate).toContain('{{dialogueModeDirective}}');

    for (const type of videoTemplateTypes) {
      const template = getDefaultTemplate(type).template;
      expect(template).toContain('景别：');
      expect(template).toContain('多机位运镜');
      expect(template).toContain('画面描述');
      expect(template).toContain('角色提示词');
      expect(template).toContain('道具提示词');
      expect(template).toContain('呼应提示词');
      expect(template).toContain('光影氛围提示词');
      expect(template).toContain('{{dialogueModeDirective}}');
      expect(template).toContain('NARRATIVE_TO_SCENE');
      expect(template).toContain('本源剧情事实');
      expect(template).toContain('禁止输出来源叙述句');
      expect(template).toContain('若没有真实生成分镜图');
      expect(template).toContain('禁止输出或暗示 `@shot_anchor` / `@grid_anchor`');
      expect(template).not.toContain('她自称天道，说要帮我夺回气运');
      expect(template).not.toContain('小白 对 我 台词');
    }
  });

  it('生图模板禁止在无真实锚定图时输出 shot/grid anchor', () => {
    const imageTemplate = getDefaultTemplate('shot_image_prompt_generation').template;

    expect(imageTemplate).toContain('只有当上方【视觉参考集合】明确列出真实分镜锚定图 / 宫格锚定图时');
    expect(imageTemplate).toContain('如果【视觉参考集合】提示无锚定图或纯文字推理');
    expect(imageTemplate).toContain('禁止**输出 `@shot_anchor` / `@grid_anchor`');
  });

  it('故事板模式模板强调电影级制作笔记、连续性和视频 AI 可读性', () => {
    const reasoningTemplate = getDefaultTemplate('storyboard_shot_prompt_generation').template;
    const ttiTemplate = getDefaultTemplate('tti_storyboard_shot_image').template;

    expect(reasoningTemplate).toContain('电影分镜信息图海报感');
    expect(reasoningTemplate).toContain('剧情驱动，不机械填格');
    expect(reasoningTemplate).toContain('默认制作板模块');
    expect(reasoningTemplate).toContain('【项目标题】');
    expect(reasoningTemplate).toContain('项目名称：{{projectTitle}}');
    expect(reasoningTemplate).toContain('副标题：{{projectSubtitle}}');
    expect(reasoningTemplate).toContain('拍摄形式：{{shootingFormat}}');
    expect(reasoningTemplate).toContain('项目类型：{{projectType}}');
    expect(reasoningTemplate).toContain('当前分镜时长：{{shotDurationSeconds}}秒');
    expect(reasoningTemplate).toContain('限制条件：{{storyboardConstraints}}');
    expect(reasoningTemplate).toContain('类型必须使用项目类型“{{projectType}}”');
    expect(reasoningTemplate).toContain('必须是当前分镜时长，不是项目总时长');
    expect(reasoningTemplate).toContain('【角色设计区】');
    expect(reasoningTemplate).toContain('【场景设计区】');
    expect(reasoningTemplate).toContain('【俯视镜头调度图】');
    expect(reasoningTemplate).toContain('【分镜故事区（N镜头）】');
    expect(reasoningTemplate).toContain('【灯光与风格】');
    expect(reasoningTemplate).toContain('【情绪关键词】');
    expect(reasoningTemplate).toContain('【声音设计】');
    expect(reasoningTemplate).toContain('【摄影说明】');
    expect(reasoningTemplate).toContain('【色彩方案】');
    expect(reasoningTemplate).toContain('焦段（24mm/35mm/50mm/85mm）');
    expect(reasoningTemplate).toContain('镜头数由剧情决定，不机械补满');
    expect(reasoningTemplate).toContain('{{storyboardContinuityNotice}}');
    expect(reasoningTemplate).toContain('@previous_storyboard_anchor');
    expect(reasoningTemplate).toContain('可读笔记文字');
    expect(reasoningTemplate).toContain('故事板很复杂，绝不能默认固定 2x2');
    expect(reasoningTemplate).toContain('如果剧情正好是四段强递进');
    expect(reasoningTemplate).toContain('电影级制作方案表');
    expect(reasoningTemplate).toContain('非对称、多区块、多尺寸面板');
    expect(reasoningTemplate).toContain('角色路径箭头');
    expect(reasoningTemplate).toContain('编号机位');
    expect(reasoningTemplate).toContain('不是对白字幕');
    expect(reasoningTemplate).toContain('风格前缀');
    expect(reasoningTemplate).toContain('严禁输出 `@Image N`');
    expect(reasoningTemplate).toContain('provider 协议');
    expect(ttiTemplate).toContain('{{storyboardPrompt}}');
    expect(ttiTemplate).toContain('highly detailed cinematic storyboard infographic poster');
    expect(ttiTemplate).toContain('deep blue title bar');
    expect(ttiTemplate).toContain('Required board sections');
    expect(ttiTemplate).toContain('project title header');
    expect(ttiTemplate).toContain('character design zone');
    expect(ttiTemplate).toContain('scene design zone');
    expect(ttiTemplate).toContain('top-down blocking diagram');
    expect(ttiTemplate).toContain('storyboard story zone with a story-driven N-shot sequence');
    expect(ttiTemplate).toContain('sound design zone');
    expect(ttiTemplate).toContain('unified color palette zone');
    expect(ttiTemplate).toContain('without mechanical equal panels');
    expect(ttiTemplate).toContain('focal length label such as 24mm / 35mm / 50mm / 85mm');
    expect(ttiTemplate).toContain('not a fixed count');
    expect(ttiTemplate).toContain('these notes are not dialogue subtitles');

    const variableNames = getDefaultTemplate('storyboard_shot_prompt_generation').variables.map(variable => variable.name);
    expect(variableNames).toContain('projectTitle');
    expect(variableNames).toContain('projectSubtitle');
    expect(variableNames).toContain('shootingFormat');
    expect(variableNames).toContain('projectType');
    expect(variableNames).toContain('shotDurationSeconds');
    expect(variableNames).toContain('storyboardConstraints');
  });

  it('视频模板禁止在精确时长后追加第二套逐镜头输出', () => {
    for (const type of videoTemplateTypes) {
      const template = getDefaultTemplate(type).template;
      expect(template).toContain('后面不得再追加');
      expect(template).toContain('精确时长');
      expect(template).toContain('不得另起第二套逐镜头结构');
    }

    for (const type of ['shot_video_6s_multi', 'shot_video_10s_multi', 'shot_video_15s_multi', 'shot_video_20s_multi'] as const) {
      const template = getDefaultTemplate(type).template;
      expect(template).toContain('内部参考，严禁原样输出');
      expect(template).toContain('不得在 `精确时长` 后追加 `镜头 1：`');
    }
  });

  it('生图推理模板声明台词和视频结构参考变量', () => {
    const template = getDefaultTemplate('shot_image_prompt_generation');
    const names = template.variables.map((variable) => variable.name);

    expect(names).toContain('dialogueText');
    expect(names).toContain('dialogueModeDirective');
    expect(names).toContain('cameraMovementHint');
    expect(names).toContain('shotsSection');
  });

  it('首帧延展视频模板声明道具变量，避免道具提示词缺上下文', () => {
    for (const type of ['shot_video_6s_firstframe', 'shot_video_10s_firstframe', 'shot_video_16s_firstframe', 'shot_video_20s_firstframe'] as const) {
      const template = getDefaultTemplate(type);
      expect(template.template).toContain('- 道具：{{props}}');
      expect(template.variables.map((variable) => variable.name)).toContain('props');
      expect(template.variables.map((variable) => variable.name)).toContain('dialogueModeDirective');
    }
  });
});
