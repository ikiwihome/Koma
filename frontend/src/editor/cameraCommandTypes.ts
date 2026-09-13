/**
 * 运镜/景别命令类型定义
 * 支持中英文，用于 / 命令快速输入
 */

export type CommandCategory = 'camera' | 'shot';

export interface CameraCommand {
  id: string;
  nameZh: string;
  nameEn: string;
  category: CommandCategory;
  description: string;
  aliases?: string[];  // 额外的搜索关键词
}

// 运镜方式命令
export const CAMERA_COMMANDS: CameraCommand[] = [
  // 基础运镜
  { id: 'static', nameZh: '固定', nameEn: 'static', category: 'camera', description: '镜头固定不动，画面稳定' },
  { id: 'push', nameZh: '推', nameEn: 'push in', category: 'camera', description: '镜头向前推进，突出主体', aliases: ['推镜头', '缓推', '快推', 'dolly in'] },
  { id: 'pull', nameZh: '拉', nameEn: 'pull out', category: 'camera', description: '镜头向后拉远，展示环境', aliases: ['拉镜头', '缓拉', '快拉', 'dolly out'] },
  { id: 'pan_left', nameZh: '左摇', nameEn: 'pan left', category: 'camera', description: '镜头水平向左摇动', aliases: ['横摇', '摇镜头'] },
  { id: 'pan_right', nameZh: '右摇', nameEn: 'pan right', category: 'camera', description: '镜头水平向右摇动', aliases: ['横摇', '摇镜头'] },
  { id: 'tilt_up', nameZh: '上摇', nameEn: 'tilt up', category: 'camera', description: '镜头垂直向上仰起', aliases: ['纵摇', '仰拍'] },
  { id: 'tilt_down', nameZh: '下摇', nameEn: 'tilt down', category: 'camera', description: '镜头垂直向下俯视', aliases: ['纵摇', '俯拍'] },
  { id: 'zoom_in', nameZh: '变焦推', nameEn: 'zoom in', category: 'camera', description: '变焦镜头拉近，聚焦细节', aliases: ['变焦'] },
  { id: 'zoom_out', nameZh: '变焦拉', nameEn: 'zoom out', category: 'camera', description: '变焦镜头拉远，扩展视野', aliases: ['变焦'] },
  { id: 'tracking', nameZh: '跟', nameEn: 'tracking', category: 'camera', description: '镜头跟随主体移动', aliases: ['跟镜头', '跟拍', '移动跟拍'] },
  { id: 'crane_up', nameZh: '升', nameEn: 'crane up', category: 'camera', description: '镜头垂直上升，俯瞰效果', aliases: ['升镜头', '升降'] },
  { id: 'crane_down', nameZh: '降', nameEn: 'crane down', category: 'camera', description: '镜头垂直下降，接近主体', aliases: ['降镜头', '升降'] },
  { id: 'orbit', nameZh: '环绕', nameEn: 'orbit', category: 'camera', description: '镜头围绕主体旋转', aliases: ['环绕拍摄', '绕拍', 'arc shot'] },
  { id: 'handheld', nameZh: '手持', nameEn: 'handheld', category: 'camera', description: '手持拍摄，画面轻微晃动，增加真实感', aliases: ['手持拍摄'] },
  { id: 'steadicam', nameZh: '稳定器', nameEn: 'steadicam', category: 'camera', description: '稳定器拍摄，流畅移动', aliases: ['稳定器拍摄'] },
  { id: 'whip', nameZh: '甩', nameEn: 'whip pan', category: 'camera', description: '快速甩动镜头，制造转场效果', aliases: ['甩镜头', '快摇'] },
];

// 景别命令
export const SHOT_TYPE_COMMANDS: CameraCommand[] = [
  { id: 'extreme_closeup', nameZh: '大特写', nameEn: 'extreme close-up', category: 'shot', description: '拍摄面部细节或物体局部，强调情感', aliases: ['ECU'] },
  { id: 'closeup', nameZh: '特写', nameEn: 'close-up', category: 'shot', description: '拍摄面部或重要物体，突出表情', aliases: ['CU'] },
  { id: 'medium_closeup', nameZh: '中近景', nameEn: 'medium close-up', category: 'shot', description: '胸部以上，兼顾表情和动作', aliases: ['MCU'] },
  { id: 'medium', nameZh: '中景', nameEn: 'medium shot', category: 'shot', description: '腰部以上，展示上半身动作', aliases: ['MS', '半身'] },
  { id: 'medium_wide', nameZh: '中远景', nameEn: 'medium wide', category: 'shot', description: '膝盖以上，展示更多肢体语言', aliases: ['MWS'] },
  { id: 'full', nameZh: '全景', nameEn: 'full shot', category: 'shot', description: '展示人物全身', aliases: ['FS', '全身'] },
  { id: 'wide', nameZh: '远景', nameEn: 'wide shot', category: 'shot', description: '展示人物与环境关系', aliases: ['WS'] },
  { id: 'extreme_wide', nameZh: '大远景', nameEn: 'extreme wide', category: 'shot', description: '展示宏大场景，人物渺小', aliases: ['EWS', '大全景'] },
  { id: 'establishing', nameZh: '场景确立', nameEn: 'establishing shot', category: 'shot', description: '展示场景全貌，交代时间地点', aliases: ['定场镜头'] },
  { id: 'over_shoulder', nameZh: '过肩', nameEn: 'over the shoulder', category: 'shot', description: '从一人肩后拍摄另一人，常用于对话', aliases: ['OTS', '过肩镜头'] },
  { id: 'pov', nameZh: '主观', nameEn: 'POV', category: 'shot', description: '模拟角色视角，增强代入感', aliases: ['主观镜头', 'point of view'] },
  { id: 'aerial', nameZh: '航拍', nameEn: 'aerial', category: 'shot', description: '高空俯拍，展示宏观场景', aliases: ['鸟瞰', 'drone shot'] },
  { id: 'low_angle', nameZh: '仰拍', nameEn: 'low angle', category: 'shot', description: '从下往上拍摄，显得主体高大', aliases: ['低角度'] },
  { id: 'high_angle', nameZh: '俯拍', nameEn: 'high angle', category: 'shot', description: '从上往下拍摄，显得主体渺小', aliases: ['高角度'] },
  { id: 'dutch', nameZh: '斜角', nameEn: 'dutch angle', category: 'shot', description: '倾斜构图，制造不安感', aliases: ['荷兰角', 'canted angle'] },
];

// 合并所有命令
export const ALL_COMMANDS: CameraCommand[] = [...CAMERA_COMMANDS, ...SHOT_TYPE_COMMANDS];

// 命令正则：匹配 /cmd_xxx 格式
export const COMMAND_REGEX = /\/cmd_([a-z_]+)/g;

/**
 * 创建命令字符串
 */
export function createCommandString(id: string): string {
  return `/cmd_${id}`;
}

/**
 * 解析命令字符串
 */
export interface ParsedCommand {
  id: string;
  from: number;
  to: number;
}

export function parseCommands(text: string): ParsedCommand[] {
  const results: ParsedCommand[] = [];
  const regex = new RegExp(COMMAND_REGEX.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({
      id: match[1],
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return results;
}

/**
 * 根据 ID 查找命令
 */
export function findCommandById(id: string): CameraCommand | undefined {
  return ALL_COMMANDS.find(cmd => cmd.id === id);
}

/**
 * 搜索命令（支持中英文和别名）
 */
export function searchCommands(query: string): CameraCommand[] {
  if (!query) return ALL_COMMANDS;
  const q = query.toLowerCase();
  return ALL_COMMANDS.filter(cmd => {
    return cmd.nameZh.toLowerCase().includes(q) ||
           cmd.nameEn.toLowerCase().includes(q) ||
           cmd.id.includes(q) ||
           cmd.aliases?.some(a => a.toLowerCase().includes(q));
  });
}
