/**
 * 智能编辑器模块导出
 */
export * from './mentionTypes';
export { createMentionPlugin, createMentionAtomicDelete, mentionTheme, type MentionClickHandler } from './mentionPlugin';
export { createMentionAutocomplete, autocompleteTheme } from './mentionAutocomplete';
export type { MentionDataSource } from './mentionAutocomplete';
export * from './mentionTooltip';
export {
  createKeywordHighlightPlugin,
  createKeywordTooltip,
  createKeywordAtomicDelete,
  keywordHighlightTheme,
  CAMERA_KEYWORDS,
  CAMERA_KEYWORDS_EN,
  CAMERA_KEYWORDS_ZH,
  SHOT_TYPE_KEYWORDS,
  SHOT_TYPE_KEYWORDS_EN,
  SHOT_TYPE_KEYWORDS_ZH,
} from './keywordHighlightPlugin';
export * from './cameraCommandTypes';
export { createCombinedAutocomplete, combinedAutocompleteTheme } from './combinedAutocomplete';
export { ScriptEditor } from './ScriptEditor';
export type { ScriptEditorProps } from './ScriptEditor';
export { MentionProvider, useMentionContext, useMentionItems } from './MentionContext';
