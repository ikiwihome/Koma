/**
 * Koma 官方 TTS（qwen-tts）的内置音色目录。
 *
 * 数据源：build/extraResources/audio/qwen-tts/{category}/{Voice-中文名}.wav
 *  - 文件名 "Voice-中文名" 中的 Voice 部分小写后即为上游 voice id（OpenAI 兼容字段）
 *  - 中文名作为 UI 展示的别名
 *
 * 试听 wav 文件由打包脚本（cmd/builder*.json 的 extraResources）随客户端分发：
 *  - 生产: <resourcesPath>/extraResources/audio/qwen-tts/{sampleFile}
 *  - 开发: <projectRoot>/build/extraResources/audio/qwen-tts/{sampleFile}
 *
 * 注意：05_语言/lang-*.wav 是语言切换示例（非真实 voice id），不在此清单中。
 */

import type { Voice } from '../../types';

export type KomaTTSVoiceCategory = 'common' | 'multilang' | 'premium' | 'dialect';

export interface KomaTTSVoiceMeta extends Voice {
  category: KomaTTSVoiceCategory;
  /** 相对 audio/qwen-tts 目录的 wav 路径（用于试听）。 */
  sampleFile: string;
}

const COMMON_DIR = '01_通用中英文';
const MULTILANG_DIR = '02_多语种原生';
const PREMIUM_DIR = '03_精品百人';
const DIALECT_DIR = '04_中文方言';

const PROVIDER = 'koma-tts';

function v(
  category: KomaTTSVoiceCategory,
  dir: string,
  id: string,
  englishName: string,
  chineseName: string,
  language: string,
  gender: Voice['gender'],
): KomaTTSVoiceMeta {
  return {
    id,
    name: `${englishName} / ${chineseName}`,
    language,
    gender,
    provider: PROVIDER,
    category,
    sampleFile: `${dir}/${englishName}-${chineseName}.wav`,
  };
}

/**
 * 全部内置音色清单。新增 / 删除音色时同步改这里 + 把对应 wav 放入
 * build/extraResources/audio/qwen-tts/{category}/。
 */
export const KOMA_TTS_VOICES: KomaTTSVoiceMeta[] = [
  // 01 通用中英文（zh-CN + en）
  v('common', COMMON_DIR, 'cherry', 'Cherry', '芊悦', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'aiden', 'Aiden', '艾登', 'zh-CN', 'male'),
  v('common', COMMON_DIR, 'bella', 'Bella', '萌宝', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'chelsie', 'Chelsie', '千雪', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'ethan', 'Ethan', '晨煦', 'zh-CN', 'male'),
  v('common', COMMON_DIR, 'jennifer', 'Jennifer', '詹妮弗', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'kai', 'Kai', '凯', 'zh-CN', 'male'),
  v('common', COMMON_DIR, 'katerina', 'Katerina', '卡捷琳娜', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'maia', 'Maia', '四月', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'momo', 'Momo', '茉兔', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'moon', 'Moon', '月白', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'nofish', 'Nofish', '不吃鱼', 'zh-CN', 'male'),
  v('common', COMMON_DIR, 'ryan', 'Ryan', '甜茶', 'zh-CN', 'male'),
  v('common', COMMON_DIR, 'serena', 'Serena', '苏瑶', 'zh-CN', 'female'),
  v('common', COMMON_DIR, 'vivian', 'Vivian', '十三', 'zh-CN', 'female'),

  // 02 多语种原生
  v('multilang', MULTILANG_DIR, 'alek', 'Alek', '俄语', 'ru', 'male'),
  v('multilang', MULTILANG_DIR, 'andre', 'Andre', '葡语欧', 'pt-PT', 'male'),
  v('multilang', MULTILANG_DIR, 'bodega', 'Bodega', '西班牙语', 'es', 'male'),
  v('multilang', MULTILANG_DIR, 'dolce', 'Dolce', '意大利语', 'it', 'female'),
  v('multilang', MULTILANG_DIR, 'emilien', 'Emilien', '法语', 'fr', 'male'),
  v('multilang', MULTILANG_DIR, 'lenn', 'Lenn', '德语', 'de', 'male'),
  v('multilang', MULTILANG_DIR, 'onoanna', 'OnoAnna', '日语', 'ja', 'female'),
  v('multilang', MULTILANG_DIR, 'radiogol', 'RadioGol', '葡语巴', 'pt-BR', 'male'),
  v('multilang', MULTILANG_DIR, 'sohee', 'Sohee', '韩语', 'ko', 'female'),
  v('multilang', MULTILANG_DIR, 'sonrisa', 'Sonrisa', '西语拉美', 'es-419', 'female'),

  // 03 精品百人（zh-CN 角色音）
  v('premium', PREMIUM_DIR, 'arthur', 'Arthur', '徐大爷', 'zh-CN', 'male'),
  v('premium', PREMIUM_DIR, 'bunny', 'Bunny', '萌小姬', 'zh-CN', 'female'),
  v('premium', PREMIUM_DIR, 'ebona', 'Ebona', '诡婆婆', 'zh-CN', 'female'),
  v('premium', PREMIUM_DIR, 'eldricsage', 'EldricSage', '沧明子', 'zh-CN', 'male'),
  v('premium', PREMIUM_DIR, 'elias', 'Elias', '墨讲师', 'zh-CN', 'male'),
  v('premium', PREMIUM_DIR, 'mia', 'Mia', '乖小妹', 'zh-CN', 'female'),
  v('premium', PREMIUM_DIR, 'mochi', 'Mochi', '沙小弥', 'zh-CN', 'male'),
  v('premium', PREMIUM_DIR, 'neil', 'Neil', '阿闻', 'zh-CN', 'male'),
  v('premium', PREMIUM_DIR, 'nini', 'Nini', '邻家妹妹', 'zh-CN', 'female'),
  v('premium', PREMIUM_DIR, 'pip', 'Pip', '调皮小新', 'zh-CN', 'male'),
  v('premium', PREMIUM_DIR, 'seren', 'Seren', '小婉', 'zh-CN', 'female'),
  v('premium', PREMIUM_DIR, 'stella', 'Stella', '美少女阿月', 'zh-CN', 'female'),
  v('premium', PREMIUM_DIR, 'vincent', 'Vincent', '田叔', 'zh-CN', 'male'),

  // 04 中文方言
  v('dialect', DIALECT_DIR, 'dylan', 'Dylan', '北京晓东', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'eric', 'Eric', '四川程川', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'jada', 'Jada', '上海阿珍', 'zh-CN-dialect', 'female'),
  v('dialect', DIALECT_DIR, 'kiki', 'Kiki', '粤语阿清', 'zh-CN-dialect', 'female'),
  v('dialect', DIALECT_DIR, 'li', 'Li', '南京老李', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'marcus', 'Marcus', '陕西秦川', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'peter', 'Peter', '天津李彼得', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'rocky', 'Rocky', '粤语阿强', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'roy', 'Roy', '闽南阿杰', 'zh-CN-dialect', 'male'),
  v('dialect', DIALECT_DIR, 'sunny', 'Sunny', '四川晴儿', 'zh-CN-dialect', 'female'),
];

export const KOMA_TTS_VOICE_CATEGORY_LABEL: Record<KomaTTSVoiceCategory, string> = {
  common: '通用中英',
  multilang: '多语种原生',
  premium: '精品角色',
  dialect: '中文方言',
};

export const KOMA_TTS_DEFAULT_VOICE_ID = 'cherry';

export function findKomaTTSVoice(id?: string): KomaTTSVoiceMeta | undefined {
  if (!id) return undefined;
  const lower = id.trim().toLowerCase();
  return KOMA_TTS_VOICES.find((v) => v.id === lower);
}
