/**
 * Prompt 模板管理
 * 默认模板和自定义模板支持
 */
import { electronService } from '../services/electronService';
import { getStorageConfig, initStorageConfig } from './storageConfig';
import { loadSettings, saveSettings } from './globalStore';
import { STORAGE_KEYS } from '../constants/storageKeys';
import type { AppSettings } from '../types';
import { VIDEO_REASONING_TEMPLATE_CONTENT } from './templates/videoReasoning';

// Prompt 模板类型
export type PromptTemplateType =
  // 全局约束模板（自动注入到 TTI/ITV 模板，对应 prompts/整体提示词.txt）
  | 'global_positive_prefix'      // 前置正向（通用一致性 + 高质量约束）
  | 'global_positive_suffix'      // 后置正向（人物/场景稳定 + 视频首帧一致性）
  | 'global_negative_suffix'      // 后置负向（畸形 / drift / 字幕水印禁项）
  | 'global_video_constraints'    // 视频规约（仅注入到视频类模板）
  // 系统提示模板（System Prompt）
  | 'shot_prompt_system'       // 分镜提示词生成的系统提示
  | 'shot_breakdown_system'    // 分镜拆解的系统提示
  | 'script_analysis_system'   // 剧本解析的系统提示
  // LLM 任务模板
  | 'random_script_generation' // 随机剧本生成（一步完成）
  | 'script_generation'        // 剧本生成
  | 'script_polish'            // 剧本润色
  | 'shot_breakdown'           // 分镜拆解
  | 'shot_image_prompt_generation' // 分镜图片提示词生成
  | 'storyboard_shot_prompt_generation' // 故事板分镜提示词生成（电影级制作方案板）
  | 'shot_video_6s_multi'          // 分镜视频提示词 · 多参模式 · 6 秒
  | 'shot_video_10s_multi'         // 分镜视频提示词 · 多参模式 · 10 秒
  | 'shot_video_15s_multi'         // 分镜视频提示词 · 多参模式 · 15 秒
  | 'shot_video_20s_multi'         // 分镜视频提示词 · 多参模式 · 20 秒
  | 'shot_video_6s_firstframe'     // 分镜视频提示词 · 首帧延展模式 · 6 秒
  | 'shot_video_10s_firstframe'    // 分镜视频提示词 · 首帧延展模式 · 10 秒
  | 'shot_video_16s_firstframe'    // 分镜视频提示词 · 首帧延展模式 · 16 秒
  | 'shot_video_20s_firstframe'    // 分镜视频提示词 · 首帧延展模式 · 20 秒
  | 'grid_shot_prompt_generation'  // 九宫格分镜提示词生成（将单个分镜扩展为9个连续画面）
  | 'grid_4_shot_prompt_generation' // 四宫格分镜提示词生成（将单个分镜扩展为4个连续画面，更细粒度的镜头控制）
  | 'character_extraction'     // 角色提取
  | 'scene_extraction'         // 场景提取
  | 'prop_extraction'          // 道具提取
  | 'tweet_script_generation'  // 推文文案生成（剧本 → 整段连续推文旁白）
  | 'tweet_shot_breakdown'     // 推文文案分镜化（推文旁白 + 分镜列表 → 每分镜 1-3 句解说台词）
  // TTI 图片生成模板
  | 'tti_character_costume'    // 角色定妆照（三视图）
  | 'tti_scene_preview'        // 场景预览图
  | 'tti_prop_reference'       // 道具参考图
  | 'tti_shot_image'           // 分镜图片
  | 'tti_grid_shot_image'      // 九宫格分镜图片（3×3网格）
  | 'tti_grid_4_shot_image'    // 四宫格分镜图片（2×2网格）
  | 'tti_storyboard_shot_image' // 故事板分镜图片（电影级制作方案板）
  // ITV 视频生成模板
  | 'itv_shot_video'           // 分镜视频
  | 'itv_character_motion'     // 角色动态视频
  | 'itv_prop_motion';         // 道具动态视频

// Prompt 模板分类
//
// 用于在 PromptStudio UI 分组展示，以及给"用户新建自定义模板"提供受控选项。
// 每个分类都有明确的运行时职责：
//
// - global         全局约束：被 resolvePromptTemplate 自动注入到 TTI / ITV 模板，
//                  不会被业务代码直接 resolve；用户编辑这些模板可全站生效。
// - system         系统提示：作为 role:system 与对应业务模板配对调用（如 shot_prompt_system）。
// - script         剧本生成 / 润色：random / script / polish 类。
// - analysis       剧本/分镜结构化分析：shot_breakdown（输出 JSON 分镜列表）。
// - extraction     角色 / 场景 / 道具提取：从剧本提取实体清单。
// - tweet          推文文案：剧本→旁白脚本、旁白→分镜化解说。
// - inference-image  图片提示词推理：分镜图（含九宫格）的 image prompt 生成。
// - inference-video  视频提示词推理：分镜视频的 video prompt 生成
//                  （按时长 × multi-ref / first-frame 模式 5 模板）。
// - tti            文生图直拼：定妆照、场景图、道具图、分镜图、九宫格图等
//                  直接喂给 TTI 模型的提示词组装模板。
// - itv            图生视频直拼：分镜视频、角色/道具动态视频，直接喂 ITV 模型。
export type PromptTemplateCategory =
  | 'global'
  | 'system'
  | 'script'
  | 'analysis'
  | 'extraction'
  | 'tweet'
  | 'inference-image'
  | 'inference-video'
  | 'tti'
  | 'itv';

/** 分类元数据：UI 分组标题 + 简短描述（i18n 暂走中文，后续可改 key） */
export const PROMPT_CATEGORY_META: Record<PromptTemplateCategory, { label: string; description: string; order: number }> = {
  global:           { label: '全局约束',     description: '自动注入到 TTI / ITV 模板，编辑后全站生效',           order: 0 },
  system:           { label: '系统提示',     description: 'role:system 内容，配合业务模板调用',                  order: 1 },
  script:           { label: '剧本生成',     description: '随机生成 / 命题生成 / 润色',                          order: 2 },
  analysis:         { label: '剧本分析',     description: '分镜拆解等结构化分析（输出 JSON）',                   order: 3 },
  extraction:       { label: '实体提取',     description: '从剧本提取角色 / 场景 / 道具清单',                    order: 4 },
  tweet:            { label: '推文文案',     description: '剧本 → 旁白；旁白 → 分镜化解说',                      order: 5 },
  'inference-image':{ label: '图片提示词推理', description: '分镜静态画面提示词（含九宫格）',                    order: 6 },
  'inference-video':{ label: '视频提示词推理', description: '分镜视频提示词（按时长 × 多参 / 首帧 5 模板）',      order: 7 },
  tti:              { label: 'TTI 直拼',     description: '文生图模型的直接输入提示词（定妆 / 场景图等）',       order: 8 },
  itv:              { label: 'ITV 直拼',     description: '图生视频模型的直接输入提示词（分镜视频等）',          order: 9 },
};

// Prompt 模板接口
export interface PromptTemplate {
  id: PromptTemplateType;
  name: string;
  /** 分类，用于 PromptStudio 分组展示与用户新建自定义模板时选择 */
  category: PromptTemplateCategory;
  description: string;
  template: string;
  variables: PromptTemplateVariable[];
  isCustom: boolean;    // 是否自定义
}

export interface PromptTemplateVariable {
  name: string;
  label: string;
  description: string;
  format: string;
  example?: string;
  required?: boolean;
}

export interface PromptTemplateOverride {
  template: string;
  updatedAt: number;
}

export interface PromptTemplateValidationResult {
  isValid: boolean;
  unknownVariables: string[];
  missingRequiredVariables: string[];
}

export interface ResolvedPromptTemplate {
  template: PromptTemplate;
  prompt: string;
  source: 'default' | 'custom';
}

const COMMON_VARIABLE_DEFINITIONS: Record<string, Omit<PromptTemplateVariable, 'name'>> = {
  duration: {
    label: '目标时长',
    description: '剧本目标时长，供随机剧本或剧本生成模板控制篇幅。',
    format: '分钟数字字符串',
    example: '3',
    required: true,
  },
  idea: {
    label: '创意',
    description: '用户提供的故事创意、概念或一句话灵感。',
    format: '自然语言短段落',
    example: '一个在旧城区夜巡的入殓师意外发现亡者会留下声音',
    required: true,
  },
  style: {
    label: '风格',
    description: '题材或叙事风格标签。',
    format: '短语或枚举字符串',
    example: '悬疑、治愈、黑色幽默',
    required: true,
  },
  script: {
    label: '剧本文本',
    description: '完整剧本文本，用于提取、拆解或润色。',
    format: '完整自然语言文本',
    example: '场景一：雨夜，顾行蹲在后院焚烧纸钱……',
    required: true,
  },
  requirements: {
    label: '润色要求',
    description: '用户补充的润色要求或限制。',
    format: '自然语言短段落',
    example: '强化节奏，保留人物关系，不要改动结局',
    required: true,
  },
  scriptContent: {
    label: '分镜素材',
    description: '分镜对应的原始剧本内容，仅作为视觉提炼素材，不应被原样复述。',
    format: '自然语言短段落',
    example: '顾行在后院把纸钱投入火盆，火光映亮脸侧',
    required: true,
  },
  characters: {
    label: '角色信息',
    description: '当前任务涉及的角色名或角色视觉信息列表。',
    format: '逗号分隔字符串或多行列表',
    example: '顾行, 老周',
    required: true,
  },
  scenes: {
    label: '场景信息',
    description: '当前任务涉及的场景列表或场景信息。',
    format: '逗号分隔字符串或 JSON 字符串',
    example: '殡葬用品店后院, 雨夜墓地',
    required: true,
  },
  props: {
    label: '道具信息',
    description: '当前任务涉及的道具列表或道具信息。',
    format: '逗号分隔字符串或 JSON 字符串',
    example: '纸钱, 铁盆, 墓碑',
    required: true,
  },
  emotion: {
    label: '情绪标签',
    description: '画面情绪标签，使用时应转化为可见的表情、姿态、光线或色调特征。',
    format: '短语',
    example: '平静、压抑、警觉',
    required: true,
  },
  stylePrefix: {
    label: '画风前缀',
    description: '项目或主题预设提供的视觉风格前缀。',
    format: '逗号分隔短语字符串',
    example: 'anime style, japanese animation, vibrant colors',
    required: true,
  },
  cameraOptions: {
    label: '可选运镜',
    description: '允许模型选择的运镜关键字列表。',
    format: '逗号分隔关键字',
    example: 'static shot, tracking shot, push in',
    required: true,
  },
  shotTypeOptions: {
    label: '可选景别',
    description: '允许模型选择的景别关键字列表。',
    format: '逗号分隔关键字',
    example: 'close-up, medium shot, wide shot',
    required: true,
  },
  characterRefs: {
    label: '角色引用表',
    description: '可插入到提示词中的角色引用清单，格式为角色名到 @角色ID 的映射。',
    format: '多行文本',
    example: '顾行: @char_001',
    required: true,
  },
  sceneRefs: {
    label: '场景引用表',
    description: '可插入到提示词中的场景引用清单，格式为场景名到 @scene_ID 的映射。',
    format: '多行文本',
    example: '雨夜墓地: @scene_001',
    required: true,
  },
  propRefs: {
    label: '道具引用表',
    description: '可插入到提示词中的道具引用清单，格式为道具名到 @prop_ID 的映射。',
    format: '多行文本',
    example: '铁盆: @prop_001',
    required: true,
  },
  shotTypeHint: {
    label: '景别提示',
    description: '当前分镜已经确定的景别提示，应优先遵守。',
    format: '短语',
    example: 'medium close-up',
    required: true,
  },
  cameraMovementHint: {
    label: '运镜提示',
    description: '当前分镜已经确定的运镜提示，应优先遵守。',
    format: '短语',
    example: 'slow tracking shot',
    required: true,
  },
  durationSeconds: {
    label: '镜头时长',
    description: '当前镜头的总时长，用于视频提示词的时间片段规划。允许值随当前选择的视频渠道（{{durationConstraint}}）变化。',
    format: '秒数字符串',
    example: '10',
    required: true,
  },
  durationConstraint: {
    label: '时长约束描述',
    description: '运行时根据当前选择的 ITV 视频渠道生成的时长约束句（如"只能填写 6、12、16、20 之一" / "必须在 4–16 秒范围内"）。由调用方注入，无需在用户编辑模板时填写。',
    format: '自然语言短句',
    example: '只能填写 6、12、16、20 之一',
    required: false,
  },
  durationDefault: {
    label: '默认时长',
    description: '运行时根据当前 ITV 视频渠道给出的推荐默认时长（秒）。无法判断时使用。',
    format: '秒数字符串',
    example: '10',
    required: false,
  },
  projectNarrativeMode: {
    label: '项目叙事模式',
    description: '项目设置中的叙事模式：剧情模式或解说模式。',
    format: '短语',
    example: '剧情模式',
    required: false,
  },
  dialogueModeDirective: {
    label: '台词模式约束',
    description: '运行时根据项目叙事模式生成的台词改写约束。',
    format: '多行文本',
    example: '【项目叙事模式：剧情模式】...',
    required: false,
  },
  imageMode: {
    label: '图片模式',
    description: '当前分镜的图片生成模式，值为 normal、grid-4、grid-9 或 storyboard。',
    format: '枚举字符串',
    example: 'storyboard',
    required: true,
  },
  projectTitle: {
    label: '项目名称',
    description: '当前项目标题，用于故事板【项目标题】区。由项目元数据注入，不能由模型自行改写为其它片名。',
    format: '短文本',
    example: '叶赎修仙异闻录',
    required: true,
  },
  projectSubtitle: {
    label: '项目副标题',
    description: '故事板标题区副标题，默认使用“短片分镜设计”。',
    format: '短文本',
    example: '短片分镜设计',
    required: true,
  },
  shootingFormat: {
    label: '拍摄形式',
    description: '故事板标题区的拍摄形式。默认“单机位”，后续如项目支持多机位可由运行时传入。',
    format: '短文本',
    example: '单机位',
    required: true,
  },
  projectType: {
    label: '项目类型',
    description: '当前项目的题材类型，来自 ProjectMeta.genre，用于故事板【项目标题】区的“类型”。',
    format: '短文本',
    example: '修仙玄幻',
    required: true,
  },
  shotDurationSeconds: {
    label: '分镜时长',
    description: '当前分镜的时长，来自 Shot.duration；故事板【项目标题】区必须使用这个值，而不是项目总时长。',
    format: '秒数字符串',
    example: '15',
    required: true,
  },
  storyboardConstraints: {
    label: '故事板限制条件',
    description: '故事板【项目标题】区的限制条件，如镜头节奏、角色数、场景数。',
    format: '短文本',
    example: '镜头数量由剧情节奏决定 / 2 个角色 / 1 个场景',
    required: true,
  },
  referenceTable: {
    label: '视觉参考集合',
    description: '运行时构造的视觉参考集合。视频模板使用 references 索引表；故事板等可编辑提示词模板只应使用语义 mention，禁止提前输出 @Image N。',
    format: '多行文本',
    example: '@char_abc 顾行',
    required: false,
  },
  storyboardContinuityNotice: {
    label: '故事板连续性说明',
    description: '故事板模式下对上一故事板/当前故事板锚点的继承说明。',
    format: '多行文本',
    example: '上一故事板参考：@previous_storyboard_anchor ...',
    required: false,
  },
  storyboardPrompt: {
    label: '故事板推理结果',
    description: '故事板提示词推理模板输出的结构化电影故事板方案。',
    format: '多行文本',
    example: '故事板类型：电影级制作方案板...',
    required: true,
  },
  gridSequencePrompt: {
    label: '九宫格镜头拆解',
    description: '九宫格模式下已生成的 9 条连续镜头提示词，可作为视频提示词的分段依据。',
    format: '多行文本',
    example: '镜头01：...\n镜头02：...',
    required: true,
  },
  character: {
    label: '角色资料',
    description: '角色原始资料或角色卡信息。',
    format: '自然语言短段落或 JSON 片段',
    example: '顾行，男，二十多岁，面容清瘦，寡言',
    required: true,
  },
  context: {
    label: '上下文',
    description: '角色视觉设计时可参考的剧情上下文，输出时仍需只保留外观信息。',
    format: '自然语言短段落',
    example: '角色长期在旧城区夜间工作，服饰偏耐磨、防水',
    required: true,
  },
  scene: {
    label: '场景信息',
    description: '场景相关的输入信息。',
    format: '自然语言短段落',
    example: '雨夜墓地，墓碑稀疏排列，湿地反光',
    required: true,
  },
  plot: {
    label: '情节素材',
    description: '剧情素材，仅供提炼视觉事实，不应用于直接复述。',
    format: '自然语言短段落',
    example: '两人在墓前短暂停顿后继续对话',
    required: true,
  },
  appearance: {
    label: '角色外观',
    description: '角色客观外观、服装、材质、配色与体态描述。',
    format: '自然语言短段落，仅限可见外观',
    example: '瘦高体型，苍白肤色，黑色短发，深灰长风衣，防水皮靴',
    required: true,
  },
  description: {
    label: '视觉描述',
    description: '客观视觉描述，只写当前可见外观、动作、空间、材质、光照等事实。',
    format: '自然语言短段落',
    example: '湿润石板地面上立着铁盆，火光映亮人物侧脸，纸灰在雨雾中飘散',
    required: true,
  },
  location: {
    label: '空间位置',
    description: '场景的地理或空间位置描述。',
    format: '短语',
    example: '殡葬用品店后院',
    required: true,
  },
  time: {
    label: '时间状态',
    description: '画面中的时间状态，应转为可见光照或天色特征。',
    format: '短语或枚举',
    example: 'night',
    required: true,
  },
  mood: {
    label: '可见氛围',
    description: '画面氛围的可见化描述，应落到光线、色调、天气或空间状态。',
    format: '短语',
    example: 'low-key lighting, damp air, muted blue-gray palette',
    required: true,
  },
  type: {
    label: '类型',
    description: '对象的类型或类别说明。',
    format: '短语',
    example: 'ritual paper money',
    required: true,
  },
  cameraMovement: {
    label: '镜头运动',
    description: '最终视频提示词中的镜头运动描述。',
    format: '短语',
    example: 'slow dolly in',
    required: true,
  },
  characterName: {
    label: '角色名',
    description: '角色展示视频的主角名称。',
    format: '字符串',
    example: '顾行',
    required: true,
  },
  action: {
    label: '动作描述',
    description: '主体当前可见动作与动态表现。',
    format: '自然语言短段落',
    example: '微微抬头，衣摆轻晃，眼神平稳移动',
    required: true,
  },
  motion: {
    label: '运动描述',
    description: '道具或主体的运动方式。',
    format: '自然语言短段落',
    example: 'slow rotation, subtle tilt, surface highlights moving across edges',
    required: true,
  },
  motionTimeline: {
    label: '动作时间线',
    description: '按 `[start,end]秒` 组织的动作与镜头变化时间线。',
    format: '多段时间片段文本',
    example: '[0,1]秒：人物静止建立构图；[1,3]秒：手部缓慢抬起，镜头缓推',
    required: true,
  },
  shotDescription: {
    label: '分镜剧情概述',
    description: '当前分镜的剧情概述或画面主题，用于九宫格图片生成时的全局描述。',
    format: '自然语言短段落',
    example: '顾行在后院焚烧纸钱，火光映照出压抑的夜晚氛围',
    required: true,
  },
  gridPrompt: {
    label: '九宫格镜头描述',
    description: '已组装的 9 条连续画面描述（镜头01~镜头09），用于九宫格 TTI 图片生成。',
    format: '多行文本，每行以 镜头NN： 开头',
    example: '镜头01：远景，雨夜墓地全貌…\n镜头02：中景，人物走向墓碑…',
    required: true,
  },
  resolution: {
    label: '分辨率',
    description: '目标图片分辨率。',
    format: '短语',
    example: '8K',
    required: true,
  },
  aspectRatio: {
    label: '画幅比例',
    description: '目标图片画幅比例，九宫格中每个格子的画面比例应与整体一致。',
    format: '比例字符串',
    example: '16:9',
    required: true,
  },
  // ========== 全局约束注入变量（来自 global_* 模板，由 resolvePromptTemplate 自动注入） ==========
  globalPositivePrefix: {
    label: '全局前置正向（自动注入）',
    description: '从 global_positive_prefix 模板自动注入；模板中可在画面描述前追加该占位符。',
    format: '段落',
    required: false,
  },
  globalPositiveSuffix: {
    label: '全局后置正向（自动注入）',
    description: '从 global_positive_suffix 模板自动注入；适合放在画面描述末尾强化一致性。',
    format: '段落',
    required: false,
  },
  globalNegativeSuffix: {
    label: '全局后置负向（自动注入）',
    description: '从 global_negative_suffix 模板自动注入；适合放在 negative prompt 区域。',
    format: '段落',
    required: false,
  },
  globalVideoConstraints: {
    label: '全局视频规约（自动注入）',
    description: '从 global_video_constraints 模板自动注入；仅视频类提示词应使用。',
    format: '段落',
    required: false,
  },
  // ========== 推文文案变量 ==========
  tweetScript: {
    label: '推文旁白脚本',
    description: '剧集级整段连续推文旁白脚本，作为分镜级推文台词的切分输入。',
    format: '多段口语化短句文本',
    example: '深夜，他推开店门——纸钱被火苗吞噬，那一刻……他听见亡者的声音。',
    required: true,
  },
  shotsList: {
    label: '分镜列表',
    description: '本剧集的全部分镜清单，按顺序编号 + 剧本原文，用于把推文旁白切分到每个分镜。',
    format: '多行文本（每行一镜：编号 / scriptContent / 时长）',
    example: '#1 顾行蹲在后院焚烧纸钱，火光映亮脸侧 (6s)\n#2 火盆中纸灰飞起，他凑近倾听 (10s)',
    required: true,
  },
  plotSummary: {
    label: '故事情节摘要',
    description: '剧情主线摘要（关键事件 / 核心冲突 / 角色关系），辅助提取阶段补足上下文；无则可省略。',
    format: '自然语言短段落',
    example: '入殓师顾行在夜班整理遗物时听到亡者声音，与女主角合作追查死者生前未完成的执念。',
    required: false,
  },
  // ========== 视频推理上下文衔接变量（多参模式 + 首帧模式） ==========
  prevShot2Info: {
    label: '上 2 分镜信息（多参模式专用）',
    description: '相邻向前第 2 个分镜的剧情 + 已生成的视频提示词；不存在则填"无"',
    format: '多行文本',
    example: '剧情：顾行走到墓前停下\n已生成提示词：中景，顾行 @Image 1 缓慢走至墓碑前 @Image 3...',
    required: false,
  },
  prevShot1Info: {
    label: '上 1 分镜信息（多参模式专用）',
    description: '相邻向前第 1 个分镜的剧情 + 已生成的视频提示词；不存在则填"无"',
    format: '多行文本',
    example: '剧情：他蹲下点燃纸钱\n已生成提示词：近景，顾行 @Image 1 蹲身将纸钱投入铁盆 @Image 4...',
    required: false,
  },
  prevShotInfo: {
    label: '上 1 分镜信息（首帧模式专用）',
    description: '首帧模式专用：上一相邻分镜末帧需要继承的状态（人物站位 / 朝向 / 视线 / 持物 / 光影 / 背景）；不存在则填"无"',
    format: '多行文本',
    example: '人物在画面右侧侧身站立，左手握符纸，光从画面左前方斜入，背景是斑驳的红砖墙',
    required: false,
  },
  nextShotInfo: {
    label: '下 1 分镜信息',
    description: '相邻向后第 1 个分镜的剧情；尚未推理时不带提示词；不存在则填"无"',
    format: '多行文本',
    example: '剧情：纸钱燃尽，他凑近铁盆听到一声叹息',
    required: false,
  },
};

// 内建变量名集合：这些变量由 resolvePromptTemplate 内部从 global_* 模板自动注入，
// 模板里可以直接使用 {{globalXxx}} 占位符而无需在自身 variables 列表中声明
const INTRINSIC_GLOBAL_VARIABLE_NAMES = new Set([
  'globalPositivePrefix',
  'globalPositiveSuffix',
  'globalNegativeSuffix',
  'globalVideoConstraints',
]);

// 全局变量名 → 对应模板类型的映射（resolvePromptTemplate 据此拉取注入内容）
const GLOBAL_INJECTION_MAP: Record<string, PromptTemplateType> = {
  globalPositivePrefix: 'global_positive_prefix',
  globalPositiveSuffix: 'global_positive_suffix',
  globalNegativeSuffix: 'global_negative_suffix',
  globalVideoConstraints: 'global_video_constraints',
};

// 全局模板类型自身不参与注入（避免递归）
const GLOBAL_TEMPLATE_TYPES = new Set<PromptTemplateType>([
  'global_positive_prefix',
  'global_positive_suffix',
  'global_negative_suffix',
  'global_video_constraints',
]);

function variable(
  name: string,
  overrides: Partial<Omit<PromptTemplateVariable, 'name'>> = {}
): PromptTemplateVariable {
  const fallback: Omit<PromptTemplateVariable, 'name'> = {
    label: name,
    description: `${name} 变量`,
    format: '字符串',
    required: true,
  };
  return {
    name,
    ...(COMMON_VARIABLE_DEFINITIONS[name] || fallback),
    ...overrides,
  };
}

function getVariableNames(variables: PromptTemplateVariable[]): string[] {
  return variables.map(variableItem => variableItem.name);
}

function getRequiredVariableNames(variables: PromptTemplateVariable[]): string[] {
  return variables.filter(variableItem => variableItem.required !== false).map(variableItem => variableItem.name);
}

// ========== 默认模板 ==========

const DEFAULT_TEMPLATES: Record<PromptTemplateType, PromptTemplate> = {
  // ========== 全局约束模板（自动注入到 TTI / ITV 模板） ==========

  global_positive_prefix: {
    id: 'global_positive_prefix',
    category: 'global',
    name: '全局前置正向约束',
    description: '通用一致性 + 高质量约束，会被 TTI/ITV 模板里的 {{globalPositivePrefix}} 占位符自动注入',
    template: `严格遵循当前输入提示词与参考图，不自由发挥，不新增文案外人物、场景、物件、动作、台词。保持人物身份一致、画风一致、构图稳定、比例真实、细节清晰、8k 高质量、sharp focus, high detail, clean composition, consistent style, accurate anatomy.`,
    variables: [],
    isCustom: false,
  },

  global_positive_suffix: {
    id: 'global_positive_suffix',
    category: 'global',
    name: '全局后置正向约束',
    description: '人物 / 场景稳定 + 视频首帧一致性约束，会被 {{globalPositiveSuffix}} 占位符自动注入',
    template: `优先保证人物稳定、站位稳定、朝向稳定、服装稳定、发型稳定、场景稳定、道具稳定。若为单图生视频任务，必须保持首帧一致性、镜头稳定、动作自然、避免人物乱跑、避免无依据运镜、避免无依据动作强化。无字幕，无中文文字，无水印，无 logo。`,
    variables: [],
    isCustom: false,
  },

  global_negative_suffix: {
    id: 'global_negative_suffix',
    category: 'global',
    name: '全局后置负向约束',
    description: '畸形 / drift / 字幕水印禁项，会被 {{globalNegativeSuffix}} 占位符自动注入；通常拼到 negative prompt 区域',
    template: `low quality, blurry, out of focus, worst quality, normal quality, lowres, jpeg artifacts, text, subtitle, watermark, logo, signature, username, extra people, extra character, duplicate person, wrong character, face drift, hairstyle drift, costume drift, accessory drift, prop drift, scene drift, bad anatomy, deformed body, malformed limbs, extra arms, extra legs, extra hands, extra fingers, missing fingers, fused fingers, broken hands, broken face, distorted eyes, cross-eyed, wrong proportions, bad perspective, cropped body, floating body, disconnected limbs, mutation, messy composition`,
    variables: [],
    isCustom: false,
  },

  global_video_constraints: {
    id: 'global_video_constraints',
    category: 'global',
    name: '全局视频规约',
    description: '视频生成专用规约（前 0.15 秒废帧、首帧一致性、动作约束等），会被视频类模板里的 {{globalVideoConstraints}} 占位符自动注入',
    template: `视频前 0.15 秒为废帧，严格遵循当前输入提示词与参考图，不自由发挥，不新增文案外人物、场景、物件、动作、台词。优先保证人物身份一致、站位稳定、朝向稳定、服装稳定、发型稳定、场景稳定、道具稳定、画风一致、比例真实、细节清晰。若为单图生视频任务，必须保持首帧一致性、镜头稳定、动作自然，禁止人物乱跑、禁止无依据运镜、禁止无依据大幅动作、禁止无依据景别变化。high detail, sharp focus, clean composition, consistent style, accurate anatomy. 无字幕，无中文文字，无水印，无 logo。`,
    variables: [],
    isCustom: false,
  },

  // ========== 系统提示模板 ==========

  shot_prompt_system: {
    id: 'shot_prompt_system',
    category: 'system',
    name: '分镜提示词系统提示',
    description: '生成分镜提示词时的系统角色定义',
    template: `你是一个专业的视频提示词生成专家。你的任务是为视频生成模型编写高质量的中文提示词。

要求：
1. 提示词使用中文描述
2. 如果需要引用资产，使用显式的 @mentions 形式：
   - 角色：@char_角色ID
   - 场景：@scene_场景ID
   - 道具：@prop_道具ID
3. 包含运镜描述和景别描述（视频提示词时）
4. 描述要具体、生动，但只写客观可见事实（外观、动作、光线、环境），不要复述剧情或背景设定
5. 直接输出提示词，不要有任何前缀或解释`,
    variables: [],
    isCustom: false,
  },

  shot_breakdown_system: {
    id: 'shot_breakdown_system',
    category: 'system',
    name: '分镜拆解系统提示',
    description: '分镜拆解时的系统角色定义',
    template: `你是一个专业的影视分镜师。你的任务是根据剧本内容，结合给定的角色、场景和道具，生成分镜结构。

每个分镜应该包含：
- scriptContent: 对应的剧本原文
- shotType: 景别（close-up特写/medium中景/wide全景/extreme-wide大全景）
- cameraMovement: 运镜方式（static固定/pan摇镜/zoom-in推镜/tracking跟随/handheld手持）
- duration: 预估时长（秒），{{durationConstraint}}，无法判断时填写 {{durationDefault}} 秒
- characters: 出现的角色名列表
- dialogue: 角色台词，格式为"角色名（情绪）：台词内容"，具体生成尺度必须遵守项目叙事模式
- emotion: 画面情绪氛围
- props: 出现的道具名列表

{{dialogueModeDirective}}

【情绪词列表】
高兴、愤怒、悲伤、恐惧、反感、低落、惊讶、自然、急切、平静、激动、呵斥、关心、严肃

【完整覆盖硬性规则】
1. 必须按剧本原文顺序从头到尾拆解，不能跳段、不能只挑“重要情节”、不能摘要式合并中间动作。
2. 每个原文句子/动作/环境变化/视线变化/停顿/台词都必须归入某一个 shot.scriptContent；没有画面变化但承接关系重要的句子也要保留在相邻分镜中。
3. shot.scriptContent 必须优先复制原文连续片段，允许带少量相邻上下文，但禁止改写成概括句；禁止把多个相距较远的原文段落揉成一个摘要。
4. 当同一段里出现“新动作 / 新视线目标 / 新道具状态 / 新场景空间 / 新说话人 / 情绪转折 / 时间推进”时，应优先拆成新的分镜，不要为了减少数量而合并。
5. 如果剧本文本很长，也必须继续输出完整 shots 数组直到覆盖末尾；宁可分镜多，也不要丢失细节。
6. 输出前自检：把所有 shot.scriptContent 连起来，应能覆盖原剧本的主干顺序；若发现遗漏，必须补齐后再返回。

注意：不需要生成画面描述(description)提示词，这将在后续步骤生成。`,
    variables: [
      variable('durationConstraint'),
      variable('durationDefault'),
      variable('projectNarrativeMode', { required: false }),
      variable('dialogueModeDirective', { required: false }),
    ],
    isCustom: false,
  },

  script_analysis_system: {
    id: 'script_analysis_system',
    category: 'system',
    name: '剧本解析系统提示',
    description: '剧本解析时的系统角色定义',
    template: `你是一个专业的影视编剧和分镜师。你的任务是分析用户提供的剧本，提取关键信息。
请严格按照要求的 JSON 格式输出，不要输出任何其他内容。`,
    variables: [],
    isCustom: false,
  },

  // ========== LLM 任务模板 ==========

  random_script_generation: {
    id: 'random_script_generation',
    category: 'script',
    name: '随机剧本生成',
    description: '一步生成完整的随机剧本',
    template: `你是一个专业的编剧，请随机创作一个短视频剧本。

【创作要求】
1. 随机选择一个新颖有趣的主题和风格（如：治愈、搞笑、悬疑、科幻、爱情、职场等）
2. 时长约 {{duration}} 分钟
3. 剧本包含场景描述、角色对话、动作指示
4. 情节紧凑，有明确的开端、发展、高潮、结局
5. 对话自然生动，符合角色性格
6. 每次创作都要有变化，不要重复

【输出格式】
首先用注释标注创意元数据，然后输出完整剧本：

<!--
主题：[故事主题]
风格：[风格类型]
关键元素：[元素1, 元素2, 元素3]
一句话简介：[剧情简介]
-->

## [剧本标题]

### 场景 1：[场景名称]
[场景描述]

**角色A**：对话内容
（动作指示）

**角色B**：对话内容
...

### 场景 2：...
`,
    variables: [variable('duration')],
    isCustom: false,
  },

  script_generation: {
    id: 'script_generation',
    category: 'script',
    name: '剧本生成',
    description: '从创意/灵感生成完整剧本',
    template: `你是一个专业的编剧，请根据以下创意生成一个短视频剧本。

创意：{{idea}}
风格：{{style}}
时长：约 {{duration}} 分钟

要求：
1. 剧本包含场景描述、角色对话、动作指示
2. 情节紧凑，有明确的开端、发展、高潮、结局
3. 对话自然生动，符合角色性格
4. 场景转换流畅，视觉感强

请按以下格式输出：

## 剧本标题

### 场景 1：[场景名称]
[场景描述]

**角色A**：对话内容
（动作指示）

**角色B**：对话内容
...

### 场景 2：...
`,
    variables: [variable('idea'), variable('style'), variable('duration')],
    isCustom: false,
  },

  script_polish: {
    id: 'script_polish',
    category: 'script',
    name: '剧本润色',
    description: '优化现有剧本的语言和结构',
    template: `你是一个专业的剧本编辑，请润色以下剧本。

原剧本：
{{script}}

润色要求：
- {{requirements}}

请保持原有的故事结构，优化语言表达，使对话更加生动自然，场景描述更加具体形象。

硬性要求：
1. 只返回润色后的完整剧本正文
2. 不要返回任何前言、后记、说明、总结或解释
3. 不要使用 Markdown 标题、粗体、分隔线、代码块
4. 不要补充“以下是润色版”之类提示语
5. 不要改动角色名、集数、场次编号的语义结构
`,
    variables: [variable('script'), variable('requirements')],
    isCustom: false,
  },

  shot_breakdown: {
    id: 'shot_breakdown',
    category: 'analysis',
    name: '分镜拆解（行号切分模式）',
    description: '把已经"推文化"的字幕行剧本切分到分镜，不改写原文，仅输出每镜归属的行号区间',
    template: `你是一位专业的分镜师。下面给你一段已经"推文化"为字幕行格式的剧本，每行已加好编号。
你的任务是把**连续的若干行**划归到一个分镜，输出每个分镜归属的"行号列表"。

【最重要硬约束】
1. **禁止改写、合并、压缩、概括、补充任何字幕行原文**。每一行都必须原样保留在某个分镜里。
2. **禁止跨行重组词序、禁止把相隔的行强行合到一个分镜**。划归到同一分镜的行必须是**连续行号**（如 [3, 4, 5]），不能跳号（如 [3, 5, 7] 是非法）。
3. **必须按字幕行号顺序、连续、不重不漏地覆盖全部行**。所有分镜的 scriptLineIndices 拼起来应等于 [1, 2, 3, ..., N]，N 是字幕总行数。

【时长要求】
每个镜头的 duration {{durationConstraint}}；无法判断时填写 {{durationDefault}}。

【情绪词列表】
高兴、愤怒、悲伤、恐惧、反感、低落、惊讶、自然、急切、平静、激动、呵斥、关心、严肃

已知角色：{{characters}}
已知场景：{{scenes}}
已知道具：{{props}}

项目叙事模式：{{projectNarrativeMode}}
{{dialogueModeDirective}}

【重要】characters、scenes、props 字段必须使用上方"已知角色/场景/道具"列表中的原始名称，不要自行编造或修改名称。如果某分镜涉及的元素不在列表中，则不填入对应字段。

【字幕行剧本（逐行编号）】
{{script}}

【切分原则】
1. 按字幕行号从 1 开始顺序，把连续若干行划归一个分镜，不许跳号。
2. 出现下列任一信号时倾向"开新镜头"：新动作 / 新视线目标 / 新道具状态 / 新空间 / 新说话人 / 情绪转折 / 时间推进。
3. 单镜分配的行数原则上 1–6 行；行数受 duration 约束（每行约 1.5–3 秒，按 duration 折算合理行数）。
4. 不许出现空分镜（scriptLineIndices 为空）。
5. dialogue 字段由项目叙事模式决定：剧情模式可从第一人称推文解说改写少量真实对白；解说模式只保留显式对白或极少必要短反应。
6. 自检：把所有分镜的 scriptLineIndices 按顺序拼起来 = [1, 2, ..., N]，无遗漏、无重复、无乱序。

【输出 JSON】
\`\`\`json
{
  "shots": [
    {
      "scriptLineIndices": [1, 2, 3],
      "shotType": "close-up/medium/wide/extreme-wide",
      "cameraMovement": "static/pan/zoom-in/tracking/handheld",
      "duration": 6,
      "dialogue": "角色名（情绪）：「台词内容」",
      "characters": ["已知角色名称"],
      "emotion": "情绪标签",
      "props": ["已知道具名称"],
      "scenes": ["已知场景名称"]
    }
  ]
}
\`\`\`

字段说明：
- \`scriptLineIndices\`：1-based 字幕行号数组，必须连续（如 [3,4,5]），代表本分镜归属哪些行；下游会用这些索引从原剧本切片，不会读取其它字段去重建文本
- 其它字段（shotType / cameraMovement / duration / dialogue / characters / scenes / props / emotion）描述本分镜的镜头语言与元素归属
- \`dialogue\`：必须遵守项目叙事模式；剧情模式中可为第一人称推文素材生成短对白，解说模式不要强行补对白
`,
    variables: [
      variable('script'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('durationConstraint'),
      variable('durationDefault'),
      variable('projectNarrativeMode', { required: false }),
      variable('dialogueModeDirective', { required: false }),
    ],
    isCustom: false,
  },

  shot_image_prompt_generation: {
    id: 'shot_image_prompt_generation',
    category: 'inference-image',
    name: '分镜图片提示词生成',
    description: '为分镜生成静态图片提示词',
    template: `根据以下分镜信息生成一条静态分镜图片提示词。它必须能作为后续视频提示词的 0 秒画面锚点：同一场景、同一角色状态、同一道具位置、同一光影逻辑，视频只在这张图的基础上展开动作。

{{referenceTable}}

{{gridSequenceNotice}}

> 角色参考图判断：如果上方【视觉参考集合】里列出角色参考图，角色外貌 / 发型 / 脸型 / 眼睛 / 体型 / 常规服装 / 常规配饰以参考图为唯一真相；图片提示词只写角色引用 + 当前静帧姿态、朝向、视线、表情、手部、口型和临时状态，禁止补写静态样貌，避免文字与参考图冲突。

## 输入

剧本内容（唯一真理来源）：{{scriptContent}}
台词字段（只用于判断口型、表情和说话状态；除非剧本明确要求字幕/气泡，否则不要把台词画成文字）：{{dialogueText}}
{{dialogueModeDirective}}
出场角色：{{characters}}
出现场景：{{scenes}}
出场道具：{{props}}
情绪氛围：{{emotion}}
风格前缀：{{stylePrefix}}
推荐景别：{{shotTypeHint}}
推荐运镜（只用于选择构图方向，不输出视频动作）：{{cameraMovementHint}}
后续视频镜头结构参考（只用于选择首帧 / 关键锚定帧，不要原样输出）：{{shotsSection}}

## 核心规则

1. **客观可见 only**：只描述静止画面中能看见的事实——姿态 / 手部动作 / 道具状态 / 空间关系 / 构图 / 光线。已有角色参考图时，不写人物静态外貌、常规服装和常规配饰；无参考图时才可按角色基准补充必要外观。不复述剧情、不描述心理、不解释事件原因、不写旁白 / 解说 / 评价 / 总结句。
2. **解剖学正确（Anatomically correct）**：人物**必须真实人体可执行**——五指、双眼、双耳、四肢、对称面部、合理关节。**禁止**：手指数量错误 / 多肢体 / 关节反向 / 头身比例失真 / 手部畸形 / 面部扭曲 / 透视畸变。姿势必须有明确重心（脚是否着地 / 手是否扶物 / 坐姿支撑点）。
3. **第三方评论 / 字幕 / 弹幕**：剧本里如有”网友评论””弹幕””字幕””新闻播报””短信””微博”等内容，**绝对不能让人物开口念出**——只能作为画面字幕 / 弹幕 / 手机屏幕等**纯视觉显示**，并写明”字幕：『内容』””手机屏幕显示『内容』”等形式。
4. **画面层次**：画面描述必须有主空间 + 背景/远景 + 前景/近景三层；优先写可见材质、遮挡关系、地面物、光柱/阴影、手部/面部特写对象，避免空泛“氛围感”。
5. **空间精度**：用自然定位词写清人物和道具位置（如“神像底座旁”“地面杂草前景”“门口左侧课桌”）。场景含多个同类物体时才使用编号；不要硬编不存在的床号 / 桌号 / 门号。
6. **情绪可见化**：把”情绪氛围”转成可见线索——表情 / 肢体张力 / 视线方向 / 嘴角 / 眉眼 / 肩颈 / 手指 / 色调 / 明暗对比。
7. **景别构图**：优先用推荐景别，并补一个服务动作的辅景别（如手部特写、眯眼特写、道具特写、系统气泡），让生图能支撑后续视频的主动作。
8. **引用编码**：所有人物 / 场景 / 道具引用**必须使用 \`@<id> <名称>\` 格式**——mention 协议字符串（\`@char_<id>\` / \`@scene_<id>\` / \`@prop_<id>\`）在前，空格分隔，再跟该对象的中文名称（如 \`@char_abc123 周明\`、\`@scene_xyz789 教室\`、\`@prop_def456 钥匙\`）。只有当上方【视觉参考集合】明确列出真实分镜锚定图 / 宫格锚定图时，才允许写 \`@shot_anchor 分镜锚定图\` 或 \`@grid_anchor 网格锚定图\`；如果【视觉参考集合】提示无锚定图或纯文字推理，**禁止**输出 \`@shot_anchor\` / \`@grid_anchor\`。**禁止**只写 mention 不带名称、只写名称不带 mention，或写成 \`<名称> @Image N\` / \`@Image N <名称>\` / \`@角色 <名称>\` 等形式。同一元素每次出现都必须重复完整标注。
9. **跨镜头一致**：已有角色参考图时，人物外观（穿着 / 发型 / 体型 / 常规配饰）只继承参考图，不在提示词里复述或改写；剧情关键持物写入道具或动作。同一场景内的家具 / 陈设 / 光照在不同分镜间保持稳定，不得引入新元素。
10. **输出结构**：直接输出下面字段，字段为空写“无”，不要前言、解释、自检、Markdown checkbox。字段之间用中文句号或分号连接，可保留字段名，方便后续视频提示词对应。

## 输出字段

整体画风：[继承风格前缀；如明确，则写具体风格]
景别构图：【主】[推荐景别/主构图]，【辅】[特写对象/中景/系统气泡等]
画面描述：[主空间 + 背景/远景 + 前景/近景；写可见层次、材质、地面物、遮挡关系]
角色提示词：[逐条写 @char_<id> <角色名> + 当前静帧姿态、朝向、视线、表情、手部、口型和临时状态；已有角色参考图时禁止写发型、脸型、眼睛、体型、常规服装颜色材质、常规配饰等静态样貌]
系统/字幕提示词：[系统气泡、屏幕字、弹幕、字幕等纯视觉内容；无则“无”]
道具提示词：[逐条写道具名 + 引用或可见位置/材质/状态；无则“无”]
动作定格提示词：[选择最适合作为视频 0 秒的动作起手帧或关键锚定帧；写重心、接触点、视线、手部]
对白视觉提示词：[只写口型/说话状态/嘴唇细节；不要把普通对白画成文字；无则“无”]
情绪提示词：[角色名：可见情绪，用眉眼、嘴角、肩颈、手指、身体倾斜外化]
光影氛围提示词：[光源方向、色温、明暗交替、灰尘/粒子/雾气等可见物理氛围]
呼应提示词：[与上/下分镜的视觉反差、伏笔或末帧承接；无则“无”]
负面约束：不生成多余角色，不生成无关文字，不改角色服装和场景结构，避免畸形手、错位眼、穿模、透视扭曲

## 引用列表

- 可用角色：{{characterRefs}}
- 可用场景：{{sceneRefs}}
- 可用道具：{{propRefs}}

输出：直接输出提示词，不要任何说明。
`,
    variables: [
      variable('scriptContent'),
      variable('dialogueText', {
        label: '分镜台词',
        description: '当前分镜的显式台词字段。图片模板只用它判断口型、表情、字幕/气泡，不应把普通对白画成文字。',
        format: '多行台词文本或“无”',
      }),
      variable('dialogueModeDirective', { required: false }),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('emotion'),
      variable('stylePrefix'),
      variable('shotTypeHint'),
      variable('cameraMovementHint', {
        label: '推荐运镜',
        description: '当前分镜的视频运镜提示，图片模板只用它选择静帧构图方向。',
        format: '短语',
      }),
      variable('shotsSection', {
        label: '视频镜头结构参考',
        description: '后续视频镜头结构，只用于静态图选择 0 秒锚定帧或关键帧，不原样输出。',
        format: '多行文本',
        required: false,
      }),
      variable('shotTypeOptions'),
      variable('characterRefs'),
      variable('sceneRefs'),
      variable('propRefs'),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
    ],
    isCustom: false,
  },

  // ========== 视频推理 · 多参模式（含 @角色/@场景/@道具 映射，依赖映射基准库） ==========

  shot_video_6s_multi: {
    id: 'shot_video_6s_multi',
    category: 'inference-video',
    name: '视频推理 · 多参 · 6 秒',
    description: '多参照模式 6 秒分镜：含 @角色/@场景/@道具 映射；上下文衔接段使用 prevShot2Info / prevShot1Info / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_6s_multi,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShot2Info', { required: false }),
      variable('prevShot1Info', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
      variable('shotsSection', { required: false }),
    ],
    isCustom: false,
  },

  shot_video_10s_multi: {
    id: 'shot_video_10s_multi',
    category: 'inference-video',
    name: '视频推理 · 多参 · 10 秒',
    description: '多参照模式 10 秒分镜：含 @角色/@场景/@道具 映射；上下文衔接段使用 prevShot2Info / prevShot1Info / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_10s_multi,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShot2Info', { required: false }),
      variable('prevShot1Info', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
      variable('shotsSection', { required: false }),
    ],
    isCustom: false,
  },

  shot_video_15s_multi: {
    id: 'shot_video_15s_multi',
    category: 'inference-video',
    name: '视频推理 · 多参 · 15 秒',
    description: '多参照模式 15 秒分镜：含 @角色/@场景/@道具 映射；上下文衔接段使用 prevShot2Info / prevShot1Info / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_15s_multi,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShot2Info', { required: false }),
      variable('prevShot1Info', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
      variable('shotsSection', { required: false }),
    ],
    isCustom: false,
  },

  shot_video_20s_multi: {
    id: 'shot_video_20s_multi',
    category: 'inference-video',
    name: '视频推理 · 多参 · 20 秒',
    description: '多参照模式 20 秒分镜：含 @角色/@场景/@道具 映射；上下文衔接段使用 prevShot2Info / prevShot1Info / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_20s_multi,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShot2Info', { required: false }),
      variable('prevShot1Info', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
      variable('shotsSection', { required: false }),
    ],
    isCustom: false,
  },

  // ========== 视频推理 · 首帧延展模式（以单图为锚做微动延展，不带 @ 映射） ==========

  shot_video_6s_firstframe: {
    id: 'shot_video_6s_firstframe',
    category: 'inference-video',
    name: '视频推理 · 首帧 · 6 秒',
    description: '首帧延展模式 6 秒分镜：以单图为锚做微动延展；上下文衔接使用紧跨度的 prevShotInfo / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_6s_firstframe,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShotInfo', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
    ],
    isCustom: false,
  },

  shot_video_10s_firstframe: {
    id: 'shot_video_10s_firstframe',
    category: 'inference-video',
    name: '视频推理 · 首帧 · 10 秒',
    description: '首帧延展模式 10 秒分镜：以单图为锚做微动延展；上下文衔接使用紧跨度的 prevShotInfo / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_10s_firstframe,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShotInfo', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
    ],
    isCustom: false,
  },

  shot_video_16s_firstframe: {
    id: 'shot_video_16s_firstframe',
    category: 'inference-video',
    name: '视频推理 · 首帧 · 16 秒',
    description: '首帧延展模式 16 秒分镜：以单图为锚做微动延展；上下文衔接使用紧跨度的 prevShotInfo / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_16s_firstframe,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShotInfo', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
    ],
    isCustom: false,
  },

  shot_video_20s_firstframe: {
    id: 'shot_video_20s_firstframe',
    category: 'inference-video',
    name: '视频推理 · 首帧 · 20 秒',
    description: '首帧延展模式 20 秒分镜：以单图为锚做微动延展；上下文衔接使用紧跨度的 prevShotInfo / nextShotInfo',
    template: VIDEO_REASONING_TEMPLATE_CONTENT.shot_video_20s_firstframe,
    variables: [
      variable('scriptContent'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('dialogueModeDirective', { required: false }),
      variable('prevShotInfo', { required: false }),
      variable('nextShotInfo', { required: false }),
      variable('referenceTable', { required: false }),
      variable('gridSequenceNotice', { required: false }),
    ],
    isCustom: false,
  },

  grid_shot_prompt_generation: {
    id: 'grid_shot_prompt_generation',
    category: 'inference-image',
    name: '九宫格分镜提示词生成',
    description: '将单个分镜的剧情拆成 9 个连续动作帧的提示词，形成单一动作链（不是 9 个独立画面）',
    template: `根据以下分镜信息，把该分镜的剧情内容拆成 **9 个时间上连续的动作帧**，构成一条**单一动作链**——不是 9 个独立场景，不是同一情境的 9 个不同视角，而是 0 秒到结束 9 个连贯瞬间。

剧本内容：{{scriptContent}}
台词字段（只用于口型、表情、字幕/气泡判断；普通对白不要画成文字）：{{dialogueText}}
{{dialogueModeDirective}}
出场角色：{{characters}}
出现场景：{{scenes}}
出场道具：{{props}}
情绪氛围：{{emotion}}
风格前缀：{{stylePrefix}}

# 叙事弧硬约束（违反任一条都判废重写）
1. **单一时间轴**：9 帧严格按时间顺序，镜头 01 = 起手（动作 0 秒），镜头 09 = 收束（动作结束）；中间 7 帧填补连续过渡，不得跳帧、不得倒序、不得重排。
2. **单一场景 + 单一空间锚点**：9 帧必须在同一场景同一空间锚点（如：宿舍床#1 同一张床、教室同一个工位、走廊同一段位置），人物站位 / 朝向变化只允许小幅度。**禁止画面跳到不同场景或同一场景的远端**。
3. **单一动作链**：把剧情 / 情绪 / 关系推进拆成一条连贯动作链，常见骨架：
   - 起手帧（01）：当前状态 / 静态锚点（如躺着 / 坐着 / 站着 / 持物 / 视线落点）
   - 触发帧（02-03）：第一个变化（如手部动作起势、视线开始移动、表情起变）
   - 推进帧（04-05）：动作中段、视线已转移、情绪进入主峰
   - 转折帧（06-07）：动作 / 情绪关键节奏切点，可能是反应、回应、新动作起手
   - 收束帧（08-09）：动作完成、姿态归位、情绪余波；09 必须能作为下一分镜的起点（人物姿态 / 视线 / 持物 / 光影都稳定）
4. **画面要素一致**：9 帧人物外观、服装、体型、面部特征、整体色调、光照、固定陈设、道具状态全程一致；**只允许人物动作 / 姿态 / 表情 / 镜头远近角度发生变化**。
5. **画面层次一致**：每帧都写出主空间 + 背景/远景 + 前景/近景中的至少两层；需要特写时明确特写对象（手、眼、道具、系统气泡），不要只写“特写表情”。
6. **景别变化服务叙事**：远 / 中 / 近 / 特写 不与编号绑定，按节奏切换（如 01 中景定场 → 04 近景捕捉手部细节 → 07 特写表情 → 09 中景收束），**禁止 9 帧用同一景别**也禁止"每帧都换景别"的碎切。
7. **镜头机位 / 角度禁令**：除非剧情明示，禁止人物直面镜头；禁止 0° 纯正面机位；优先 30°-60° 侧拍 / 过肩 OTS。
8. **严禁孤立画面拼接**：禁止把 9 帧写成"角色 A 的 9 张特写"、"场景的 9 个不同角度"、"同一姿势的 9 种细节"——这些都是错误用法。

9. **解剖学正确（Anatomically correct）**：每帧人物动作必须**真实人体可执行**——五指、双眼、对称面部、合理关节、有明确重心 / 接触点。**禁止**：手指数量错误 / 多肢体 / 关节反向 / 头身比例失真 / 手穿过实体 / 同时执行两个相反动作 / 透视畸变。

10. **第三方评论 / 字幕 / 弹幕禁入主角动作链**：剧本里若有"网友评论""弹幕""字幕"等内容，9 帧**绝不能拍成主角对镜头念出来**——只能在某帧画面里作为字幕 / 手机屏幕 / 弹幕等纯视觉元素呈现。

# 文案精简规则
1. 每帧描述 ≤ 80 字，整段总长度 ≤ 800 字。
2. 只描述客观可见事实（人物外观 / 动作 / 表情 / 视线 / 持物 / 光线 / 环境），不复述剧情、不写心理活动、不解释事件原因、不加旁白 / 评价句。
3. 把"情绪氛围"转成可见线索：表情、肢体张力、色调、明暗对比、肢体节奏。
4. 为每个角色 / 场景 / 道具用对应 mention 引用（@char_ID / @scene_ID / @prop_ID，见下方列表）。
5. 避免空洞形容词（"epic / cinematic / 美轮美奂"）——用具体动词 / 名词 / 颜色 / 光位代替。

可用角色引用：
{{characterRefs}}

可用场景引用：
{{sceneRefs}}

可用道具引用：
{{propRefs}}

输出格式（严格按此格式输出，不要有前言或解释；每帧都包含景别/画面层次/角色动作/光影）：
镜头01：[景别；起手帧 / 静态锚点；主空间 + 背景/前景；角色姿态与光影]
镜头02：[景别；第一个变化；手部/视线/重心；可见环境层次]
镜头03：[景别；变化推进；表情和微动作；道具/前景]
镜头04：[景别；动作中段；特写对象或中景关系；光影变化]
镜头05：[景别；情绪 / 动作主峰；口型/手部/道具状态]
镜头06：[景别；节奏切点 / 反应起势；空间锚点保持]
镜头07：[景别；反应中段；表情细节和身体重心]
镜头08：[景别；收势铺垫；前景/背景呼应]
镜头09：[景别；动作完成、归位、可作为下一分镜起点的稳定态；末帧光影]
`,
    variables: [
      variable('scriptContent'),
      variable('dialogueText', {
        label: '分镜台词',
        description: '当前分镜的显式台词字段。九宫格只用它判断口型、表情、字幕/气泡。',
        format: '多行台词文本或“无”',
      }),
      variable('dialogueModeDirective', { required: false }),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('emotion'),
      variable('stylePrefix'),
      variable('characterRefs'),
      variable('sceneRefs'),
      variable('propRefs'),
    ],
    isCustom: false,
  },

  grid_4_shot_prompt_generation: {
    id: 'grid_4_shot_prompt_generation',
    category: 'inference-image',
    name: '四宫格分镜提示词生成',
    description: '将单个分镜的剧情拆成 4 个连续动作帧的提示词；适合"少切换、强稳定、节奏简洁"的镜头',
    template: `根据以下分镜信息，把该分镜的剧情内容拆成 **4 个时间上连续的动作帧**，构成一条**单一动作链** — 不是 4 个独立场景，不是同一情境的 4 个不同视角，而是 0 秒到结束 4 个关键时序锚点。

相比九宫格，四宫格只挑 4 个**最关键**的瞬间——起手 / 第一节奏切点 / 第二节奏切点 / 收束。**少切换、强稳定、节奏简洁**——适合人物对话、关键动作起承转合、情绪渐进等不需要碎切的镜头。

剧本内容：{{scriptContent}}
台词字段（只用于口型、表情、字幕/气泡判断；普通对白不要画成文字）：{{dialogueText}}
{{dialogueModeDirective}}
出场角色：{{characters}}
出现场景：{{scenes}}
出场道具：{{props}}
情绪氛围：{{emotion}}
风格前缀：{{stylePrefix}}

# 叙事弧硬约束（违反任一条都判废重写）
1. **单一时间轴**：4 帧严格按时间顺序，01 = 起手帧（动作 0 秒），04 = 收束帧（动作结束）；02/03 = 两个关键节奏切点。不得跳帧、不得倒序、不得重排。
2. **单一场景 + 单一空间锚点**：4 帧必须在同一场景同一空间锚点；人物站位 / 朝向变化只允许小幅度。**禁止画面跳到不同场景**。
3. **单一动作链**（起承转合骨架）：
   - 镜头 01：起手帧 / 静态锚点（当前状态——躺着 / 坐着 / 站着 / 持物 / 视线落点）
   - 镜头 02：第一节奏切点——动作起势、视线开始移动、表情起变
   - 镜头 03：第二节奏切点——动作中段或情绪主峰、新动作起手
   - 镜头 04：收束帧——动作完成、姿态归位、情绪余波；必须能作为下一分镜起点
4. **画面要素一致**：4 帧人物外观、服装、体型、面部特征、整体色调、光照、固定陈设、道具状态全程一致；**只允许人物动作 / 姿态 / 表情 / 镜头远近角度发生变化**。
5. **画面层次一致**：每帧都写出主空间 + 背景/远景 + 前景/近景中的至少两层；需要特写时明确特写对象（手、眼、道具、系统气泡）。
6. **景别变化服务叙事**：远 / 中 / 近 / 特写 不与编号绑定，按节奏切换（如 01 中景定场 → 03 近景捕捉关键动作 → 04 中景收束）；4 帧不要用同一景别，也不要每帧都换。
7. **机位 / 角度禁令**：除非剧情明示，禁止人物直面镜头；禁止 0° 纯正面；优先 30°-60° 侧拍 / 过肩 OTS。
8. **严禁孤立画面拼接**：不写"4 张同一姿势的特写"、"场景的 4 个角度"、"角色的 4 个表情"——这些都是错误用法。

9. **解剖学正确（Anatomically correct）**：每帧人物动作必须**真实人体可执行**——五指、双眼、对称面部、合理关节、有明确重心 / 接触点。**禁止**：手指数量错误 / 多肢体 / 关节反向 / 头身比例失真 / 手穿过实体 / 同时执行两个相反动作 / 透视畸变。

10. **第三方评论 / 字幕 / 弹幕禁入主角动作链**：剧本里若有"网友评论""弹幕""字幕""新闻播报"等内容，4 帧**绝不能拍成主角对镜头念出来**——只能作为字幕 / 手机屏幕 / 弹幕等纯视觉元素呈现。

# 文案精简规则
1. 每帧描述 ≤ 100 字，整段总长度 ≤ 500 字。
2. 只描述客观可见事实（人物外观 / 动作 / 表情 / 视线 / 持物 / 光线 / 环境），不复述剧情、不写心理活动、不加旁白 / 评价句。
3. 把"情绪氛围"转成可见线索：表情、肢体张力、色调、明暗对比。
4. 为每个角色 / 场景 / 道具用对应 mention 引用（@char_ID / @scene_ID / @prop_ID，见下方列表）。
5. 避免空洞形容词——用具体动词 / 名词 / 颜色 / 光位代替。

可用角色引用：
{{characterRefs}}

可用场景引用：
{{sceneRefs}}

可用道具引用：
{{propRefs}}

输出格式（严格按此格式输出，不要有前言或解释；每帧都包含景别/画面层次/角色动作/光影）：
镜头01：[景别；起手帧 / 静态锚点；主空间 + 背景/前景；角色姿态与光影]
镜头02：[景别；第一节奏切点 / 动作起势；手部/视线/重心；可见环境层次]
镜头03：[景别；第二节奏切点 / 动作主峰；特写对象或中景关系；光影变化]
镜头04：[景别；收束帧 / 可作为下一分镜起点的稳定态；前景/背景呼应]
`,
    variables: [
      variable('scriptContent'),
      variable('dialogueText', {
        label: '分镜台词',
        description: '当前分镜的显式台词字段。四宫格只用它判断口型、表情、字幕/气泡。',
        format: '多行台词文本或“无”',
      }),
      variable('dialogueModeDirective', { required: false }),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('emotion'),
      variable('stylePrefix'),
      variable('characterRefs'),
      variable('sceneRefs'),
      variable('propRefs'),
    ],
    isCustom: false,
  },

  storyboard_shot_prompt_generation: {
    id: 'storyboard_shot_prompt_generation',
    category: 'inference-image',
    name: '故事板分镜提示词生成',
    description: '将单个分镜整理成带制作笔记的电影级故事板/制作方案板提示词，强调剧情递进、情绪表演、光影、镜头衔接和视频 AI 可读性',
    template: `根据以下分镜信息，生成一条用于“故事板模式”出图的图片提示词。目标是一张电影级故事板信息图 / 前期制作方案表：它不是单纯漂亮拼图，而是给后续视频 AI 读取剧情、动作、机位、光影、情绪和连续性的制作板。

{{referenceTable}}

{{storyboardContinuityNotice}}

## 输入

项目名称：{{projectTitle}}
副标题：{{projectSubtitle}}
拍摄形式：{{shootingFormat}}
项目类型：{{projectType}}
当前分镜时长：{{shotDurationSeconds}}秒
限制条件：{{storyboardConstraints}}
剧本内容（唯一真理来源）：{{scriptContent}}
台词字段（只用于口型、表情和说话状态；普通对白不要画成文字）：{{dialogueText}}
{{dialogueModeDirective}}
出场角色：{{characters}}
出现场景：{{scenes}}
出场道具：{{props}}
情绪氛围：{{emotion}}
风格前缀：{{stylePrefix}}

## 故事板核心目标

1. **电影分镜信息图海报感**：画面像一张高度精细的电影分镜信息图海报 / 专业影视前期制作设定板。结构清晰，分区明确，信息密集但排版整洁，现代 UI 风格，深蓝色标题栏或等价的高级标题系统，电影级质感。
2. **剧情驱动，不机械填格**：不要机械固定 8 镜头、2x2 或均匀网格。先判断剧情内容、角色数量、场景复杂度、时长和情绪转折，再决定 X 个镜头 / X 个角色 / 1 个或多个场景。镜头数量必须服务叙事节奏：短动作可 4-6 镜头，15 秒标准段落可 6-8 镜头，复杂调度可 8-12 镜头。
3. **默认制作板模块**：默认生成“电影前期制作板”，稳定包含以下模块，但允许按剧情重要性调整面积和顺序：
   - 【项目标题】项目名称必须使用“{{projectTitle}}”，副标题必须使用“{{projectSubtitle}}”，拍摄形式必须使用“{{shootingFormat}}”，类型必须使用项目类型“{{projectType}}”，时长必须使用当前分镜时长“{{shotDurationSeconds}}秒”，限制条件必须使用“{{storyboardConstraints}}”；
   - 【角色设计区】角色设定板，包含正面、背面、侧面、特写、动作姿态；保持人物一致性，展示服装、配饰、随身道具；
   - 【场景设计区】电影级场景概念图，空间细节丰富，真实光影，电影剧照质感，环境氛围清晰；
   - 【俯视镜头调度图】场景俯视平面图，按实际镜头数标注 1-N 编号镜头，箭头表示人物移动与镜头运动轨迹，像电影拍摄蓝图 / 建筑平面图；
   - 【分镜故事区（N镜头）】N 个按时间顺序推进的镜头格，每格包含场景画面、极短制作笔记、镜头类型、焦段、运动方式；
   - 【灯光与风格】电影级布光、冷暖/明暗/反差方案；
   - 【情绪关键词】用短词或小图标表达紧张 / 轻松 / 浪漫 / 神秘 / 冲突 / 幽默等真实情绪；
   - 【声音设计】环境音与背景音乐风格；
   - 【摄影说明】镜头语言与叙事节奏；
   - 【色彩方案】统一色板和主辅色关系。
4. **剧情层层递进**：把当前分镜整理成 N 个关键视觉节拍，形成起因 / 触发 / 反应 / 转折 / 情绪主峰 / 收束。每个节拍都要有清晰的画面动作和角色状态，不写抽象剧情总结。
5. **情绪表达到位**：把情绪转化为演员表演：微表情、视线、口型、肩颈张力、手指、身体重心、呼吸、犹豫或爆发瞬间。不要只写“悲伤/紧张/震惊”。
6. **光影表达**：明确主光源、补光、反光、色温、阴影形状、烟雾/尘粒/蒸汽/水面反射等物理可见元素。光影必须推动情绪递进。
7. **镜头语言**：为每个节拍安排景别、焦段（24mm / 35mm / 50mm / 85mm 等）、机位、运动方式（静止 / 跟拍 / 手持 / 推进 / 摇臂 / 横移）、构图重心、前景/中景/背景层次。相邻节拍之间要有视觉衔接，不要孤立拼贴。
8. **项目风格注入**：整体画风必须继承“风格前缀”，人物 / 场景 / 道具与项目已有视觉参考保持同一美术体系。不得漂移到不相干写实、动漫或广告风格。
9. **可读笔记文字**：故事板上必须有短笔记文字，用于给视频 AI 生成连贯剧情。允许并鼓励出现：面板编号、短标题、镜头标签、动作笔记、情绪笔记、光影笔记、声音笔记、转场/衔接笔记、角色路径箭头、机位编号、俯视平面图标注。文字要短、清楚、像制作板备注；不要写成长段说明。
10. **不是字幕**：笔记文字不是对白字幕，也不是把台词贴在画面里。普通对白只转化为口型/表情/动作笔记；只有剧本明确要求屏幕字、弹幕、招牌、UI 时，才把那些文字作为画内文本。
11. **版式决策系统**：故事板很复杂，绝不能默认固定 2x2 或均匀网格。默认采用“多区块电影前期制作板”；只有剧情正好是四段宣传漫画时才用 2x2。必须先判断当前分镜需要表达什么，再选择结构：
   - 如果剧情正好是四段强递进，可用垂直 2x2 四格宣传漫画信息图；
   - 如果有动作冲突、空间调度、追逐、对峙、多人关系，优先用电影级制作方案表：主场景大图 + 俯视平面图 + 角色路径箭头 + 编号机位 + 分镜脚本笔记；
   - 如果是连续情绪或动作推进，用宽幅 4-8 面板电影故事板，每格下方有 camera/action/light/mood notes；
   - 如果需要解释角色表演、道具、能量特效或关键姿态，可加入非对称研究区：角色表演小稿、道具/手部特写、光影色板、构图草图、动作弧线；
   - 允许非对称、多区块、多尺寸面板、主大图 + 小缩略图、插入平面图和机位图；只要叙事清晰、制作可读、风格统一即可。
12. **引用编码**：所有人物 / 场景 / 道具引用必须使用 \`@<id> <名称>\` 格式；故事板连续性引用只在上方参考集合真实存在时使用 \`@previous_storyboard_anchor 上一故事板锚点\` 或 \`@storyboard_anchor 当前故事板锚点\`。没有真实锚定图时禁止输出这些锚点。**严禁输出 \`@Image N\` / \`@图片N\` / \`references[N]\`**，这些只属于最终请求编译后的 provider 协议，不允许写入本地可编辑提示词。

## 输出字段

故事板类型：[例如：非对称电影级制作方案表 / 宽幅连续故事板 / 主场景+平面图+机位调度板 / 角色表演研究故事板 / 四格宣传漫画信息图；按当前剧情复杂度选择，禁止固定默认 2x2]
整体画风：[继承风格前缀；说明摄影质感/绘制质感/色彩体系]
【项目标题】：[项目名称：{{projectTitle}}；副标题：{{projectSubtitle}}；拍摄形式：{{shootingFormat}}；类型：{{projectType}}；时长：{{shotDurationSeconds}}秒（必须是当前分镜时长，不是项目总时长）；限制条件：{{storyboardConstraints}}]
版式构图：[电影分镜信息图海报；深蓝色标题栏或高级标题系统；结构清晰的网格布局但不机械等分；写清阅读顺序、边框风格、主场景大面板、连续小面板、俯视平面图、角色路径箭头、编号机位、角色/道具/手部/光影研究区、色彩条/灯光条]
【角色设计区】：[角色设定板；按实际角色数展示正面/背面/侧面/特写/动作姿态中的关键视图；保持人物一致性；写实摄影风格或项目风格下的高细节面部；服装、配饰、随身道具展示]
【场景设计区】：[电影级场景概念图；空间结构、前中后景、环境氛围、时间/天气/材质/真实光影；必须继承 @scene 引用]
【俯视镜头调度图】：[场景俯视平面图；按实际镜头数标注 1-N 编号镜头；箭头表示人物移动与镜头运动轨迹；包含角色站位、关键道具、入口/出口、镜头方向]
【分镜故事区（N镜头）】：[按 1-N 列出镜头，N 由剧情节奏决定。每个镜头必须包含：场景画面、极短对白/动作笔记（不是字幕）、镜头类型（远景/中景/特写）、焦段（24mm/35mm/50mm/85mm）、运动方式（静止/跟拍/手持/推进/摇臂/横移）、情绪变化、光影变化、与下一镜头的衔接]
文字笔记层：[必须有短笔记；列出每个面板或研究区的短标题、camera/action/mood/light/sound/transition notes；说明文字是制作备注，不是对白字幕；避免长段文字墙]
剧情节拍：[按时间顺序写 N 个节拍；每个节拍包含面板编号、短标题、景别、焦段、机位、角色动作、情绪变化、画面层次、衔接到下一节拍；镜头数由剧情决定，不机械补满]
角色表演：[逐条写 @char_<id> <角色名> + 表情递进、微动作、视线、手部、重心和口型；有参考图时禁止改写常规外貌]
场景与道具：[逐条写 @scene_<id> / @prop_<id> 的空间关系、材质状态、反光/遮挡/接触点]
【灯光与风格】：[主光、补光、轮廓光、色温、反差、冷暖关系、高对比/柔光/低照度氛围；说明光影如何从开场推进到收束]
【情绪关键词】：[用短词或图标式词组表达核心情绪，例如紧张 / 轻松 / 浪漫 / 神秘 / 冲突 / 幽默；必须和角色表演对应]
【声音设计】：[环境音说明，如脚步声、风声、城市噪音、机器声、衣料摩擦、道具声；背景音乐风格，如现代/悬疑/古风/低频弦乐；声音只作为制作笔记，不画成字幕]
【摄影说明】：[镜头语言说明：稳定推进 / 手持抖动 / 远景建立 / 特写情绪强化 / 过肩关系 / 横移揭示；强调电影感构图与叙事节奏]
【色彩方案】：[统一色板，例如深蓝 / 灰黑 / 暖米色 / 冷青色点缀；写主色、辅色、情绪色和光源色，不要每格乱换色]
连续性：[如存在上一故事板参考，写如何继承上一故事板的场景/人物/光影/末态；否则写“无上一故事板参考，按当前分镜建立起始状态”]
负面约束：不要把普通对白画成字幕，不要长段文字墙，不要无关 logo / 水印，不新增无关角色，不改角色服装和场景结构，避免畸形手、错位眼、穿模、透视扭曲

## 引用列表

- 可用角色：{{characterRefs}}
- 可用场景：{{sceneRefs}}
- 可用道具：{{propRefs}}

输出：直接输出提示词，不要任何说明。
`,
    variables: [
      variable('scriptContent'),
      variable('dialogueText', {
        label: '分镜台词',
        description: '当前分镜的显式台词字段。故事板只用它判断表情、口型和说话状态，不应把普通对白画成文字。',
        format: '多行台词文本或“无”',
      }),
      variable('dialogueModeDirective', { required: false }),
      variable('projectTitle'),
      variable('projectSubtitle'),
      variable('shootingFormat'),
      variable('projectType'),
      variable('shotDurationSeconds'),
      variable('storyboardConstraints'),
      variable('characters'),
      variable('scenes'),
      variable('props'),
      variable('emotion'),
      variable('stylePrefix'),
      variable('characterRefs'),
      variable('sceneRefs'),
      variable('propRefs'),
      variable('referenceTable', { required: false }),
      variable('storyboardContinuityNotice', { required: false }),
    ],
    isCustom: false,
  },

  character_extraction: {
    id: 'character_extraction',
    category: 'extraction',
    name: '角色提取',
    description: '从剧本中提取所有可单独识别的人物（含"我"），输出结构化资料用于后续 AI 文生图与角色基准库',
    template: `请根据提供的小说原文、推文文案、故事情节，提取文中出现过的所有"可单独识别的人物"，包括"我"，输出结构化资料用于后续 AI 文生图与角色基准库。

【输入数据】
小说原文：
{{script}}

推文文案（已精炼的整集解说旁白；可补足剧情主线信息；无则视作空）：
{{tweetScript}}

故事情节（剧情主线摘要；无则视作空）：
{{plotSummary}}

项目视觉风格定向（视觉风格关键词；用于在原文未明说时做合理可视化补全的风格收敛，不影响客观事实；无则忽略）：
{{stylePrefix}}

【字段要求】每个人物必须输出以下字段：
1. "name"：人物标准名（最稳定、最适合作为主名称的称呼）
2. "aliases"：人物全部代称，多个代称用英文逗号分隔；不得重复 name 本身；aliases 内部不得重复；如果没有代称，填空字符串 ""
3. "age"：年龄
   - 必须依据剧本线索（职业、身份、社会角色、对白语气、家庭关系、场景、年代背景）尽量给出具体年龄或区间
   - 可写形式示例："28岁"、"约30岁"、"40岁出头"、"10岁左右的少年"、"60岁以上的老人"
   - 仅当剧本完全没有任何线索可推断时才允许填"未知"，正常情况下禁止使用"未知"
4. "gender"：只能填写 "male"、"female"、"neutral"、"unknown"；性别无法 100% 确认时根据上下文选最合理的可视化性别，不要写 "unknown" 兜底
5. "role"：只能填写 "protagonist"、"antagonist"、"supporting"
6. "appearance"：纯客观可见外观，作为文生图的核心提示词；总长度 ≥ 60 字
   - **必须显式包含以下七要素**（缺一不可）：年龄段、性别、发色、发型、眼睛颜色、上身服装、下身服装
   - 在七要素之外还要尽量覆盖：脸部细节（脸型、眉型、眼型、鼻型、嘴唇、肤色）、体态（身高感、身材、姿势）、鞋履与配饰（眼镜、首饰、围巾、手套、武器/法器造型，均带材质）、衣物外可见的特征痕迹（疤痕、纹身、胎记）
   - 服装必须给出【颜色】+【款式】+【材质】三维（如：深灰色羊毛长风衣 / 白色棉质立领衬衫 / 蓝色牛仔修身长裤）
7. "description"：≤ 20 字的极简身份 / 职业标签，仅用于 LLM 上下文识别，禁止任何剧情、性格、心理、过往经历

【硬性规则】违反任一项都视为不合格：
1. **必须包含"我"这个人物**。即使原文未明确"我"的外貌，也要结合上下文给出最合理、最保守的可视化补全（性别、年龄段、身份气质都要落到画面元素上）。
2. 必须合并同一人物的不同叫法、代称、身份称呼到同一条记录里，不要重复输出同一个人物；多个名字时 name 选最核心、最稳定的，其余全部进 aliases。
3. 只提取"可单独识别的人物"。禁止输出泛指群体：众人 / 同学们 / 路人 / 村民们 / 所有人 等。
4. 若人物没有明确姓名但在文中可单独识别，使用文中最稳定的称呼作为 name（如：班主任、老板娘、司机、邻居阿姨）。
5. **每个人物的穿着必须尽量不重复**。原文未明确服装时，在不违背人物身份、时代、阶层、剧情氛围的前提下做合理且保守的差异化补全，确保不同人物在画面中可一眼区分。
6. 若提供了"项目视觉风格定向"，对原文未明说的视觉细节做补全时风格要向其收敛；但不得改变原文已明确的外观事实。

【appearance 红线规则】
1. 只描述视觉可见的客观特征。禁止性格、情绪、气质、命运、心理、思想等抽象词。
2. 服装材质禁止"职业套装"、"日常服"、"休闲装"等模糊词，必须给出具体材质（棉布 / 呢料 / 皮革 / 亚麻 / 丝绸 / 牛仔 / 工装布 / 针织 / 化纤 等）。
3. 禁止描述被衣物遮挡的身体特征（如胸口胎记、腰背纹身、内衣、私处），只写衣物外可见的痕迹。
4. 禁止"好看的 / 普通的 / 帅气的 / 美丽的 / 清秀的"等主观或模糊词汇。
5. 禁止职业 / 身份 / 社会关系叙述（如店主、老板、养父）；这些写到 description 字段。
6. 禁止超自然能力设定（如能看见鬼魂、通灵、被诅咒）。
7. 禁止经历背景事件（如火场被救、全家遇难、身世成谜）。
8. 必须使用中文描述；任何无法在画面中直接看到的内容一律剔除。
9. appearance 写法风格统一，建议结构："一个……岁左右的……人，……发色……发型，……眼睛，穿着……上装，下身穿……"

【输出要求】
- 只输出 JSON，可包裹在 \`\`\`json 代码块中；禁止输出任何解释、前言、备注、Markdown 标题。
- JSON 必须严格遵循下方示例的结构（顶层对象包含 \`characters\` 数组）。
- 不得出现重复人物、不得漏掉"我"、不得缺字段、不得输出无效 JSON。

\`\`\`json
{
  "characters": [
    {
      "name": "顾行",
      "aliases": "阿行,顾先生",
      "age": "28岁",
      "gender": "male",
      "role": "protagonist",
      "appearance": "一个28岁左右的年轻男人，黑色微卷短发，深棕色丹凤眼，窄长脸，挺直鼻梁，薄唇，小麦色肤；中等偏高瘦削身形，肩背挺拔；上身穿深灰色羊毛长风衣搭白色棉质立领衬衫，下身穿黑色斜纹布修身长裤，脚踩黑色牛皮短靴，左手腕戴一只银色金属机械表，左眉尾有一道浅淡旧疤。",
      "description": "年轻调查员"
    },
    {
      "name": "我",
      "aliases": "自己",
      "age": "20岁左右",
      "gender": "female",
      "role": "supporting",
      "appearance": "一个20岁左右的年轻女人，深棕色长发扎成低马尾，黑色眼睛，圆脸柔和五官，浅肤色；中等偏瘦体型；上身穿浅杏色棉质连帽外套搭白色针织内搭，下身穿蓝色牛仔修身长裤，脚踩白色帆布鞋。",
      "description": "第一人称叙述者"
    }
  ]
}
\`\`\`
`,
    variables: [
      variable('script'),
      variable('tweetScript', { required: false }),
      variable('plotSummary', { required: false }),
      variable('stylePrefix', { required: false }),
    ],
    isCustom: false,
  },

  scene_extraction: {
    id: 'scene_extraction',
    category: 'extraction',
    name: '场景提取',
    description: '从剧本中提取所有"主要场景"，输出结构化资料用于后续 AI 文生图与场景基准库',
    template: `请根据提供的小说原文、推文文案、故事情节，提取文中出现过的所有"主要场景"。

【输入数据】
小说原文：
{{script}}

推文文案（已精炼的整集解说旁白；可补足剧情主线信息；无则视作空）：
{{tweetScript}}

故事情节（剧情主线摘要；无则视作空）：
{{plotSummary}}

项目视觉风格定向（视觉风格关键词；用于在原文未明说时做合理可视化补全的风格收敛，不影响客观事实；无则忽略）：
{{stylePrefix}}

【字段要求】每个场景必须输出以下字段：
1. "name"：场景标准名称
   - 必须 ≥ 4 个字，且尽量清晰、稳定、适合后续做参考图命名
   - 例：学校校园外景 / 家中客厅内部 / 医院病房内部 / 废弃工厂仓库内部
2. "aliases"：场景全部代称，多个代称用英文逗号分隔；不得重复 name 本身；如果没有代称，填空字符串 ""
3. "description"：场景详细可视化描述（中文），按下面"description 写法规范"组织
4. "time"：可见时间状态，仅可为 "day" / "night" / "twilight"
5. "weather"：天气短语（如 晴 / 阴 / 小雨 / 暴雨 / 大雪 / 雾 等）；若不可判定填 ""
6. "mood"：可见氛围短语（落到光线 / 色调 / 空间状态 / 天气特征上的可见线索，禁止抽象评价词）
7. "keyElements"：场景内具有辨识度的可视化元素列表（字符串数组），3–6 项

【硬性规则】违反任一项都视为不合格：
1. 必须合并同一场景的不同叫法、别称、简称到同一条记录；不得重复输出同一个场景。
2. 只提取"主要场景"：对剧情推进有作用、被明确提及、可单独形成视觉画面。不要输出一闪而过、无法独立成景的泛化地点。
3. 同一地点在不同时间段或使用状态下本质仍是同一场景的，优先合并为一个场景。
4. 同一建筑内若有多个明显独立空间且能在剧情中单独成镜（客厅 / 卧室 / 病房 / 走廊），允许分别输出。
5. 若提供了"项目视觉风格定向"，对原文未明说的视觉细节做补全时风格要向其收敛；但不得改变原文已明确的空间事实。

【description 写法规范】
1. description 必须是完整自然语言句子，并尽量包含以下可视化信息：
   - 环境类型（室内 / 室外 / 场所属性）
   - 时间（白天 / 黄昏 / 夜晚 / 凌晨）
   - 氛围（落到可见光线、色调、天气特征上）
   - 空间结构（前景 / 中景 / 后景关系，房间布局，开口与通道）
   - 主要陈设
   - 主要材质
   - 光线特征（光源方向、强度、色温）
   - 可识别细节（招牌 / 标志 / 划痕 / 痕迹等可作为镜头记忆点的元素）
2. 必须以"场景可视化描述"为主，方便后续直接用于场景设定或生图参考。
3. **绝对禁止**出现以下任一项：
   - 人物姓名 / 人物代称 / 我 / 他 / 她 / 他们
   - 人物动作 / 人物情绪 / 对话内容
   - 抽象评价词（"很阴森"、"很豪华"、"很破旧"），必须落到具体画面元素上
4. 原文未把场景描写得很完整时，结合剧情语境、场景用途、时代背景、生活常识做合理保守的可视化补全；不得补出超出剧情常识的夸张设定。
5. 写法风格统一，优先采用"空间结构 + 地面 / 墙面 / 陈设 + 光线 / 氛围 + 可识别细节"的方式描述。

【室内场景特殊要求 — 为后续场景图透视全貌取景预留素材】
后续场景参考图会以"强透视 + 全貌取景"方式渲染，让下游视频模型不需要凭空想象未入画的部分。
因此对所有 description 中能判定为**室内**的场景，必须显式写明以下要素：
   a. 至少两面相邻墙体的位置与材质（如"左侧水泥墙、正面贴白色瓷砖的承重墙"）
   b. 地面材质与图案（如"灰色水磨石地面，带浅色拼缝"）
   c. 天花板状态（吊顶 / 露梁 / 裸顶管线 / 高度感）
   d. 全部主要开口的相对位置：门 / 窗 / 拱门 / 走廊入口（如"正面墙居中有一扇木门，右侧墙开两扇窄窗"）
   e. 房间整体布局轮廓（开间形状、深度方向、家具分布的相对位置）
若原文未明说，按场景用途与时代背景做合理保守补全；不得为了缩短描述而省略墙体 / 地面 / 天花板 / 开口任一项。
室外场景不强制以上 a–e 项，但仍需写清地面、主要建筑立面、纵深方向上的可见物，便于建立透视纵深。

【输出要求】
- 只输出 JSON，可包裹在 \`\`\`json 代码块中；禁止输出任何解释、前言、备注、Markdown 标题。
- JSON 必须严格遵循下方示例的结构（顶层对象包含 \`scenes\` 数组）。
- 不得出现重复场景、不得缺字段、不得输出无效 JSON。

\`\`\`json
{
  "scenes": [
    {
      "name": "学校校园外景",
      "aliases": "校园,教学楼",
      "description": "一处带有教学楼和操场的校园外部空间，时间为白天，整体氛围开阔而日常。主楼是红砖结构的教学楼，前方连接着宽阔的水泥地和塑胶跑道，操场边缘种着成排树木，地面开阔，视野完整，具有明显的校园公共区域特征。",
      "time": "day",
      "weather": "晴",
      "mood": "开阔、日常、自然光均匀",
      "keyElements": ["红砖教学楼", "塑胶跑道", "成排树木", "水泥广场"]
    },
    {
      "name": "家中客厅内部",
      "aliases": "家里,客厅",
      "description": "一间长方形的普通住宅客厅内部，时间偏傍晚，氛围安静而生活化。开间略呈横向，深度方向通向居室内侧。左侧为整面浅米色乳胶漆墙，墙上挂一幅小尺寸装饰画；正面墙体为浅灰色乳胶漆，墙面居中摆一台低矮的胡桃木电视柜，右上方开一扇方形落地窗，窗外可见暖色傍晚天光；右侧墙体为同色乳胶漆，靠墙位置设一组米色布艺三人沙发，沙发后通向走廊的拱形门洞位于右后角。地面铺设浅栎木色实木地板，带细密拼缝。顶部为简洁白色平吊顶，中央嵌一盏圆形吸顶暖光灯，灯光向四周扩散在墙面留下柔和过渡。中央区域摆放低矮深木色茶几，茶几与沙发、电视柜共同构成紧凑的居家生活动线。",
      "time": "twilight",
      "weather": "",
      "mood": "暖色调灯光、安静、居家",
      "keyElements": ["浅栎木地板", "米色布艺沙发", "胡桃木电视柜", "白色平吊顶圆形吸顶灯", "正面墙落地窗", "右后角拱形门洞"]
    }
  ]
}
\`\`\`
`,
    variables: [
      variable('script'),
      variable('tweetScript', { required: false }),
      variable('plotSummary', { required: false }),
      variable('stylePrefix', { required: false }),
    ],
    isCustom: false,
  },

  prop_extraction: {
    id: 'prop_extraction',
    category: 'extraction',
    name: '道具提取',
    description: '从剧本中提取所有"主要道具"，输出结构化资料用于后续 AI 文生图与道具基准库',
    template: `请根据提供的小说原文、推文文案、故事情节，提取文中出现过的所有"主要道具"。

【输入数据】
小说原文：
{{script}}

推文文案（已精炼的整集解说旁白；可补足剧情主线信息；无则视作空）：
{{tweetScript}}

故事情节（剧情主线摘要；无则视作空）：
{{plotSummary}}

项目视觉风格定向（视觉风格关键词；用于在原文未明说时做合理可视化补全的风格收敛，不影响客观事实；无则忽略）：
{{stylePrefix}}

【字段要求】每个道具必须输出以下字段：
1. "name"：道具标准名称，2 个字以上，清晰、稳定、适合后续做参考图命名（如：银色机械怀表 / 黑色长柄雨伞 / 桐木骨灰盒 / 旧式翻盖手机 / 朱砂符纸）
2. "aliases"：道具全部代称，多个代称用英文逗号分隔；不得重复 name 本身；如果没有代称，填空字符串 ""
3. "description"：道具详细可视化描述（中文），按下面"description 写法规范"组织
4. "importance"：道具在剧情中的重要性，仅可为 "high" / "medium" / "low"
   - high：贯穿主线、决定结局、反复出现的关键信物 / 武器 / 证物
   - medium：在 1–2 个核心情节点起作用的道具
   - low：场景中出现但仅做点缀、辅助说明的道具
5. "scenes"：该道具出现过的场景标准名列表（字符串数组，应与场景提取的 name 字段对齐）；若无法确定填空数组 []

【提取范围 — 主要道具】满足下列任一条件即纳入：
- 会与角色发生交互（被拿起、使用、交换、佩戴、丢弃、藏匿）
- 推动剧情发展（信物、关键证物、线索、武器、法宝、钥匙、信件、手机、契约、药剂等）
- 反复出现且具有可识别外观的可移动物

【严禁提取】下列类别归属场景或角色描述，不进入 props：
- 环境陈设：沙发、椅子、床、柜子、桌子、灯具、门、窗、墙壁、地板、天花板、管道、固定设施、建筑结构
- 角色服装与造型组成部分：上衣、裤子、鞋、围巾、首饰、发饰、帽子、眼镜（**例外：剧情明确把它作为关键信物使用时可保留为道具**）
- 宠物 / 随身生物 / 灵兽（属角色范畴）
- 食物 / 饮料一闪而过的消耗品（除非剧情围绕它展开）
- 一闪而过、无法独立成镜的泛化物体

【硬性规则】违反任一项都视为不合格：
1. 必须合并同一道具的不同叫法、别称、简称到同一条记录；不得重复输出同一个道具。
2. 同一道具在不同章节有外观变化（如崭新 → 烧毁），优先合并为一个道具，并在 description 里点出最具辨识度的稳定外观；不要拆成多个重复道具。
3. 同一类别下若有多件外观差异明显的同类物（如两把不同的剑、两封不同的信），允许分别输出，但必须给出独立 name 和差异化 description。
4. 若提供了"项目视觉风格定向"，对原文未明说的视觉细节做补全时风格要向其收敛；但不得改变原文已明确的客观外观。
5. \`scenes\` 数组中的场景名应使用与场景提取一致的标准名；若该道具未在任何已明确的场景中出现，填 []。

【description 写法规范】
1. description 必须是完整自然语言句子，并按以下结构尽量包含可视化信息：
   - 形状
   - 主要材质
   - 结构特征（开合方式、组成部件、连接关系）
   - 主要颜色
   - 表面纹理 / 磨损 / 污渍
   - 尺寸感（手掌大小 / 半人高 / 可单手握持 等相对尺度）
   - 可识别细节（刻字、图案、瑕疵、标签）
2. 必须以"道具可视化描述"为主，方便后续直接用于道具设定或生图参考。
3. **绝对禁止**出现以下任一项：
   - 人物姓名 / 人物代称 / 我 / 他 / 她 / 他们
   - 人物动作（"被某人拿在手中"、"挥舞"等）/ 人物情绪 / 对话内容
   - 道具在剧情中的象征意义 / 推动了什么事件
4. 原文未把道具描写得很完整时，结合道具用途、时代背景、剧情语境、生活常识做合理保守的可视化补全；不得补出超出剧情常识的夸张设定。
5. 写法风格统一，优先采用"形状 + 材质 + 结构 + 颜色 + 表面细节 + 尺寸感"的方式描述。

【输出要求】
- 只输出 JSON，可包裹在 \`\`\`json 代码块中；禁止输出任何解释、前言、备注、Markdown 标题。
- JSON 必须严格遵循下方示例的结构（顶层对象包含 \`props\` 数组）。
- 不得出现重复道具、不得缺字段、不得输出无效 JSON。

\`\`\`json
{
  "props": [
    {
      "name": "银色机械怀表",
      "aliases": "怀表,旧表",
      "description": "一只可单手握持的圆形机械怀表，外壳为做旧抛光的银色金属，正面有可向上翻开的弧形表盖，盖面刻有细密的几何花纹，连接一根短链；表盘为奶白色，黑色罗马字标，时分针为深蓝色，玻璃表面有一道斜向的细微划痕。",
      "importance": "high",
      "scenes": ["殡葬用品店后院", "家中客厅内部"]
    },
    {
      "name": "桐木骨灰盒",
      "aliases": "骨灰盒,木盒",
      "description": "一只双手可端起的长方形桐木盒，整体为浅黄褐色木质纹理，表面打磨平整带有暗淡哑光质感，盒盖与盒身通过两枚黄铜小锁扣闭合，前侧贴有一张泛黄的白色长条纸标签，四角带有轻微磕碰留下的浅色擦痕。",
      "importance": "medium",
      "scenes": ["殡葬用品店后院"]
    }
  ]
}
\`\`\`
`,
    variables: [
      variable('script'),
      variable('tweetScript', { required: false }),
      variable('plotSummary', { required: false }),
      variable('stylePrefix', { required: false }),
    ],
    isCustom: false,
  },

  tweet_script_generation: {
    id: 'tweet_script_generation',
    category: 'tweet',
    name: '推文文案生成（漫剧爆款公式版）',
    description: '把整集剧本改造成第一人称漫剧推文旁白；强制爆款开头公式 + 删水文 + 短句节奏 + 反差递进反转结构，适配漫剧短视频。',
    template: `你是一名为漫剧短视频创作者服务的专业小说润色智能体。核心使命：把用户输入的小说原文，改造成适配短视频平台、能拉满停留与完播的【第一人称漫剧爆款旁白】。
请严格按照下面的爆款公式 + 漫剧文案规则，输出一段可直接做 TTS 配音 / 直接做字幕的连续旁白。

【输入剧本】
{{script}}

═════════════════════════════════════════════════════════════
【0. 字幕标点强约束 — 最高优先级（违反任意一条 = 失败）】
═════════════════════════════════════════════════════════════
本输出会直接做成竖屏短视频字幕，标点会变成画面噪声、引号 / 句号会卡 TTS 朗读。强制：

▸ 全文**唯一允许**的标点：**中文逗号「，」**。其它标点一律用换行替代。
▸ **严禁出现**的标点（出现即不合格）：
  句号「。」 问号「？」 感叹号「！」
  引号「"」「"」「'」「'」「「」「」」 书名号「《》」
  冒号「：」 分号「；」 顿号「、」
  省略号「……」「...」 破折号「——」「—」 括号「（）」「()」
  以及对应的所有英文标点 . ? ! " ' : ; , ... — ( )（其中英文逗号也禁止，逗号只用中文「，」）
▸ **一句一行**：原文里每出现一个语义停顿（原本会用句号 / 问号 / 感叹号 / 长破折号的位置），都用**换行**代替；同一行内仅允许少量逗号做轻微停顿
▸ **每行最多 15 字**（硬上限，超出立即换行；理想区间 6–15 字，更短更利于字幕一屏读完）
▸ 人物台词不加引号：直接换行写台词内容；如需指明谁在说，用「他说」「我说」开头另起一行，再换行写台词正文
▸ 数字 / 英文 / 专有名词照常保留（比如 14 亿 / 80% / 5 月 16 号 / S 省）
▸ 拟声词 / 强情绪短句单独成行（比如：卧槽 / 砰 / 我愣住了）

正确示例（看就懂）：
我一出生就被五鬼夺寿
刚满五岁就已经半截身子埋进棺材
爷爷说我想要活命
就必须向死人借寿
棺材里的尸参熬汤我每天喝三碗
骸骨上的骨菌我一口吃八根
就连十分罕见的太岁我都一周一顿
经过这三种大补
我才勉强活到了今天

错误示例（任何一条都不允许）：
"我一出生就被五鬼夺寿。"   ← 用了引号 + 句号
我一出生就被五鬼夺寿，刚满五岁就已经半截身子埋进棺材，爷爷说...   ← 没换行，全堆在一句
我说："你疯了吗？"   ← 用了引号 + 冒号 + 问号

═════════════════════════════════════════════════════════════
【1. 人称强制 — 第一人称"我"沉浸式视角】
═════════════════════════════════════════════════════════════
- 全文统一第一人称"我"叙事，绝对不切换第三人称
- 漫剧主角视角，所有动作 / 心理 / 反应都从"我"的角度展开
- 配角通过"他 / 她 + 极短台词"融入"我"的旁白，不做独立第三人称解说

═════════════════════════════════════════════════════════════
【2. 开头黄金钩子（前 3 句必须爆款公式开局）— 王中之王】
═════════════════════════════════════════════════════════════
开头**必须**套用以下任一爆款结构（选最贴合本集核心反差 / 转折的一种）：

▸ 反转结构（最基础、最稳）
模板：「我一个 xxx，却被 xxx，就连 xxx，甚至 xxx，然而 xxx，只因 xxx」
关键字眼：却 / 竟 / 不仅 / 而且 / 就连 / 甚至 / 然而 / 不仅不…反而… / 只因
例：我一个重度精神病，却被全国人奉为神明；他们听我说自己是派大星，竟也深信不疑；只因…

▸ 都知道结构
模板：「做过 xx 的都知道，xx 不仅 xxxx，而且 xxxx，甚至 xxxx，而我却…」
例：杀过人的都知道，毁尸灭迹是头等大事，但更重要的却是如何跑路，怎么让所有人都抓不到你…

▸ 全国类
模板：「全国 14 亿人都被 xxx 骗了，其实 xxx 并不是 xxx，而是 xxx，当年…」
例：全国 13 亿人都被刘备骗了，宅心仁厚不过是他收买人心的手段，真实面目却是阴险狡诈的大耳贼…

▸ 第一次类
模板：「我（你 / 男人）第一次 xx，竟 xxx，不仅 xxx，甚至 xxx，然而 xxx，此刻…」
例：我第一次直播就把 80 万观众吓当场嗝屁，可这样诡异的直播，不仅没人出来制止，反而吸引了全球 76 亿人在线观看…

▸ 为了证明类
模板：「为了证明 xxx，可以 xxx，竟 xxx，不仅 xxxx，而且 xxxx，甚至 xxxx，此刻…」
例：为了证明癌细胞是不死的存在，我一夜之间在体内植入 37 种病毒，只因…

▸ 这是 xx 世界 / 这个世界每个人都
模板：「这是个 xx 的世界，每个人 xx 都会 xx，有的 xxxx，有的 xxxx，甚至 xxx，然而明明 xxx，却 xxx，但…」
例：这是个赛博朋克世界，所有人都有概率成为强大的升者，有觉醒成为擅长战斗的武者…而我一觉醒来成为反派…

▸ 起床第一件事
模板：「这个世界的人起床第一件事就是 xxx，不仅 xxx，而且 xxx，甚至 xxx，然而我却 xxx，此刻…」

▸ 我重生 / 穿越 / 觉醒类
模板：「我重生（穿越 / 觉醒）成了 xxx，而且还是 xxx，不仅 xxxx，而且 xxxx，甚至 xxxx，此刻…」
例：我重生成了一条狗，却被人当神明供奉；只因我虽然是狗却已经活了 68 年之久…

▸ 意外发现 / 获得类
模板：「我意外（发现 / 获得 / 觉醒） xxx，然而 xxx，甚至 xxx，但他们都不知道的是 xxx，此刻…」
例：我意外获得鱼鱼果实，却被众人嘲讽是个离不开水的废物果实；殊不知鱼鱼果实其实是恶魔果实的天花板…

▸ 还没死 / 临终之问类
模板：「xx 意识到自己马上就要死了，于是临死前 xxx，xxx」
例：奶奶意识到自己马上就要死了，于是临死前问我一个很奇怪的问题，xxx
例：爷爷意识到自己马上就要死了，于是临死前嘱咐了我两件事，第一 xxx

▸ 一出生类（异象 / 诅咒 / 命格）
模板：「我（这个 xx 里的人）一出生就 xxx，不仅 xxx，甚至 xxx，xxx」
例：我一出生就让村里的女人全成了寡妇，村子里圈养的鸡鸭也在一夜之间消失不见，xxx
例：这个村子里的男孩一出生都要穿上寿衣，而且必须穿满八年才能脱掉，xxx
例：我一出生就被五鬼夺寿不久矣，刚满五岁就已经半截身子埋进了棺材，xxx

▸ 那天那年类（特定时间 + 反常铺垫）
模板：「从我 xx 岁那年（那天）起，全家（村里 / 学校）就开始 xxx，只因 xxx」
例：从我九岁那年起，全家就开始躺在红棺材里等死，只因奶奶十年前绑回来一个疯女人 xxx
例：那天我问师傅，唐僧师徒取回的真的是真经吗，倘若是真经，为何 xxx

▸ 民间传说 / 阎王类
模板：「（民间）传说，xxx 每年都会 xxx，那年 xxx 点了我的名字，xxx」
例：传说阎王爷每年都会在生死簿随机点卯，点到谁的名字，谁就得在一年之内去地府报道，那年阎王点了我的名字 xxx

▸ 穿越具体朝代 / 历史人物类（穿越题材首选钩子家族）
模板 A：「穿越 xx，我（成了 / 当着 / 面对） xxx，每天不是 xx 就是 xx，目的就是 xxx，今天 xxx」
模板 B：「穿到 xx 后，我本想 xxx，但因 xxx，xxx，正巧 xxx」
例：穿越大唐，贞观成为李世民的儿子，每天不是去青楼看花魁弹琴吹箫，就是把李世民气得三天饿九顿，只因要让自家老爹封了我去偏远地区当个逍遥王，今天我来到了皇宫内
例：穿越大明，你当着朱元璋的面收敛贪污百万两黄金，不仅修建豪宅雇官员入商，还私自铸刀征兵 xxx
例：穿越古代，我面对皇兄诬陷我沾污皇嫂时，我直接复刻凌晨审判的那场叔嫂案，xxx
例：穿到三国后，我本想辅佐刘备成就一番大事，但因思想过于超前，被说妖言惑众，正巧此时曹操 xxx
例：穿越大唐，我靠装疯卖傻誓要打京城第一美女为妻，xxx
关键句式：「穿越大唐 / 大明 / 古代 / 三国」+ 立刻反差行为 + 「目的就是 / 只因 / 此刻」收口

▸ 我是 / 我成了 / 我以 xx 身份类（强戏剧反差身份切入）
模板：「我是（成了 / 拥有 / 以） xx 的 xx，xxx，xxx，xxx」
例：我是史上最长寿的将军，在百岁寿宴当天，本该等待狼凯旋归来恭贺大寿的我，却等来了九口带血的棺材，送棺前来的 36 人目光整齐划一
例：我成了秦始皇的私生子，对他说的第一句话就是，爹我们准备造反吧，秦始皇 3 年之后必死，大秦终亡
例：我以神仙的身份在外悲摆招摇撞骗，说自己召唤神龙呼风唤雨的法术有手就行，谁料 xxx
例：我拥有无限寿元却娶了个凡人女子为妻，为了能和她共度余生，我选择与她笑死一同老去 xxx
例：我可以凭借一个眼神吓退满朝文武百官，他能让自身为九五之尊的皇帝给你端茶倒水

▸ 强戏剧事件开局类（从荒诞情节切入，无 "我"前置铺垫）
模板：「xxx，却 xxx；眼前 xxx，下一秒 xxx」
例：富豪千金抛绣球招亲，却砸中一个乞丐，而乞丐看到绣球的第一眼，便立马捡在手中，死死抱住绣球
例：瞎眼男人在大山支教三年时间，一直以为门下学生都是村里的孩童，却不知课堂上坐着的其实是山中的大妖
例：面对未婚妻的强势退婚，我刚想咆哮少年穷，却又飞快地闭上了嘴，只因我发现自己才是沦为废物的天命主角
例：直到那个扶不起的阿斗统一了三国，诸葛亮才终于确定眼前的刘禅，老子的孔明灯早特么飞到外太空去了

▸ 我每隔 xx 就 / 周期性反差行为类
模板：「我每隔 xxx 就 xxx，xx 的越好，别人 xxx，可他们都不知道，xxx，只因 xxx」
例：我每隔一段时间就从人贩子手里买几个小姑娘回家，越年轻的越好，别人都背地里骂我是猥琐变态男，可他们不知道的是，我这么做就是为了骗补贴，只因我穿越的时候获得了一个系统，系统每天补贴我十块钱

▸ 题材速查（按本集核心反差选钩子）：
- **穿越类**（穿越大唐 / 大明 / 古代 / 三国 / 系统）→ 用上面"穿越具体朝代"家族；立刻"成为某个具体历史人物 + 反差行为 + 目的"
  例：穿越大唐，贞观成为李世民的儿子，每天不是去青楼看花魁就是把李世民气得三天饿九顿
  例：穿到三国后我本想辅佐刘备成就大事，但因思想过于超前被说妖言惑众
- **设定 / 身份反差类**（人称 + 强反差身份）→ 用上面"我是 / 我成了 / 我以"家族
  例：我是史上最长寿的将军，在百岁寿宴当天却等来了九口带血的棺材
  例：我成了秦始皇的私生子，对他说的第一句话就是，爹我们准备造反吧
- **设定 / 戏剧事件类**（无 "我"前置铺垫，直接抛荒诞情节）→ 用上面"强戏剧事件开局"家族
  例：富豪千金抛绣球招亲，却砸中一个乞丐
  例：瞎眼男人在大山支教三年，一直以为门下学生都是村里孩童，却不知课堂上坐着的是山中大妖
- **悬疑 / 校园生存类** → 直接抛尸首 / 异常状况 + 第一人称当事人视角
  例：室友被杀了，尸体就藏在他衣柜里，而我默默地关上了衣柜
  例：我直播的时候被网友发现宿舍天花板漏水，大家纷纷让我找宿管来修，只有一条弹幕说，你们这个宿舍是个棺材房 xxx
- **同人 / 经典 IP 黑化反转类** → 老 IP 名号 + 颠覆原版认知
  例：哪吒死了，死在了封神的前夜
  例：西游之行是一场大阴谋，取经归来的不是得道佛陀，而是祸乱之始的邪魔
- **猎奇 / 离奇事件类** → 强反转因果 + "竟"字递推
  例：我妹为了博人同情，竟将我活活插死
  例：这个坛子里装着清朝的第十三位皇帝，而眼前的宫女为了复活皇帝，竟要吸光我的阳寿
- **人性 / 高考重生类** → 当事人受害 / 翻盘视角 + 数字震撼
  例：高考前夕，我被 18 个高考状元同时魂穿了
  例：高考 720 分，我放弃上大学，我妈没疯，表妹一家却疯了
- **直播 / 当代题材类** → 直播开场 + 异常突发
  例：我开了个直播间算命，上来就匹配到一个大孝子，主播我奶奶什么时候死

**禁开头形式**（一律不许出现）：
- 平铺直叙的环境铺垫（"在一个 xx 的下午"、"夜深了"）
- 流水账时间线
- 人物背景介绍（"我叫 xxx，今年 xx 岁"）
- 倒水分式的世界观长篇铺陈

═════════════════════════════════════════════════════════════
【3. 爽点核心公式（贯穿全文，不只是开头）】
═════════════════════════════════════════════════════════════
- **反差**：设定与现实落差越大越爽（弱 vs 神 / 普通 vs 顶配 / 表面 vs 真实）
- **递进**：「不仅… 而且… 甚至…」一层比一层夸张
- **反转**：「然而 / 不料 / 只因 / 万万没想到 / 殊不知」
- **递推字眼**：却 / 竟 / 不仅 / 而且 / 就连 / 甚至 / 然而 / 反而 / 只因
- **倒叙开局**：先抛震撼结果，再讲来龙去脉
- **数字震撼**：「3 天后」「80% 的人」「一夜之间」「百万 / 亿级」「14 亿人都"
- **隐藏身份**：表面弱 → 实际大佬；表面强 → 一拳被秒
- **被低估翻盘**：所有人嘲讽我 → 我反手碾压
- **天降系统 / 金手指**：穿越 / 重生 / 觉醒 / 系统 / 任务 / 奖励
- **宿命反差**：被预言要死的人 → 反手改命

═════════════════════════════════════════════════════════════
【4. 内容精简原则（关键：精简不等于砍核心）】
═════════════════════════════════════════════════════════════
**精简的目标是去水，不是压缩剧情**。判断一句话该留还是该删的标准：
"把它删掉，剧情还能不能让观众听懂、能不能保持冲击？" — 不能 → 必须留。

**删除**：
- 与主线**无关**的环境铺垫（季节、天气、地点纯描写）
- 角色心理**慢镜头**长句（比如三句话讲"他犹豫了一下"）
- 与冲突 / 爽点无关的客套话、过场对白
- 与主线**无关**的支线 / 配角小动作
- "他想"、"他感觉到"、"他意识到"等慢节奏衔接副词

**必须完整保留**（不许压缩，不许跳过）：
1) **核心剧情节点**：开场设定 → 起因 → 冲突 → 转折 → 高潮 → 结局留扣，**每一个节点都至少 1–2 句旁白**
2) **关键人物登场 / 退场 / 身份揭露**：每一次都要明确点出
3) **关键台词**：用「他说："xxx"」/「我说："xxx"」+ 原文短引语融入旁白
4) **关键道具 / 设定 / 系统提示 / 数值**：金手指、奖励、属性、技能名要保留
5) **空间转换**：场景换了必须有一句旁白点出（"我冲出门"、"等我赶到时"）
6) **情绪爆点 / 反转点 / 反差点**：每个都至少 1 句旁白单独承载
7) **画面感动作**（漫剧关键）：瞳孔放大、脚步顿住、手指攥紧、转身、撞门、举刀、流血等可视化动作

**核心原则**：原剧本里每个能形成一帧漫剧画面的动作，输出旁白都要有对应承接，不能因为追求节奏而跳过画面。

═════════════════════════════════════════════════════════════
【5. 节奏与语言（不限制总字数，由内容决定篇幅）】
═════════════════════════════════════════════════════════════
- **不限制输出总字数**：篇幅完全由"必须保留的核心内容"决定。原文里有多少核心剧情节点 / 关键画面 / 关键台词，输出就有多少对应旁白；不要为了短而砍内容，也不要刻意拉长水文
- **每句单句最多 15 字（硬上限）**；理想区间 6–15 字，按 1.3–1.5 倍语速朗读约 1.5–3 秒/句；超过 15 字立即换行（这是**单句节奏 + 字幕一屏可读**要求，不是总字数要求）
- 关键转折前用「……」或短句制造停顿
- 禁止连续 3 句相同结构；轮换：陈述句 / 反问 / 短句 / 省略 / 递进
- 短视频快节奏阅读习惯：开头猛、中段稳、结尾扣
- 强情绪词（爽 / 高能 / 离谱 / 炸了 / 卧槽）只在转折点出现，不堆叠

═════════════════════════════════════════════════════════════
【6. 漫剧适配（便于后续分镜）】
═════════════════════════════════════════════════════════════
- 每句旁白都要画面感强：能直接想象出一帧画面
- 关键情绪 / 动作要明确（瞳孔放大、脚步顿住、手指攥紧）
- 保留关键台词原文，方便漫剧人物口型对应
- 整体段落紧凑，适配竖屏短视频观看

═════════════════════════════════════════════════════════════
【7. 平台合规】
═════════════════════════════════════════════════════════════
- 无低俗、暴力、血腥、擦边、违规导向内容
- 情绪正向可控（爽点不等于戾气；冲突不等于对立）
- 涉及战斗 / 死亡 / 反派表达克制，画面感聚焦于"动作"而非"伤害细节"

═════════════════════════════════════════════════════════════
【8. 元语言禁令】
═════════════════════════════════════════════════════════════
**严禁**出现：
- "接下来"、"然后我们看到"、"画面切到"、"镜头转向"
- "本集主要讲"、"剧情梗概"、"故事是这样的"
- 任何标签前缀："【高能】"、"#爽点 #反转"、"⚠️"
- Markdown 标题 / 序号 / 人名标签 / 场景标签

═════════════════════════════════════════════════════════════
【9. 结尾留白】
═════════════════════════════════════════════════════════════
- 不要把本集所有结果一次说尽
- 用悬念 / 情绪冲击 / 半句话 / 反问留扣子
- 形式参考：「然而我没想到的是……」/「下一秒，所有人都疯了。」/「这一切，才刚刚开始。」

═════════════════════════════════════════════════════════════
【10. 输出前自检（必须在交付前自我核对）】
═════════════════════════════════════════════════════════════
内部完成草稿后，**逐条**核对下面 8 条；任意一条不达标，自我修订后再输出最终版本：
1. ☐ 全文统一第一人称"我"，没有切到第三人称解说？
2. ☐ 开头第 1 句是上述爆款公式之一的钩子（反转 / 都知道 / 全国 / 第一次 / 为了证明 / 这是xx世界 / 起床 / 重生穿越 / 意外发现 / 还没死 / 一出生 / 那天那年 / 传说 / 穿越具体朝代 / 我是我成了我以身份 / 强戏剧事件开局 / 我每隔xx就周期反差），不是平铺直叙？
3. ☐ 钩子选择匹配本集题材（穿越 / 设定身份反差 / 设定戏剧事件 / 悬疑 / 同人 / 猎奇 / 人性 / 直播 / 公式开头 / 其它）？
4. ☐ 原剧本里每一个**核心剧情节点**（设定 / 起因 / 冲突 / 转折 / 高潮 / 结局留扣）都有旁白覆盖，没有跳节？
5. ☐ 原剧本里每个**关键画面动作 / 关键台词 / 关键道具 / 空间转换**都有对应旁白，没有为了短节奏而跳过画面？
6. ☐ **每行单句长度 ≤ 15 字（硬上限）**，理想区间 6–15 字；超过 15 字的行已全部换行拆短？节奏紧凑（**不在乎总字数**——内容齐全优先于篇幅）？
7. ☐ **字幕标点强约束（最高优先级）**：全文除中文逗号「，」外**没有任何其它标点**？特别检查是否有句号 / 问号 / 感叹号 / 引号 / 冒号 / 分号 / 顿号 / 省略号 / 破折号 / 括号 / 书名号 / 任何英文标点？
8. ☐ **一句一行**：原本会用句号 / 问号 / 感叹号 / 长破折号停顿的位置，全部用换行替代？没有出现"全堆在一句、靠逗号串到底"的长行？

═════════════════════════════════════════════════════════════
【输出格式】
═════════════════════════════════════════════════════════════
直接输出连续旁白文本，每句一行（用换行 \\n 分隔）。
全文**只允许**中文逗号「，」一种标点，其它标点（句号 / 问号 / 感叹号 / 引号 / 冒号 / 分号 / 顿号 / 省略号 / 破折号 / 括号 / 书名号 / 任何英文标点）一律不允许；原本会用这些标点的位置一律改成换行。
不要 Markdown 标题、序号、人名标签、场景标签；不要代码块；不要解释；不要列大纲；不要任何前缀 / 后缀。
开头第 1 句**必须**是爆款公式之一的钩子。
`,
    variables: [variable('script')],
    isCustom: false,
  },

  tweet_shot_breakdown: {
    id: 'tweet_shot_breakdown',
    category: 'tweet',
    name: '推文文案分镜化（漫剧第一人称）',
    description: '把整集推文旁白按分镜切分，输出每个分镜对应的 1-3 句解说台词；保持第一人称"我"，与上游推文文案一致。',
    template: `你是一名漫剧短视频的剪辑助理。下面给你一段已经写好的【整集第一人称推文旁白】和【这一集的分镜清单】。请把旁白按时间顺序切分到每个分镜，每个分镜得到 1–3 句最贴合该分镜画面与情绪的解说台词。

【整集推文旁白】
{{tweetScript}}

【分镜清单】
{{shotsList}}

【硬性要求】
1. **人称强制第一人称"我"**：与上游推文文案一致，**禁止切换第三人称**；配角通过"他 / 她 + 极短台词"融入旁白。
2. 严格按分镜顺序输出，分镜数量必须与输入清单一致，不许遗漏、不许并合、不许多输出。
3. 每个分镜分配 1–3 句旁白；**每句最多 15 字（硬上限）**，理想 6–15 字、口语化、有画面感。
4. **切分依据**：以分镜的 \`scriptContent\` 表达的核心动作 / 情绪 / 转折为锚，把旁白里和这一镜最贴合的句子分给它。允许对原旁白做轻微改写（同义改写、断句、合并），但**不得引入旁白原文里没有的剧情、人物、动作、台词**。
5. **节奏匹配时长**：分镜时长（duration 秒）越短，分配的句数越少；6 秒分镜原则上 1 句，10 秒分镜 1–2 句，15 秒及以上分镜 2–3 句。按每秒约 4–5 字、语速 1.3–1.5 倍折算总字数上限。
6. **首镜钩子**：第一个分镜的旁白必须**完整承接整集开场爆款公式钩子**（如"我一个 xxx，却被 xxx，只因…"），开门见山把观众拉住；不要把钩子拆散到第二镜。
7. **末镜留扣**：最后一个分镜的旁白保留悬念 / 情绪冲击 / 半句话 / 反问扣子，**不把结果说尽**。
8. **递进 / 反差字眼贯穿**：在适当分镜间使用「却 / 竟 / 不仅 / 而且 / 就连 / 甚至 / 然而 / 反而 / 只因 / 殊不知」做衔接，保持爽点连贯。
9. **元语言禁令**：禁用"接下来 / 画面切到 / 我们看到 / 镜头转向"等解说性词；旁白要像"我"在讲述自己经历。
10. 不要在输出里复述剧本原文或分镜清单；只输出每个分镜对应的旁白文本。
11. **字幕标点强约束（最高优先级，违反即不合格）**：
    - \`tweetCopy\` 文本里**只允许**中文逗号「，」一种标点；**严禁**出现句号 / 问号 / 感叹号 / 引号 / 冒号 / 分号 / 顿号 / 省略号 / 破折号 / 括号 / 书名号 / 任何英文标点
    - 一个分镜里有多句旁白时，用换行符 \`\\n\` 分隔（**不要**用空格连接），**每行最多 15 字（硬上限）**
    - 人物台词不加引号，直接换行写台词正文；如需指明谁说，用「他说」「我说」开头另起一行

【输出格式】
严格按下面的 JSON 数组格式输出，可包裹在 \`\`\`json 代码块中；除 JSON 本体外不输出任何解释、备注、前缀。

\`\`\`json
[
  { "shotIndex": 1, "tweetCopy": "我一个重度精神病\\n却被全国人奉为神明" },
  { "shotIndex": 2, "tweetCopy": "他们听我说自己是派大星\\n竟也深信不疑\\n只因" }
]
\`\`\`

字段定义：
- \`shotIndex\`：分镜清单里的编号（从 1 开始），与输入顺序严格对应
- \`tweetCopy\`：分给该分镜的旁白文本（第一人称"我"）；多句之间用换行符 \`\\n\` 分隔（一句一行），全文除中文逗号「，」外不允许任何其它标点
`,
    variables: [variable('tweetScript'), variable('shotsList')],
    isCustom: false,
  },

  // ========== TTI 图片生成模板 ==========

  tti_character_costume: {
    id: 'tti_character_costume',
    category: 'tti',
    name: '角色定妆照（三视图）',
    description: '生成角色三视图定妆照',
    // 把人物 demographic + appearance 前置，让 TTI 模型先锁定主体身份与可见特征，
    // 再施加技术约束（三视图布局、纯色背景、配光、跨视图一致性）。
    template: '{{stylePrefix}}, character turnaround sheet of a {{demographic}}, {{appearance}}, full body standing reference, neutral A-pose, three poses in one image: front view | three-quarter side view | back view, identical character identity / face / hair / skin / clothing / accessories repeated across all three views, plain pure white seamless background, soft even studio lighting, no cast shadows on background, clear silhouette, all clothing layers visible, objective visible appearance only, no props, no environment, no narrative, no text, no extra characters, art style lock: match the project art style exactly (color palette, lighting, brush/line work, textures, atmosphere, rendering technique); do NOT drift toward photorealism / live-action / a different aesthetic; if a style anchor reference image is provided as references[0], inherit ONLY its art style and never copy its content',
    variables: [
      variable('stylePrefix'),
      variable('demographic', {
        description: '角色 gender + age 合成的英文人物短语，例如 "young adult male, 28 years old"；buildCharacterCostumeTemplateVariables 自动生成。',
      }),
      variable('appearance', {
        description: '角色当前用于生图的客观外观描述（脸/发/体态/服装/配饰/可见痕迹），只允许画面可见信息。',
      }),
      variable('gender', {
        description: '兼容字段：原 gender 短语，已被 demographic 取代；保留给历史自定义模板。',
        required: false,
      }),
      variable('age', {
        description: '兼容字段：原 age 短语，已被 demographic 取代；保留给历史自定义模板。',
        required: false,
      }),
    ],
    isCustom: false,
  },

  tti_scene_preview: {
    id: 'tti_scene_preview',
    category: 'tti',
    name: '场景预览图',
    description: '生成场景参考图：强透视全貌取景；室内必须显式露出至少两面墙 + 地面 + 天花板，让下游视频模型不需要凭空想象未拍到的空间。',
    // 设计目标：把场景图当作"空间锚定"参考图给后续 ITV 视频模型用。
    // - 透视技法（perspective drawing technique）需要被显式声明，避免出现没有纵深、像贴图一样的平面图。
    // - 室内必须给出全貌：corner vantage / two-point perspective + wide-angle 让两面墙 + 地面 + 天花板都进画面，
    //   连同所有门 / 窗 / 通道；任何被裁切的墙都会让视频模型在生视频时自由发挥，造成空间漂移。
    // - 外景给出 full establishing shot + 强透视线，建立纵深和清晰的可视边界。
    template: '{{stylePrefix}}, environment concept art reference plate, no people, no character, no character action, full establishing shot, wide-angle lens, strong perspective drawing technique with clearly visible perspective lines (orthogonal lines / vanishing points), complete spatial layout fully revealed in frame, objective environmental details only, {{description}}, location: {{location}}, visible time cues: {{time}}, visible atmosphere cues: {{mood}}, for INTERIOR locations: corner vantage using two-point perspective from a slightly raised eye-level, at least two full adjacent walls visible together with the floor and the ceiling, all major openings (doors, windows, archways, corridors) included in frame, room footprint fully readable, no cropped walls, no missing ceiling, no missing floor; for EXTERIOR locations: wide establishing view with one-point or two-point perspective revealing the full ground plane, key façades and the surrounding spatial extent; sharp depth cues (foreground / midground / background), architectural and material details, accurate proportions, no off-screen guesswork, cinematic composition, 4k high detail, art style lock: match the project art style exactly (color palette, lighting, brush/line work, textures, atmosphere, rendering technique); do NOT drift toward photorealism / live-action / a different aesthetic; if a style anchor reference image is provided as references[0], inherit ONLY its art style and never copy its content',
    variables: [
      variable('stylePrefix'),
      variable('description', {
        description: '场景中的客观环境细节，只描述空间、建筑、地面、植被、天气痕迹、陈设等可见内容；室内必须含可见的墙面 / 地面 / 天花板与门窗位置，以便下游视频模型不需要凭空想象不可见区域。禁止出现人物、角色名、人物动作和对白。',
      }),
      variable('location'),
      variable('time', {
        description: '用于表现时间状态的可见线索，如 night、twilight、overcast daylight。',
      }),
      variable('mood', {
        description: '场景氛围的可见线索，只能写光线、色调、湿度、雾气、空气状态等物理表现。',
      }),
    ],
    isCustom: false,
  },

  tti_prop_reference: {
    id: 'tti_prop_reference',
    category: 'tti',
    name: '道具参考图',
    description: '生成道具参考图',
    template: '{{stylePrefix}}, prop design sheet, no people, no hands, no character action, centered composition, plain background, studio lighting, objective product view only, {{type}}, {{description}}, clear material edges, surface texture details, clean presentation, art style lock: match the project art style exactly (color palette, lighting, brush/line work, textures, atmosphere, rendering technique); do NOT drift toward photorealism / live-action / a different aesthetic; if a style anchor reference image is provided as references[0], inherit ONLY its art style and never copy its content',
    variables: [
      variable('stylePrefix'),
      variable('description', {
        description: '道具的客观外观描述，只描述形状、结构、材质、磨损、颜色和表面细节，禁止出现人物、角色名和人物动作。',
      }),
      variable('type'),
    ],
    isCustom: false,
  },

  tti_shot_image: {
    id: 'tti_shot_image',
    category: 'tti',
    name: '分镜图片',
    description: '生成分镜预览图',
    template: '{{stylePrefix}}, storyboard still frame and video anchor frame, {{shotType}}, objective visible image only, use the structured description exactly: {{description}}, visible emotion cues: {{emotion}}, clear foreground / midground / background layering, readable character silhouettes and hand poses, stable spatial continuity for later video generation, cinematic lighting with explicit light direction and shadow shape, detailed environment, high quality, 4k, do not render ordinary dialogue as text unless the description explicitly asks for subtitle / system bubble / screen text, art style lock: render in the SAME art style as the project character / scene / prop reference images already established (color palette, lighting, brush/line work, textures, atmosphere, rendering technique); do NOT drift toward photorealism / live-action / a different aesthetic, do NOT change the established art style of any character, scene or prop visible in the shot',
    variables: [
      variable('stylePrefix'),
      variable('description', {
        description: '当前镜头的客观可见事实，应包含人物外观、姿态、动作瞬间、空间关系、道具状态与环境细节。',
      }),
      variable('shotType', {
        label: '镜头景别',
        description: '当前静帧使用的景别或机位短语。',
        format: '短语',
        example: 'medium close-up, eye-level',
      }),
      variable('emotion', {
        description: '情绪的可见线索，应转化为表情、肢体张力、光照或色调特征。',
      }),
    ],
    isCustom: false,
  },

  tti_grid_shot_image: {
    id: 'tti_grid_shot_image',
    category: 'tti',
    name: '九宫格分镜图片',
    description: '生成 3×3 九宫格网格分镜图',
    template: `{{stylePrefix}}, 根据{{shotDescription}}, 生成一张具有凝聚力的 3×3 连续动作网格图像, 9 个格子是同一环境、同一人物、同一道具状态沿时间推进的分镜锚点，不是 9 个无关画面；每格都要有清楚的前景 / 中景 / 背景层次、可读的角色轮廓、手部姿态和光影方向；严格保持人物/物体、服装、空间结构和光线的一致性, 每个网格画面的比例保持为{{aspectRatio}}, {{resolution}}分辨率, {{aspectRatio}}画幅。

{{gridPrompt}}`,
    variables: [
      variable('stylePrefix'),
      variable('shotDescription'),
      variable('gridPrompt'),
      variable('resolution'),
      variable('aspectRatio'),
    ],
    isCustom: false,
  },

  tti_grid_4_shot_image: {
    id: 'tti_grid_4_shot_image',
    category: 'tti',
    name: '四宫格分镜图片',
    description: '生成 2×2 四宫格网格分镜图（更适合稳定镜头与少切换叙事）',
    template: `{{stylePrefix}}, 根据{{shotDescription}}, 生成一张具有凝聚力的 2×2 连续动作网格图像, 4 个格子是同一环境、同一人物、同一道具状态的起手 / 节奏切点 / 动作主峰 / 收束锚点；每格都要有清楚的前景 / 中景 / 背景层次、可读的角色轮廓、手部姿态和光影方向；严格保持人物/物体、服装、空间结构和光线的一致性, 每个网格画面的比例保持为{{aspectRatio}}, {{resolution}}分辨率, {{aspectRatio}}画幅。

{{gridPrompt}}`,
    variables: [
      variable('stylePrefix'),
      variable('shotDescription'),
      variable('gridPrompt'),
      variable('resolution'),
      variable('aspectRatio'),
    ],
    isCustom: false,
  },

  tti_storyboard_shot_image: {
    id: 'tti_storyboard_shot_image',
    category: 'tti',
    name: '故事板分镜图片',
    description: '生成带制作笔记的电影级故事板 / 前期制作方案板图片',
    template: `{{globalPositivePrefix}}
{{stylePrefix}}, highly detailed cinematic storyboard infographic poster, professional film pre-production design board, clear grid-based layout without mechanical equal panels, deep blue title bar or equivalent premium header system, modern UI visual design, information-dense but clean editorial layout, Behance style premium layout, ArtStation style production design quality, clear section hierarchy, thin borders, high-end commercial visual design, ultra detailed, 8K texture, cinematic lighting and emotional progression, consistent characters / scene / props across panels, {{aspectRatio}} composition, {{resolution}} quality.

Required board sections: project title header with project name, subtitle, format, genre, duration, constraints; character design zone with front/back/side/close-up/action pose studies when characters are present; scene design zone with cinematic concept art and rich spatial detail; top-down blocking diagram / floor plan with camera positions numbered 1-N and arrows for character movement and camera motion; storyboard story zone with a story-driven N-shot sequence; lighting and style zone; emotion keywords zone; sound design zone; cinematography notes zone; unified color palette zone.

Each storyboard panel must include: scene image, very short production note or action/dialogue beat, shot size label such as wide / medium / close-up, focal length label such as 24mm / 35mm / 50mm / 85mm, camera movement label such as static / tracking / handheld / push-in / crane / lateral move. The number of panels must follow the narrative rhythm, not a fixed count. These labels are production notes, not subtitles.

Storyboard brief:
{{storyboardPrompt}}

Strict rendering rule: render short production-board notes, numbered camera marks, arrows, color swatches, lighting notes, sound notes, and shot labels as part of the storyboard sheet; these notes are not dialogue subtitles. Do not turn ordinary dialogue into subtitles or speech bubbles unless the brief explicitly asks for screen text / UI text / signage. Avoid long text walls, random unreadable filler, logos, and watermarks. Maintain project style exactly and preserve reference-image identity when references are provided.
{{globalPositiveSuffix}}`,
    variables: [
      variable('globalPositivePrefix', { required: false }),
      variable('globalPositiveSuffix', { required: false }),
      variable('stylePrefix'),
      variable('storyboardPrompt'),
      variable('resolution'),
      variable('aspectRatio'),
    ],
    isCustom: false,
  },

  // ========== ITV 视频生成模板 ==========

  itv_shot_video: {
    id: 'itv_shot_video',
    category: 'itv',
    name: '分镜视频',
    description: '生成分镜动态视频',
    template: '{{stylePrefix}}, objective motion picture prompt, {{description}}, shot scale: {{shotType}}, camera movement: {{cameraMovement}}, total duration {{durationSeconds}} seconds, {{motionTimeline}}, cinematic continuity, high quality video',
    variables: [
      variable('stylePrefix'),
      variable('description', {
        description: '视频镜头中的主体、环境和动作基础状态，只包含当前镜头可见事实。',
      }),
      variable('shotType', {
        label: '镜头景别',
        description: '视频镜头使用的景别短语。',
        format: '短语',
        example: 'wide shot',
      }),
      variable('cameraMovement'),
      variable('durationSeconds'),
      variable('motionTimeline'),
    ],
    isCustom: false,
  },

  itv_character_motion: {
    id: 'itv_character_motion',
    category: 'itv',
    name: '角色动态视频',
    description: '生成角色动态展示视频',
    template: '{{characterName}} {{action}}, {{stylePrefix}}, smooth animation, character showcase, professional quality',
    variables: [variable('characterName'), variable('action'), variable('stylePrefix')],
    isCustom: false,
  },

  itv_prop_motion: {
    id: 'itv_prop_motion',
    category: 'itv',
    name: '道具动态视频',
    description: '生成道具动态展示视频',
    template: '{{stylePrefix}}, {{description}}, {{motion}}, professional product animation, smooth camera movement, high quality video',
    variables: [variable('stylePrefix'), variable('description'), variable('motion')],
    isCustom: false,
  },
};

// ========== 存储路径 ==========

async function getTemplatesPath(): Promise<string> {
  const config = getStorageConfig() || (await initStorageConfig());
  return `${config.rootPath}/prompt-templates.json`;
}

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function extractTemplateVariables(templateText: string): string[] {
  const matches = Array.from(templateText.matchAll(PLACEHOLDER_REGEX), match => match[1]);
  return Array.from(new Set(matches)).sort();
}

function buildValidationResult(
  type: string,
  templateText: string
): PromptTemplateValidationResult {
  // 默认模板：按其声明的 variables 校验
  // 自定义模板（type 不在 DEFAULT_TEMPLATES 中）：不做严格白名单校验，视为合法
  const defaultTemplate = (DEFAULT_TEMPLATES as Record<string, PromptTemplate>)[type];
  if (!defaultTemplate) {
    return { isValid: true, unknownVariables: [], missingRequiredVariables: [] };
  }
  const allowedVariables = getVariableNames(defaultTemplate.variables);
  const requiredVariables = getRequiredVariableNames(defaultTemplate.variables);
  const usedVariables = extractTemplateVariables(templateText);
  // 内建全局注入变量（globalPositivePrefix 等）允许在任何模板中直接使用，
  // 不要求模板自身在 variables 列表声明
  const unknownVariables = usedVariables.filter(
    variable => !allowedVariables.includes(variable) && !INTRINSIC_GLOBAL_VARIABLE_NAMES.has(variable)
  );
  const missingRequiredVariables = requiredVariables.filter(variable => !usedVariables.includes(variable));

  return {
    isValid: unknownVariables.length === 0 && missingRequiredVariables.length === 0,
    unknownVariables,
    missingRequiredVariables,
  };
}

function normalizePromptTemplateOverride(value: unknown): PromptTemplateOverride | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { template?: unknown; updatedAt?: unknown };
  if (typeof candidate.template !== 'string') {
    return undefined;
  }

  return {
    template: candidate.template,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
  };
}

function normalizeLegacyPromptTemplates(
  data: unknown
): Partial<Record<PromptTemplateType, PromptTemplateOverride>> {
  const normalized: Partial<Record<PromptTemplateType, PromptTemplateOverride>> = {};
  if (!data || typeof data !== 'object') {
    return normalized;
  }

  for (const [key, value] of Object.entries(data)) {
    if (!(key in DEFAULT_TEMPLATES)) {
      continue;
    }
    const normalizedValue = normalizePromptTemplateOverride(value);
    if (normalizedValue) {
      normalized[key as PromptTemplateType] = normalizedValue;
    }
  }

  return normalized;
}

function mergePromptTemplateOverrides(
  current: Partial<Record<PromptTemplateType, PromptTemplateOverride>>,
  incoming: Partial<Record<PromptTemplateType, PromptTemplateOverride>>
): Partial<Record<PromptTemplateType, PromptTemplateOverride>> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!value) {
      continue;
    }
    if (!merged[key as PromptTemplateType]) {
      merged[key as PromptTemplateType] = value;
    }
  }
  return merged;
}

async function persistPromptTemplateOverrides(
  settings: AppSettings,
  overrides: Partial<Record<PromptTemplateType, PromptTemplateOverride>>
): Promise<void> {
  await saveSettings({
    ...settings,
    promptTemplates: overrides,
  });
}

async function migrateLegacyPromptTemplates(
  settings?: AppSettings
): Promise<AppSettings> {
  const currentSettings = settings || await loadSettings();
  let overrides = normalizeLegacyPromptTemplates(currentSettings.promptTemplates);
  let shouldPersist = Object.keys(overrides).length !== Object.keys(currentSettings.promptTemplates || {}).length;

  if (!electronService.isElectron()) {
    try {
      const legacyData = localStorage.getItem(STORAGE_KEYS.PROMPT_TEMPLATES);
      if (legacyData) {
        const legacyOverrides = normalizeLegacyPromptTemplates(JSON.parse(legacyData));
        const mergedOverrides = mergePromptTemplateOverrides(overrides, legacyOverrides);
        if (JSON.stringify(mergedOverrides) !== JSON.stringify(overrides)) {
          overrides = mergedOverrides;
          shouldPersist = true;
        }
        localStorage.removeItem(STORAGE_KEYS.PROMPT_TEMPLATES);
      }
    } catch {
      // ignore
    }

    if (shouldPersist) {
      await persistPromptTemplateOverrides(currentSettings, overrides);
      return { ...currentSettings, promptTemplates: overrides };
    }

    return { ...currentSettings, promptTemplates: overrides };
  }

  try {
    const path = await getTemplatesPath();
    const exists = await electronService.fs.exists(path);
    if (exists) {
      const data = await electronService.fs.readFile(path);
      const legacyOverrides = normalizeLegacyPromptTemplates(JSON.parse(data));
      const mergedOverrides = mergePromptTemplateOverrides(overrides, legacyOverrides);
      if (JSON.stringify(mergedOverrides) !== JSON.stringify(overrides)) {
        overrides = mergedOverrides;
        shouldPersist = true;
      }

      if (shouldPersist) {
        await persistPromptTemplateOverrides(currentSettings, overrides);
      }

      await electronService.fs.remove(path);
      return { ...currentSettings, promptTemplates: overrides };
    }
  } catch {
    // ignore
  }

  if (shouldPersist) {
    await persistPromptTemplateOverrides(currentSettings, overrides);
  }

  return { ...currentSettings, promptTemplates: overrides };
}

async function loadPromptTemplateOverrides(): Promise<Partial<Record<PromptTemplateType, PromptTemplateOverride>>> {
  const settings = await migrateLegacyPromptTemplates();
  return normalizeLegacyPromptTemplates(settings.promptTemplates);
}

function assertTemplateValidation(
  type: PromptTemplateType,
  templateText: string
): void {
  const validation = buildValidationResult(type, templateText);
  if (!validation.isValid) {
    const errors: string[] = [];
    if (validation.unknownVariables.length > 0) {
      errors.push(`未知变量: ${validation.unknownVariables.join(', ')}`);
    }
    if (validation.missingRequiredVariables.length > 0) {
      errors.push(`缺失必需变量: ${validation.missingRequiredVariables.join(', ')}`);
    }
    throw new Error(errors.join('；'));
  }
}

// ========== 模板管理函数 ==========

/**
 * 加载所有模板（默认 + override 覆盖 + 用户新增的 custom 自定义）
 *
 * 三层优先级（覆盖顺序，后者覆盖前者）：
 *   1. DEFAULT_TEMPLATES               内置默认模板
 *   2. settings.promptTemplates        默认模板的 override（同 id 改写 template 字段）
 *   3. settings.customPromptTemplates  用户手动新建的全新模板（id 不在 union 中）
 *
 * 返回的 Record 键类型放宽为 string，以容纳 custom 模板的任意 id。
 */
export async function loadPromptTemplates(): Promise<Record<string, PromptTemplate>> {
  const templates: Record<string, PromptTemplate> = { ...DEFAULT_TEMPLATES };

  // override 层：仅修改默认模板的 template 内容，类型仍是 PromptTemplateType
  const overrides = await loadPromptTemplateOverrides();
  for (const [key, value] of Object.entries(overrides)) {
    if (!value) continue;
    const templateKey = key as PromptTemplateType;
    if (!templates[templateKey]) continue; // 旧 override 引用了已删除的默认模板，跳过
    templates[templateKey] = {
      ...templates[templateKey],
      template: value.template,
      isCustom: true,
    };
  }

  // custom 层：用户新增的全新模板
  const customs = await loadCustomPromptTemplates();
  for (const cp of customs) {
    if (templates[cp.id]) {
      // 防御：custom id 与默认 id 冲突时不覆盖默认模板
      console.warn(`[PromptTemplate] 自定义模板 id "${cp.id}" 与默认模板冲突，已忽略 custom`);
      continue;
    }
    templates[cp.id] = {
      id: cp.id as PromptTemplateType, // 实际上是 custom id，类型上借用 union（不影响运行）
      name: cp.name,
      category: cp.category as PromptTemplateCategory,
      description: cp.description,
      template: cp.template,
      variables: (cp.variables || []).map(v => ({
        name: v.name,
        ...(COMMON_VARIABLE_DEFINITIONS[v.name] || {
          label: v.name,
          description: `${v.name} 变量`,
          format: '字符串',
          required: v.required ?? true,
        }),
        required: v.required ?? true,
      })),
      isCustom: true,
    };
  }

  return templates;
}

/**
 * 获取单个模板（支持默认模板 + 自定义模板的任意 id）
 */
export async function getPromptTemplate(type: string): Promise<PromptTemplate> {
  const templates = await loadPromptTemplates();
  return templates[type];
}

/**
 * 保存"覆盖默认模板"的内容（仅改写 template 字段，类型仍是默认 union）
 */
export async function saveCustomTemplate(template: PromptTemplate): Promise<void> {
  assertTemplateValidation(template.id, template.template);
  const settings = await migrateLegacyPromptTemplates();
  const overrides = normalizeLegacyPromptTemplates(settings.promptTemplates);
  overrides[template.id] = {
    template: template.template,
    updatedAt: Date.now(),
  };
  await persistPromptTemplateOverrides(settings, overrides);
}

// ========== 用户自定义新模板（全新 id，不属于 union） ==========

export interface CreateCustomTemplateInput {
  id: string;                  // 全新 id；不能与默认模板 / 已有 custom id 冲突
  name: string;
  category: PromptTemplateCategory;
  description: string;
  template: string;
  variables?: Array<{ name: string; required?: boolean }>;
}

const CUSTOM_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** 加载所有用户自定义新模板 */
export async function loadCustomPromptTemplates(): Promise<NonNullable<AppSettings['customPromptTemplates']>> {
  const settings = await loadSettings();
  return Array.isArray(settings.customPromptTemplates) ? settings.customPromptTemplates : [];
}

/** 新建用户自定义模板 */
export async function createCustomPromptTemplate(input: CreateCustomTemplateInput): Promise<void> {
  if (!CUSTOM_ID_PATTERN.test(input.id)) {
    throw new Error('自定义模板 id 必须是 3-64 位的小写字母 / 数字 / 下划线，且以字母开头');
  }
  if ((Object.keys(DEFAULT_TEMPLATES) as string[]).includes(input.id)) {
    throw new Error(`id "${input.id}" 与内置模板冲突，请换一个`);
  }
  const settings = await loadSettings();
  const list = Array.isArray(settings.customPromptTemplates) ? [...settings.customPromptTemplates] : [];
  if (list.some(t => t.id === input.id)) {
    throw new Error(`id "${input.id}" 已存在`);
  }
  const now = Date.now();
  list.push({
    id: input.id,
    name: input.name,
    category: input.category,
    description: input.description,
    template: input.template,
    variables: input.variables,
    createdAt: now,
    updatedAt: now,
  });
  await saveSettings({ ...settings, customPromptTemplates: list });
}

/** 更新用户自定义模板（按 id 全量替换字段，不存在则报错） */
export async function updateCustomPromptTemplate(
  id: string,
  patch: Partial<Omit<CreateCustomTemplateInput, 'id'>>,
): Promise<void> {
  const settings = await loadSettings();
  const list = Array.isArray(settings.customPromptTemplates) ? [...settings.customPromptTemplates] : [];
  const idx = list.findIndex(t => t.id === id);
  if (idx < 0) throw new Error(`自定义模板 "${id}" 不存在`);
  list[idx] = {
    ...list[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  await saveSettings({ ...settings, customPromptTemplates: list });
}

/** 删除用户自定义模板 */
export async function deleteCustomPromptTemplate(id: string): Promise<void> {
  const settings = await loadSettings();
  const list = Array.isArray(settings.customPromptTemplates) ? settings.customPromptTemplates : [];
  const next = list.filter(t => t.id !== id);
  await saveSettings({ ...settings, customPromptTemplates: next });
}

/**
 * 重置模板为默认
 */
export async function resetTemplate(type: PromptTemplateType): Promise<PromptTemplate> {
  const settings = await migrateLegacyPromptTemplates();
  const overrides = normalizeLegacyPromptTemplates(settings.promptTemplates);
  delete overrides[type];
  await persistPromptTemplateOverrides(settings, overrides);
  return DEFAULT_TEMPLATES[type];
}

/**
 * 重置所有模板为默认
 */
export async function resetAllTemplates(): Promise<void> {
  const settings = await migrateLegacyPromptTemplates();
  await persistPromptTemplateOverrides(settings, {});
}

/**
 * 获取默认模板
 */
export function getDefaultTemplate(type: PromptTemplateType): PromptTemplate {
  return DEFAULT_TEMPLATES[type];
}

/**
 * 获取所有默认模板
 */
export function getAllDefaultTemplates(): Record<PromptTemplateType, PromptTemplate> {
  return { ...DEFAULT_TEMPLATES };
}

/**
 * 默认模板 ID 集合（用于 UI 区分"用户自定义新建"与"用户改写默认"）
 */
export function getDefaultTemplateIds(): readonly string[] {
  return Object.keys(DEFAULT_TEMPLATES);
}

/** 判断给定 id 是否为默认模板 */
export function isDefaultTemplateId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULT_TEMPLATES, id);
}

export function validatePromptTemplateDraft(
  type: PromptTemplateType,
  templateText: string
): PromptTemplateValidationResult {
  return buildValidationResult(type, templateText);
}

/**
 * 填充模板变量
 */
export function fillTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'g'), value);
  }
  return result;
}

/**
 * 收集需要自动注入到当前模板的全局约束变量。
 *
 * 仅当目标模板里实际出现 {{globalXxx}} 占位符时才会拉取对应 global_* 模板内容，
 * 避免对不需要全局约束的模板（例如纯系统提示）造成无谓负担。
 *
 * 调用方传入的同名变量会覆盖自动注入的内容（手动优先）。
 */
async function collectGlobalInjections(
  template: PromptTemplate,
  callerVariables: Record<string, string>,
  templates: Record<PromptTemplateType, PromptTemplate>
): Promise<Record<string, string>> {
  if (GLOBAL_TEMPLATE_TYPES.has(template.id)) {
    return {};
  }
  const injections: Record<string, string> = {};
  const placeholders = new Set(extractTemplateVariables(template.template));
  for (const [varName, sourceType] of Object.entries(GLOBAL_INJECTION_MAP)) {
    if (Object.prototype.hasOwnProperty.call(callerVariables, varName)) {
      // 调用方显式传值时尊重调用方
      continue;
    }
    if (!placeholders.has(varName)) {
      continue;
    }
    const sourceTemplate = templates[sourceType];
    if (sourceTemplate) {
      injections[varName] = sourceTemplate.template.trim();
    }
  }
  return injections;
}

// 让函数能接受 PromptTemplateType 字面量（默认模板）和任意 string（自定义模板）id，
// 同时保留对 PromptTemplateType 字面量的类型受检（避免拼错默认模板名）。
export type PromptTemplateId = PromptTemplateType | (string & {});

export async function resolvePromptTemplate(
  type: PromptTemplateId,
  variables: Record<string, string>
): Promise<ResolvedPromptTemplate> {
  const allTemplates = await loadPromptTemplates();
  const template = allTemplates[type];
  if (!template) {
    throw new Error(`提示词模板 "${type}" 不存在（既非默认模板，也未在自定义模板中定义）`);
  }
  const variableNames = getVariableNames(template.variables);
  const requiredVariableNames = getRequiredVariableNames(template.variables);

  // 自动注入全局约束（仅在模板包含对应占位符时生效）
  const globalInjections = await collectGlobalInjections(template, variables, allTemplates);
  const mergedVariables = { ...globalInjections, ...variables };

  // 运行时仅警告模板校验问题，不阻断执行
  const validation = buildValidationResult(type, template.template);
  if (!validation.isValid) {
    const warnings: string[] = [];
    if (validation.unknownVariables.length > 0) {
      warnings.push(`模板中存在未声明变量: ${validation.unknownVariables.join(', ')}`);
    }
    if (validation.missingRequiredVariables.length > 0) {
      warnings.push(`模板中缺少变量占位符: ${validation.missingRequiredVariables.join(', ')}`);
    }
    console.warn(`[PromptTemplate] 模板 ${type} 校验警告: ${warnings.join('；')}`);
  }

  // 过滤掉模板未声明的多余变量（内建全局变量除外）；仅警告，不阻断
  const unknownVariables = Object.keys(mergedVariables).filter(
    variable => !variableNames.includes(variable) && !INTRINSIC_GLOBAL_VARIABLE_NAMES.has(variable)
  );
  if (unknownVariables.length > 0) {
    console.warn(`[PromptTemplate] 模板 ${type} 收到未声明变量（已忽略）: ${unknownVariables.join(', ')}`);
  }
  const filteredVariables = Object.fromEntries(
    Object.entries(mergedVariables).filter(
      ([key]) => variableNames.includes(key) || INTRINSIC_GLOBAL_VARIABLE_NAMES.has(key)
    )
  );

  const missingVariables = requiredVariableNames.filter((variable) => {
    if (!Object.prototype.hasOwnProperty.call(filteredVariables, variable)) {
      return true;
    }
    return typeof filteredVariables[variable] !== 'string';
  });
  if (missingVariables.length > 0) {
    throw new Error(`模板 ${type} 缺少运行时变量: ${missingVariables.join(', ')}`);
  }

  const prompt = fillTemplate(template.template, filteredVariables);
  const unresolvedVariables = extractTemplateVariables(prompt);
  let finalPrompt = prompt;
  if (unresolvedVariables.length > 0) {
    console.warn(`[PromptTemplate] 模板 ${type} 仍有未替换变量（已清除）: ${unresolvedVariables.join(', ')}`);
    // 清除未替换的 {{ variable }} 占位符，避免阻断生成流程
    finalPrompt = prompt.replace(/\{\{\s*\w+\s*\}\}/g, '');
  }

  return {
    template,
    prompt: finalPrompt,
    source: template.isCustom ? 'custom' : 'default',
  };
}

export default {
  loadPromptTemplates,
  getPromptTemplate,
  saveCustomTemplate,
  resetTemplate,
  resetAllTemplates,
  getDefaultTemplate,
  getAllDefaultTemplates,
  validatePromptTemplateDraft,
  fillTemplate,
  resolvePromptTemplate,
};
