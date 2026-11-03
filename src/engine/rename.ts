/**
 * Batch rename patterns, ported from PicKit for Windows (Files/RenameEngine.cs).
 * Tokens: {name} (or {original}), {number}, {date}, {width}, {height}. Nothing on disk is
 * renamed: PicKit hands out new files with the new names, and the originals stay as they were.
 */
export interface RenameRule {
  pattern: string;
  start: number;
  padding: number;
}

export interface RenameSource {
  name: string;
  lastModified?: number;
  width?: number;
  height?: number;
}

export interface RenamePreview {
  oldName: string;
  newName: string;
  problem: string | null;
}

const MAX_NAME = 240;
// Characters iOS Files, macOS and Windows won't all accept.
const INVALID = /[/\\:*?"<>|\u0000-\u001f]/;

export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function isoDate(ms?: number) {
  const d = new Date(ms ?? Date.now());
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function buildName(file: RenameSource, rule: RenameRule, index: number, extOverride?: string): string {
  const { stem, ext } = splitName(file.name);
  const number = String(rule.start + index).padStart(Math.min(9, Math.max(1, rule.padding)), '0');
  const name = rule.pattern
    .replace(/\{name\}/gi, stem)
    .replace(/\{original\}/gi, stem)
    .replace(/\{number\}/gi, number)
    .replace(/\{date\}/gi, isoDate(file.lastModified))
    .replace(/\{width\}/gi, file.width ? String(file.width) : '')
    .replace(/\{height\}/gi, file.height ? String(file.height) : '');
  return name + (extOverride ?? ext);
}

export function checkName(name: string): string | null {
  const { stem } = splitName(name);
  if (!stem.trim()) return 'The name is empty.';
  if (INVALID.test(name)) return 'The name contains a character that isn’t allowed in file names.';
  if (name.startsWith('.')) return 'A name can’t start with a dot.';
  if (/[ .]$/.test(stem) || name.endsWith(' ')) return 'A name can’t end with a space or dot.';
  if (name.length > MAX_NAME) return 'The name is too long.';
  return null;
}

/** Works out every new name and checks each one. A set can only be used if none has a problem. */
export function previewRenames(files: RenameSource[], rule: RenameRule, extOverride?: (f: RenameSource) => string | undefined): RenamePreview[] {
  const names = files.map((f, i) => buildName(f, rule, i, extOverride?.(f)));
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) ?? 0) + 1);
  return files.map((f, i) => {
    const n = names[i];
    const problem = checkName(n) ?? ((counts.get(n.toLowerCase()) ?? 0) > 1 ? 'More than one file would get this name.' : null);
    return { oldName: f.name, newName: n, problem };
  });
}

/** Sorts the way Files and Finder do, so "2.jpg" comes before "10.jpg". */
export function naturalSort<T>(items: T[], key: (t: T) => string): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => collator.compare(key(a), key(b)));
}

/** Makes `name` unique among `taken` by adding " 2", " 3"... before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const { stem, ext } = splitName(name);
  for (let i = 2; ; i++) {
    const n = `${stem} ${i}${ext}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}
