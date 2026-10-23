/** Plain text condition, text normalization and banned word matching of text people write. */
import * as GameData from '../../generated/data/game_data.ts';

/** Element of `check_text`'s result. */
export const TextCheckResult = {
  OK: 'OK',
  INVALID: 'INVALID',
  BANNED: 'BANNED',
} as const;
export type TextCheckResult = (typeof TextCheckResult)[keyof typeof TextCheckResult];

/** The result of `check_text`: `banned_word_id` is the matched `banned_word` ID value when `BANNED`, else 0. */
export interface TextCheck {
  readonly result: TextCheckResult;
  readonly banned_word_id: number;
}

/** A `banned_word` row with its normalized word, ready to match. */
export interface BannedWord {
  readonly id: number;
  readonly word: string;
  readonly exact: boolean;
}

const EDGE_SPACE = /^\p{White_Space}|\p{White_Space}$/u;
const REMOVED = /[\p{White_Space}\p{Default_Ignorable_Code_Point}]/gu;
const BIDI_CONTROL = /^\p{Bidi_Control}$/u;

/** C0 control, U+007F, C1 control, U+2028, U+2029 and `Bidi_Control`; U+000A is not one when new lines are allowed. */
function isControl(ch: string, allowNewline: boolean): boolean {
  const codePoint = ch.codePointAt(0) ?? 0;
  if (allowNewline && codePoint === 0x0a) return false;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029 || BIDI_CONTROL.test(ch);
}

/** True when `text` keeps every plain text condition with at most `maxCodePoints` code points. */
export function isPlainText(text: string, maxCodePoints: number, allowNewline: boolean): boolean {
  if (!Number.isSafeInteger(maxCodePoints) || !text.isWellFormed()) return false;
  let count = 0;
  for (const ch of text) {
    if (isControl(ch, allowNewline)) return false;
    count += 1;
  }
  return count >= 1 && count <= maxCodePoints && !EDGE_SPACE.test(text) && normalizeText(text) !== '';
}

/** NFKC, locale-independent lower case mapping, then every `White_Space` and `Default_Ignorable_Code_Point` character removed. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(REMOVED, '');
}

/**
 * The `Contains` words as one Aho-Corasick automaton over UTF-16 code units. Normalized text and words are well-formed,
 * so a code unit match is a code point match. Each state keeps the smallest ID value of the words that end there.
 */
class ContainsMatcher {
  private readonly next: Map<number, number>[] = [new Map<number, number>()];
  private readonly fail: number[] = [0];
  private readonly best: number[] = [Number.POSITIVE_INFINITY];

  constructor(words: readonly BannedWord[]) {
    for (const w of words) this.insert(w);
    this.link();
  }

  private insert(w: BannedWord): void {
    let state = 0;
    for (let i = 0; i < w.word.length; i += 1) {
      const unit = w.word.charCodeAt(i);
      const edges = this.edges(state);
      let to = edges.get(unit);
      if (to === undefined) {
        to = this.next.length;
        this.next.push(new Map<number, number>());
        this.fail.push(0);
        this.best.push(Number.POSITIVE_INFINITY);
        edges.set(unit, to);
      }
      state = to;
    }
    this.best[state] = Math.min(this.at(this.best, state), w.id);
  }

  private edges(state: number): Map<number, number> {
    const edges = this.next[state];
    if (edges === undefined) throw new Error(`banned word automaton has no state ${String(state)}`);
    return edges;
  }

  private at(list: readonly number[], state: number): number {
    const value = list[state];
    if (value === undefined) throw new Error(`banned word automaton has no state ${String(state)}`);
    return value;
  }

  /** Failure links in breadth-first order; each state's smallest ID value also covers the words its failure link ends. */
  private link(): void {
    const queue: number[] = [];
    for (const to of this.edges(0).values()) queue.push(to);
    for (let head = 0; head < queue.length; head += 1) {
      const state = this.at(queue, head);
      for (const [unit, to] of this.edges(state)) {
        this.fail[to] = this.step(this.at(this.fail, state), unit);
        this.best[to] = Math.min(this.at(this.best, to), this.at(this.best, this.at(this.fail, to)));
        queue.push(to);
      }
    }
  }

  private step(from: number, unit: number): number {
    for (let state = from; ; state = this.at(this.fail, state)) {
      const to = this.edges(state).get(unit);
      if (to !== undefined) return to;
      if (state === 0) return 0;
    }
  }

  /** The smallest ID value of the words `text` holds, or `POSITIVE_INFINITY`. */
  smallest(text: string): number {
    let found = this.at(this.best, 0);
    let state = 0;
    for (let i = 0; i < text.length; i += 1) {
      state = this.step(state, text.charCodeAt(i));
      found = Math.min(found, this.at(this.best, state));
    }
    return found;
  }
}

/** The `banned_word` rows, normalized: `Exact` rows by word, `Contains` rows in one automaton. */
export class BannedWords {
  /** Every row in ascending ID value. */
  readonly rows: readonly BannedWord[];
  private readonly exact = new Map<string, number>();
  private readonly contains: ContainsMatcher;

  constructor(rows: readonly BannedWord[]) {
    this.rows = [...rows].sort((a, b) => a.id - b.id);
    for (const w of this.rows) if (w.exact && !this.exact.has(w.word)) this.exact.set(w.word, w.id);
    this.contains = new ContainsMatcher(this.rows.filter((w) => !w.exact));
  }

  /** The smallest ID value of the rows that match normalized `text`, or 0. */
  match(text: string): number {
    const smallest = Math.min(this.exact.get(text) ?? Number.POSITIVE_INFINITY, this.contains.smallest(text));
    return smallest === Number.POSITIVE_INFINITY ? 0 : smallest;
  }
}

/** The rows of the `banned_word` table, normalized. */
export function bannedWords(table: GameData.BannedWordTable): BannedWords {
  return new BannedWords(
    table.all_rows().map((row) => ({ id: row.id, word: normalizeText(row.word), exact: row.match === GameData.BannedWordMatch.Exact })),
  );
}

/** Server start failure reasons of `banned_word` rows whose normalized word is empty. */
export function emptyBannedWords(words: BannedWords): string[] {
  return words.rows.filter((w) => w.word === '').map((w) => `banned_word row ${String(w.id)} has an empty normalized word`);
}

/** `check_text`: the plain text condition first, then the banned word with the smallest ID value that matches. */
export function checkText(words: BannedWords, text: string, maxCodePoints: number, allowNewline: boolean): TextCheck {
  if (!isPlainText(text, maxCodePoints, allowNewline)) return { result: TextCheckResult.INVALID, banned_word_id: 0 };
  const id = words.match(normalizeText(text));
  return id === 0 ? { result: TextCheckResult.OK, banned_word_id: 0 } : { result: TextCheckResult.BANNED, banned_word_id: id };
}
