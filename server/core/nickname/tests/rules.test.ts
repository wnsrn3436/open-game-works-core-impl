import { advance_time, read_logs, read_user_state, stop_test_server } from '../../testing/dev/index.ts';
import { CoreError, gems, id_value, nickname_state, set_gems, set_nickname, start, users } from './helpers.ts';

/** Rules settings these tests fix so they do not follow the core settings defaults. */
const RULES = {
  'nickname.minLength': 2,
  'nickname.maxLength': 8,
  'nickname.allowedScripts': ['Latin', 'Hangul'],
  'nickname.allowedSymbols': '_',
};

describe('character rules', () => {
  it('each character rule fails with NICKNAME_INVALID, and the lengths nickname.minLength and nickname.maxLength pass', async () => {
    const h = await start(false, RULES);
    try {
      const [bad, min, max, mixed] = await users(h.server, ['bad', 'min', 'max', 'mixed']);
      const invalid = [
        ' ab', // not plain text: leading White_Space
        'ab\u0007c', // not plain text: C0 control
        'a', // shorter than nickname.minLength
        'abcdefghi', // longer than nickname.maxLength
        'abπc', // a script not in nickname.allowedScripts
        'ab日c', // Han is not allowed here
        'ab!c', // a symbol not in nickname.allowedSymbols
        'ab  cd', // two U+0020 in a row
      ];
      for (const nickname of invalid) expect({ nickname, code: (await set_nickname(bad, nickname)).code }).toEqual({ nickname, code: CoreError.CORE_ERROR_NICKNAME_INVALID });
      expect(await read_user_state(h.server, bad.user_id)).not.toContainEqual(expect.objectContaining({ kind: 'NicknameUserState' }));

      expect(await set_nickname(min, 'ab')).toMatchObject({ code: 0, nickname: 'ab' });
      expect(await set_nickname(max, 'abcdefgh')).toMatchObject({ code: 0, nickname: 'abcdefgh' });
      expect(await set_nickname(mixed, '가나_1 b')).toMatchObject({ code: 0, nickname: '가나_1 b' });
    } finally {
      await stop_test_server(h.server);
    }
  });

  it('counts the lengths in code points: one character outside the BMP is NICKNAME_INVALID under nickname.minLength 2, and nickname.maxLength of them pass', async () => {
    const h = await start(false, { ...RULES, 'nickname.maxLength': 4, 'nickname.allowedScripts': ['Han'] });
    try {
      const [bad, max] = await users(h.server, ['bad', 'max']);
      // U+20000.. are Han characters of the CJK Unified Ideographs Extension B, two UTF-16 code units each.
      expect((await set_nickname(bad, '\u{20000}')).code).toBe(CoreError.CORE_ERROR_NICKNAME_INVALID);
      expect((await set_nickname(bad, '\u{20000}\u{20001}\u{20002}\u{20003}\u{20004}')).code).toBe(CoreError.CORE_ERROR_NICKNAME_INVALID);
      expect(await read_user_state(h.server, bad.user_id)).not.toContainEqual(expect.objectContaining({ kind: 'NicknameUserState' }));
      expect(await set_nickname(max, '\u{20000}\u{20001}\u{20002}\u{20003}')).toMatchObject({ code: 0, nickname: '\u{20000}\u{20001}\u{20002}\u{20003}' });
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('SetNickname order', () => {
  it('for a user in the cooldown with a short balance, a rule failure comes before the cooldown and the cooldown before the cost, and the balance stays', async () => {
    const h = await start(true, { 'nickname.changeCooldownMs': 1000 });
    try {
      const [a, owner] = await users(h.server, ['a', 'owner']);
      expect((await set_nickname(owner, 'Owner')).code).toBe(0);
      expect((await set_nickname(a, 'First')).code).toBe(0);
      // Change 1 costs 10 of the cost item; 5 is short.
      await set_gems(h.server, a.user_id, 5n);
      const failures: [string, number][] = [
        ['a', CoreError.CORE_ERROR_NICKNAME_INVALID],
        ['BadWord', CoreError.CORE_ERROR_NICKNAME_BANNED],
        ['OWNER', CoreError.CORE_ERROR_NICKNAME_TAKEN],
        ['Second', CoreError.CORE_ERROR_NICKNAME_COOLDOWN],
      ];
      for (const [nickname, code] of failures) expect({ nickname, code: (await set_nickname(a, nickname)).code }).toEqual({ nickname, code });
      advance_time(h.server, 1000n);
      expect((await set_nickname(a, 'Second')).code).toBe(CoreError.CORE_ERROR_ITEM_NOT_ENOUGH);
      expect(await nickname_state(h.server, a.user_id)).toMatchObject({ nickname: 'First', change_count: 0 });
      expect(await gems(h.server, a.user_id)).toBe(5n);
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('banned word', () => {
  it('a banned word that differs only in case, full width or spaces is NICKNAME_BANNED with an info log of the matched banned_word ID value', async () => {
    const h = await start(false);
    try {
      const [a, b, c] = await users(h.server, ['a', 'b', 'c']);
      expect((await set_nickname(a, 'Bad Word')).code).toBe(CoreError.CORE_ERROR_NICKNAME_BANNED);
      expect((await set_nickname(a, 'ＢＡＤＷＯＲＤ')).code).toBe(CoreError.CORE_ERROR_NICKNAME_BANNED);
      expect((await set_nickname(a, 'Ｂａｄ ｗｏｒｄ')).code).toBe(CoreError.CORE_ERROR_NICKNAME_BANNED);
      expect((await set_nickname(b, 'xxbadwordx')).code).toBe(CoreError.CORE_ERROR_NICKNAME_BANNED);
      expect(await read_user_state(h.server, a.user_id)).not.toContainEqual(expect.objectContaining({ kind: 'NicknameUserState' }));
      expect((await set_nickname(c, 'Bad Wolf')).code).toBe(0);

      // The log line has the module field at the top level or under `fields`.
      const ids = read_logs(h.server, 'core', 'info')
        .map((l) => l['banned_word_id'] ?? (l['fields'] as Record<string, unknown> | undefined)?.['banned_word_id'])
        .filter((v) => v !== undefined)
        .map(Number);
      expect(ids).toEqual([1, 2, 3, 4].map(() => id_value('[banned_en_1]')));
    } finally {
      await stop_test_server(h.server);
    }
  });
});

describe('check_nickname', () => {
  it('ends without a failure value for a nickname that follows the rules and for one another user has, returns NICKNAME_INVALID and NICKNAME_BANNED, and changes no saved state', async () => {
    const h = await start(true);
    try {
      const [owner, other] = await users(h.server, ['owner', 'other']);
      expect((await set_nickname(owner, 'Taken')).code).toBe(0);
      const before = await read_user_state(h.server, other.user_id);
      const nickname = h.nickname();
      expect(nickname.check_nickname('Fresh')).toBeNull();
      expect(nickname.check_nickname('taken')).toBeNull();
      expect(nickname.check_nickname('a')).toBe(CoreError.CORE_ERROR_NICKNAME_INVALID);
      expect(nickname.check_nickname('ab  c')).toBe(CoreError.CORE_ERROR_NICKNAME_INVALID);
      expect(nickname.check_nickname('BadWord')).toBe(CoreError.CORE_ERROR_NICKNAME_BANNED);
      expect(await read_user_state(h.server, other.user_id)).toEqual(before);
      expect(await read_user_state(h.server, owner.user_id)).toContainEqual(expect.objectContaining({ kind: 'NicknameUserState' }));
      // Nothing was registered for the checked names: another user can still take them.
      expect((await set_nickname(other, 'Fresh')).code).toBe(0);
    } finally {
      await stop_test_server(h.server);
    }
  });
});
