import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import type { ParamList } from '../index.ts';
import { admin_list, advance, CoreError, new_user, request, rows, sent_events, settle, START_TIME, start, stop_all, user, type Server } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const Kind = CoreContract.AnalyticsParamKind;
const RETENTION_MS = 7_776_000_000n;

/** A request whose handler tracks; `result` is what the handler returns after tracking. */
function tracked(server: Server, user_id: bigint, track: (ctx: RequestCtx) => void, result: () => unknown = () => new CoreContract.ResyncResponse()): Promise<{ code: number; request_id: string }> {
  return request(server, user_id, 'Resync', (ctx) => {
    track(ctx);
    return result();
  });
}

function event_rows(server: Server, user_id: bigint): Record<string, unknown>[] {
  return rows(server, 'SELECT * FROM logging_server_event WHERE user_id = $1 ORDER BY seq', [user_id]);
}

describe('track', () => {
  it('stores a logging_server_event row and the fake adapter gets the event after commit for a consenting user', async () => {
    const server = await start();
    const user_id = await user(server);
    const params: ParamList = [
      ['stage', 3n],
      ['wave', 2],
      ['ratio', 0.25],
      ['boss', 'ogre'],
      ['first', true],
    ];
    const result = await tracked(server, user_id, (ctx) => {
      expect(server.logging.track(ctx, 'stage_clear', params)).toBeNull();
      expect(sent_events(server)).toEqual([]);
    });
    expect(result.code).toBe(0);
    await settle(server);
    const [row, ...rest] = event_rows(server, user_id);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      user_id,
      seq: 1n,
      time_at: START_TIME,
      request_id: result.request_id,
      client_version: '1.2.3',
      platform: 'android',
      name: 'stage_clear',
      expires_at: START_TIME + RETENTION_MS,
    });
    const stored = CoreContract.AnalyticsEvent.decode(row?.params as Uint8Array)?.params ?? [];
    expect(stored.map((p) => [p.key, p.kind, p.int_value, p.double_value, p.string_value, p.bool_value])).toEqual([
      ['stage', Kind.ANALYTICS_PARAM_KIND_INT, 3n, 0, '', false],
      ['wave', Kind.ANALYTICS_PARAM_KIND_INT, 2n, 0, '', false],
      ['ratio', Kind.ANALYTICS_PARAM_KIND_DOUBLE, 0n, 0.25, '', false],
      ['boss', Kind.ANALYTICS_PARAM_KIND_STRING, 0n, 0, 'ogre', false],
      ['first', Kind.ANALYTICS_PARAM_KIND_BOOL, 0n, 0, '', true],
    ]);
    expect(sent_events(server).map((e) => [e.user_id, e.name, e.time_at, e.params.length])).toEqual([[user_id, 'stage_clear', START_TIME, 5]]);
    await tracked(server, user_id, (ctx) => {
      server.logging.track_core_event(ctx, 'core_shop_bought', [
        ['product_id', 7],
        ['quantity', 2n],
      ]);
    });
    await settle(server);
    expect(event_rows(server, user_id).map((r) => [r.seq, r.name])).toEqual([
      [1n, 'stage_clear'],
      [2n, 'core_shop_bought'],
    ]);
  });

  it('leaves neither a row nor a sent event for a request that ends with a GameError, or for a user without consent', async () => {
    const server = await start();
    const user_id = await user(server);
    const game_error = await tracked(
      server,
      user_id,
      (ctx) => {
        server.logging.track(ctx, 'stage_clear', []);
      },
      () => 3,
    );
    expect(game_error.code).toBe(3);
    const refused = await new_user(server);
    const without = await user(server, false);
    for (const id of [refused, without]) {
      if (id === refused) {
        const consent = new CoreContract.ConsentUserState();
        consent.analytics_allowed = false;
        await server.storage.run_user_transaction(id, (ctx) => {
          server.storage.put_core_state(ctx, consent);
          return 'pass';
        });
      }
      expect((await tracked(server, id, (ctx) => server.logging.track(ctx, 'stage_clear', []))).code).toBe(0);
    }
    await settle(server);
    for (const id of [user_id, refused, without]) expect(event_rows(server, id)).toEqual([]);
    expect(sent_events(server)).toEqual([]);
    expect(server.lines.filter((line) => line.includes('stage_clear'))).toEqual([]);
  });

  it('stores an integer number outside the safe integer range as INT, and is INTERNAL for an integer number outside int64', async () => {
    const server = await start();
    const user_id = await user(server);
    const big = 2 ** 53;
    const ok = await tracked(server, user_id, (ctx) => {
      server.logging.track(ctx, 'stage_clear', [
        ['score', big],
        ['low', -(2 ** 63)],
      ]);
      server.logging.track_core_event(ctx, 'core_iap_granted', [
        ['product_id', 1],
        ['store', 'IAP_STORE_APPLE'],
        ['spend_amount', big],
        ['test', false],
        ['renewal', false],
      ]);
    });
    expect(ok.code).toBe(0);
    const stored = event_rows(server, user_id).map((row) => (CoreContract.AnalyticsEvent.decode(row.params as Uint8Array)?.params ?? []).map((p) => [p.key, p.kind, p.int_value]));
    expect(stored).toEqual([
      [
        ['score', Kind.ANALYTICS_PARAM_KIND_INT, 2n ** 53n],
        ['low', Kind.ANALYTICS_PARAM_KIND_INT, -(2n ** 63n)],
      ],
      [
        ['product_id', Kind.ANALYTICS_PARAM_KIND_INT, 1n],
        ['store', Kind.ANALYTICS_PARAM_KIND_STRING, 0n],
        ['spend_amount', Kind.ANALYTICS_PARAM_KIND_INT, 2n ** 53n],
        ['test', Kind.ANALYTICS_PARAM_KIND_BOOL, 0n],
        ['renewal', Kind.ANALYTICS_PARAM_KIND_BOOL, 0n],
      ],
    ]);
    for (const value of [2 ** 63, -(2 ** 64)]) {
      expect((await tracked(server, user_id, (ctx) => server.logging.track(ctx, 'stage_clear', [['score', value]]))).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    }
    expect(event_rows(server, user_id)).toHaveLength(2);
  });

  it('is INTERNAL for a track name starting with core_, a key that is not snake_case, and a track_core_event name not in the table', async () => {
    const server = await start();
    const user_id = await user(server);
    const bad: ((ctx: RequestCtx) => void)[] = [
      (ctx) => server.logging.track(ctx, 'core_user_created', [['provider', 'guest']]),
      (ctx) => server.logging.track(ctx, 'stage_clear', [['Stage', 1]]),
      (ctx) => server.logging.track_core_event(ctx, 'core_unknown', []),
      (ctx) => server.logging.track(ctx, 'stage_clear', [['ratio', Number.NaN]]),
      (ctx) => server.logging.track(ctx, 'stage_clear', [['stage', 1], ['stage', 2]]),
      (ctx) => server.logging.track_core_event(ctx, 'core_shop_bought', [['product_id', 'seven'], ['quantity', 1]]),
      (ctx) => server.logging.track_core_event(ctx, 'core_shop_bought', [['product_id', 7]]),
    ];
    for (const track of bad) expect((await tracked(server, user_id, track)).code).toBe(CoreError.CORE_ERROR_INTERNAL);
    await settle(server);
    expect(event_rows(server, user_id)).toEqual([]);
    expect(sent_events(server)).toEqual([]);
  });
});

describe('list_server_events', () => {
  it('returns the rows of [from_at, to_at) by (time_at, user_id, seq), at most limit, and deletes rows after the retention period', async () => {
    const server = await start();
    const a = await user(server);
    const b = await user(server);
    const [first, second] = a < b ? [a, b] : [b, a];
    const track = (id: bigint, name: string): Promise<unknown> => tracked(server, id, (ctx) => server.logging.track(ctx, name, []));
    await track(second, 'e1');
    await track(first, 'e2');
    await track(first, 'e3');
    await advance(server, 10n);
    await track(first, 'e4');
    await advance(server, 10n);
    await track(second, 'e5');
    const names = async (input: Record<string, unknown>): Promise<unknown> => {
      const entries = await admin_list(server, 'list_server_events', input);
      return Array.isArray(entries) ? entries.map((e) => e.name) : entries;
    };
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 20n, limit: 10 })).toEqual(['e2', 'e3', 'e1', 'e4']);
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 21n, limit: 2 })).toEqual(['e2', 'e3']);
    expect(await names({ from_at: START_TIME + 1n, to_at: START_TIME + 21n, limit: 10 })).toEqual(['e4', 'e5']);
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 21n, limit: 10, name: 'e3' })).toEqual(['e3']);
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 21n, limit: 10, user_id: second })).toEqual(['e1', 'e5']);
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 21n, limit: 10, after_time_at: START_TIME, after_user_id: first, after_seq: 2n })).toEqual(['e1', 'e4', 'e5']);
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 21n, limit: 10, after_seq: 2n })).toBe('bad_request');
    const entry = (await admin_list(server, 'list_server_events', { from_at: START_TIME, to_at: START_TIME + 1n, limit: 1 })) as Record<string, unknown>[];
    expect(Object.keys(entry[0] ?? {})).toEqual(['user_id', 'seq', 'time_at', 'request_id', 'client_version', 'platform', 'name', 'params', 'expires_at']);
    expect(entry[0]).toMatchObject({ user_id: first.toString(), seq: '1', time_at: START_TIME.toString() });

    await advance(server, RETENTION_MS - 20n);
    expect(await names({ from_at: START_TIME, to_at: START_TIME + 21n, limit: 10 })).toEqual(['e4', 'e5']);
    await server.storage.sweep_expired();
    expect(event_rows(server, first).map((r) => r.name)).toEqual(['e4']);
    await advance(server, 20n);
    await server.storage.sweep_expired();
    expect([...event_rows(server, first), ...event_rows(server, second)]).toEqual([]);
  });
});
