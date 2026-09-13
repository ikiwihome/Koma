# Agnes 默认配置

默认渠道定义在 `resources/agnes-models.json`：

| 用途 | 模型 | Base URL |
| --- | --- | --- |
| 文本 | agnes-3.0-flash | https://api.agnes-ai.cn/v1 |
| 图片 | agnes-image-2.5-flash | https://api.agnes-ai.cn |
| 视频 | agnes-video-2.5-flash | https://api.agnes-ai.cn |

Electron 首次启动读取 `AGNES_API_KEY` 环境变量，或本机构建文件
`resources/agnes-defaults.local.json`（格式为 `{"apiKey":"..."}`）。该明文文件不进入 Git，
也不随软件分发。构建前生成 AES-256-GCM 加密文件 `resources/agnes-defaults.enc.json`，
随 Windows 软件分发并可跨机器读取。首次启动解密后使用 Electron safeStorage 加密写入渠道数据库，
前端不包含默认密钥。其他机器从源码构建时需要自行提供该文件或环境变量。

初始化标记为 `agnes-defaults-v1`，仅初始化一次，不会在重启时覆盖用户后续修改。
Agnes 激活信息单独保存于 `agnes-activation`；原 Koma 激活信息、图床渠道和图床默认选择均保留。

默认 Koma 图床 Key 由 Electron 读取 `KOMA_IMAGE_HOSTING_API_KEY`，或
`resources/koma-hosting-defaults.local.json`（同样使用 `{"apiKey":"..."}` 格式）。
此明文文件仅用于本机构建，不进入 Git，也不随软件分发。构建前自动生成 AES-256-GCM
加密文件 `resources/koma-hosting-defaults.enc.json`，随软件分发并可跨机器读取。
首次启动自动解密后使用 Electron safeStorage 加密保存到七牛云图床渠道；
已有图床 Key 和用户的默认图床选择不会被覆盖。初始化标记为 `koma-hosting-defaults-v1`。
两种 Key 使用独立加密上下文和随机 IV。客户端包含解密材料，因此分发加密用于避免明文暴露，不能保证密钥不可提取。

图片使用 `/v1/images/generations`，参考图传入 `extra_body.image`。
视频使用 `/v1/videos` 创建任务，再通过 `/agnesapi?video_id=...&model_name=...` 查询。
Flash 视频固定 720P，支持 4–12 秒及最多 5 张参考图片。
余额通过 `/v1/dashboard/billing/subscription` 与 `/v1/dashboard/billing/usage` 查询。

构建 Windows x64 免安装目录：

```powershell
npm run build:win:dir
```

输出：`out/win-unpacked/AI短剧生成工具.exe`，运行时保留整个目录。不会生成安装程序或 portable 单文件包。

接口参考：
- https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash
- https://www.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash
