import { alphabet_error, code_bound_after, generate_code, is_valid_code, normalize_code } from '../code.ts';

/** Byte order of the UTF-8 encodings. */
function compare_bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

const RULES = { alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', min_length: 4, max_length: 12 };

const CODE_CHARS = Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');

describe('coupon code', () => {
  it('bounds the codes byte after any after_code with a string of code characters only', () => {
    const codes = [...CODE_CHARS];
    for (const a of CODE_CHARS) for (const b of CODE_CHARS) codes.push(a + b);
    for (const a of '09AZ') for (const b of '09AZ') for (const c of '09AZ') codes.push(a + b + c);
    const afters = ['', 'a', 'm', 'z', 'A', 'Z', 'ZZ', 'ZZZ', '9', 'A9', 'AZ', 'Aa', 'A:', 'A ', 'A@', 'A[', 'Bz', 'B-', 'AZz', '9z', '\u0000',
      'A\u0000', 'é', 'Aé', `A${String.fromCodePoint(0x1f600)}`, 'ZZa', '0', '00'];
    for (const after of afters) {
      const bound = code_bound_after(after);
      if (bound !== null) expect(bound).toMatch(/^[0-9A-Z]+$/);
      for (const code of codes) {
        const listed = bound !== null && compare_bytes(code, bound) >= 0;
        expect([after, code, listed]).toEqual([after, code, compare_bytes(code, after) > 0]);
      }
    }
    expect(code_bound_after('')).toBe('0');
    expect(code_bound_after('AB')).toBe('AB0');
    expect(code_bound_after('Aa')).toBe('B');
    expect(code_bound_after('A9z')).toBe('AA');
    expect(code_bound_after('A:')).toBe('AA');
    expect(code_bound_after('a')).toBeNull();
    expect(code_bound_after('ZZm')).toBeNull();
  });

  it('normalizes lowercase letters, - and white space anywhere into the stored code', () => {
    const space = (code: number): string => String.fromCodePoint(code);
    expect(normalize_code(' spr-ing 2026 ')).toBe('SPRING2026');
    expect(normalize_code(`a${space(0x3000)}b${space(0xa0)}c${space(0x85)}d${space(0x2028)}e\tf\ng`)).toBe('ABCDEFG');
    expect(normalize_code('--ab--')).toBe('AB');
  });

  it('keeps non-ASCII letters and other characters as they are', () => {
    expect(normalize_code('äb_1')).toBe('äB_1');
    expect(normalize_code(`x${String.fromCodePoint(0xfeff)}y`)).toBe(`X${String.fromCodePoint(0xfeff)}Y`);
  });

  it('accepts a normalized code of alphabet characters within the length limits only', () => {
    expect(is_valid_code('ABCD', RULES)).toBe(true);
    expect(is_valid_code('ABCDEFGHIJ12', RULES)).toBe(true);
    expect(is_valid_code('ABC', RULES)).toBe(false);
    expect(is_valid_code('ABCDEFGHIJ123', RULES)).toBe(false);
    expect(is_valid_code('ABC_', RULES)).toBe(false);
    expect(is_valid_code('', RULES)).toBe(false);
  });

  it('rejects an empty alphabet, a lowercase letter, another character and a repeated character', () => {
    expect(alphabet_error(RULES.alphabet)).toBeNull();
    expect(alphabet_error('')).not.toBeNull();
    expect(alphabet_error('ABCabc')).not.toBeNull();
    expect(alphabet_error('AB-C')).not.toBeNull();
    expect(alphabet_error('ABCA')).not.toBeNull();
  });

  it('generates codes of the length from the alphabet', () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generate_code('XY7', 9);
      expect(code).toMatch(/^[XY7]{9}$/);
    }
  });
});
