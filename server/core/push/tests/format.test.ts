/** The push text formatter, the night window and the translation binary reader, without a server instance. */
import { format_text, type ArgValue } from '../format.ts';
import { push_cases, type FormatCase } from './text_format.ts';
import { night_window_end } from '../send.ts';
import { Translations } from '../translation.ts';
import { translation_binary } from './helpers.ts';

function value_of(c: FormatCase): ArgValue {
  return c.input.kind === 'int' ? BigInt(c.input.value) : c.input.value;
}

describe('format_text', () => {
  it('formats every int and string case of core test fixture text-format, offset 0', () => {
    const cases = push_cases();
    expect(cases.length).toBeGreaterThan(40);
    for (const c of cases) {
      const out = format_text(c.input.text, new Map([['v', value_of(c)]]), c.input.language, 0n);
      if (c.expected === null) expect(out.errors, c.name).toEqual(['v']);
      else expect({ name: c.name, text: out.text, errors: out.errors }).toEqual({ name: c.name, text: c.expected, errors: [] });
    }
  });

  it('a date with the device offset 9 hours is the date of t + 9 hours at offset 0', () => {
    const t = 1_704_484_800_000n;
    const nine = 9n * 3_600_000n;
    for (const text of ['{t:date}', '{t:datetime}']) {
      const shifted = format_text(text, new Map([['t', t]]), 'en', nine).text;
      expect(shifted).toBe(format_text(text, new Map([['t', t + nine]]), 'en', 0n).text);
    }
    expect(format_text('{t:date}', new Map([['t', t]]), 'en', nine).text).toBe('01/06/2024');
  });

  it('a slot whose formatter does not take the value kind is empty and named', () => {
    expect(format_text('a{n:n}b', new Map([['n', 'x']]), 'en', 0n)).toEqual({ text: 'ab', errors: ['n'] });
    expect(format_text('{c:compact}', new Map([['c', '12a']]), 'en', 0n)).toEqual({ text: '', errors: ['c'] });
  });
});

describe('night window', () => {
  const day = 86_400_000n;
  const minute = 60_000n;

  it('across midnight: from the start minute, and not at the end minute', () => {
    expect(night_window_end(1320, 480, 1320n * minute, 0n)).toBe(day + 480n * minute);
    expect(night_window_end(1320, 480, 0n, 0n)).toBe(480n * minute);
    expect(night_window_end(1320, 480, 480n * minute - 1n, 0n)).toBe(480n * minute);
    expect(night_window_end(1320, 480, 480n * minute, 0n)).toBeNull();
    expect(night_window_end(1320, 480, 1320n * minute - 1n, 0n)).toBeNull();
  });

  it('within a day: from the start minute, and not at the end minute', () => {
    expect(night_window_end(600, 720, 600n * minute, 0n)).toBe(720n * minute);
    expect(night_window_end(600, 720, 720n * minute, 0n)).toBeNull();
    expect(night_window_end(600, 720, 599n * minute, 0n)).toBeNull();
  });

  it('uses the device local time: clock + timezone offset', () => {
    const offset = 2n * 3_600_000n;
    expect(night_window_end(600, 720, 8n * 60n * minute, offset)).toBe(720n * minute - offset);
    expect(night_window_end(600, 720, 8n * 60n * minute, -offset)).toBeNull();
  });
});

/** The texts `Translations` reads from `bytes` as a language's translation binary. */
function read_translation(bytes: Uint8Array): ReadonlyMap<string, string> | null {
  return new Translations((name) => (name === 'translation_ko.bin' ? bytes : null)).of('ko');
}

describe('translation binary', () => {
  it('reads a translation binary: texts by translation key', () => {
    const texts = read_translation(translation_binary(new Map([['push_message.title.[a]', 'Hello {name}'], ['push_message.body.[a]', '안녕']])));
    expect(texts).toEqual(new Map([['push_message.body.[a]', '안녕'], ['push_message.title.[a]', 'Hello {name}']]));
  });

  it('a binary that is not a Translation is null, also after valid entries', () => {
    expect(read_translation(new Uint8Array([0x0a, 0x05, 0x01]))).toBeNull();
    expect(read_translation(new Uint8Array([]))?.size).toBe(0);
    const valid = translation_binary(new Map([['push_message.title.[a]', 'Hello']]));
    expect(read_translation(Uint8Array.from([...valid, 0x0a, 0x05, 0x0a, 0x01]))).toBeNull();
  });
});
