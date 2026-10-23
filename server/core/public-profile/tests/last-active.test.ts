import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { DB_KIND, START, get_profiles, hold_user_lock, new_user, request, start, stop_all, stored_last_active, withdraw, type Instance } from './helpers.ts';

const GRANULARITY = 60_000n;

afterEach(() => {
  stop_all();
});

function floor_to(time: bigint, unit: bigint): bigint {
  return (time / unit) * unit;
}

async function last_active_seen_by(instance: Instance, viewer: bigint, user_id: bigint): Promise<bigint | undefined> {
  const result = await get_profiles(instance, viewer, [user_id]);
  if (!(result instanceof CoreContract.GetPublicProfilesResponse)) throw new Error(`GetPublicProfiles failed: ${String(result)}`);
  return result.profiles[0]?.last_active_at;
}

describe('last active', () => {
  it('is clock_now at request start rounded down to public-profile.lastActiveGranularityMs, and the next start in the same unit writes nothing', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY), 'storage.userLockWaitMs': 200 });
    const [viewer, user] = [await new_user(instance), await new_user(instance)];

    await instance.profile.on_request_start(user);
    expect(await last_active_seen_by(instance, viewer, user)).toBe(floor_to(START, GRANULARITY));

    // The same unit: a write would wait for the held user lock and fail with an error log.
    instance.clock.advance(GRANULARITY - (START % GRANULARITY) - 1n);
    const lock = await hold_user_lock(instance, user, DB_KIND === 'postgresql');
    try {
      await instance.profile.on_request_start(user);
    } finally {
      await lock.release();
    }
    expect(instance.logs('error')).toEqual([]);
    expect(stored_last_active(instance, user)).toBe(floor_to(START, GRANULARITY));

    instance.clock.advance(1n);
    await instance.profile.on_request_start(user);
    expect(await last_active_seen_by(instance, viewer, user)).toBe(floor_to(START, GRANULARITY) + GRANULARITY);
  });

  it('is 0 for a user with no record', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY) });
    const [viewer, user] = [await new_user(instance), await new_user(instance)];

    expect(await last_active_seen_by(instance, viewer, user)).toBe(0n);
  });

  it('records nothing when public-profile.lastActiveGranularityMs is 0', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': 0 });
    const [viewer, user] = [await new_user(instance), await new_user(instance)];

    await instance.profile.on_request_start(user);

    expect(stored_last_active(instance, user)).toBeNull();
    expect(await last_active_seen_by(instance, viewer, user)).toBe(0n);
  });

  it('is 0 in a profile when public-profile.lastActiveGranularityMs is 0, even for a user with a stored row', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': 0 });
    const [viewer, user] = [await new_user(instance), await new_user(instance)];
    // A row written while the server ran with another public-profile.lastActiveGranularityMs.
    await request(instance, user, 'Test', (ctx) => {
      instance.storage.db(ctx).query('INSERT INTO public_profile_activity (user_id, last_active_at) VALUES ($1, $2)', [user, floor_to(START, GRANULARITY)]);
    });
    expect(stored_last_active(instance, user)).toBe(floor_to(START, GRANULARITY));

    expect(await last_active_seen_by(instance, viewer, user)).toBe(0n);
  });

  it('leaves one error log when the transaction fails, and the request transaction after it runs', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY), 'storage.userLockWaitMs': 200 });
    const user = await new_user(instance);

    const lock = await hold_user_lock(instance, user, DB_KIND === 'postgresql');
    try {
      await expect(instance.profile.on_request_start(user)).resolves.toBeNull();
    } finally {
      await lock.release();
    }
    const handled = await request(instance, user, 'Test', () => 'handled');

    expect(handled).toBe('handled');
    expect(stored_last_active(instance, user)).toBeNull();
    expect(instance.logs('error')).toEqual([expect.objectContaining({ level: 'error', user_id: user.toString() })]);
  });

  it('does nothing for a withdrawn user and a user ID with no user', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY) });
    const gone = await new_user(instance);
    await withdraw(instance, gone);

    await instance.profile.on_request_start(gone);
    await instance.profile.on_request_start(999_999n);

    expect(stored_last_active(instance, gone)).toBeNull();
    expect(stored_last_active(instance, 999_999n)).toBeNull();
    expect(instance.logs('error')).toEqual([]);
  });

  it('has no public_profile_activity row of a user after the withdrawal', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY) });
    const user = await new_user(instance);
    await instance.profile.on_request_start(user);
    expect(stored_last_active(instance, user)).not.toBeNull();

    await withdraw(instance, user);

    expect(stored_last_active(instance, user)).toBeNull();
  });
});

describe('last active in a transaction', () => {
  it('writes the larger of the stored value and the new value when a larger value commits after the read', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY), 'storage.userLockWaitMs': 5000 });
    const user = await new_user(instance);
    const ahead = floor_to(START, GRANULARITY) + 100n * GRANULARITY;
    // Another request start of the user with a later unit: it holds the user lock and commits its row only after the
    // `read_db` read of this start saw no row, so this start's transaction meets the larger stored value.
    const lock = await hold_user_lock(instance, user, DB_KIND === 'postgresql');
    await lock.query('INSERT INTO public_profile_activity (user_id, last_active_at) VALUES ($1, $2)', [user, ahead]);
    const committed = lock.commit_after(300);

    await instance.profile.on_request_start(user);
    await committed;

    expect(instance.logs('error')).toEqual([]);
    expect(stored_last_active(instance, user)).toBe(ahead);
  });

  it('writes the new value over a smaller stored value that commits after the read', async () => {
    const instance = await start({ 'public-profile.lastActiveGranularityMs': Number(GRANULARITY), 'storage.userLockWaitMs': 5000 });
    const user = await new_user(instance);
    const behind = floor_to(START, GRANULARITY) - GRANULARITY;
    const lock = await hold_user_lock(instance, user, DB_KIND === 'postgresql');
    await lock.query('INSERT INTO public_profile_activity (user_id, last_active_at) VALUES ($1, $2)', [user, behind]);
    const committed = lock.commit_after(300);

    await instance.profile.on_request_start(user);
    await committed;

    expect(instance.logs('error')).toEqual([]);
    expect(stored_last_active(instance, user)).toBe(floor_to(START, GRANULARITY));
  });
});
