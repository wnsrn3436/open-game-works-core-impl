/** Translation keys, the glossary and the translation files (`data` skill `## translation`, `## glossary`). */
import { createHash } from 'node:crypto';
import { type DataFolder, glossaryHeader, TRANSLATION_HEADER } from './data.ts';
import { compareBytes, type Diagnostics, filePlace, type Place } from './diag.ts';
import { sameHeader } from './load.ts';
import { cellPlace, cellText, column, flatPlace, flatText, newFlatRecord, setFlat, type Column, type FlatFile, type Row, type Table } from './model.ts';
import type { BuildTarget } from './types.ts';

/** First 16 hex digits of the SHA-256 of a UTF-8 text. */
export function hash16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** One key column value of a translation key. */
export interface KeyPart {
  kind: 'id' | 'int' | 'enum';
  text: string;
  enumType: string;
}

/** A text of a `tstring` cell. */
export interface TextEntry {
  key: string;
  parts: KeyPart[];
  source: string;
  table: Table;
  column: Column;
  row: Row;
  place: Place;
  target: BuildTarget;
}

/**
 * The key part of a key column of a row, for translation keys and `requirement` row keys. The kind comes from the
 * value: an `int` cell may hold an ID name, and that part is an ID name like an `id` cell's.
 */
export function keyPart(table: Table, row: Row, name: string): KeyPart {
  const col = column(table, name);
  const t = col?.type;
  const text = col ? cellText(row, col) : '';
  if (t?.k === 'enum') return { kind: 'enum', text, enumType: t.enumType };
  return { kind: t?.k === 'id' || text.startsWith('[') ? 'id' : 'int', text, enumType: '' };
}

/** The translation key of a `tstring` cell before ID names and enum elements become values. */
export function translationKey(table: string, col: string, parts: readonly KeyPart[]): string {
  return [table, col, ...parts.map((p) => p.text)].join('.');
}

/** Every text of a built `tstring` cell with build target other than `None` that is not empty. */
export function collectTexts(data: DataFolder): TextEntry[] {
  const out: TextEntry[] = [];
  for (const table of data.tables.values()) {
    for (const col of table.columns) {
      const t = col.type;
      if (t?.k !== 'tstring' || col.target === 'None') continue;
      for (const row of table.rows) {
        const source = cellText(row, col);
        if (source === '') continue;
        const parts = t.keyCols.map((name) => keyPart(table, row, name));
        out.push({ key: translationKey(table.name, col.name, parts), parts, source, table, column: col, row, place: cellPlace(table, row, col), target: col.target });
      }
    }
  }
  return out;
}

/** Texts by key, the first text of each key; later texts of the same key with another source are `duplicate`. */
export function textsByKey(texts: readonly TextEntry[], diags: Diagnostics | null): Map<string, TextEntry> {
  const byKey = new Map<string, TextEntry>();
  for (const t of texts) {
    const first = byKey.get(t.key);
    if (!first) byKey.set(t.key, t);
    else if (first.source !== t.source) diags?.add('duplicate', t.place, `translation key ${t.key} has another source text at ${first.place.file}:${String(first.place.line)}`);
  }
  return byKey;
}

/** Glossary rows that match a source text, in byte order of `source`. */
export function matchingGlossary(glossary: FlatFile | null, source: string): FlatFile['records'] {
  if (glossary === null) return [];
  return glossary.records
    .filter((g) => flatText(g, 'source') !== '' && source.includes(flatText(g, 'source')))
    .sort((a, b) => compareBytes(flatText(a, 'source'), flatText(b, 'source')));
}

/** `current_hash` of a text in a language: the source text, then each matching glossary row. */
export function currentHash(source: string, glossary: FlatFile | null, language: string, isSource: boolean): string {
  if (isSource) return hash16(source);
  let input = source;
  for (const g of matchingGlossary(glossary, source)) input += `\n${flatText(g, 'source')}\t${flatText(g, language)}`;
  return hash16(input);
}

function languageIds(data: DataFolder): Set<string> {
  const table = data.tables.get('language');
  const id = table ? column(table, 'id') : undefined;
  return new Set(table && id ? table.rows.map((r) => cellText(r, id)) : []);
}

/** Matches the glossary: rows whose `source` changed lose their translations; `language` names are themselves. */
export function syncGlossary(data: DataFolder, languages: readonly string[], diags: Diagnostics): boolean {
  const file = data.glossary;
  if (file === null) return false;
  const header = glossaryHeader(languages);
  if (!file.exists) file.header = header;
  if (!sameHeader(file, header)) {
    diags.add('structure', filePlace(file.file), `the header is not ${header.join(',')}`);
    return false;
  }
  const langIds = languageIds(data);
  for (const g of file.records) {
    const hash = hash16(flatText(g, 'source'));
    if (flatText(g, 'source_hash') !== hash) {
      for (const l of languages) setFlat(g, l, '');
      setFlat(g, 'source_hash', hash);
    }
    if (langIds.has(flatText(g, 'id_name'))) for (const l of languages) setFlat(g, l, flatText(g, 'source'));
  }
  file.changed = true;
  return true;
}

/** Matches the translation file of a language to the texts. */
export function syncTranslation(file: FlatFile, texts: ReadonlyMap<string, TextEntry>, glossary: FlatFile | null, language: string, isSource: boolean, diags: Diagnostics): void {
  if (!file.exists) file.header = [...TRANSLATION_HEADER];
  if (!sameHeader(file, TRANSLATION_HEADER)) {
    diags.add('structure', filePlace(file.file), `the header is not ${TRANSLATION_HEADER.join(',')}`);
    return;
  }
  const old = new Map(file.records.map((r) => [flatText(r, 'key'), r]));
  const keys = [...texts.keys()].sort(compareBytes);
  file.records = keys.map((key) => {
    const source = (texts.get(key) as TextEntry).source;
    const record = old.get(key) ?? newFlatRecord({ key, source: '', source_hash: '', current_hash: '', text: '' });
    const hash = currentHash(source, glossary, language, isSource);
    setFlat(record, 'source', source);
    setFlat(record, 'current_hash', hash);
    if (isSource) {
      setFlat(record, 'text', source);
      setFlat(record, 'source_hash', hash);
    }
    return record;
  });
  file.changed = true;
}

/** Matches the glossary and then every translation file. */
export function syncTranslations(data: DataFolder, languages: readonly string[], sourceLanguage: string, diags: Diagnostics): void {
  const targets = languages.filter((l) => l !== sourceLanguage);
  const glossaryOk = syncGlossary(data, targets, diags);
  const texts = textsByKey(collectTexts(data), null);
  for (const [lang, file] of data.translations) {
    if (file === null) continue;
    syncTranslation(file, texts, glossaryOk ? data.glossary : null, lang, lang === sourceLanguage, diags);
  }
}

/** `translation_missing` and `translation_stale` lines of the translation files and the glossary. */
export function checkTranslationState(data: DataFolder, sourceLanguage: string, diags: Diagnostics): void {
  for (const [lang, file] of data.translations) {
    if (file === null || lang === sourceLanguage) continue;
    for (const r of file.records) {
      const text = flatText(r, 'text');
      if (text === '') diags.add('translation_missing', flatPlace(file, r, 'text'), `${flatText(r, 'key')} has no ${lang} translation`);
      else if (flatText(r, 'source_hash') !== flatText(r, 'current_hash')) diags.add('translation_stale', flatPlace(file, r, 'text'), `${flatText(r, 'key')} ${lang} translation is stale`);
    }
  }
  const glossary = data.glossary;
  if (glossary === null) return;
  for (const g of glossary.records) {
    for (const lang of glossary.header.slice(4)) {
      if (flatText(g, lang) === '') diags.add('translation_missing', flatPlace(glossary, g, lang), `glossary ${JSON.stringify(flatText(g, 'source'))} has no ${lang} cell`);
    }
  }
}

/** `glossary_missing`: the `name` text of a row of a table with an `id` column is not a glossary row of its ID name. */
export function checkGlossaryNames(data: DataFolder, diags: Diagnostics): void {
  const rows = data.glossary?.records ?? [];
  const known = new Set(rows.map((g) => `${flatText(g, 'id_name')}\u0000${flatText(g, 'source')}`));
  for (const table of data.tables.values()) {
    const name = column(table, 'name');
    const id = column(table, 'id');
    if (name?.type?.k !== 'tstring' || name.target === 'None' || !id) continue;
    for (const row of table.rows) {
      const text = cellText(row, name);
      if (text === '' || known.has(`${cellText(row, id)}\u0000${text}`)) continue;
      diags.add('glossary_missing', cellPlace(table, row, name), `name ${JSON.stringify(text)} of ${cellText(row, id)} is not in the glossary with id_name ${cellText(row, id)}`);
    }
  }
}
