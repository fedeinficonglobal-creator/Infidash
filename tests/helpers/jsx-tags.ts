import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function listTsx(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...listTsx(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

export function toPosix(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

export interface OpeningTag {
  name: string;
  text: string;
  line: number;
}

/**
 * Minimal JSX opening-tag tokenizer: finds `<name ...>` and tracks braces and
 * quotes so `>` inside attribute expressions (arrows, generics) does not end the tag.
 */
export function openingTags(source: string): OpeningTag[] {
  const tags: OpeningTag[] = [];
  const pattern = /<([a-z][a-zA-Z0-9]*)(?=[\s>/])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (depth === 0 && (ch === '"' || ch === "'")) quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '`' && depth > 0) {
        // template literal inside an expression
        i += 1;
        while (i < source.length && source[i] !== '`') i += 1;
      } else if (ch === '>' && depth <= 0) break;
    }
    const line = source.slice(0, match.index).split('\n').length;
    tags.push({ name: match[1], text: source.slice(match.index, i + 1), line });
    pattern.lastIndex = match.index + match[0].length;
  }
  return tags;
}

export function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}
