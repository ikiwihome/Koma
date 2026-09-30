import { app as electronApp, protocol } from 'electron';
import { ElectronEgg } from 'ee-core';
import { join } from 'node:path';
import { Lifecycle } from './preload/lifecycle';
import { preload } from './preload';
import { getBusinessLogsDir } from './service/paths';

const APP_DISPLAY_NAME = 'AI短剧生成工具';
const ELECTRON_REMOTE_DEBUGGING_PORT = process.env.KOMA_ELECTRON_REMOTE_DEBUGGING_PORT || '9333';
const isDev = process.env.NODE_ENV === 'development' || !electronApp.isPackaged;

// ee-core 在 ElectronEgg 构造时会**无条件**创建 `~/.<appName>/{data,logs}`，
// 并在整个进程生命周期里持有日志文件句柄（事后删不掉，下次启动又会重建）。
// 实现见 ee-core/app/dir.js → ee-core/ps/index.js#getUserHomeHiddenAppDir()：
//   path.join(process.env.EE_USER_HOME, '.' + process.env.EE_APP_NAME)
// 其中 EE_APP_NAME 由 ElectronEgg 从 `app.getName()` 读取，没有任何配置项可覆盖。
// 因此这里先用内部名 `koma`（拼出 `~/.koma`，正好是业务根）完成框架初始化，
// 等 ElectronEgg 构造结束再改回对外显示名。
const EE_CORE_APP_NAME = 'koma';

electronApp.setName(EE_CORE_APP_NAME);
// 业务存储根：~/.koma/   （projects/ logs/ settings.db plugins-runtime/ 等）
// Chromium / Electron 内部状态：~/.koma/_userData/
//   （Cookies、Local Storage、Cache、SingletonLock 等都进子目录，
//    避免污染业务存储根，扫描业务根的代码不会再撞到这些框架文件）
electronApp.setPath('userData', join(electronApp.getPath('home'), '.koma', '_userData'));
electronApp.setAppLogsPath(getBusinessLogsDir());

// 自定义协议 koma-local:// 必须在 app.ready 之前注册为 privileged，
// 否则 Chromium 在 renderer 端会拒绝 <img>/<video>/fetch 加载（DOM 里能看到正确的 src，
// 但资源不会加载、也不会触发主进程的 protocol.handle）。
// - standard:true 让 URL 按 host+path 标准解析（authority 为空，pathname 形如 /Users/...）
// - secure:true 通过 <video> 等需要 secure-context 的 API 校验
// - supportFetchAPI:true 允许 renderer 用 fetch() 拉资源
// - stream:true 允许 protocol.handle 返回 Range/分块响应（视频 range 请求需要）
// - corsEnabled:true 允许跨源访问
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'koma-local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

if (isDev) {
  electronApp.commandLine.appendSwitch('remote-debugging-port', ELECTRON_REMOTE_DEBUGGING_PORT);

  console.info(
    `[electron-devtools] chrome-devtools-mcp browser-url=http://127.0.0.1:${ELECTRON_REMOTE_DEBUGGING_PORT}`
  );
}

const app = new ElectronEgg();
// ee-core 的自管目录（~/.koma/{data,logs}）已在构造时定型，这里恢复对外显示名，
// 让窗口 / 关于面板 / 诊断上报仍然显示中文名。
// `app.getPath('userData')` 已被上面的 setPath 显式固定，不会因为改名回落到 %APPDATA%\<name>。
electronApp.setName(APP_DISPLAY_NAME);
const lifecycle = new Lifecycle();

app.register('ready', lifecycle.ready);
app.register('electron-app-ready', lifecycle.electronAppReady);
app.register('window-ready', lifecycle.windowReady);
app.register('before-close', lifecycle.beforeClose);
app.register('preload', preload);

app.run();
