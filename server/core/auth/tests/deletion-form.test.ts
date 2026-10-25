import { truncated_ip } from '../context.ts';
import { page_language, parse_form } from '../deletion.ts';

describe('web account deletion page language', () => {
  const supported = ['en', 'ko', 'pt-BR'];

  it('picks the first range by q with the same tag ignoring case', () => {
    expect(page_language('ko-KR, pt-br;q=0.9, en;q=0.8', supported, 'en')).toBe('pt-BR');
    expect(page_language('en;q=0.5, KO;q=0.6', supported, 'en')).toBe('ko');
  });

  it('falls back to a supported language with the same primary subtag, then to the source language', () => {
    expect(page_language('ko-KR', supported, 'en')).toBe('ko');
    expect(page_language('pt-PT', supported, 'en')).toBe('pt-BR');
    expect(page_language('fr-FR, de', supported, 'en')).toBe('en');
    expect(page_language('', supported, 'ko')).toBe('ko');
  });
});

describe('web account deletion form', () => {
  const parse = (body: string, google = true): ReturnType<typeof parse_form> => parse_form(body, 10, 64, google);

  it('reads the code method, keeps the public code input as typed and normalizes the code', () => {
    expect(parse('method=code&confirm=yes&public_code=ab0i-cdlz&code=abcd-efgh+jk')).toEqual({ method: 'code', public_code: 'ab0i-cdlz', code: 'ABCDEFGHJK' });
  });

  it('refuses a missing confirm, an unknown field, a field twice, and fields of the other method', () => {
    expect(parse('method=code&public_code=AB01CD1Z&code=ABCDEFGHJK')).toBeNull();
    expect(parse('method=code&confirm=no&public_code=AB01CD1Z&code=ABCDEFGHJK')).toBeNull();
    expect(parse('method=code&confirm=yes&public_code=AB01CD1Z&code=ABCDEFGHJK&x=1')).toBeNull();
    expect(parse('method=code&confirm=yes&confirm=yes&public_code=AB01CD1Z&code=ABCDEFGHJK')).toBeNull();
    expect(parse('method=code&confirm=yes&public_code=AB01CD1Z&code=ABCDEFGHJK&credential=c')).toBeNull();
    expect(parse('method=other&confirm=yes')).toBeNull();
  });

  it('refuses a public_code that is not a public code input, a user_id field and a code of other characters or length', () => {
    expect(parse('method=code&confirm=yes&public_code=AB01CD1&code=ABCDEFGHJK')).toBeNull();
    expect(parse('method=code&confirm=yes&public_code=AB01CD1U&code=ABCDEFGHJK')).toBeNull();
    expect(parse('method=code&confirm=yes&user_id=12&code=ABCDEFGHJK')).toBeNull();
    expect(parse('method=code&confirm=yes&public_code=AB01CD1Z&code=ABCDEFGHJK')).not.toBeNull();
    expect(parse('method=code&confirm=yes&public_code=AB01CD1Z&code=ABCDEFGHJI')).toBeNull();
    expect(parse('method=code&confirm=yes&public_code=AB01CD1Z&code=ABCDEFGHJ')).toBeNull();
  });

  it('reads the google method only when the environment has a login-google adapter and the credential fits', () => {
    expect(parse('method=google&confirm=yes&credential=fake%3Aa')).toEqual({ method: 'google', credential: 'fake:a' });
    expect(parse('method=google&confirm=yes&credential=fake%3Aa', false)).toBeNull();
    expect(parse(`method=google&confirm=yes&credential=${'x'.repeat(65)}`)).toBeNull();
  });
});

describe('truncated IP', () => {
  it('keeps 24 bits of IPv4 and 48 bits of IPv6', () => {
    expect(truncated_ip('203.0.113.77')).toBe('203.0.113.0');
    expect(truncated_ip('::ffff:203.0.113.77')).toBe('203.0.113.0');
    expect(truncated_ip('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(truncated_ip('2001:db8::1')).toBe('2001:db8:0::');
    expect(truncated_ip('nonsense')).toBe('');
  });
});
