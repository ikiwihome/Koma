import type { TransitionType } from '../../../types/editor';

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MAX_TRANSITION_DURATION = 2.0;
export const MIN_VISIBLE_DURATION = 0.1;
/** 浮点比较容差：1 微秒，用于时间点邻接判断和 duration 钳位 */
export const TIME_EPSILON = 1e-6;
/** 单轨最大转场数量上限，防止一次性批量添加导致性能问题 */
export const MAX_TRANSITIONS_PER_TRACK = 100;
export const TRANSITION_TYPE_FADE: TransitionType = 'fade';
export const SUPPORTED_TRANSITION_TYPES: ReadonlySet<TransitionType> = new Set<TransitionType>(['fade']);
