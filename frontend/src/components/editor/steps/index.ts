/**
 * 编辑器步骤组件集中注册
 *
 * 在 EditorView 顶部 import 此模块触发副作用，把 step Component 注入到
 * editorStepRegistry 中已声明的元数据上。新增 step 时：
 *   1) 在 workflow/editorStepRegistry 注册元数据
 *   2) 在本目录添加 wrapper component
 *   3) 在本文件追加 setStepComponent 调用
 * EditorView 自身无需改动。
 */
import { setStepComponent } from '../../../workflow/editorStepRegistry';
import { ScriptStep } from './ScriptStep';
import { AssetsStep } from './AssetsStep';
import { StoryboardStep } from './StoryboardStep';
import { VideoStep } from './VideoStep';

setStepComponent('script', ScriptStep);
setStepComponent('assets', AssetsStep);
setStepComponent('storyboard', StoryboardStep);
setStepComponent('video', VideoStep);

export { ScriptStep, AssetsStep, StoryboardStep, VideoStep };
