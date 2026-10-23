/** `translation_format`: format arguments and input prompt tokens (`data` skill `### format`). */
import type { CoreData, SpecFormatArgument } from './corespec.ts';
import type { DataFolder } from './data.ts';
import type { Diagnostics, Place } from './diag.ts';
import { cellText, column, flatPlace, flatText } from './model.ts';
import { isSnakeCase } from './types.ts';
import type { TextEntry } from './translation.ts';

type Kind = SpecFormatArgument['kind'];

export interface Token {
  kind: 'argument' | 'prompt' | 'bad_prompt';
  name: string;
  formatter: string | null;
}

/** The format arguments and input prompt tokens of a text. */
export function tokensOf(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/\{([^{}:]*)(?::([^{}]*))?\}/g)) {
    const name = m[1] as string;
    const formatter = m[2] ?? null;
    if (name === 'action') out.push(formatter === null ? { kind: 'bad_prompt', name, formatter } : { kind: 'prompt', name: formatter, formatter: null });
    else out.push({ kind: 'argument', name, formatter });
  }
  return out;
}

const PARTICLES = new Set(['은/는', '이/가', '을/를', '와/과', '으로/로']);

/** The value kinds a formatter takes; null when it is not a formatter. */
export function formatterKinds(formatter: string | null): readonly Kind[] | null {
  if (formatter === null || PARTICLES.has(formatter)) return ['integer', 'real', 'string'];
  if (formatter === 'n') return ['integer', 'real'];
  if (formatter === 'compact') return ['integer', 'string'];
  if (formatter === 'ordinal' || formatter === 'date' || formatter === 'datetime' || formatter === 'duration') return ['integer'];
  if (/^plural:[^/]*\/[^/]*$/.test(formatter)) return ['integer', 'real'];
  return null;
}

function setOf(tokens: readonly Token[], kind: Token['kind']): string {
  return [...new Set(tokens.filter((t) => t.kind === kind).map((t) => t.name))].sort().join(',');
}

type ArgLists = Map<string, SpecFormatArgument[][]>;

function addArgs(out: ArgLists, key: string, args: SpecFormatArgument[]): void {
  const list = out.get(key) ?? [];
  list.push(args);
  out.set(key, list);
}

function addMail(out: ArgLists, idName: string, args: SpecFormatArgument[]): void {
  for (const c of ['title', 'body']) addArgs(out, `mail_template.${c}.${idName}`, args);
}

/** `mail_template` rows the core reserved IDs point to. */
function reservedMailArgs(data: DataFolder, core: CoreData, out: ArgLists): void {
  const reservedId = data.tables.get('reserved_id');
  const idCol = reservedId ? column(reservedId, 'id') : undefined;
  const valueCol = reservedId ? column(reservedId, 'value') : undefined;
  if (!reservedId || !idCol || !valueCol) return;
  for (const r of core.allReserved.filter((x) => x.table === 'reserved_id' && x.rowOf === 'mail_template')) {
    const row = reservedId.rows.find((x) => cellText(x, idCol) === r.id);
    if (row) addMail(out, cellText(row, valueCol), core.formatArguments.get(r.id) ?? []);
  }
}

/** `mail_template` rows a core table's `ref<mail_template.id>` column points to, and core table `tstring` columns. */
function coreTableArgs(data: DataFolder, core: CoreData, out: ArgLists): void {
  for (const [name, { table: spec }] of core.allTables) {
    const table = data.tables.get(name);
    for (const c of table ? spec.columns : []) {
      const col = table ? column(table, c.name) : undefined;
      if (!table || !col) continue;
      const args = core.formatArguments.get(`${name}.${c.name}`);
      if (/^ref<mail_template\.id>\??$/.test(c.type)) for (const row of table.rows) addMail(out, cellText(row, col), args ?? []);
      else if (c.type.startsWith('tstring<') && args !== undefined) addArgs(out, `${name}.${c.name}.`, args);
    }
  }
}

/**
 * The format argument lists of the texts core gives values to, by translation key. A key `<table>.<column>.` holds
 * the lists of every text of that core table `tstring` column.
 */
export function coreTextArguments(data: DataFolder, core: CoreData): ArgLists {
  const out: ArgLists = new Map();
  for (const r of core.allReserved) {
    if (r.table === 'reserved_string') addArgs(out, `reserved_string.text.${r.id}`, core.formatArguments.get(r.id) ?? []);
  }
  reservedMailArgs(data, core, out);
  coreTableArgs(data, core, out);
  return out;
}

function checkTokens(tokens: readonly Token[], place: Place, key: string, serverOnly: boolean, diags: Diagnostics): void {
  for (const t of tokens) {
    if (t.kind === 'bad_prompt') diags.add('translation_format', place, `${key}: {action} is not an input prompt token`);
    else if (t.kind === 'prompt' && !isSnakeCase(t.name)) diags.add('translation_format', place, `${key}: input prompt action ${t.name} is not snake_case`);
    else if (t.kind === 'prompt' && serverOnly) diags.add('translation_format', place, `${key}: a Server tstring text has an input prompt token`);
    else if (t.kind === 'argument' && formatterKinds(t.formatter) === null) diags.add('translation_format', place, `${key}: {${t.name}:${t.formatter ?? ''}} has no such formatter`);
  }
}

function checkCoreArguments(tokens: readonly Token[], lists: readonly SpecFormatArgument[][], place: Place, key: string, diags: Diagnostics): void {
  for (const args of lists) {
    for (const t of tokens.filter((x) => x.kind === 'argument')) {
      const arg = args.find((a) => a.name === t.name);
      if (!arg) {
        diags.add('translation_format', place, `${key}: core gives no format argument {${t.name}}`);
        continue;
      }
      const kinds = formatterKinds(t.formatter);
      if (kinds !== null && !kinds.includes(arg.kind)) diags.add('translation_format', place, `${key}: formatter ${t.formatter ?? 'none'} does not take ${arg.kind} {${t.name}}`);
    }
  }
}

/** Checks the source text and every translation of each text. */
export function checkFormats(data: DataFolder, core: CoreData, texts: ReadonlyMap<string, TextEntry>, sourceLanguage: string, diags: Diagnostics): void {
  const coreArgs = coreTextArguments(data, core);
  const byLanguage = [...data.translations].filter(([lang]) => lang !== sourceLanguage)
    .map(([lang, file]) => ({ lang, file, records: new Map((file?.records ?? []).map((r) => [flatText(r, 'key'), r])) }));
  for (const [key, entry] of texts) {
    const base = tokensOf(entry.source);
    const lists = coreArgs.get(key) ?? coreArgs.get(`${entry.table.name}.${entry.column.name}.`) ?? [];
    const serverOnly = entry.target === 'Server';
    checkTokens(base, entry.place, key, serverOnly, diags);
    checkCoreArguments(base, lists, entry.place, key, diags);
    for (const { lang, file, records } of byLanguage) {
      const record = records.get(key);
      const text = record ? flatText(record, 'text') : '';
      if (file === null || !record || text === '') continue;
      const place = flatPlace(file, record, 'text');
      const tokens = tokensOf(text);
      checkTokens(tokens, place, key, serverOnly, diags);
      checkCoreArguments(tokens, lists, place, key, diags);
      if (setOf(tokens, 'argument') !== setOf(base, 'argument')) diags.add('translation_format', place, `${key}: ${lang} format arguments differ from the source text`);
      if (setOf(tokens, 'prompt') !== setOf(base, 'prompt')) diags.add('translation_format', place, `${key}: ${lang} input prompt actions differ from the source text`);
    }
  }
}
