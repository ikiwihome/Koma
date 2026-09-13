#!/usr/bin/env node
/**
 * 把 JSX/TSX 里写死的 Tailwind 调色板类（bg-zinc-* / text-zinc-* / border-zinc-* / *-emerald-*）
 * 批量替换为 @theme 暴露的语义类（bg-bg-* / text-text-* / border-border* / *-accent*），
 * 保证主题切换时这些 class 跟随 token 走，不再泄漏成"亮色页面里夹深色块"。
 *
 * 用法:
 *   node scripts/migrate-tailwind-to-tokens.mjs            # dry-run 列出每文件改动数
 *   node scripts/migrate-tailwind-to-tokens.mjs --write    # 实际写入文件
 *
 * 安全策略:
 *   - 只对 .tsx 文件操作；
 *   - 用单词边界 \b 匹配，避免误伤 `bg-zinc-900px` 之类的伪命中；
 *   - 不动 text-white / text-black / bg-black / bg-white （多为 overlay / 在 accent 上的对比文字，与主题无关）；
 *   - 不动 bg-red-* / text-red-* / bg-emerald-900/X 这类语义状态色，避免破坏 status badge 含义。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'src');
const WRITE = process.argv.includes('--write');

/** 替换规则。键名 = 旧 class（精确），值 = 新 class。
 *  对每条规则：构造正则 /\b(prefix-)?old\b/g，prefix 形如 hover: / focus: / group-hover: / disabled: / peer-hover: / active: ，
 *  用 $1 保留 prefix。这样 hover:bg-zinc-800 也命中同一条规则。*/
const COLOR_MAP = {
  // 背景：zinc 深色 → 语义 bg
  'bg-zinc-950': 'bg-bg-app',
  'bg-zinc-900': 'bg-bg-surface',
  'bg-zinc-800': 'bg-bg-elevated',
  'bg-zinc-700': 'bg-bg-hover',
  'bg-zinc-600': 'bg-bg-hover',
  'bg-zinc-500': 'bg-bg-hover',
  'bg-gray-50':  'bg-bg-app',

  // 文字：zinc 系
  'text-zinc-100': 'text-text-primary',
  'text-zinc-200': 'text-text-primary',
  'text-zinc-300': 'text-text-secondary',
  'text-zinc-400': 'text-text-secondary',
  'text-zinc-500': 'text-text-tertiary',
  'text-zinc-600': 'text-text-muted',
  'text-zinc-700': 'text-text-muted',
  'text-gray-400': 'text-text-secondary',
  'text-gray-500': 'text-text-tertiary',

  // placeholder
  'placeholder-zinc-600': 'placeholder-text-muted',

  // 边框：zinc 系
  'border-zinc-800': 'border-border-subtle',
  'border-zinc-700': 'border-border',
  'border-zinc-600': 'border-border',
  'border-zinc-500': 'border-border',
  'border-zinc-400': 'border-border',

  // 品牌色 emerald → accent (仅替换 base / hover；emerald-900 alpha 用作 status 不动)
  'bg-emerald-500': 'bg-accent',
  'bg-emerald-600': 'bg-accent-hover',
  'text-emerald-400': 'text-accent',
  'text-emerald-500': 'text-accent',
  'text-emerald-300': 'text-accent',
  'border-emerald-500': 'border-accent',
  'border-emerald-600': 'border-accent',
  'border-emerald-400': 'border-accent',
  'border-l-emerald-500': 'border-l-accent',
  'border-l-emerald-600': 'border-l-accent',
  'ring-emerald-500': 'ring-accent',
  'ring-emerald-500/20': 'ring-accent/20',
  'ring-emerald-500/30': 'ring-accent/30',
  'shadow-emerald-500': 'shadow-accent',
  'shadow-emerald-500/5': 'shadow-accent/5',
  'shadow-emerald-500/10': 'shadow-accent/10',
  'shadow-emerald-900/30': 'shadow-accent/15',
  'shadow-emerald-900/40': 'shadow-accent/20',
  'border-emerald-900/50': 'border-accent/30',
  'border-emerald-800/50': 'border-accent/30',
  'focus:border-emerald-600': 'focus:border-accent',
  'hover:border-emerald-400': 'hover:border-accent',
  'hover:border-emerald-600': 'hover:border-accent',
  'hover:ring-emerald-500': 'hover:ring-accent',
  'from-emerald-500': 'from-accent',
  'to-emerald-700': 'to-accent-hover',
  'to-emerald-600': 'to-accent-hover',

  // 状态色：写死的蓝/红/橙/绿 → status-* 语义类。
  // 这些颜色在 dark 主题下挑了 400/500 档（浅亮文字），在 light 主题下挑 600/700 档（深文字），
  // 通过 Token 解耦让对比度自动适配。
  'text-blue-400': 'text-status-info',
  'text-blue-500': 'text-status-info',
  'text-blue-300': 'text-status-info',
  'text-red-400': 'text-status-error',
  'text-red-500': 'text-status-error',
  'text-red-300': 'text-status-error',
  'text-orange-400': 'text-status-warning',
  'text-orange-500': 'text-status-warning',
  'text-yellow-400': 'text-status-warning',
  'text-yellow-500': 'text-status-warning',
  'text-amber-400': 'text-status-warning',
  'text-amber-500': 'text-status-warning',
  'text-green-400': 'text-status-success',
  'text-green-500': 'text-status-success',
  'text-green-300': 'text-status-success',

  // status badge 的暗色 alpha 软底 → status-* 半透明
  'bg-blue-900/50': 'bg-status-info/15',
  'bg-blue-900/30': 'bg-status-info/12',
  'bg-blue-900/20': 'bg-status-info/10',
  'bg-red-900/50': 'bg-status-error/15',
  'bg-red-900/40': 'bg-status-error/14',
  'bg-red-900/30': 'bg-status-error/12',
  'bg-red-900/20': 'bg-status-error/10',
  'bg-orange-900/50': 'bg-status-warning/15',
  'bg-orange-900/30': 'bg-status-warning/12',
  'bg-green-900/50': 'bg-status-success/15',
  'bg-green-900/40': 'bg-status-success/14',
  'bg-green-900/30': 'bg-status-success/12',

  // 边框 status
  'border-red-500': 'border-status-error',
  'border-red-600': 'border-status-error',
  'border-red-400': 'border-status-error',
  'border-blue-500': 'border-status-info',
  'border-blue-400': 'border-status-info',
  'border-blue-800/50': 'border-status-info/30',
  'border-orange-800/50': 'border-status-warning/30',
  'border-purple-800/50': 'border-status-info/30',

  // bg-red-* 实色按钮（错误/删除）→ status-error；on text 用 onStatus
  'bg-red-500': 'bg-status-error',
  'bg-red-600': 'bg-status-error',
  'hover:bg-red-500': 'hover:bg-status-error',
  'hover:bg-red-600': 'hover:bg-status-error',
  // bg-red-X/Y alpha 软底
  'bg-red-500/80': 'bg-status-error/80',
  'bg-red-500/90': 'bg-status-error/90',

  // bg-cyan-* 是次级强调蓝（视频/时间线 / 转场预览）→ 收敛到 status-info
  'bg-cyan-500': 'bg-status-info',
  'bg-cyan-600': 'bg-status-info',
  'hover:bg-cyan-500': 'hover:bg-status-info',
  'hover:bg-cyan-600': 'hover:bg-status-info',
  'bg-cyan-500/30': 'bg-status-info/15',
  'bg-cyan-500/90': 'bg-status-info',
  'border-cyan-500': 'border-status-info',
  'border-cyan-400': 'border-status-info',
  'border-cyan-500/30': 'border-status-info/30',
  'border-cyan-500/50': 'border-status-info/50',
  'hover:border-cyan-600': 'hover:border-status-info',
  'text-cyan-200': 'text-status-info',
  'text-cyan-300': 'text-status-info',
  'text-cyan-400': 'text-status-info',
  'hover:text-cyan-300': 'hover:text-status-info',
  'ring-blue-500': 'ring-status-info',

  // ring-2 ring-blue-500 类型为 focus / drop indicator → ring-status-info

  // text-white / hover:text-white：除媒体覆盖外，多数应该跟主题
  // —— 媒体上的 text-white（bg-black/X 旁）放到白名单脚本人工豁免
  // —— hover:text-white（菜单/按钮）统一改 hover:text-text-primary
  'hover:text-white': 'hover:text-text-primary',

  // form 原生 accent-color（input range / checkbox 等）→ status / accent
  'accent-cyan-500': 'accent-status-info',
  'accent-blue-500': 'accent-status-info',
  'accent-orange-500': 'accent-status-warning',
  'accent-purple-500': 'accent-accent',

  // bg-cyan-400 系列：时间线 playhead / resize handle / 转场预览
  'bg-cyan-400': 'bg-status-info',
  'bg-cyan-400/12': 'bg-status-info/15',
  'bg-cyan-400/50': 'bg-status-info/50',

  // bg-orange-* 系列：警告/隐藏状态徽章
  'bg-orange-500': 'bg-status-warning',
  'bg-orange-500/15': 'bg-status-warning/15',
  'bg-orange-500/20': 'bg-status-warning/20',
  'border-orange-500/50': 'border-status-warning/50',
  'border-orange-500/45': 'border-status-warning/45',
  'text-orange-200': 'text-status-warning',
  'text-orange-300': 'text-status-warning',

  // bg-green-400/X 时间线波形
  'bg-green-400/50': 'bg-status-success/50',

  // ring 颜色（focus / drop indicator）
  'ring-red-500/50': 'ring-status-error/50',
  'ring-cyan-500/20': 'ring-status-info/20',
  'ring-cyan-500/50': 'ring-status-info/50',
};

/** Tailwind 修饰前缀，统一 prefix-:base-class 的形式 */
const PREFIX_PATTERN = '(?:hover|focus|active|disabled|group-hover|group-focus|peer-hover|peer-focus|focus-visible|focus-within|aria-selected|aria-expanded|data-\\[[^\\]]+\\]|md|sm|lg|xl|2xl|dark|first|last|odd|even):';

/** 收集所有 .tsx 文件 */
function collectTsx(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectTsx(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
}

const files = [];
collectTsx(ROOT, files);

let totalReplacements = 0;
let totalFilesChanged = 0;
const perFileReport = [];

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  let fileReplacements = 0;
  let report = '';

  for (const [oldClass, newClass] of Object.entries(COLOR_MAP)) {
    // 匹配：可选前缀 + 老 class，前后是空白 / 引号 / 反引号 / `}` / `${` 之类的非字符
    // 用 lookbehind / lookahead 限定单词边界（Tailwind class 名都由 字母/数字/-/: / [ / ] 组成）
    const escapedOld = oldClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_-])((?:${PREFIX_PATTERN})*)${escapedOld}(?![A-Za-z0-9_-])`, 'g');
    src = src.replace(re, (_, prefix) => {
      fileReplacements += 1;
      return prefix + newClass;
    });
  }

  if (fileReplacements > 0) {
    perFileReport.push({ file: path.relative(path.resolve(__dirname, '..'), file), count: fileReplacements });
    totalReplacements += fileReplacements;
    totalFilesChanged += 1;
    if (WRITE) fs.writeFileSync(file, src, 'utf8');
  }
}

perFileReport.sort((a, b) => b.count - a.count);
for (const { file, count } of perFileReport.slice(0, 30)) {
  console.log(`${String(count).padStart(4)}  ${file}`);
}
if (perFileReport.length > 30) {
  console.log(`...  (and ${perFileReport.length - 30} more files)`);
}
console.log('---');
console.log(`Total: ${totalReplacements} replacements across ${totalFilesChanged} files.`);
console.log(WRITE ? '✓ Files written.' : '(dry run; pass --write to apply)');
