import * as testing from '../../testing/dev/index.ts';
import { DAY_MS, E, HOUR_MS, JAN_16, JAN_17, START_AT, buy, id, purchase_row, run, set_balance, set_offer, snapshot, start, stop_all, user, type TestServer, type TestSession } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

function purchase_count(server: TestServer, session: TestSession, product: string): Promise<number> {
  return run(server, session, (ctx, core) => core.shop.get_purchase_count(ctx, id(product)));
}

describe('sale condition', () => {
  it('answers SHOP_PRODUCT_UNAVAILABLE before start_at and from end_at, and sells between them', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_window]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    testing.set_time(server, JAN_16 - 1n);
    expect((await buy(session, '[shop_window]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    testing.set_time(server, JAN_16);
    expect((await buy(session, '[shop_window]')).code).toBe(0);
    testing.set_time(server, JAN_17 - 1n);
    expect((await buy(session, '[shop_window]')).code).toBe(0);
    testing.set_time(server, JAN_17);
    const before = await snapshot(server, session);
    expect((await buy(session, '[shop_window]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers SHOP_PRODUCT_UNAVAILABLE while the linked live event is not active', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    testing.set_time(server, JAN_16);
    const before = await snapshot(server, session);
    expect((await buy(session, '[shop_event_pack]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('answers SHOP_PRODUCT_LOCKED and changes nothing for a user whose requirement is not passed', async () => {
    const server = await start({ shop_rank: false });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    const before = await snapshot(server, session);
    expect((await buy(session, '[shop_locked]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_LOCKED);
    expect(await snapshot(server, session)).toEqual(before);
  });

  it('sells a product with a requirement to a user who passes it', async () => {
    const server = await start({ shop_rank: true });
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_locked]')).code).toBe(0);
  });

  it('answers SHOP_PRODUCT_UNAVAILABLE while the offer is off, sells it while on with reset_at at the offer end, and counts from 0 after the offer is on again', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    // [shop_offer] lasts 1h.
    await set_offer(server, session, '[shop_offer]', START_AT, 1);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(0);
    const row = await purchase_row(server, session, '[shop_offer_pack]');
    expect(row?.count).toBe(1);
    expect(row?.reset_at).toBe(START_AT + HOUR_MS);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
    testing.set_time(server, START_AT + HOUR_MS);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    const restarted = START_AT + 2n * HOUR_MS;
    testing.set_time(server, restarted);
    await set_offer(server, session, '[shop_offer]', restarted, 2);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(0);
    const again = await purchase_row(server, session, '[shop_offer_pack]');
    expect(again?.count).toBe(1);
    expect(again?.reset_at).toBe(restarted + HOUR_MS);
  });

  it('counts from 0 when the offer is on again before its previous end time', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    // [shop_offer] lasts 1h. DEV set_offer turns it on again at 30m, which moves the end to 90m.
    await set_offer(server, session, '[shop_offer]', START_AT, 1);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(0);
    const restarted = START_AT + HOUR_MS / 2n;
    testing.set_time(server, restarted);
    expect(await purchase_count(server, session, '[shop_offer_pack]')).toBe(1);
    await set_offer(server, session, '[shop_offer]', restarted, 2);
    expect(await purchase_count(server, session, '[shop_offer_pack]')).toBe(0);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(0);
    const row = await purchase_row(server, session, '[shop_offer_pack]');
    expect(row?.count).toBe(1);
    expect(row?.reset_at).toBe(restarted + HOUR_MS);
    expect(await purchase_count(server, session, '[shop_offer_pack]')).toBe(1);
    expect((await buy(session, '[shop_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
  });

  it('sells a limit_count 1 product of an offer of a repeated live event again when round 2 turns the offer on before the round 1 offer end', async () => {
    const server = await start();
    const session = await user(server);
    await set_balance(server, session, '[shop_gold]', 1000n);
    // [shop_event_offer] lasts 3d and is bound to [shop_event]: round 1 is 2027-01-15, round 2 starts at JAN_17.
    await set_offer(server, session, '[shop_event_offer]', START_AT, 1);
    expect((await buy(session, '[shop_event_offer_pack]')).code).toBe(0);
    const first = await purchase_row(server, session, '[shop_event_offer_pack]');
    expect(first?.reset_at).toBe(START_AT + 3n * DAY_MS);
    expect((await buy(session, '[shop_event_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
    testing.set_time(server, JAN_17);
    expect(JAN_17 < START_AT + 3n * DAY_MS).toBe(true);
    // round 2 resets the offer: it is off until it is turned on again.
    expect((await buy(session, '[shop_event_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_PRODUCT_UNAVAILABLE);
    await set_offer(server, session, '[shop_event_offer]', JAN_17, 1);
    expect(await purchase_count(server, session, '[shop_event_offer_pack]')).toBe(0);
    expect((await buy(session, '[shop_event_offer_pack]')).code).toBe(0);
    const again = await purchase_row(server, session, '[shop_event_offer_pack]');
    expect(again?.count).toBe(1);
    expect(again?.reset_at).toBe(JAN_17 + 3n * DAY_MS);
    expect((await buy(session, '[shop_event_offer_pack]')).code).toBe(E.CORE_ERROR_SHOP_LIMIT_REACHED);
  });
});
