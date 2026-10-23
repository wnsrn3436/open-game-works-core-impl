/**
 * `public-profile` through a test server: field validation, response delta, request start and withdrawal as
 * `routing` and `auth` run them.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { Storage } from '../../storage/index.ts';
import { storage_module } from '../../storage/tests/helpers.ts';
import {
  advance_time,
  core_test_register,
  login,
  read_logs,
  read_user_state,
  send,
  start_test_server,
  stop_test_server,
  type TestServer,
  type TestSession,
} from '../../testing/dev/index.ts';
import { ACTIVITY_TABLE, type BuildPublicProfileHook } from '../index.ts';

const START = 1_800_000_123_456n;
const GRANULARITY = 60_000n;
const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
const INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;

/** The server modules of these tests: `routing`, its dependency closure with `cheat`, `nickname` and `public-profile`. */
const SERVER_MODULES = [
  'admin-api',
  'auth',
  'cheat',
  'game-update',
  'idempotency',
  'item-ledger',
  'logging',
  'mailbox',
  'nickname',
  'public-profile',
  'routing',
  'server-time',
  'session',
  'storage',
  'validation',
];

interface RegisterCore {
  readonly routing: { register_hook(module: string, hook: string, fn: unknown): void };
}

interface Started {
  readonly server: TestServer;
  /** The `storage` module object of the running server instance; content `register(core)` gets only its member `content`. */
  storage(): Storage;
}

const servers: TestServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await stop_test_server(server);
});

async function start(settings: Readonly<Record<string, unknown>> = {}, hook: BuildPublicProfileHook | null = null): Promise<Started> {
  const register = (core: Readonly<Record<string, unknown>>): void => {
    const own = core as unknown as RegisterCore;
    if (hook !== null) own.routing.register_hook('public-profile', 'build_public_profile', hook);
    core_test_register(core);
  };
  const server = await start_test_server(
    START,
    undefined,
    undefined,
    undefined,
    undefined,
    { 'public-profile.lastActiveGranularityMs': Number(GRANULARITY), ...settings },
    register,
    undefined,
    SERVER_MODULES,
  );
  servers.push(server);
  return { server, storage: () => storage_module(server) };
}

function floor_to(time: bigint, unit: bigint): bigint {
  return (time / unit) * unit;
}

async function get_profiles(session: TestSession, user_ids: readonly bigint[]): Promise<{ envelope: CoreContract.ResponseEnvelope; response: CoreContract.GetPublicProfilesResponse | null }> {
  const message = new CoreContract.GetPublicProfilesRequest();
  message.user_ids = [...user_ids];
  const result = await send(session, 'core/GetPublicProfiles', message);
  return { envelope: result.envelope, response: result.response as CoreContract.GetPublicProfilesResponse | null };
}

async function error_code(session: TestSession, user_ids: readonly bigint[]): Promise<number> {
  return (await get_profiles(session, user_ids)).envelope.error?.code ?? 0;
}

async function last_active(viewer: TestSession, user_id: bigint): Promise<bigint | undefined> {
  const { response } = await get_profiles(viewer, [user_id]);
  return response?.profiles[0]?.last_active_at;
}

function stored_row_count(storage: Storage, user_id: bigint): number {
  return storage.read_db().query(`SELECT user_id FROM ${ACTIVITY_TABLE} WHERE user_id = $1`, [user_id]).length;
}

describe('GetPublicProfiles request', () => {
  it('is INVALID_REQUEST for over the limit, an empty list, a 0 element and duplicates', async () => {
    const { server } = await start();
    const viewer = await login(server, 'viewer');
    const limit = 100n;
    const over = Array.from({ length: Number(limit) + 1 }, (_, i) => BigInt(i) + 1n);

    expect(await error_code(viewer, over)).toBe(INVALID_REQUEST);
    expect(await error_code(viewer, [])).toBe(INVALID_REQUEST);
    expect(await error_code(viewer, [0n])).toBe(INVALID_REQUEST);
    expect(await error_code(viewer, [viewer.user_id, viewer.user_id])).toBe(INVALID_REQUEST);
    expect(await error_code(viewer, [viewer.user_id])).toBe(0);
  });

  it('leaves the stored state as it was and has an empty user_state in the response', async () => {
    const { server } = await start();
    const [viewer, other] = [await login(server, 'viewer'), await login(server, 'other')];
    const message = new CoreContract.SetNicknameRequest();
    message.nickname = 'other';
    expect((await send(other, 'core/SetNickname', message)).envelope.error).toBeNull();
    await get_profiles(viewer, [other.user_id]);
    const before = [await read_user_state(server, viewer.user_id), await read_user_state(server, other.user_id)];

    const { envelope, response } = await get_profiles(viewer, [viewer.user_id, other.user_id]);

    expect(envelope.error).toBeNull();
    expect(response?.profiles.map((p) => [p.user_id, p.nickname])).toEqual([
      [viewer.user_id, ''],
      [other.user_id, 'other'],
    ]);
    expect(envelope.user_state?.entries ?? []).toEqual([]);
    expect([await read_user_state(server, viewer.user_id), await read_user_state(server, other.user_id)]).toEqual(before);
  });

  it('is INTERNAL and leaves the stored state when the hook reads a kind that is not public or gives too many bytes', async () => {
    let mode: 'private' | 'large' = 'private';
    let storage: Storage | null = null;
    const hook: BuildPublicProfileHook = (ctx, user_id) => {
      if (mode === 'private') storage?.read_public_state(ctx, [user_id], CoreContract.NicknameUserState);
      return new Uint8Array(mode === 'large' ? 5 : 0);
    };
    const started = await start({ 'public-profile.maxProfileBytes': 4 }, hook);
    storage = started.storage();
    const [viewer, other] = [await login(started.server, 'viewer'), await login(started.server, 'other')];
    const before = await read_user_state(started.server, other.user_id);

    expect(await error_code(viewer, [other.user_id])).toBe(INTERNAL);
    mode = 'large';
    expect(await error_code(viewer, [other.user_id])).toBe(INTERNAL);
    expect(await read_user_state(started.server, other.user_id)).toEqual(before);
    // One `error` log per failed request, `routing`'s, with the target user ID in the thrown message.
    const errors = read_logs(started.server, 'error');
    expect(errors.map((line) => line.request)).toEqual(['core/GetPublicProfiles', 'core/GetPublicProfiles']);
    for (const line of errors) expect(String(line.stack_trace)).toContain(`user ${other.user_id.toString()}`);
  });
});

describe('last active through requests', () => {
  it('is clock_now at request start rounded down, unchanged by a request in the same unit, and moves with the next unit', async () => {
    const { server } = await start();
    const viewer = await login(server, 'viewer');
    const user = await login(server, 'user');
    const first = floor_to(START, GRANULARITY);

    expect(await last_active(viewer, user.user_id)).toBe(first);
    advance_time(server, GRANULARITY - (START % GRANULARITY) - 1n);
    await get_profiles(user, [user.user_id]);
    expect(await last_active(viewer, user.user_id)).toBe(first);

    advance_time(server, 1n);
    await get_profiles(user, [user.user_id]);
    expect(await last_active(viewer, user.user_id)).toBe(first + GRANULARITY);
  });

  it('is recorded by Login', async () => {
    const { server } = await start();
    const viewer = await login(server, 'viewer');
    advance_time(server, 3n * GRANULARITY);
    const terms = await send(viewer, 'core/GetTerms', new CoreContract.GetTermsRequest());
    const message = new CoreContract.LoginRequest();
    message.provider = CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST;
    message.agreements = ((terms.response as CoreContract.GetTermsResponse | null)?.documents ?? []).map((document) => {
      const agreement = new CoreContract.TermsAgreement();
      agreement.item = document.item;
      agreement.version = document.version;
      return agreement;
    });

    const result = await send(viewer, 'core/Login', message);

    expect(result.envelope.error).toBeNull();
    const user_id = (result.response as CoreContract.LoginResponse | null)?.result?.user_id ?? 0n;
    expect(await last_active(viewer, user_id)).toBe(floor_to(START + 3n * GRANULARITY, GRANULARITY));
  });

  it('is 0 for every user when public-profile.lastActiveGranularityMs is 0', async () => {
    const { server } = await start({ 'public-profile.lastActiveGranularityMs': 0 });
    const [viewer, user] = [await login(server, 'viewer'), await login(server, 'user')];

    expect(await last_active(viewer, user.user_id)).toBe(0n);
    expect(await last_active(viewer, viewer.user_id)).toBe(0n);
  });

  it('has no public_profile_activity row of the user after Withdraw', async () => {
    const started = await start();
    const user = await login(started.server, 'user');
    expect(stored_row_count(started.storage(), user.user_id)).toBe(1);

    const result = await send(user, 'core/Withdraw', new CoreContract.WithdrawRequest());

    expect(result.envelope.error).toBeNull();
    expect(stored_row_count(started.storage(), user.user_id)).toBe(0);
  });
});
