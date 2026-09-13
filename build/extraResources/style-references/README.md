# 内置风格参考图（"画风锚"）

每个内置风格预设需要一张 PNG 参考图，启动时 electron main 会镜像到
`${userData}/style-references/`（即 `~/.koma/style-references/`），生成角色 / 场景 /
道具图时作为 `references[0]` 注入 TTI provider，模型严格继承画风（色调 / 笔触 /
光影 / 笔法），prompt 硬约束"仅参考画风、不参考内容"。

## 文件名约定

文件名必须与 `frontend/src/config/themePresets.ts` 中各 preset 的
`defaultStyleReferenceFile` 字段一一对应：

| presetId          | 文件名                  |
|-------------------|-------------------------|
| `anime-urban`     | `anime-urban.png`       |
| `anime-xuanhuan`  | `anime-xuanhuan.png`    |
| `anime-classical` | `anime-classical.png`   |
| `anime-pixel`     | `anime-pixel.png`       |

`custom` 预设没有内置默认图，用户必须自己在视觉风格设置里上传。

## 推荐规格

- 长边 1024–2048 px，比例 16:9 或 1:1
- 文件 < 2 MB
- 色彩 / 笔触 / 光影特征清晰
- 画面**不要含特定角色 / 道具**（这是画风锚，不是内容锚）

## 运行时覆盖

- **全局覆盖**（设置 → 视觉风格 上传按钮）落到
  `~/.koma/style-references/{presetId}-user.{ext}`，对所有项目生效
- **项目级覆盖**（项目设置 → 基本信息 → 项目风格参考图）落到
  `~/.koma/projects/{projectId}/assets/style-reference.{ext}`，仅本项目生效
- 解析优先级：项目级覆盖 > 全局用户覆盖 > 内置默认（本目录的 PNG）

## 使用 SVG

不支持。SVG 不能被多数 TTI provider 当作图生图的输入参考。请用 PNG / JPG / WebP。
