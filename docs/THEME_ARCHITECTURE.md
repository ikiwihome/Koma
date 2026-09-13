# 主题系统架构规范 (v2)

> 与 [`THEME_SYSTEM_PLAN.md`](./THEME_SYSTEM_PLAN.md) 配套。计划讲"做什么"，本文讲"代码怎么分层、技术栈如何收口"。
>
> **核心原则**：
> 1. 颜色 / 圆角 / 间距等**值**：唯一作者层 = TypeScript；唯一分发通道 = CSS 变量。
> 2. **样式技术栈**：项目只允许 **SCSS（含 SCSS Modules）+ Tailwind v4** 两种。
> 3. **inline `style={{}}`**：除 CSS 变量桥接外全面禁止。
> 4. 所有"硬编码 hex / 内联样式"必须抽出到独立样式文件。

---

## 1. 当前问题陈述

### 1.1 颜色值散落

| 技术栈 | 文件 | 现状 |
|---|---|---|
| TypeScript | `theme/tokens.ts` | 设计 token 对象 |
| Antd ConfigProvider | `theme/antdTheme.ts` | 写死 `darkAlgorithm` |
| Tailwind v4 `@theme` | `index.css` 顶部 | 颜色值**手抄** |
| 普通 CSS `:root` | `index.css` 后段 | **再手抄** |
| 散落 hex / rgba | 各 `*.css` / `*.tsx` | 889 行 hex 命中 |

**4 份"事实"互不引用** → 任何主题改动都要在 4 处手动同步 → 永远不一致。

### 1.2 样式技术栈混乱（实测）

| 技术 | 文件数 | 问题 |
|---|---|---|
| Tailwind v4 | 全局 | OK，保留 |
| 普通 `*.css` | 12 | 多技术栈混用 |
| `*.module.css` | 10 | 多技术栈混用 |
| inline `style={{}}` | **492 处 / 80 文件** | 严重，含 72 处颜色字面量 + 28 处动态 |
| Tailwind arbitrary hex | **35 处** `bg-[#xxx]` | 绕过主题 |

---

## 2. 设计目标

| ID | 目标 | 验收 |
|---|---|---|
| G1 | 颜色 / 圆角 / 阴影等值唯一来自 TS theme | grep 业务文件得不到 hex |
| G2 | 样式技术栈仅 **SCSS + Tailwind**，禁止普通 CSS | `find -name "*.css" -not -name "*.module.scss"` 应为空 |
| G3 | 业务 JSX 禁止 `style={{}}` 字面量值（仅允许 CSS 变量桥接） | grep 通过 |
| G4 | 用户可在设置切换 4 套预设主题，立即生效 | 切换 → 不刷新 → 全 UI 跟随 |
| G5 | 选择持久化 | 重启保留 |
| G6 | 默认主题视觉 = 当前 100% | 截图回归通过 |
| G7 | 加新主题 = 新增 1 个 `themes/*.ts` 文件，不动其它代码 | 验证 |

**OUT OF SCOPE**：
- 不做用户自定义颜色 picker（仅预设切换）
- 不重构 Antd 组件本身
- 不重写既有业务样式逻辑（只调 token 引用）

---

## 3. 技术栈收口

### 3.1 允许清单

| 技术栈 | 用途 | 文件后缀 / 形式 |
|---|---|---|
| **SCSS** | 所有自定义样式 | `*.scss`（全局）/ `*.module.scss`（组件作用域） |
| **Tailwind v4** | JSX className 中的工具类组合 | `className="flex gap-2"` 等 |
| **TypeScript theme** | 值的作者层 + 主题切换 + JS 侧消费（chart / canvas） | `theme/**/*.ts` |
| **Antd ConfigProvider** | Antd 组件主题接入 | 仅在 `ThemeProvider` 内出现 1 次 |

### 3.2 禁止清单

| 项目 | 替代方案 |
|---|---|
| ❌ 普通 `*.css` 文件 | 重命名 `.scss` |
| ❌ `*.module.css` 文件 | 重命名 `.module.scss` |
| ❌ JSX `style={{...}}` 字面量值 | Tailwind 工具类 / SCSS module class |
| ❌ Tailwind `bg-[#10b981]` 字面 hex | 语义工具类 `bg-accent` 或扩 SemanticTokens |
| ❌ TS 业务文件 hex / `import tokens` 直接读 | `useThemeValue('bg', 'app')` |
| ❌ `colorMode="dark"` / `darkTheme={true}` 字面量 | `useTheme().meta.mode` |
| ❌ 在业务组件内嵌 `<ConfigProvider>` 改局部颜色 | 扩 `SemanticTokens` 加语义档位 |

### 3.3 唯一例外：CSS 变量桥接（动态值场景）

**唯一允许的 inline `style`** —— 只能传 CSS 变量，不能传值：

```tsx
// ✅ 允许：传 CSS 变量，值参与计算
<div
  className={styles.progressBar}
  style={{ '--progress': `${progress}%` } as CSSProperties}
/>
```

```scss
// ProgressBar.module.scss
.progressBar {
  width: var(--progress);
  background: var(--token-accent-base);
  transition: width 200ms;
}
```

**禁止**：
```tsx
// ❌ 直接传值
<div style={{ width: `${progress}%` }} />
// ❌ 多个值
<div style={{ width: 200, padding: 12 }} />
// ❌ 颜色
<div style={{ color: '#10b981' }} />
```

CSS 变量桥接的判定：`style={{}}` 内**所有 key 必须以 `--` 开头**。Stylelint / 自检脚本据此机械检测。

---

## 4. 三层架构

```
┌────────────────────────── L1 · 作者层 (TypeScript) ────────────────────────┐
│  唯一允许写颜色字面量的地方                                                │
│                                                                            │
│   theme/palettes/*.ts        ◄── 色板原料 (zinc / slate / blue / ...)      │
│           │                                                                │
│           ▼                                                                │
│   theme/themes/*.ts          ◄── 语义主题 (dark-emerald, light-business)   │
│           │                                                                │
│           ▼ SemanticTokens (强类型)                                        │
└───────────┬────────────────────────────────────────────────────────────────┘
            │
┌───────────▼─────────────── L2 · 编译层 (纯函数) ───────────────────────────┐
│                                                                            │
│   themeToCssVars(theme)    → Record<`--token-${string}`, string>           │
│   themeToAntdConfig(theme) → ThemeConfig (Antd v6)                         │
│                                                                            │
└───────────┬───────────────────────────────────────┬────────────────────────┘
            │                                       │
┌───────────▼─────────── L3 · 运行时 (ThemeProvider) ▼───────────────────────┐
│                                                                            │
│   set CSS vars on :root   ──┐         feed to <ConfigProvider>             │
│                             │                  │                           │
└─────────────────────────────┼──────────────────┼───────────────────────────┘
                              │                  │
              ─────────────── │ ─────────────────┼─────────────
                              │                  │
                ┌─────────────┼──────────┐       │
                ▼             ▼          ▼       ▼
            ┌───────┐    ┌───────┐  ┌────────┐ ┌──────┐
L4 ·        │ SCSS  │    │ Tail- │  │ JS     │ │ Antd │
消费层      │ +     │    │ wind  │  │ chart/ │ │ comp │
（仅 4 类） │ Module│    │ class │  │ canvas │ │      │
            └───┬───┘    └───┬───┘  └────┬───┘ └──┬───┘
                │            │           │        │
                └────────────┴───────────┘        │
                            ▼                     ▼
                  全部只读 var(--token-*)   ConfigProvider 自动重渲染
```

### 各层契约

| 层 | 输入 | 输出 | 谁可以改 |
|---|---|---|---|
| L1 Palette | — | hex 常量 | 设计师（PR 评审） |
| L1 Theme | Palette | `SemanticTokens` 对象 | 同上 |
| L2 Compile | `SemanticTokens` | CssVarMap + AntdConfig | 不需要改（纯函数稳定） |
| L3 Provider | active theme id | 副作用（DOM + Antd） | 不需要改 |
| L4 消费 | `var(--token-*)` 或 `useThemeValue()` | UI | 业务代码，**只读** |

---

## 5. 命名规范

### 5.1 CSS 变量命名空间

**唯一前缀：`--token-`**。

```
--token-bg-app           背景：最深
--token-bg-surface       背景：表面
--token-bg-elevated      背景：悬浮
--token-bg-card          背景：卡片
--token-bg-hover         背景：hover

--token-border-base      边框：主
--token-border-subtle    边框：次
--token-border-focus     边框：焦点

--token-text-primary     文字：主
--token-text-secondary   文字：次
--token-text-tertiary    文字：辅
--token-text-muted       文字：弱

--token-accent-base      品牌色
--token-accent-hover
--token-accent-glow

--token-status-success
--token-status-info
--token-status-warning
--token-status-error

--token-radius-sm/base/lg
--token-shadow-sm/md/lg/glow
--token-space-xs/sm/md/lg/xl
--token-z-base/modal/dropdown/tooltip
--token-overlay-on-bg    叠层方向（亮主题=black-alpha，暗主题=white-alpha）
```

### 5.2 SemanticTokens 类型（封闭集合）

```ts
// frontend/src/theme/types.ts
export interface SemanticTokens {
  bg: { app: string; surface: string; elevated: string; card: string; hover: string };
  border: { base: string; subtle: string; focus: string };
  text: { primary: string; secondary: string; tertiary: string; muted: string };
  accent: { base: string; hover: string; glow: string };
  status: { success: string; info: string; warning: string; error: string };
  radius: { sm: number; base: number; lg: number };
  shadow: { sm: string; md: string; lg: string; glow: string };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  z: { base: number; modal: number; dropdown: number; tooltip: number };
  overlay: { onBg: string };
}
```

加新 token = 改 `SemanticTokens` 类型 → CI 强制全部 4 套主题对齐。

---

## 6. 各技术栈消费规则

### 6.1 SCSS / SCSS Modules

**所有自定义样式都写在 `.scss` / `.module.scss` 里。** 全文件中：

- 颜色 / 圆角 / 阴影 / 间距：必须 `var(--token-*)`，禁止 hex / rgb / hsl 字面量
- 嵌套 / mixin / `@use`：放心用（这就是 SCSS 的价值）

```scss
// ShotCard.module.scss
@use 'sass:math';

.shotCard {
  background: var(--token-bg-card);
  border: 1px solid var(--token-border-subtle);
  border-radius: calc(var(--token-radius-base) * 1px);
  color: var(--token-text-primary);
  padding: calc(var(--token-space-md) * 1px);

  &:hover {
    background: var(--token-bg-hover);
    border-color: var(--token-border-base);
  }

  &.isActive {
    border-color: var(--token-border-focus);
    box-shadow: var(--token-shadow-glow);
  }
}
```

```tsx
// ShotCard.tsx
import styles from './ShotCard.module.scss';
<div className={cn(styles.shotCard, active && styles.isActive)} />
```

### 6.2 Tailwind v4

**只在 JSX `className` 里使用工具类组合。** SCSS 文件内**禁止** `@apply`（保持两套技术栈职责清晰）。

```tsx
// 简单布局：Tailwind 工具类（首选，零样式文件）
<div className="flex items-center gap-2 px-3 py-2">
  <Icon /><span>label</span>
</div>

// 复杂状态 / 嵌套 / 主题分支：SCSS Module（首选）
<div className={styles.complexCard} />
```

**禁止**：
- `bg-[#10b981]` / `text-[#fff]` 等含 hex 的 arbitrary value（绕过主题）
- `bg-[var(--token-bg-app)]` 这种"伪绕路"也禁止 —— 应使用 Tailwind v4 `@theme` 的语义类

`index.css` 改造为纯转发层：

```css
/* index.css */
@import "tailwindcss";

@theme {
  /* @theme 里只做 Tailwind 工具类 → CSS 变量的映射，不持有真实值 */
  --color-bg-app: var(--token-bg-app);
  --color-bg-surface: var(--token-bg-surface);
  --color-bg-elevated: var(--token-bg-elevated);
  --color-text-primary: var(--token-text-primary);
  --color-text-secondary: var(--token-text-secondary);
  --color-accent: var(--token-accent-base);
  --color-status-success: var(--token-status-success);
  --color-status-error: var(--token-status-error);
  --radius: var(--token-radius-base);
  --radius-sm: var(--token-radius-sm);
  --radius-lg: var(--token-radius-lg);
}

/* SSR / 首屏闪屏兜底默认值（仅默认主题） */
:root {
  --token-bg-app: #09090b;
  --token-bg-surface: #18181b;
  /* ... 默认主题完整快照 */
}
```

JSX 里写 `bg-bg-app` / `text-text-primary` / `rounded-base` 这类语义工具类，主题切换自动跟随。

### 6.3 TypeScript（chart / canvas / react-flow）

```ts
// theme/runtime/useThemeValue.ts
export function useThemeValue<K extends keyof SemanticTokens, P extends keyof SemanticTokens[K]>(
  scope: K, key: P,
): SemanticTokens[K][P] {
  const { theme } = useTheme();
  return theme.tokens[scope][key];
}
```

```tsx
// react-flow Background 颜色
const dotColor = useThemeValue('text', 'muted');
<Background color={dotColor} />

// ECharts 配色
const accentBase = useThemeValue('accent', 'base');
const option = useMemo(() => ({ color: [accentBase, ...] }), [accentBase]);
```

**禁止**：
- 业务文件 `import { tokens } from '@/theme/tokens'` 直接读
- `getComputedStyle(document.documentElement).getPropertyValue('--token-xxx')` DOM 抓取
- 字面量颜色 `'#10b981'` 出现在业务 tsx

### 6.4 Antd

```ts
// theme/compile/themeToAntdConfig.ts
export function themeToAntdConfig(t: SemanticTokens, mode: 'dark' | 'light'): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: t.accent.base,
      colorBgContainer: t.bg.surface,
      borderRadius: t.radius.base,
      // ...严格映射，不写字面量
    },
  };
}
```

`<ConfigProvider>` **只在 `ThemeProvider` 内出现 1 次**。业务代码内嵌 ConfigProvider 改局部颜色 → CI 拒绝。

### 6.5 dark-only 运行时 flag

```tsx
// ❌ 旧
<ReactFlow colorMode="dark" />
<ScriptEditor darkTheme={true} />

// ✅ 新
const { theme } = useTheme();
<ReactFlow colorMode={theme.meta.mode} />
<ScriptEditor darkTheme={theme.meta.mode === 'dark'} />
```

---

## 7. inline style 迁移规则

实测 492 处 inline style，按用途分四档处理：

### 档 1：纯布局值（margin / padding / width / fontSize）— **首选 Tailwind 工具类**

```tsx
// ❌ 旧
<div style={{ marginTop: 16, padding: 12, width: 320 }} />

// ✅ 新
<div className="mt-4 p-3 w-80" />
```

### 档 2：含颜色 / 复杂样式 — **必须移到 SCSS module**

```tsx
// ❌ 旧
<div style={{ color: '#10b981', borderTop: '1px solid #27272a' }} />

// ✅ 新
import styles from './X.module.scss';
<div className={styles.divider} />
```

```scss
// X.module.scss
.divider {
  color: var(--token-accent-base);
  border-top: 1px solid var(--token-border-subtle);
}
```

### 档 3：动态值（依赖 props / state）— **CSS 变量桥接**

```tsx
// ❌ 旧
<div style={{ width: `${progress}%`, opacity: progress / 100 }} />

// ✅ 新
import styles from './X.module.scss';
<div
  className={styles.progress}
  style={{
    '--progress': `${progress}%`,
    '--opacity': String(progress / 100),
  } as CSSProperties}
/>
```

```scss
.progress {
  width: var(--progress);
  opacity: var(--opacity);
  background: var(--token-accent-base);
  transition: width 200ms, opacity 200ms;
}
```

### 档 4：第三方库强制 inline（白名单）

少量第三方组件（如 `react-virtuoso` 的 `style` 必须传给宿主）允许保留 inline，但仅限传**布局结构值**（`{ flex: 1, height: '100%' }`），不可含颜色。维护一份白名单文件 `docs/INLINE_STYLE_EXCEPTIONS.md`，CI 仅放行白名单里的文件。

---

## 8. 数据流：主题切换的传播路径

```
User clicks "商务明亮" in 设置
        │
        ▼
themeProvider.setTheme('light-business')
        │
        ├──► persistence.save('light-business')
        │
        ├──► const next = themes['light-business']
        │
        ├──► const cssVars = themeToCssVars(next.tokens)
        │       │
        │       └──► for each [k, v]:
        │              document.documentElement.style.setProperty(k, v)
        │       (CSS 变量 cascade，所有 var(--token-*) 消费方瞬间更新)
        │       (Tailwind 工具类、SCSS module 全部跟随)
        │
        ├──► const antdConfig = themeToAntdConfig(next.tokens, next.meta.mode)
        │       └──► <ConfigProvider theme={antdConfig}> re-renders
        │              所有 Antd 组件接收新 token 重新计算样式
        │
        ├──► setActiveTheme(next)  (Context state)
        │       └──► useTheme / useThemeValue 消费方重渲染
        │              chart / canvas / react-flow 跟随
        │
        └──► document.documentElement.dataset.theme = 'light-business'
                CSS 可用 [data-theme="light-business"] .xxx { ... } 做主题特例
```

---

## 9. 防腐边界（lint / CI）

### 9.1 Stylelint 规则

```js
// .stylelintrc.cjs
module.exports = {
  customSyntax: 'postcss-scss',
  rules: {
    // 颜色字面量只允许在 theme 目录
    'color-no-hex': [true, {
      severity: 'error',
      ignoreFiles: ['**/theme/palettes/**', '**/theme/themes/**'],
    }],
    'color-named': ['never', { ignoreFiles: ['**/theme/**'] }],
    // 禁止在 @theme 块写 hex
    'declaration-property-value-disallowed-list': {
      '/^--color-/': ['/#[0-9a-fA-F]/'],
    },
  },
};
```

### 9.2 ESLint 规则

```js
// .eslintrc.cjs
module.exports = {
  rules: {
    // 禁止业务 tsx 写 inline style 含字面量值（仅放行 CSS 变量桥接）
    'react/forbid-component-props': ['error', {
      forbid: [{
        propName: 'style',
        allowedFor: [],   // 默认全禁
        message: '禁止 inline style；动态值用 CSS 变量桥接，静态值移到 SCSS module',
      }],
    }],
  },
  overrides: [{
    files: ['**/theme/**'], rules: { 'react/forbid-component-props': 'off' },
  }],
};
```

补充自定义 ESLint plugin（`eslint-plugin-koma-theme-discipline`）做更精细检测：
- 检测 `style={{}}` 表达式：所有 key 是否以 `--` 开头，否则报错
- 检测 `'#xxxxxx'` 字符串字面量在非 theme 目录的引用

### 9.3 自检脚本 `scripts/check-style-discipline.ts`

```ts
// CI 跑，违反则非零退出
const checks = [
  { name: 'plain-css',     pattern: /\.css$/, exclude: /\.module\.scss$/, exclude2: /\.scss$/ },
  { name: 'inline-style-literal', glob: 'src/**/*.tsx', regex: /style=\{\{[^}]*[^-]:/ },
  { name: 'tailwind-arbitrary-hex', glob: 'src/**/*.tsx', regex: /\[#[0-9a-fA-F]{3,6}\]/ },
  { name: 'dark-flag-literal', glob: 'src/**/*.tsx', regex: /(colorMode="dark"|darkTheme=\{true\})/ },
  { name: 'business-import-tokens', glob: 'src/**/*.{ts,tsx}', exclude: 'src/theme/**', regex: /from ['"].*\/theme\/tokens['"]/ },
];
```

### 9.4 类型保险

`useThemeValue<K, P>` 泛型限定，传 `('bg', 'apple')` TS 报错 → 不存在的 token 名根本写不出来。

### 9.5 PR 门槛

- 改 `SemanticTokens` 类型 → CI 比对 4 套主题文件 keys 必须齐全
- 加新主题 = 新增 1 个文件 + 注册一处 → 不允许动其它代码
- 业务 PR 触发 §9.1-9.3 lint / 自检；违反 = 不能合

---

## 10. 目录结构

```
frontend/src/theme/
├── types.ts                    # SemanticTokens / Theme / ThemeId 类型
├── index.ts                    # 公共出口
│
├── palettes/                   # L1 色板（hex 字面量唯一允许处之一）
│   ├── zinc.ts
│   ├── slate.ts
│   ├── blue.ts
│   ├── emerald.ts
│   └── amber.ts
│
├── themes/                     # L1 主题（SemanticTokens 实例，hex 字面量唯一允许处之二）
│   ├── dark-emerald.ts         # 当前默认
│   ├── dark-business.ts
│   ├── light-business.ts
│   └── high-contrast.ts
│
├── compile/                    # L2 编译（纯函数，单测）
│   ├── themeToCssVars.ts
│   ├── themeToAntdConfig.ts
│   ├── varNames.ts             # 命名空间常量集中处
│   └── *.test.ts
│
├── runtime/                    # L3 运行时
│   ├── ThemeProvider.tsx
│   ├── useTheme.ts
│   ├── useThemeValue.ts
│   ├── persistence.ts
│   └── ssrFallback.ts
│
└── README.md
```

---

## 11. 三个反模式（强制规避）

### ❌ 反模式 1：业务组件 import tokens 直接读值

```ts
// 错：绕开 Provider，主题切换不响应
import { tokens } from '@/theme/tokens';
const bg = tokens.colors.bg.app;

// 对：响应主题
const bg = useThemeValue('bg', 'app');
```

### ❌ 反模式 2：业务组件嵌 ConfigProvider 改局部颜色

```tsx
// 错：破坏全局统一
<ConfigProvider theme={{ token: { colorPrimary: '#ff0000' } }}>
  <Button>红按钮</Button>
</ConfigProvider>

// 对：用语义档位
<Button danger>红按钮</Button>
```

### ❌ 反模式 3：CSS / SCSS 里硬编码 alpha 透明色

```scss
// 错：alpha 与背景耦合，亮模式下变浊
.card { background: rgba(63, 63, 70, 0.7); }

// 对：用语义叠层 token，主题决定方向
.card {
  background: var(--token-bg-card);
  &::before {
    content: '';
    background: var(--token-overlay-on-bg);  // 暗:white-alpha, 亮:black-alpha
  }
}
```

---

## 12. 验收清单

| 项 | 通过标准 |
|---|---|
| 业务文件 grep `#[0-9a-fA-F]{3,6}` | < 50（基线 889） |
| `find -name "*.css"` 排除 `.scss` | 0（全部 .scss / .module.scss） |
| 业务 tsx grep `style={{` 含非 `--` 开头 key | 0（仅 CSS 变量桥接 + 白名单） |
| Tailwind 含 hex arbitrary value `[#xxx]` | 0 |
| 业务 tsx grep `colorMode="dark"` / `darkTheme={true}` | 0 |
| 非 `theme/` 目录 import `tokens` | 0 |
| Stylelint / ESLint / 自检脚本 全过 | ✓ |
| 4 套主题切换 4 关键页（分镜/设置/编辑器/资产）截图无错位 | ✓ |
| 加第 5 套主题 = 新增 1 个 `themes/*.ts`，无其它改动 | ✓ |

---

## 13. 一句话总结

> **TS 写值，CSS 变量分发，SCSS + Tailwind 各取所需；inline style 只能传 CSS 变量，普通 CSS 文件全部消失。**
