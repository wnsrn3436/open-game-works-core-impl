import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { ProfileUserState, QuestUserState, profile, quest } from '../../storage/tests/kinds.ts';
import type { BuildPublicProfileHook } from '../index.ts';
import { START, get_profiles, new_user, request, set_nickname, start, stop_all, withdraw, type Instance } from './helpers.ts';

const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

afterEach(() => {
  stop_all();
});

/** The hook of a game whose `PublicProfile` is its public kind `ProfileUserState`: empty bytes when the user has none. */
function profile_hook(instance: Instance): BuildPublicProfileHook {
  return (ctx, user_id) => {
    const [entry] = instance.storage.read_public_state(ctx, [user_id], ProfileUserState);
    return entry === undefined ? new Uint8Array(0) : (entry.value as ProfileUserState).encode();
  };
}

async function put_profile(instance: Instance, user_id: bigint, level: bigint): Promise<void> {
  await request(instance, user_id, 'Test', (ctx) => {
    instance.storage.put_state(ctx, profile(level));
  });
}

function profiles_of(result: CoreContract.GetPublicProfilesResponse | number): CoreContract.PublicProfileEntry[] {
  if (!(result instanceof CoreContract.GetPublicProfilesResponse)) throw new Error(`GetPublicProfiles failed: ${String(result)}`);
  return result.profiles;
}

function error_lines(instance: Instance): Record<string, unknown>[] {
  return instance.logs('error');
}

describe('profile build', () => {
  it('gives the profile from the public kind and the nickname of other users in user ID order, the own user too', async () => {
    const instance = await start();
    // In user ID order: user IDs are random, so the order the users were made is not it.
    const [a, b, c] = [await new_user(instance), await new_user(instance), await new_user(instance)].sort((x, y) => (x < y ? -1 : 1)) as [bigint, bigint, bigint];
    await set_nickname(instance, a, 'alice');
    await set_nickname(instance, c, 'carol');
    await put_profile(instance, b, 7n);
    await put_profile(instance, c, 9n);
    instance.profile.hook_slots.build_public_profile = profile_hook(instance);

    const entries = profiles_of(await get_profiles(instance, a, [c, a, b]));

    expect(entries.map((e) => e.user_id)).toEqual([a, b, c]);
    expect(entries.map((e) => e.nickname)).toEqual(['alice', '', 'carol']);
    expect(entries.map((e) => [...e.profile])).toEqual([[], [...profile(7n).encode()], [...profile(9n).encode()]]);
  });

  it('builds the own profile through the hook with the ctx of the requesting user', async () => {
    const instance = await start();
    const a = await new_user(instance);
    await put_profile(instance, a, 3n);
    const seen: bigint[] = [];
    const hook = profile_hook(instance);
    instance.profile.hook_slots.build_public_profile = (ctx, user_id) => {
      seen.push(ctx.user_id, user_id);
      return hook(ctx, user_id);
    };

    const entries = profiles_of(await get_profiles(instance, a, [a]));

    expect(seen).toEqual([a, a]);
    expect([...(entries[0]?.profile ?? [])]).toEqual([...profile(3n).encode()]);
  });

  it('leaves out user IDs with no user and withdrawn users', async () => {
    const instance = await start();
    const [a, gone] = [await new_user(instance), await new_user(instance)];
    await set_nickname(instance, gone, 'ghost');
    await withdraw(instance, gone);
    instance.profile.hook_slots.build_public_profile = profile_hook(instance);

    const entries = profiles_of(await get_profiles(instance, a, [gone, a, 999_999n]));

    expect(entries.map((e) => e.user_id)).toEqual([a]);
  });

  it('gives empty profile bytes and fills the nickname without the hook', async () => {
    const instance = await start();
    const [a, b] = [await new_user(instance), await new_user(instance)];
    await set_nickname(instance, b, 'bob');
    await put_profile(instance, b, 5n);

    const entries = profiles_of(await get_profiles(instance, a, [b]));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.nickname).toBe('bob');
    expect(entries[0]?.profile).toEqual(new Uint8Array(0));
  });

  it('get_public_profiles from a content handler gives the same entries as GetPublicProfiles', async () => {
    const instance = await start({ 'public-profile.maxRequestCount': 2 });
    const [a, b] = [await new_user(instance), await new_user(instance)];
    await set_nickname(instance, b, 'bob');

    const entries = await request(instance, a, 'Test', (ctx) => instance.profile.get_public_profiles(ctx, [b, a]));
    expect(entries.map((e) => [e.user_id, e.nickname])).toEqual([
      [a, ''],
      [b, 'bob'],
    ]);
  });

  it('get_public_profiles of public-profile.maxRequestCount × 2 + 1 users gives every active user in user ID order without a throw', async () => {
    const max = 2;
    const instance = await start({ 'public-profile.maxRequestCount': max, 'public-profile.lastActiveGranularityMs': 60_000 });
    const users: bigint[] = [];
    for (let i = 0; i < max * 2 + 1; i += 1) users.push(await new_user(instance));
    users.sort((x, y) => (x < y ? -1 : 1));
    const name = (user: bigint): string => `user${String(users.indexOf(user))}`;
    for (const user of users) await set_nickname(instance, user, name(user));
    for (const user of users) await instance.profile.on_request_start(user);
    await put_profile(instance, users[4] as bigint, 6n);
    instance.profile.hook_slots.build_public_profile = profile_hook(instance);
    const lookups: number[] = [];
    const get_nicknames = instance.nickname.get_nicknames.bind(instance.nickname);
    instance.nickname.get_nicknames = (ctx, user_ids) => {
      lookups.push(user_ids.length);
      return get_nicknames(ctx, user_ids);
    };
    const last_active = (START / 60_000n) * 60_000n;

    const entries = await request(instance, users[0] as bigint, 'Test', (ctx) => instance.profile.get_public_profiles(ctx, [...users].reverse()));

    expect(entries.map((e) => e.user_id)).toEqual(users);
    expect(entries.map((e) => e.nickname)).toEqual(users.map(name));
    expect(entries.map((e) => e.last_active_at)).toEqual(users.map(() => last_active));
    expect([...(entries[4]?.profile ?? [])]).toEqual([...profile(6n).encode()]);
    expect(lookups).toEqual([2, 2, 1]);
  });
});

// A hook failure throws with the target user ID in the message; the request's `error` log is `routing`'s, so
// public-profile writes none of its own.
describe('hook failures', () => {
  it('throws when the hook reads a kind that is not public with read_public_state, and the stored state stays', async () => {
    const instance = await start();
    const [a, b] = [await new_user(instance), await new_user(instance)];
    await request(instance, b, 'Test', (ctx) => {
      instance.storage.put_state(ctx, quest(1n, 4n));
    });
    instance.profile.hook_slots.build_public_profile = (ctx, user_id) => {
      instance.storage.read_public_state(ctx, [user_id], QuestUserState);
      return new Uint8Array(0);
    };

    await expect(get_profiles(instance, a, [b])).rejects.toThrow(`user ${b.toString()}`);

    const quests = await request(instance, b, 'Test', (ctx) => instance.storage.list_state(ctx, QuestUserState));
    expect(quests).toEqual([quest(1n, 4n)]);
    expect(error_lines(instance)).toEqual([]);
  });

  it('throws when the hook calls put_state, and nothing is written', async () => {
    const instance = await start();
    const [a, b] = [await new_user(instance), await new_user(instance)];
    instance.profile.hook_slots.build_public_profile = (ctx) => {
      instance.storage.put_state(ctx, quest(2n, 1n));
      return new Uint8Array(0);
    };

    await expect(get_profiles(instance, a, [b])).rejects.toThrow(`user ${b.toString()}`);

    const quests = await request(instance, a, 'Test', (ctx) => instance.storage.list_state(ctx, QuestUserState));
    expect(quests).toEqual([]);
    expect(error_lines(instance)).toEqual([]);
  });

  it('throws when the hook output is over public-profile.maxProfileBytes and passes at the limit', async () => {
    const instance = await start({ 'public-profile.maxProfileBytes': 4 });
    const [a, b] = [await new_user(instance), await new_user(instance)];
    let size = 4;
    instance.profile.hook_slots.build_public_profile = () => new Uint8Array(size).fill(1);

    expect(profiles_of(await get_profiles(instance, a, [b]))[0]?.profile).toHaveLength(4);
    size = 5;
    await expect(get_profiles(instance, a, [b])).rejects.toThrow(`user ${b.toString()}`);
    expect(error_lines(instance)).toEqual([]);
  });

  it('throws when the hook output is not bytes', async () => {
    const instance = await start();
    const [a, b] = [await new_user(instance), await new_user(instance)];
    instance.profile.hook_slots.build_public_profile = (() => 'not bytes') as unknown as BuildPublicProfileHook;

    await expect(get_profiles(instance, a, [b])).rejects.toThrow(`user ${b.toString()}`);
    expect(error_lines(instance)).toEqual([]);
  });
});

describe('GetPublicProfiles', () => {
  it('is INVALID_REQUEST for over the limit, an empty list, a 0 element and duplicates', async () => {
    const instance = await start({ 'public-profile.maxRequestCount': 2 });
    const [a, b, c] = [await new_user(instance), await new_user(instance), await new_user(instance)];

    expect(await get_profiles(instance, a, [a, b, c])).toBe(INVALID_REQUEST);
    expect(await get_profiles(instance, a, [])).toBe(INVALID_REQUEST);
    expect(await get_profiles(instance, a, [0n])).toBe(INVALID_REQUEST);
    expect(await get_profiles(instance, a, [b, b])).toBe(INVALID_REQUEST);
    expect(profiles_of(await get_profiles(instance, a, [a, b]))).toHaveLength(2);
  });

  it('leaves the stored state as it was and makes an empty UserState delta', async () => {
    const instance = await start();
    const [a, b] = [await new_user(instance), await new_user(instance)];
    await set_nickname(instance, b, 'bob');
    await put_profile(instance, b, 2n);
    instance.profile.hook_slots.build_public_profile = profile_hook(instance);
    const message = new CoreContract.GetPublicProfilesRequest();
    message.user_ids = [a, b];
    const read_rows = (user_id: bigint): Promise<unknown> => request(instance, user_id, 'Test', (ctx) => instance.storage.read_user_rows(ctx));
    const before = [await read_rows(a), await read_rows(b)];

    const delta = await request(instance, a, 'core/GetPublicProfiles', (ctx) => {
      const response = instance.profile.GetPublicProfiles(ctx, message);
      expect(response).toBeInstanceOf(CoreContract.GetPublicProfilesResponse);
      return instance.storage.take_response_delta(ctx).delta;
    });

    expect(delta.user_state.entries).toEqual([]);
    expect([await read_rows(a), await read_rows(b)]).toEqual(before);
  });
});

describe('is_active_user', () => {
  it('is false for a user ID with no user and a withdrawn user and true for a user', async () => {
    const instance = await start();
    const [a, gone] = [await new_user(instance), await new_user(instance)];
    await withdraw(instance, gone);

    const result = await request(instance, a, 'Test', (ctx) => [
      instance.profile.is_active_user(ctx, a),
      instance.profile.is_active_user(ctx, gone),
      instance.profile.is_active_user(ctx, 999_999n),
    ]);

    expect(result).toEqual([true, false, false]);
  });
});

describe('count_find_attempt', () => {
  it('is UNAUTHORIZED for a withdrawn user, counts nothing for it, and counts the user of each call', async () => {
    const instance = await start({ 'public-profile.findPerMinute': 2 });
    const [a, gone] = [await new_user(instance), await new_user(instance)];
    await withdraw(instance, gone);
    expect(await instance.profile.count_find_attempt(gone)).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
    expect(instance.storage.read_db().query('SELECT user_id FROM public_profile_find_counter WHERE user_id = $1', [gone])).toEqual([]);
    expect(await instance.profile.count_find_attempt(a)).toBe('pass');
    expect(await instance.profile.count_find_attempt(a)).toBe('pass');
    expect(await instance.profile.count_find_attempt(a)).toBe(CoreContract.CoreError.CORE_ERROR_RATE_LIMITED);
  });
});
