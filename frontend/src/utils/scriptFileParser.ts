/**
 * 剧本 / 字幕文件解析器
 *
 * 把上传的文件读成纯文本（按行），再按格式提取台词/正文：
 * - .srt   SubRip：去掉序号 + 时间码 → 保留台词行
 * - .vtt   WebVTT：跳过 WEBVTT 头、NOTE/STYLE/REGION 块、时间码 → 保留台词行
 * - .lrc   Lyrics：去掉 [mm:ss.xx] 时间标签和元数据标签
 * - .ass / .ssa  Advanced SubStation Alpha：取 [Events] 段 Dialogue: 行最后一个文本字段，
 *           去掉 \\N / {\\xxx} 样式占位符
 * - .txt / .md  纯文本：原样返回（去 BOM）
 *
 * 返回：解析结果 + 元信息（行数 / 检测到的格式 / 是否被识别为字幕）
 */

export type ScriptFileFormat = 'srt' | 'vtt' | 'lrc' | 'ass' | 'plain';

export interface ParsedScriptFile {
  text: string;
  format: ScriptFileFormat;
  /** 解析后非空行数 */
  lineCount: number;
  /** 是否识别为已知字幕格式（vs 纯文本兜底） */
  recognized: boolean;
}

/** 移除 UTF-8 BOM */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 时间码识别：SRT/VTT 通用 `00:00:00,000 --> 00:00:00,000` 或 `00:00:00.000 --> 00:00:00.000` */
const TIMECODE_RE = /^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}/;
/** SRT 单纯序号行 */
const PURE_INDEX_RE = /^\s*\d+\s*$/;
/** LRC 时间标签 `[mm:ss.xx]` 或 `[mm:ss]` */
const LRC_TIMECODE_RE = /^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g;
/** LRC 元数据标签 `[ar:xxx]` `[ti:xxx]` 等 */
const LRC_META_RE = /^\[(?:ar|al|ti|au|by|offset|re|ve|length|tool):[^\]]*\]\s*$/i;

function detectFormatByExt(filename: string): ScriptFileFormat {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'lrc') return 'lrc';
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  return 'plain';
}

function detectFormatByContent(text: string): ScriptFileFormat | null {
  const head = text.slice(0, 800);
  if (/^\s*WEBVTT\b/m.test(head)) return 'vtt';
  if (/^\[Script Info\]/im.test(head) || /^\[Events\]/im.test(head)) return 'ass';
  // SRT 最强信号：前 800 字符里至少出现一次时间码
  if (TIMECODE_RE.test(head) || /\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(head)) return 'srt';
  // LRC 至少一行是 [mm:ss.xx] 开头
  if (/^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/m.test(head)) return 'lrc';
  return null;
}

function parseSrt(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (PURE_INDEX_RE.test(line)) continue;
    if (TIMECODE_RE.test(line)) continue;
    out.push(line);
  }
  return out;
}

function parseVtt(text: string): string[] {
  const out: string[] = [];
  let inSkipBlock = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      inSkipBlock = false;
      continue;
    }
    if (/^WEBVTT\b/.test(line)) continue;
    // NOTE / STYLE / REGION 块：跳过整个块直到空行
    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
      inSkipBlock = true;
      continue;
    }
    if (inSkipBlock) continue;
    if (TIMECODE_RE.test(line)) continue;
    if (PURE_INDEX_RE.test(line)) continue;
    // 简单去掉行内 <c> / <i> 等 cue tag
    out.push(line.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim());
  }
  return out.filter(Boolean);
}

function parseLrc(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (LRC_META_RE.test(line)) continue;
    // 一行可能有多个时间标签（多翻译）— 一并去掉
    line = line.replace(LRC_TIMECODE_RE, '').trim();
    if (!line) continue;
    out.push(line);
  }
  return out;
}

function parseAss(text: string): string[] {
  const out: string[] = [];
  let inEvents = false;
  let formatFields: string[] | null = null;
  let textFieldIdx = -1;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[/.test(line)) {
      inEvents = /^\[Events\]/i.test(line);
      formatFields = null;
      textFieldIdx = -1;
      continue;
    }
    if (!inEvents) continue;
    if (/^Format:/i.test(line)) {
      formatFields = line.replace(/^Format:\s*/i, '').split(',').map(s => s.trim());
      textFieldIdx = formatFields.findIndex(f => /^text$/i.test(f));
      continue;
    }
    if (/^Dialogue:/i.test(line) && formatFields && textFieldIdx >= 0) {
      const body = line.replace(/^Dialogue:\s*/i, '');
      // ASS 的 Text 字段在 Format 顺序中排最后；前面其它字段都是逗号分隔，
      // 但 Text 自身可能含逗号 — 按 split(',', textFieldIdx) 把 Text 之前部分裁掉
      const parts = body.split(',');
      if (parts.length <= textFieldIdx) continue;
      let textValue = parts.slice(textFieldIdx).join(',');
      // 去样式占位 `{\\xxx}` 与硬换行 \\N
      textValue = textValue
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\N/gi, ' ')
        .replace(/\\h/gi, ' ')
        .trim();
      if (textValue) out.push(textValue);
    }
  }
  return out;
}

function parsePlain(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.replace(/\s+$/g, '')).filter(line => line.length > 0);
}

function parseByFormat(format: ScriptFileFormat, text: string): string[] {
  switch (format) {
    case 'srt': return parseSrt(text);
    case 'vtt': return parseVtt(text);
    case 'lrc': return parseLrc(text);
    case 'ass': return parseAss(text);
    case 'plain': return parsePlain(text);
  }
}

/** 读取文件并按格式抽取纯文本（按行返回成 \n 分隔的文本） */
export async function parseScriptFile(file: File): Promise<ParsedScriptFile> {
  const raw = stripBom(await file.text());
  // 优先按内容嗅探（用户把 .srt 改名成 .txt 也能识别）；嗅探失败再按扩展名
  const detected = detectFormatByContent(raw);
  const fallback = detectFormatByExt(file.name);
  const format = detected || fallback;
  const lines = parseByFormat(format, raw);
  const text = lines.join('\n');
  return {
    text,
    format,
    lineCount: lines.length,
    recognized: format !== 'plain' || !!detected,
  };
}

export const SCRIPT_FILE_ACCEPT = '.srt,.vtt,.lrc,.ass,.ssa,.txt,.md,text/plain,text/markdown,application/x-subrip,text/vtt';
