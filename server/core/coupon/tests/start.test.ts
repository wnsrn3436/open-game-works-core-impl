import * as testing from '../../testing/dev/index.ts';
import { START_AT } from './helpers.ts';
import { start_modules } from './modules.ts';

describe('server start', () => {
  it('does not start with a lowercase letter in coupon.codeAlphabet', async () => {
    await expect(testing.start_test_server(START_AT, undefined, undefined, undefined, undefined, { 'coupon.codeAlphabet': 'ABCabc123' })).rejects.toThrow();
    const failure = await start_modules(START_AT, { 'coupon.codeAlphabet': 'ABCabc123' });
    expect(typeof failure).toBe('string');
  });

  it('does not start with an empty coupon.codeAlphabet or a repeated character', async () => {
    expect(typeof (await start_modules(START_AT, { 'coupon.codeAlphabet': '' }))).toBe('string');
    expect(typeof (await start_modules(START_AT, { 'coupon.codeAlphabet': 'ABCA' }))).toBe('string');
  });

  it('starts with the default coupon.codeAlphabet', async () => {
    const started = await start_modules(START_AT);
    if (typeof started === 'string') throw new Error(started);
    started.stop();
  });
});
