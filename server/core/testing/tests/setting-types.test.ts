import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check_overrides } from '../dev/test_server.ts';

/** A game checkout has no `core-spec/`: this file's `node:fs` hides it. */
vi.mock('node:fs', async (import_original) => {
  const fs = await import_original<typeof import('node:fs')>();
  const hidden = (path: unknown): boolean => /[\\/]core-spec([\\/]|$)/.test(path instanceof URL ? fileURLToPath(path) : String(path));
  const missing = (path: unknown): Error => Object.assign(new Error(`ENOENT: no such file or directory, ${String(path)}`), { code: 'ENOENT' });
  return {
    ...fs,
    existsSync: (path: Parameters<typeof fs.existsSync>[0]) => !hidden(path) && fs.existsSync(path),
    readdirSync: ((path: Parameters<typeof fs.readdirSync>[0], ...rest: unknown[]) => {
      if (hidden(path)) throw missing(path);
      return (fs.readdirSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readdirSync,
    readFileSync: ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
      if (hidden(path)) throw missing(path);
      return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFileSync,
  };
});

/** Settings values as a game's `server/generated/core_settings.json` holds them, with environment `DEV`. */
const GAME_SETTINGS = {
  'routing.userRateLimitPerMinute': 60,
  'auth.inactiveGuestDeleteAfterMs': null,
  'environments.DEV.trustedProxyCount': 0,
  'environments.DEV.updatePublicKeys': [],
};

/** `check_overrides` of the game settings values with `overrides`, to run in `expect`. */
function check(overrides: Record<string, unknown>): () => void {
  return () => {
    check_overrides(GAME_SETTINGS, overrides);
  };
}

describe('settings override types without core-spec/', () => {
  it('a checkout without core-spec/ throws for a non-integer of an integer key, a wrong value of a nullable key and a wrong array element', () => {
    expect(existsSync(new URL('../../../../core-spec/', import.meta.url))).toBe(false);
    expect(check({ 'routing.userRateLimitPerMinute': 1.5 })).toThrow(/routing\.userRateLimitPerMinute is 1\.5, not integer/);
    expect(check({ 'auth.inactiveGuestDeleteAfterMs': 'abc' })).toThrow(/auth\.inactiveGuestDeleteAfterMs is "abc", not integer\?/);
    expect(check({ 'environments.<ENV>.trustedProxyCount': 0.5 })).toThrow(/trustedProxyCount is 0\.5, not integer/);
    expect(check({ 'environments.<ENV>.updatePublicKeys': [1] })).toThrow(/updatePublicKeys is \[1\], not array<string>/);
    expect(check({ 'no-module.noKey': 1 })).toThrow(/no-module\.noKey/);
  });

  it('a checkout without core-spec/ takes values of the spec type', () => {
    expect(
      check({
        'routing.userRateLimitPerMinute': 2,
        'auth.inactiveGuestDeleteAfterMs': 86_400_000,
        'environments.<ENV>.trustedProxyCount': 1,
        'environments.<ENV>.updatePublicKeys': ['key'],
      }),
    ).not.toThrow();
    expect(check({ 'auth.inactiveGuestDeleteAfterMs': null })).not.toThrow();
  });
});
