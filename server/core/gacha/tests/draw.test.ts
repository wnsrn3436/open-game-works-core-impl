import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { read_logs, read_user_state, send, send_admin, set_time } from '../../testing/dev/index.ts';
import {
  GACHA_SOURCE, INTERNAL, INVALID_REQUEST, MULTI, MULTI_GUARANTEE, NORMAL, PITY, START_AT, WINDOW_END, WINDOW_START, amounts, balance, changes, data, delta_of, draw,
  error_code, gacha_changes, history, id, item, login, pity, set_balance, start, stop_all, type Core,
} from './helpers.ts';

const CoreError = CoreContract.CoreError;

afterEach(async () => {
  await stop_all();
});

/** True when a drawn item list holds a hero item: the draw reached the pity tier P (and so G). */
function has_hero(items: readonly CoreContract.ItemAmount[]): boolean {
  return items.some((i) => i.item_id === id('[gacha_hero_a]') || i.item_id === id('[gacha_hero_b]'));
}

describe('DrawGacha', () => {
  it('takes the cost, grants the result and changes the pity state and the draw record; cost, grant and pity come in the same response', async () => {
    const { server } = await start();
    const session = await login(server, 'draw');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const drawn = await draw(session, '[gacha_banner_main]', undefined, { seed: 1n });
    expect(error_code(drawn)).toBe(0);
    const response = drawn.response as CoreContract.DrawGachaResponse;
    expect(response.results).toHaveLength(1);
    expect(response.items).toEqual(response.results[0]?.items);
    expect(response.mailed).toBe(false);
    const banner = String(id('[gacha_banner_main]'));
    expect(changes(drawn.envelope)[0]).toEqual([id('[gacha_gem]'), -10n, GACHA_SOURCE]);
    expect(gacha_changes(drawn.envelope).every((c) => c.source === GACHA_SOURCE && c.ref === banner)).toBe(true);
    expect(changes(drawn.envelope).slice(1).map(([item_id, delta]) => [item_id, delta])).toEqual(amounts(response.items));
    const balances = delta_of(drawn.envelope, CoreContract.ItemBalanceUserState);
    expect(balances.find((b) => b.id === BigInt(id('[gacha_gem]')))?.value?.amount).toBe(90n);
    expect(delta_of(drawn.envelope, CoreContract.GachaPityUserState).map((p) => [p.id, p.value?.count, p.value?.rate_up_guaranteed])).toEqual([
      [BigInt(id('[gacha_banner_main]')), 1, false],
    ]);
    expect(await balance(server, session.user_id, '[gacha_gem]')).toBe(90n);
    const listed = await history(session, '[gacha_banner_main]', 0n, 10);
    expect(listed.entries.map((e) => [e.draw_seq, e.draw_index, e.kind, e.items])).toEqual([[1n, 1, NORMAL, response.results[0]?.items]]);
  });

  it('a cost it cannot pay is ITEM_NOT_ENOUGH, nothing changes and nothing is drawn', async () => {
    let granted = 0;
    const { server } = await start({ hooks: { grant_gacha_result: () => ((granted += 1), []) } });
    const session = await login(server, 'poor');
    await set_balance(server, session.user_id, '[gacha_gem]', 5n);
    const before = await read_user_state(server, session.user_id);
    const drawn = await draw(session, '[gacha_banner_main]');
    expect(error_code(drawn)).toBe(CoreError.CORE_ERROR_ITEM_NOT_ENOUGH);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    expect(granted).toBe(0);
    expect((await history(session, 0, 0n, 10)).entries).toEqual([]);
  });

  it('a ticket draw takes ticket_item n times; a ticket draw without ticket_item and MULTI without multi_count are INVALID_REQUEST', async () => {
    const { server } = await start();
    const session = await login(server, 'ticket');
    await set_balance(server, session.user_id, '[gacha_ticket]', 25n);
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    const drawn = await draw(session, '[gacha_banner_main]', MULTI, { ticket: true });
    expect(error_code(drawn)).toBe(0);
    expect(drawn.response?.results).toHaveLength(10);
    expect(changes(drawn.envelope)[0]).toEqual([id('[gacha_ticket]'), -10n, GACHA_SOURCE]);
    expect(await balance(server, session.user_id, '[gacha_ticket]')).toBe(15n);
    expect(await balance(server, session.user_id, '[gacha_gem]')).toBe(1000n);
    const before = await read_user_state(server, session.user_id);
    expect(error_code(await draw(session, '[gacha_banner_shared]', undefined, { ticket: true }))).toBe(INVALID_REQUEST);
    expect(error_code(await draw(session, '[gacha_banner_shared]', MULTI))).toBe(INVALID_REQUEST);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
  });

  it('a GachaDrawMode that is neither SINGLE nor MULTI is INVALID_REQUEST and nothing changes', async () => {
    const { server } = await start();
    const session = await login(server, 'mode');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const before = await read_user_state(server, session.user_id);
    expect(error_code(await draw(session, '[gacha_banner_main]', CoreContract.GachaDrawMode.GACHA_DRAW_MODE_UNSPECIFIED))).toBe(INVALID_REQUEST);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    expect((await history(session, 0, 0n, 10)).entries).toEqual([]);
  });

  it('is GACHA_BANNER_UNAVAILABLE before start_at, from end_at, and while the linked live event is not active', async () => {
    const { server } = await start();
    const session = await login(server, 'window');
    const unavailable = CoreError.CORE_ERROR_GACHA_BANNER_UNAVAILABLE;
    expect(error_code(await draw(session, '[gacha_banner_window]'))).toBe(unavailable);
    set_time(server, WINDOW_START - 1n);
    expect(error_code(await draw(session, '[gacha_banner_window]'))).toBe(unavailable);
    set_time(server, WINDOW_START);
    expect(error_code(await draw(session, '[gacha_banner_window]'))).toBe(0);
    set_time(server, WINDOW_END - 1n);
    expect(error_code(await draw(session, '[gacha_banner_window]'))).toBe(0);
    set_time(server, WINDOW_END);
    expect(error_code(await draw(session, '[gacha_banner_window]'))).toBe(unavailable);
    expect(error_code(await draw(session, '[gacha_banner_event]'))).toBe(unavailable);
  });

  it('with a fixed seed the draw after pity_count − 1 draws that miss P is PITY and rolls pity_table; reaching P resets the count', async () => {
    const { server } = await start();
    const session = await login(server, 'pity');
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    const owner = '[gacha_banner_main]';
    const kinds: CoreContract.GachaDrawKind[] = [];
    const counts: number[] = [];
    for (let seed = 1n; seed <= 3n; seed += 1n) {
      const drawn = await draw(session, owner, undefined, { seed });
      expect(error_code(drawn)).toBe(0);
      const result = drawn.response?.results[0] as CoreContract.GachaDrawResult;
      kinds.push(result.kind);
      counts.push((await pity(server, session.user_id, owner))?.count ?? -1);
      if (seed < 3n) expect(has_hero(result.items)).toBe(false);
      else expect(has_hero(result.items)).toBe(true);
    }
    expect(kinds).toEqual([NORMAL, NORMAL, PITY]);
    expect(counts).toEqual([1, 2, 0]);
  });

  it('on a rate_up_guarantee banner, the pity tier after one that missed the rate-up rolls rate_up_table, and then g is false', async () => {
    const { server } = await start();
    const session = await login(server, 'rate_up');
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    const owner = '[gacha_banner_main]';
    const results: CoreContract.GachaDrawResult[] = [];
    for (let seed = 11n; seed <= 16n; seed += 1n) {
      const drawn = await draw(session, owner, undefined, { seed });
      expect(error_code(drawn)).toBe(0);
      results.push(drawn.response?.results[0] as CoreContract.GachaDrawResult);
      if (seed === 13n) expect(await pity(server, session.user_id, owner)).toMatchObject({ count: 0, rate_up_guaranteed: true });
    }
    expect(results.map((r) => r.kind)).toEqual([NORMAL, NORMAL, PITY, NORMAL, NORMAL, PITY]);
    // pity_table picks lt_rate_up with weight 1 of 1000000, so the first pity tier misses the rate-up
    expect(amounts(results[2]?.items ?? [])).toEqual([[id('[gacha_hero_b]'), 1n]]);
    expect(results[2]?.rate_up).toBe(false);
    expect(amounts(results[5]?.items ?? [])).toEqual([[id('[gacha_hero_a]'), 1n]]);
    expect(results[5]?.rate_up).toBe(true);
    expect(await pity(server, session.user_id, owner)).toMatchObject({ count: 0, rate_up_guaranteed: false });
  });

  it('in MULTI the last draw is MULTI_GUARANTEE when no earlier draw reached G, and NORMAL when one did', async () => {
    const { server } = await start();
    const session = await login(server, 'multi');
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    const seen = new Set<string>();
    for (let seed = 21n; seed <= 44n; seed += 1n) {
      const drawn = await draw(session, '[gacha_banner_multi]', MULTI, { seed });
      expect(error_code(drawn)).toBe(0);
      const [first, last] = drawn.response?.results ?? [];
      expect(first?.kind).toBe(NORMAL);
      if (has_hero(first?.items ?? [])) {
        expect(last?.kind).toBe(NORMAL);
        seen.add('reached');
      } else {
        expect(last?.kind).toBe(MULTI_GUARANTEE);
        expect(has_hero(last?.items ?? [])).toBe(true);
        seen.add('missed');
      }
    }
    expect([...seen].sort()).toEqual(['missed', 'reached']);
  });

  it('two banners with the same pity_banner share the pity state', async () => {
    const { server } = await start();
    const session = await login(server, 'shared');
    await set_balance(server, session.user_id, '[gacha_gem]', 1000n);
    const drawn = await draw(session, '[gacha_banner_shared]', undefined, { seed: 31n });
    expect(delta_of(drawn.envelope, CoreContract.GachaPityUserState).map((p) => [p.id, p.value?.count])).toEqual([[BigInt(id('[gacha_banner_main]')), 1]]);
    expect(error_code(await draw(session, '[gacha_banner_main]', undefined, { seed: 32n }))).toBe(0);
    expect((await pity(server, session.user_id, '[gacha_banner_main]'))?.count).toBe(2);
    expect(await pity(server, session.user_id, '[gacha_banner_shared]')).toBeNull();
    const third = await draw(session, '[gacha_banner_shared]', undefined, { seed: 33n });
    expect(third.response?.results[0]?.kind).toBe(PITY);
    expect((await pity(server, session.user_id, '[gacha_banner_main]'))?.count).toBe(0);
  });

  it('a grant that is LIMIT_EXCEEDED goes as one [gacha_grant_mail] mail with the same list, the response grants nothing, and the cost is taken', async () => {
    const { server } = await start();
    const session = await login(server, 'mail');
    await set_balance(server, session.user_id, '[gacha_gem]', 10n);
    const drawn = await draw(session, '[gacha_banner_capped]');
    expect(error_code(drawn)).toBe(0);
    expect(drawn.response?.mailed).toBe(true);
    expect(drawn.response?.items).toEqual([]);
    expect(changes(drawn.envelope)).toEqual([[id('[gacha_gem]'), -1n, GACHA_SOURCE]]);
    expect(drawn.envelope.item_mails.map((m) => [m.source, m.ref, amounts(m.items)])).toEqual([
      [GACHA_SOURCE, String(id('[gacha_banner_capped]')), [[id('[gacha_capped]'), 2n]]],
    ]);
    const mails = delta_of(drawn.envelope, CoreContract.MailUserState);
    expect(mails.map((m) => [m.value?.template_id, amounts(m.value?.attachments ?? [])])).toEqual([
      [data().ReservedId.gacha_grant_mail(), [[id('[gacha_capped]'), 2n]]],
    ]);
    expect(await balance(server, session.user_id, '[gacha_gem]')).toBe(9n);
    expect(await balance(server, session.user_id, '[gacha_capped]')).toBe(0n);
  });

  it('the output of grant_gacha_result is granted, and the draw record and GachaDrawResult are the drawn result', async () => {
    const calls: unknown[][] = [];
    const grant = (ctx: unknown, banner_id: number, results: readonly { items: readonly CoreContract.ItemAmount[] }[]): CoreContract.ItemAmount[] => {
      calls.push([banner_id, results.length]);
      return [item('[gacha_shard]', 5n)];
    };
    const { server } = await start({ hooks: { grant_gacha_result: grant } });
    const session = await login(server, 'convert');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const drawn = await draw(session, '[gacha_banner_main]', undefined, { seed: 41n });
    expect(error_code(drawn)).toBe(0);
    expect(calls).toEqual([[id('[gacha_banner_main]'), 1]]);
    expect(amounts(drawn.response?.items ?? [])).toEqual([[id('[gacha_shard]'), 5n]]);
    expect(changes(drawn.envelope)).toEqual([
      [id('[gacha_gem]'), -10n, GACHA_SOURCE],
      [id('[gacha_shard]'), 5n, GACHA_SOURCE],
    ]);
    const drawn_items = drawn.response?.results[0]?.items ?? [];
    expect(amounts(drawn_items)).toEqual([[id('[gacha_star]'), 1n]]);
    expect(await balance(server, session.user_id, '[gacha_star]')).toBe(0n);
    expect((await history(session, 0, 0n, 10)).entries.map((e) => amounts(e.items))).toEqual([amounts(drawn_items)]);
  });

  it('a DrawGacha sent again with the same request ID is applied once', async () => {
    const { server } = await start();
    const session = await login(server, 'again');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const request_id = '7d0f6a52-0d0b-4b8e-9a51-2a8f0c5e9b11';
    const first = await draw(session, '[gacha_banner_main]', MULTI, { request_id, seed: 51n });
    const second = await draw(session, '[gacha_banner_main]', MULTI, { request_id, seed: 52n });
    expect(error_code(first)).toBe(0);
    expect(second.response?.results).toEqual(first.response?.results);
    expect(await balance(server, session.user_id, '[gacha_gem]')).toBe(0n);
    expect((await history(session, 0, 0n, 100)).entries).toHaveLength(10);
  });

  it('a content handler writing GachaPityUserState directly is refused', async () => {
    let core: Core | null = null;
    const operation = {
      name: 'game_put_pity',
      role: 'ops',
      body: 'json',
      max_body_bytes: null,
      input: { user_id: { type: { kind: 'int64' }, optional: false } },
      user_target: 'user_id',
      handler: (_input: unknown, ctx: unknown) => {
        const row = new CoreContract.GachaPityUserState();
        row.id = BigInt(id('[gacha_banner_main]'));
        row.count = 2;
        (core?.storage?.put_state as unknown as (ctx: unknown, value: unknown) => void)(ctx, row);
        return {};
      },
      prepare: null,
      audit_args: null,
    };
    const { server } = await start({
      extra: (c) => {
        core = c;
        (c.routing?.register_admin_operation as unknown as (op: unknown) => void)(operation);
      },
    });
    const session = await login(server, 'direct');
    const response = await send_admin(server, 'game_put_pity', { user_id: String(session.user_id) });
    expect(response.status).toBe(500);
    expect(await pity(server, session.user_id, '[gacha_banner_main]')).toBeNull();
  });

  it('a user whose requirement evaluation does not pass gets GACHA_BANNER_LOCKED and nothing is drawn or changed', async () => {
    let granted = 0;
    const { server } = await start({ hooks: { grant_gacha_result: () => ((granted += 1), []) } });
    const session = await login(server, 'locked');
    const before = await read_user_state(server, session.user_id);
    expect(error_code(await draw(session, '[gacha_banner_locked]'))).toBe(CoreError.CORE_ERROR_GACHA_BANNER_LOCKED);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    expect(granted).toBe(0);
    expect((await history(session, 0, 0n, 10)).entries).toEqual([]);
  });

  it('a draw leaves the core analytics event core_gacha_drawn for a user who allows analytics', async () => {
    const { server } = await start();
    const session = await login(server, 'analytics');
    const consent = (await read_user_state(server, session.user_id)).find((s) => s.kind === 'ConsentUserState');
    expect((consent?.value as CoreContract.ConsentUserState | undefined)?.analytics_allowed).toBe(true);
    await set_balance(server, session.user_id, '[gacha_ticket]', 10n);
    expect(error_code(await draw(session, '[gacha_banner_main]', MULTI, { ticket: true }))).toBe(0);
    const listed = await send_admin(server, 'list_server_events', {
      user_id: String(session.user_id),
      name: 'core_gacha_drawn',
      from_at: String(START_AT),
      to_at: String(START_AT + 1n),
      limit: 10,
    });
    expect(listed.status).toBe(200);
    const entries = (listed.json as { entries: { params: string }[] }).entries;
    expect(entries).toHaveLength(1);
    const event = CoreContract.AnalyticsEvent.decode(Buffer.from(entries[0]?.params ?? '', 'base64'));
    expect(event?.params.map((p) => [p.key, p.int_value, p.bool_value])).toEqual([
      ['banner_id', BigInt(id('[gacha_banner_main]')), false],
      ['count', 10n, false],
      ['ticket', 0n, true],
    ]);
  });

  it('on_gacha_drawn runs once per successful DrawGacha with its GachaDrawResult list, and its mission.add_progress comes in the same delta', async () => {
    const calls: [number, CoreContract.GachaDrawMode, readonly CoreContract.GachaDrawResult[]][] = [];
    let fail = false;
    let core: Core | null = null;
    const on_drawn = (ctx: unknown, banner_id: number, mode: CoreContract.GachaDrawMode, results: readonly CoreContract.GachaDrawResult[]): void => {
      if (fail) throw new Error('on_gacha_drawn failed');
      calls.push([banner_id, mode, results]);
      (core?.mission?.add_progress as unknown as (ctx: unknown, counter: number, amount: number) => unknown)(ctx, id('[gacha_draw_counter]'), results.length);
    };
    const { server } = await start({ hooks: { on_gacha_drawn: on_drawn }, extra: (c) => (core = c) });
    const session = await login(server, 'drawn');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const drawn = await draw(session, '[gacha_banner_main]', MULTI, { seed: 61n });
    expect(error_code(drawn)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(id('[gacha_banner_main]'));
    expect(calls[0]?.[1]).toBe(MULTI);
    expect(calls[0]?.[2]).toEqual(drawn.response?.results);
    expect(delta_of(drawn.envelope, CoreContract.MissionProgressUserState).map((m) => [m.id, m.value?.progress])).toEqual([[BigInt(id('[gacha_draw_mission]')), 10n]]);

    expect(error_code(await draw(session, '[gacha_banner_main]'))).toBe(CoreError.CORE_ERROR_ITEM_NOT_ENOUGH);
    expect(calls).toHaveLength(1);

    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const before = await read_user_state(server, session.user_id);
    const before_history = (await history(session, 0, 0n, 100)).entries;
    fail = true;
    expect(error_code(await draw(session, '[gacha_banner_main]', MULTI, { seed: 62n }))).toBe(INTERNAL);
    expect(await read_user_state(server, session.user_id)).toEqual(before);
    expect((await history(session, 0, 0n, 100)).entries).toEqual(before_history);
  });

  it('on_gacha_drawn returning a value is INTERNAL with an error log, and the cost, grant, pity state and draw record stay', async () => {
    let output: unknown = 'pass';
    const { server } = await start({ hooks: { on_gacha_drawn: () => output } });
    const session = await login(server, 'drawnoutput');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const before = await read_user_state(server, session.user_id);
    for (const value of ['pass', 1001]) {
      output = value;
      expect(error_code(await draw(session, '[gacha_banner_main]', undefined, { seed: 63n }))).toBe(INTERNAL);
      expect(await read_user_state(server, session.user_id)).toEqual(before);
      expect((await history(session, 0, 0n, 100)).entries).toEqual([]);
    }
    expect(read_logs(server, 'error').filter((line) => line.message === 'hook on_gacha_drawn returned a value')).toHaveLength(2);
    output = undefined;
    expect(error_code(await draw(session, '[gacha_banner_main]', undefined, { seed: 64n }))).toBe(0);
  });

  it('judges validate_gacha_draw and grant_gacha_result by storage.check_hook_output: 1000 and up is the GameError, 1 to 999 is INTERNAL with an error log', async () => {
    const REFUSED = GameContract.GameError.GAME_ERROR_CORE_TEST;
    let validate: unknown = 'pass';
    let grant: unknown = [];
    const { server } = await start({ hooks: { validate_gacha_draw: () => validate, grant_gacha_result: () => grant } });
    const session = await login(server, 'hookoutput');
    await set_balance(server, session.user_id, '[gacha_gem]', 100n);
    const before = await read_user_state(server, session.user_id);
    const logs = (): string => JSON.stringify(read_logs(server));
    const expect_unchanged = async (code: number): Promise<void> => {
      expect(error_code(await draw(session, '[gacha_banner_main]', undefined, { seed: 65n }))).toBe(code);
      expect(await read_user_state(server, session.user_id)).toEqual(before);
      expect((await history(session, 0, 0n, 100)).entries).toEqual([]);
    };

    validate = REFUSED;
    await expect_unchanged(REFUSED);
    expect(logs()).not.toContain('hook validate_gacha_draw returned');
    for (const value of [CoreError.CORE_ERROR_INVALID_REQUEST, 999]) {
      validate = value;
      await expect_unchanged(INTERNAL);
      expect(logs()).toContain(`hook validate_gacha_draw returned ${String(value)}, not pass or a GameError`);
    }

    validate = 'pass';
    grant = REFUSED;
    await expect_unchanged(REFUSED);
    expect(logs()).not.toContain('hook grant_gacha_result returned');
    for (const value of [CoreError.CORE_ERROR_INVALID_REQUEST, 999]) {
      grant = value;
      await expect_unchanged(INTERNAL);
      expect(logs()).toContain(`hook grant_gacha_result returned ${String(value)}, not pass or a GameError`);
    }
  });
});

describe('DrawGacha request field validation', () => {
  it('a banner ID that is not in gacha_banner is INVALID_REQUEST', async () => {
    const { server } = await start();
    const session = await login(server, 'unknown');
    const request = new CoreContract.DrawGachaRequest();
    request.banner_id = 2_147_483_647;
    request.mode = CoreContract.GachaDrawMode.GACHA_DRAW_MODE_SINGLE;
    expect(error_code(await send(session, 'core/DrawGacha', request))).toBe(INVALID_REQUEST);
  });
});
