import { Project, ScriptAnalysisResult, AppSettings, scriptLinesFromText } from '../types';
import { getThumbnailUrl } from './dimensions';

// 开发测试用模拟数据
export const DEV_TEST_PROJECT: Project = {
  id: 'dev-test',
  title: '废弃医院的回声',
  genre: '恐怖/悬疑',
  mode: 'drama',
  episodes: 12,
  lastEdited: '测试项目',
  thumbnail: getThumbnailUrl('horror'),
  status: 'storyboard'
};

export const DEV_TEST_ANALYSIS: ScriptAnalysisResult = {
  characters: [
    { id: 'c1', name: '叶青凡', role: 'protagonist', prompt: '28岁男性调查员，沉稳冷静，黑发，深邃眼神' },
    { id: 'c2', name: '鬼护士', role: 'antagonist', prompt: '神秘的医院幽灵，白色护士服，无面孔' },
  ],
  scenes: [
    { id: 's1', name: '废弃医院走廊', prompt: 'Location: 废弃医院\nTime: night\nMood: 阴森紧张\n昏暗的走廊，墙壁剥落' },
  ],
  props: [
    { id: 'pr1', name: '手电筒', prompt: 'Type: 道具\n发出微弱光芒的老旧手电' },
    { id: 'pr2', name: '手术刀', prompt: 'Type: 武器\n生锈的手术刀' },
  ],
  shots: [
    { id: 'shot1', scriptLines: scriptLinesFromText('走廊里死一般的寂静'), shotType: 'wide', cameraMovement: 'static', duration: 3, imagePrompt: 'Wide shot of dark hospital corridor', characters: ['c1'], dialogue: '', emotion: '紧张' },
    { id: 'shot2', scriptLines: scriptLinesFromText('叶青凡站在铁门前'), shotType: 'medium', cameraMovement: 'tracking', duration: 4, imagePrompt: 'Medium shot of Ye Qingfan holding flashlight', characters: ['c1'], dialogue: '比我记忆中更黑了', emotion: '警觉' },
    { id: 'shot3', scriptLines: scriptLinesFromText('铁门发出刺耳的摩擦声'), shotType: 'close-up', cameraMovement: 'zoom-in', duration: 2, imagePrompt: 'Close-up of rusty iron door opening', characters: [], dialogue: '', emotion: '悬疑' },
    { id: 'shot4', scriptLines: scriptLinesFromText('鬼护士背对窗户站立'), shotType: 'wide', cameraMovement: 'static', duration: 4, imagePrompt: 'Wide shot of ghost nurse silhouette against window', characters: ['c2'], dialogue: '', emotion: '恐怖' },
    { id: 'shot5', scriptLines: scriptLinesFromText('鬼护士转身，脸上没有五官'), shotType: 'close-up', cameraMovement: 'zoom-in', duration: 3, imagePrompt: 'Close-up of faceless ghost nurse turning', characters: ['c2'], dialogue: '', emotion: '惊悚' },
  ],
};

export const DEFAULT_SCRIPT = `# 第一场：废弃医院 - 夜
[氛围: 阴森, 紧张]

走廊里死一般的寂静，只有滴水声回荡。
叶青凡站在一扇生锈的铁门前，手里紧紧握着手电筒。

叶青凡
(低语)
"比我记忆中更黑了。"

他用力推门，铁门发出刺耳的摩擦声。

里面，一个身影背对着窗户站立。那是鬼护士。
她缓慢地转过身，脸上没有五官。手中握着一把生锈的手术刀。
`;

// 默认设置
export const DEFAULT_SETTINGS: AppSettings = {
  channelConfigs: [],
  mediaDefaults: {},
};

// 时间格式化工具函数
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}
