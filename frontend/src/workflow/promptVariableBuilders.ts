import type { Character, Prop, Scene, Shot } from '../types';
import { getShotScriptText } from '../types';
import { DEFAULT_VIDEO_DURATION_SECONDS } from '../utils/videoDuration';

// shot.duration 在创建 / 编辑 / AI 生成时已按当前 ITV 渠道 spec 吸附（见 Storyboard / ShotAnalysisService）。
// 这一层只做最低限度的数值兜底，不再吸附到 grok 枚举（之前用 normalizeVideoDurationSeconds 会把 seedance 的 5 推回 6）。
function coerceShotDurationSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.round(parsed));
  }
  return DEFAULT_VIDEO_DURATION_SECONDS;
}

function cleanText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

function joinClauses(parts: Array<string | undefined>): string {
  return parts.map(cleanText).filter(Boolean).join(', ');
}

function splitVisualClauses(value?: string): string[] {
  return (value || '')
    .split(/[，,。；;、\n]+/)
    .map(cleanText)
    .filter(Boolean);
}

const HUMAN_TOKENS = [
  '人', '人物', '角色', '主角', '配角', '路人', '男人', '女人', '男孩', '女孩', '少年', '少女',
  '老人', '小孩', '顾行', '老周', '他', '她', '他们', '她们', '两人', '三人', '众人'
];

const HUMAN_ACTION_TOKENS = [
  '站', '坐', '蹲', '走', '跑', '看', '望', '抬', '抬手', '伸手', '转身', '回头', '对视', '说',
  '微笑', '哭', '喊', '拿', '握', '抱', '靠', '跪', '挥', '跳', '停顿', '凝视'
];

const NARRATIVE_OR_ABSTRACT_TOKENS = [
  '剧情', '故事', '情节', '命运', '回忆', '往事', '内心', '心情', '情绪', '氛围', '气氛',
  '孤独', '悲伤', '哀伤', '愤怒', '温柔', '紧张', '神秘', '压抑', '惊讶', '恐惧',
  '正在', '刚刚', '随后', '然后', '接着', '即将', '准备', '仿佛', '似乎', '像是'
];

const PROP_USAGE_TOKENS = [
  '手里', '手中', '手上的', '拿着', '握着', '举着', '抱着', '佩戴', '穿着', '踩着', '坐在', '放在他', '放在她'
];

const CHARACTER_STORY_TOKENS = [
  '店主', '老板', '职业', '工作', '靠', '为生', '接私活',
  '能看见', '看见鬼', '鬼魂', '灵异',
  '养父', '养母', '继承', '去世', '身世', '成谜',
  '火场', '被救', '遇难', '全家',
];

function containsHumanSubject(clause: string): boolean {
  return HUMAN_TOKENS.some(token => clause.includes(token));
}

function containsHumanAction(clause: string): boolean {
  return HUMAN_ACTION_TOKENS.some(token => clause.includes(token));
}

function containsNarrativeOrAbstractToken(clause: string): boolean {
  return NARRATIVE_OR_ABSTRACT_TOKENS.some(token => clause.includes(token));
}

function containsPropUsageContext(clause: string): boolean {
  return PROP_USAGE_TOKENS.some(token => clause.includes(token));
}

function containsCharacterStoryToken(clause: string): boolean {
  return CHARACTER_STORY_TOKENS.some(token => clause.includes(token));
}

function sanitizeCharacterAppearance(value?: string, fallback?: string): string {
  const clauses = splitVisualClauses(value);
  const filtered = clauses.filter(clause => (
    !containsCharacterStoryToken(clause)
    && !containsNarrativeOrAbstractToken(clause)
  ));
  return cleanText(filtered.join(', ') || fallback || '');
}

function sanitizeSceneDescription(value?: string, fallback?: string): string {
  const clauses = splitVisualClauses(value);
  const filtered = clauses.filter(clause => (
    !containsHumanSubject(clause)
    && !containsHumanAction(clause)
    && !containsNarrativeOrAbstractToken(clause)
  ));
  return cleanText(filtered.join(', ') || fallback || '');
}

function sanitizePropDescription(value?: string, fallback?: string): string {
  const clauses = splitVisualClauses(value);
  const filtered = clauses.filter(clause => (
    !containsHumanSubject(clause)
    && !containsHumanAction(clause)
    && !containsNarrativeOrAbstractToken(clause)
    && !containsPropUsageContext(clause)
  ));
  return cleanText(filtered.join(', ') || fallback || '');
}

function stripDialogueAndNarrativeNoise(value?: string): string {
  const text = cleanText(value);
  if (!text) return '';

  return text
    .replace(/“[^”]*”/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/「[^」]*」/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/(因为|所以|于是|随后|然后|接着|准备|打算|想要|意识到|决定|内心|心里|想着|回忆着)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatShotType(shotType?: Shot['shotType']): string {
  const mapping: Record<string, string> = {
    'close-up': 'close-up, eye-level',
    'medium': 'medium shot, eye-level',
    'wide': 'wide shot, eye-level',
    'extreme-wide': 'extreme wide shot, eye-level',
  };
  return mapping[shotType || 'medium'] || 'medium shot, eye-level';
}

function formatSceneTime(time?: Scene['time']): string {
  const mapping: Record<string, string> = {
    day: 'daylight, clear ambient light',
    night: 'night, low-key lighting, practical lights visible',
    twilight: 'twilight, mixed cool and warm light',
  };
  return mapping[time || 'day'] || cleanText(time);
}

function formatSceneMood(mood?: string): string {
  const normalized = cleanText(mood);
  if (!normalized) return '';

  const mapping: Record<string, string> = {
    '平静': 'steady lighting, restrained contrast, stable atmosphere',
    '紧张': 'hard contrast, compressed framing, tense air',
    '神秘': 'mist, obscured depth, dim scattered highlights',
    '压抑': 'low-key lighting, muted palette, heavy air',
    '温暖': 'warm highlights, soft contrast, gentle ambient haze',
    '悲伤': 'cool desaturated palette, still air, softened contrast',
  };
  return mapping[normalized] || normalized;
}

function formatEmotionCue(emotion?: string): string {
  const normalized = cleanText(emotion);
  if (!normalized) return 'neutral expression, stable posture';

  const mapping: Record<string, string> = {
    '平静': 'calm expression, relaxed shoulders, steady movement',
    '紧张': 'tight jaw, alert gaze, controlled movement',
    '激动': 'wider gesture range, lifted chin, fast motion accents',
    '悲伤': 'lowered gaze, slowed movement, softened posture',
    '愤怒': 'tense facial muscles, rigid posture, abrupt movement',
    '自然': 'neutral expression, natural breathing, balanced posture',
    '惊讶': 'widened eyes, lifted brows, brief body recoil',
    '低落': 'lowered shoulders, slow motion, unfocused gaze',
  };
  return mapping[normalized] || normalized;
}

function getCharacterAppearance(character?: Character): string {
  if (!character) return '';
  // 优先使用结构化提取出来的 appearance；用户在角色面板里手动改的也会回写到 appearance。
  // prompt 历史上是 appearance 的镜像，作为兜底；最后用 name 兜底防止全空。
  const primary = sanitizeCharacterAppearance(character.appearance, '');
  if (primary) return primary;
  return sanitizeCharacterAppearance(character.prompt, character.name);
}

const GENDER_EN: Record<string, string> = {
  male: 'male',
  female: 'female',
  neutral: 'androgynous',
  unknown: '',
};

const UNKNOWN_AGE_PATTERN = /^(未知|unknown|n\/?a)$/i;
const NUMERIC_AGE_PATTERN = /^\d+$/;
const CHINESE_AGE_PATTERN = /^(\d+)\s*岁$/i;
const YEARS_OLD_PATTERN = /^(\d+)\s*years?\s+old$/i;

function formatGenderClause(gender?: string): string {
  if (!gender) return '';
  const en = GENDER_EN[gender];
  return en ? `${en},` : '';
}

function normalizeAgeToYearsOld(age: string): string {
  if (NUMERIC_AGE_PATTERN.test(age)) {
    return `${age} years old`;
  }

  return age
    .replace(CHINESE_AGE_PATTERN, '$1 years old')
    .replace(YEARS_OLD_PATTERN, '$1 years old');
}

function formatAgeClause(age?: string): string {
  const trimmed = cleanText(age);
  if (!trimmed || UNKNOWN_AGE_PATTERN.test(trimmed)) return '';
  return `${normalizeAgeToYearsOld(trimmed)},`;
}

// 把数字/区间年龄转换为 TTI 模型更容易理解的英语年龄段名词，
// 用于和 gender 拼成一个紧凑的人物身份短语（如 "young adult male"）。
function ageBucketLabel(age?: string): string {
  const trimmed = cleanText(age);
  if (!trimmed) return '';
  if (/^(未知|unknown|n\/?a)$/i.test(trimmed)) return '';
  const match = /(\d+)/.exec(trimmed);
  if (!match) return '';
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 13) return 'child';
  if (value < 20) return 'teenager';
  if (value < 30) return 'young adult';
  if (value < 50) return 'adult';
  if (value < 65) return 'middle-aged';
  return 'elderly';
}

// 把 gender + age 合成一个具象人物名词短语，便于 TTI 模型把性别 / 年龄锁进主体；
// 同时保留精确年龄词以提供细节，例如 "young adult male, 28 years old"。
function formatDemographicClause(gender?: string, age?: string): string {
  const genderEn = GENDER_EN[gender || ''] || '';
  const bucket = ageBucketLabel(age);
  const subjectParts = [bucket, genderEn].filter(Boolean);
  const subject = subjectParts.length ? subjectParts.join(' ') : 'person';
  const trimmedAge = cleanText(age);
  const explicitAge = trimmedAge && !/^(未知|unknown|n\/?a)$/i.test(trimmedAge)
    ? (/^\d+$/.test(trimmedAge) ? `${trimmedAge} years old` : trimmedAge)
    : '';
  return joinClauses([subject, explicitAge]);
}

function getSceneVisualDescription(scene?: Scene): string {
  if (!scene) return '';
  return sanitizeSceneDescription(
    scene.prompt || joinClauses([
      scene.location,
      formatSceneTime(scene.time),
      formatSceneMood(scene.mood),
    ]),
    joinClauses([
      scene.location,
      formatSceneTime(scene.time),
      formatSceneMood(scene.mood),
      scene.name,
    ])
  );
}

function getPropVisualDescription(prop?: Prop): string {
  if (!prop) return '';
  return sanitizePropDescription(
    prop.prompt || joinClauses([prop.type, prop.name]),
    joinClauses([prop.type, prop.name])
  );
}

function summarizeCharacters(characterIds: string[] | undefined, characters: Character[]): string {
  return joinClauses(
    (characterIds || []).map(characterId => {
      const character = characters.find(item => item.id === characterId);
      if (!character) return '';
      return `${character.name}, ${getCharacterAppearance(character)}`;
    })
  );
}

function summarizeScenes(sceneIds: string[] | undefined, scenes: Scene[]): string {
  return joinClauses(
    (sceneIds || []).map(sceneId => {
      const scene = scenes.find(item => item.id === sceneId);
      if (!scene) return '';
      return `${scene.name}, ${getSceneVisualDescription(scene)}`;
    })
  );
}

function summarizeProps(propIds: string[] | undefined, props: Prop[]): string {
  return joinClauses(
    (propIds || []).map(propId => {
      const prop = props.find(item => item.id === propId);
      if (!prop) return '';
      return `${prop.name}, ${getPropVisualDescription(prop)}`;
    })
  );
}

function getShotVisibleAction(shot: Shot): string {
  return cleanText(stripDialogueAndNarrativeNoise(getShotScriptText(shot)));
}

function buildMotionTimeline(durationSeconds: number, action: string, cameraMovement: string): string {
  const duration = coerceShotDurationSeconds(durationSeconds);
  const segments: Array<[number, number]> = duration <= 2
    ? [[0, duration]]
    : duration <= 4
      ? [[0, 1], [1, duration]]
      : [[0, 1], [1, duration - 1], [duration - 1, duration]];

  return segments.map(([start, end], index) => {
    if (index === 0) {
      return `[${start},${end}]秒：建立主体站位、环境层次与初始姿态，镜头以 ${cameraMovement} 开始，动作保持克制连贯`;
    }
    if (index === segments.length - 1 && segments.length > 1) {
      return `[${start},${end}]秒：${action || '主体动作收束'}，镜头完成 ${cameraMovement} 并稳定落点，保留环境余动`;
    }
    return `[${start},${end}]秒：${action || '主体持续当前可见动作'}，镜头维持 ${cameraMovement}，环境细节保持连贯变化`;
  }).join(' ');
}

export function buildCharacterCostumeTemplateVariables(
  character: Character,
  stylePrefix: string
): Record<string, string> {
  return {
    stylePrefix: cleanText(stylePrefix),
    demographic: formatDemographicClause(character.gender, character.age),
    // gender / age 仍然透传，方便老的自定义模板覆盖继续生效。
    gender: formatGenderClause(character.gender),
    age: formatAgeClause(character.age),
    appearance: getCharacterAppearance(character),
  };
}

export function buildScenePreviewTemplateVariables(
  scene: Scene,
  stylePrefix: string
): Record<string, string> {
  return {
    stylePrefix: cleanText(stylePrefix),
    description: getSceneVisualDescription(scene),
    location: cleanText(scene.location || scene.name),
    time: formatSceneTime(scene.time),
    mood: formatSceneMood(scene.mood),
  };
}

export function buildPropReferenceTemplateVariables(
  prop: Prop,
  stylePrefix: string
): Record<string, string> {
  return {
    stylePrefix: cleanText(stylePrefix),
    description: getPropVisualDescription(prop),
    type: cleanText(prop.type || prop.name),
  };
}

export function buildShotImageTemplateVariables(params: {
  shot: Shot;
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  stylePrefix: string;
}): Record<string, string> {
  const { shot, characters, scenes, props, stylePrefix } = params;
  const description = joinClauses([
    summarizeCharacters(shot.characters, characters),
    getShotVisibleAction(shot),
    summarizeScenes(shot.scenes, scenes),
    summarizeProps(shot.props, props),
  ]);

  return {
    stylePrefix: cleanText(stylePrefix),
    description,
    shotType: formatShotType(shot.shotType),
    emotion: formatEmotionCue(shot.emotion),
  };
}

export function buildShotVideoTemplateVariables(params: {
  shot: Shot;
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  stylePrefix: string;
  cameraMovement: string;
}): Record<string, string> {
  const { shot, characters, scenes, props, stylePrefix, cameraMovement } = params;
  const description = joinClauses([
    summarizeCharacters(shot.characters, characters),
    getShotVisibleAction(shot),
    summarizeScenes(shot.scenes, scenes),
    summarizeProps(shot.props, props),
  ]);
  const motionTimeline = buildMotionTimeline(shot.duration, getShotVisibleAction(shot), cameraMovement);

  return {
    stylePrefix: cleanText(stylePrefix),
    description,
    shotType: formatShotType(shot.shotType),
    cameraMovement: cleanText(cameraMovement),
    durationSeconds: String(coerceShotDurationSeconds(shot.duration)),
    motionTimeline,
  };
}
