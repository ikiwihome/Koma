const CODE_BLOCK_RE = /```(?:markdown|md|text)?\s*([\s\S]*?)\s*```/i;
const MARKDOWN_HEADING_RE = /^\s*#{1,6}\s*/;
const HORIZONTAL_RULE_RE = /^\s*([-*_])\1{2,}\s*$/;
const WRAPPER_PATTERNS = [
  /^当然可以[。！!]?/,
  /^以下是/,
  /^下面是/,
  /润色版/,
  /重点优化/,
  /保持原有故事结构/,
];
const SCRIPT_SIGNAL_PATTERNS = [
  /^\s*第[零一二三四五六七八九十百千两\d０-９]+\s*[集回话章节]/,
  /^\s*(?:episode|ep\.?|chapter|part|vol\.?)\s*\d+/i,
  /^\s*s\d+\s*e\d+/i,
  /^\s*\d{1,4}\s*[-—–]\s*\d{1,4}\b/,
  /^\s*人物[:：]/,
  /^\s*[^\s：:]{1,12}[:：]/,
];

function extractCodeBlock(text: string): string {
  const match = text.match(CODE_BLOCK_RE);
  return match ? match[1] : text;
}

function normalizeMarkdownLine(line: string): string {
  return line
    .replace(MARKDOWN_HEADING_RE, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1');
}

function isScriptSignal(line: string): boolean {
  return SCRIPT_SIGNAL_PATTERNS.some(pattern => pattern.test(line));
}

function removeLeadingWrappers(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0) {
    const line = trimmed[0].trim();
    if (!line) {
      trimmed.shift();
      continue;
    }
    if (isScriptSignal(line)) {
      break;
    }
    if (HORIZONTAL_RULE_RE.test(line) || WRAPPER_PATTERNS.some(pattern => pattern.test(line))) {
      trimmed.shift();
      continue;
    }
    break;
  }
  return trimmed;
}

export function normalizePolishedScriptOutput(text: string): string {
  const raw = extractCodeBlock(text).replace(/\r\n/g, '\n').trim();
  const normalizedLines = raw
    .split('\n')
    .map(normalizeMarkdownLine)
    .filter(line => !HORIZONTAL_RULE_RE.test(line.trim()));

  return removeLeadingWrappers(normalizedLines).join('\n').trim();
}

export function validatePolishedScriptOutput(text: string): string {
  const normalized = normalizePolishedScriptOutput(text);
  if (!normalized) {
    throw new Error('润色结果为空，未返回有效正文。');
  }

  const contentLines = normalized.split('\n').filter(line => line.trim());
  const hasSignal = contentLines.some(isScriptSignal);
  if (!hasSignal && contentLines.length < 3) {
    throw new Error('润色结果未返回有效正文，请重试。');
  }

  const firstLine = contentLines[0] || '';
  if (WRAPPER_PATTERNS.some(pattern => pattern.test(firstLine))) {
    throw new Error('润色结果包含说明文字，未自动应用。');
  }

  return normalized;
}
