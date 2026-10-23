import * as GameData from '../../../generated/data/game_data.ts';
import { TextCheckResult } from '../index.ts';
import { bannedWordTable, emptyData, standalone, withContainer } from './standalone.ts';

const { Contains, Exact } = GameData.BannedWordMatch;

describe('plain text', () => {
  const v = standalone();

  it('passes text within the code point limit, counting code points', () => {
    expect(v.is_plain_text('abc', 3)).toBe(true);
    expect(v.is_plain_text('가나다', 3)).toBe(true);
    expect(v.is_plain_text('😀😀', 2)).toBe(true);
    expect(v.is_plain_text('a b', 3)).toBe(true);
    expect(v.is_plain_text('abcd', 3)).toBe(false);
  });

  it.each([
    ['empty text', ''],
    ['C0 control U+0000', 'a\u0000b'],
    ['C0 control U+001F', 'a\u001fb'],
    ['new line U+000A', 'a\nb'],
    ['U+007F', 'a\u007fb'],
    ['C1 control U+0080', 'a\u0080b'],
    ['C1 control U+009F', 'a\u009fb'],
    ['U+2028', 'a b'],
    ['U+2029', 'a b'],
    ['leading space', ' ab'],
    ['trailing space', 'ab '],
    ['leading U+3000', '　ab'],
    ['trailing U+00A0', 'ab '],
    ['bad UTF-8 (lone surrogate)', 'a\ud800b'],
    ['Bidi_Control U+202E', 'a\u202eb'],
    ['Bidi_Control U+2066', 'a\u2066b'],
    ['Bidi_Control U+200F', 'a\u200fb'],
    ['Bidi_Control U+061C', 'a\u061cb'],
    ['only U+3164', '\u3164'],
    ['only U+200B', '\u200b'],
    ['only U+115F', '\u115f'],
  ])('rejects %s', (_name, text) => {
    expect(v.is_plain_text(text, 10)).toBe(false);
  });

  it('rejects a code point limit that is not an integer', () => {
    expect(v.is_plain_text('abc', Number.NaN)).toBe(false);
    expect(v.is_plain_text('abc', Number.POSITIVE_INFINITY)).toBe(false);
    expect(v.is_plain_text('abc', 3.5)).toBe(false);
  });
});

describe('normalize_text', () => {
  const v = standalone();

  it('makes strings that differ only in full and half width, case and spaces the same', () => {
    expect(v.normalize_text('ＡＢＣ　１２３')).toBe('abc123');
    expect(v.normalize_text('abc 123')).toBe('abc123');
    expect(v.normalize_text('Hello World')).toBe(v.normalize_text('ｈｅｌｌｏ　ｗｏｒｌｄ'));
    expect(v.normalize_text('ｶﾀｶﾅ')).toBe(v.normalize_text('カタカナ'));
    expect(v.normalize_text(' a\tb\nc ')).toBe('abc');
  });

  it('removes Default_Ignorable_Code_Point characters', () => {
    expect(v.normalize_text('ba\u200bd')).toBe('bad');
    expect(v.normalize_text('b\u00adad')).toBe('bad');
    expect(v.normalize_text('b\u2060ad')).toBe('bad');
    expect(v.normalize_text('b\ufeffa\u034fd')).toBe('bad');
  });
});

describe('check_text', () => {
  const data = withContainer(emptyData(), 'BannedWordTable', bannedWordTable([
    [7, 'bad', Contains],
    [5, 'ＢＡＤ', Contains],
    [3, 'evil', Exact],
  ]));
  const v = standalone(data);

  it('gives INVALID for text that breaks a plain text condition', () => {
    expect(v.check_text('', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text(' bad', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text('abcdefghijk', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
  });

  it('gives BANNED with the smallest ID value of the Contains rows the text holds', () => {
    expect(v.check_text('so bad', 10, false)).toEqual({ result: TextCheckResult.BANNED, banned_word_id: 5 });
    expect(v.check_text('Ｂ a d day', 20, false)).toEqual({ result: TextCheckResult.BANNED, banned_word_id: 5 });
  });

  it('gives BANNED for text equal to an Exact row and does not stop longer text', () => {
    expect(v.check_text('evil', 10, false)).toEqual({ result: TextCheckResult.BANNED, banned_word_id: 3 });
    expect(v.check_text('E V I L', 10, false)).toEqual({ result: TextCheckResult.BANNED, banned_word_id: 3 });
    expect(v.check_text('evil one', 10, false)).toEqual({ result: TextCheckResult.OK, banned_word_id: 0 });
  });

  it('gives OK for plain text with no banned word', () => {
    expect(v.check_text('good day', 10, false)).toEqual({ result: TextCheckResult.OK, banned_word_id: 0 });
  });

  it('passes a new line in the middle only when new lines are allowed', () => {
    expect(v.check_text('good\nday', 10, true)).toEqual({ result: TextCheckResult.OK, banned_word_id: 0 });
    expect(v.check_text('good\nday', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text('\ngood', 10, true)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text('good\r\nday', 10, true)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
  });
});

describe('check_text with invisible characters', () => {
  const v = standalone(withContainer(emptyData(), 'BannedWordTable', bannedWordTable([[7, 'bad', Contains]])));

  it('gives BANNED for a Contains word split by U+200B, U+00AD or U+2060', () => {
    for (const text of ['ba\u200bd', 'b\u00adad', 'b\u2060ad']) {
      expect(v.check_text(text, 10, false)).toEqual({ result: TextCheckResult.BANNED, banned_word_id: 7 });
    }
  });

  it('gives INVALID for text with U+202E or U+2066', () => {
    expect(v.check_text('ok\u202eko', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text('ok\u2066ko', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
  });

  it('gives OK for emoji text with U+200D and U+FE0F', () => {
    expect(v.check_text('\u{1f468}\u200d\u{1f469}\u200d\u{1f467}', 10, false)).toEqual({ result: TextCheckResult.OK, banned_word_id: 0 });
    expect(v.check_text('\u2764\ufe0f', 10, false)).toEqual({ result: TextCheckResult.OK, banned_word_id: 0 });
  });

  it('gives INVALID for text of only U+3164 or only U+200B, whose normalized text is empty', () => {
    expect(v.check_text('\u3164', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text('\u3164\u3164', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
    expect(v.check_text('\u200b', 10, false)).toEqual({ result: TextCheckResult.INVALID, banned_word_id: 0 });
  });
});

describe('check_text banned word lookup', () => {
  it('finds Contains words that overlap, nest and need a failure link, with the smallest ID value', () => {
    const v = standalone(withContainer(emptyData(), 'BannedWordTable', bannedWordTable([
      [9, 'abcd', Contains],
      [4, 'bc', Contains],
      [6, 'cde', Contains],
      [2, 'xab', Contains],
      [8, 'abc', Exact],
    ])));
    const id = (text: string) => v.check_text(text, 20, false).banned_word_id;
    expect(id('zabcz')).toBe(4);
    expect(id('zzcdez')).toBe(6);
    expect(id('abcde')).toBe(4);
    expect(id('xxab')).toBe(2);
    expect(id('abc')).toBe(4);
    expect(id('abd')).toBe(0);
  });

  it('gives the same result as matching every row in turn', () => {
    const alphabet = ['a', 'b', 'c', 'Ａ', ' ', '가', '😀'];
    let seed = 12345;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const word = (max: number): string => Array.from({ length: 1 + random(max) }, () => alphabet[random(alphabet.length)]).join('').trim() || 'a';
    const rows: [number, string, GameData.BannedWordMatch][] = Array.from({ length: 40 }, (_, i) => [i + 1, word(4), random(4) === 0 ? Exact : Contains]);
    const v = standalone(withContainer(emptyData(), 'BannedWordTable', bannedWordTable(rows)));
    const sorted = rows.map(([rowId, w, match]) => ({ id: rowId, word: v.normalize_text(w), exact: match === Exact }));
    for (let i = 0; i < 500; i += 1) {
      const text = word(12);
      const normalized = v.normalize_text(text);
      const hit = sorted.find((w) => (w.exact ? normalized === w.word : normalized.includes(w.word)));
      const expected = hit === undefined ? { result: TextCheckResult.OK, banned_word_id: 0 } : { result: TextCheckResult.BANNED, banned_word_id: hit.id };
      expect(v.check_text(text, 20, false), text).toEqual(expected);
    }
  });
});

describe('banned word rows at server start', () => {
  function startWith(words: readonly [number, string, GameData.BannedWordMatch][]): string | null {
    const v = standalone(withContainer(emptyData(), 'BannedWordTable', bannedWordTable(words)));
    v.begin_start();
    return v.complete_start();
  }

  it('fails the start when a row word normalizes to an empty string', () => {
    expect(startWith([[1, 'bad', Contains], [2, '　', Contains]])).toContain('banned_word row 2');
    expect(startWith([[4, ' \t', Exact]])).toContain('banned_word row 4');
  });

  it('starts when every row word is not empty after normalization', () => {
    expect(startWith([[1, 'bad', Contains], [2, 'evil', Exact]])).toBeNull();
  });
});
