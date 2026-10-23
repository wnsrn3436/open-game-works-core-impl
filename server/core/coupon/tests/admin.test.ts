import { randomUUID } from 'node:crypto';
import * as testing from '../../testing/dev/index.ts';
import { admin, codes_of, coupon_body, create, gem, gold, item_id, start, type TestServer } from './helpers.ts';

const servers: TestServer[] = [];

async function server(settings?: Readonly<Record<string, unknown>>): Promise<TestServer> {
  const started = await start(undefined, settings);
  servers.push(started);
  return started;
}

afterEach(async () => {
  for (const s of servers.splice(0)) await testing.stop_test_server(s);
});

const CODE = /^[A-Z0-9]+$/;

describe('coupon admin operations', () => {
  it('makes count different unique codes and list_coupon_codes returns them all in byte order', async () => {
    const s = await server();
    const id = await create(s, { kind: 'unique', count: 50 });
    const codes = await codes_of(s, id);
    expect(codes).toHaveLength(50);
    expect(new Set(codes).size).toBe(50);
    expect(codes).toEqual([...codes].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    for (const code of codes) {
      expect(code).toMatch(CODE);
      expect(code).toHaveLength(12);
    }
  });

  it('get_coupon returns count of create_coupon for a unique coupon and 0 for a shared coupon', async () => {
    const s = await server();
    const unique = await create(s, { kind: 'unique', count: 3, memo: 'batch' });
    const shared = await create(s, { code: 'GETME1', max_uses: 5 });
    const u = (await admin(s, 'get_coupon', { coupon_id: String(unique) })).json;
    expect(u['count']).toBe(3);
    expect(u['kind']).toBe('unique');
    expect(u['code']).toBe('');
    expect(u['memo']).toBe('batch');
    const g = (await admin(s, 'get_coupon', { coupon_id: String(shared) })).json;
    expect(g['count']).toBe(0);
    expect(g['kind']).toBe('shared');
    expect(g['code']).toBe('GETME1');
    expect(g['max_uses']).toBe(5);
    expect(g['used_count']).toBe('0');
    expect(g['disabled']).toBe(false);
    expect(g['items']).toEqual([{ ...gold(100n), big_amount: '' }]);
  });

  it('answers conflict for a shared coupon with a code that exists', async () => {
    const s = await server();
    await create(s, { code: 'TWICE1' });
    const again = await admin(s, 'create_coupon', coupon_body({ code: 'tw-ice1' }));
    expect(again.status).toBe(409);
    expect(again.json['error']).toBe('conflict');
  });

  it('ends a unique create_coupon of count 3 with conflict when coupon.codeAlphabet AB and coupon.generatedCodeLength 1 make two codes, writing no coupon row and no code row', async () => {
    const s = await server({ 'coupon.codeAlphabet': 'AB', 'coupon.minCodeLength': 1, 'coupon.generatedCodeLength': 1 });
    const result = await admin(s, 'create_coupon', coupon_body({ kind: 'unique', count: 3 }));
    expect(result.status).toBe(409);
    expect(result.json['error']).toBe('conflict');
    expect((await admin(s, 'get_coupon', { coupon_id: '1' })).status).toBe(404);
    // A and B are every code these settings allow: neither has a code row.
    for (const code of ['A', 'B']) expect((await admin(s, 'get_coupon', { code })).status).toBe(404);
  }, 10_000);

  it('ends a unique create_coupon with conflict when stored codes take the whole code space, writing nothing', async () => {
    const s = await server({ 'coupon.codeAlphabet': 'AB', 'coupon.minCodeLength': 1, 'coupon.generatedCodeLength': 1 });
    const first = await create(s, { kind: 'unique', count: 2 });
    expect([...(await codes_of(s, first))].sort()).toEqual(['A', 'B']);
    const result = await admin(s, 'create_coupon', coupon_body({ kind: 'unique', count: 1 }));
    expect(result.status).toBe(409);
    expect(result.json['error']).toBe('conflict');
    expect((await admin(s, 'get_coupon', { coupon_id: String(first + 1n) })).status).toBe(404);
    expect(await codes_of(s, first)).toHaveLength(2);
  }, 10_000);

  it('get_coupon answers bad_request for both or neither of coupon_id and code, and finds a coupon by an unnormalized code', async () => {
    const s = await server();
    const id = await create(s, { code: 'FINDME1' });
    expect((await admin(s, 'get_coupon', { coupon_id: String(id), code: 'FINDME1' })).status).toBe(400);
    expect((await admin(s, 'get_coupon', {})).status).toBe(400);
    const found = await admin(s, 'get_coupon', { code: ' find-me 1' });
    expect(found.status).toBe(200);
    expect(found.json['coupon_id']).toBe(String(id));
    expect((await admin(s, 'get_coupon', { code: 'NOTHERE1' })).status).toBe(404);
    expect((await admin(s, 'get_coupon', { coupon_id: '999' })).status).toBe(404);
  });

  it('list_coupon_codes pages from an empty after_code and continues from the last code without gaps or repeats', async () => {
    const s = await server();
    const id = await create(s, { kind: 'unique', count: 7 });
    const seen: string[] = [];
    let after = '';
    for (;;) {
      const page = await admin(s, 'list_coupon_codes', { coupon_id: String(id), after_code: after, limit: 3 });
      expect(page.status).toBe(200);
      const codes = (page.json['codes'] as { code: string }[]).map((row) => row.code);
      expect(codes.length).toBeLessThanOrEqual(3);
      if (codes.length === 0) break;
      seen.push(...codes);
      after = codes[codes.length - 1] ?? '';
    }
    expect(seen).toEqual(await codes_of(s, id));
    expect(new Set(seen).size).toBe(7);
    expect((await admin(s, 'list_coupon_codes', { coupon_id: '999', after_code: '', limit: 3 })).status).toBe(404);
  });

  it('list_coupon_codes returns only that coupon\'s codes after an after_code that is no code, up to limit', async () => {
    const s = await server();
    const first = await create(s, { kind: 'unique', count: 20 });
    const second = await create(s, { kind: 'unique', count: 20 });
    const all = await codes_of(s, first);
    const page = await admin(s, 'list_coupon_codes', { coupon_id: String(first), after_code: 'M', limit: 5 });
    expect(page.status).toBe(200);
    const codes = (page.json['codes'] as { code: string }[]).map((row) => row.code);
    expect(codes).toEqual(all.filter((code) => Buffer.compare(Buffer.from(code), Buffer.from('M')) > 0).slice(0, 5));
    const others = new Set(await codes_of(s, second));
    for (const code of codes) expect(others.has(code)).toBe(false);
  });

  it('list_coupon_codes compares an after_code with lowercase letters and other characters in byte order', async () => {
    const s = await server({ 'coupon.codeAlphabet': 'AMZ', 'coupon.minCodeLength': 2, 'coupon.generatedCodeLength': 2 });
    // 8 of the 9 codes, so the last code has 2 free codes in 9 for each of its 100 picks: (7/9)^100 ≈ 1e-11 that it ends in conflict.
    const id = await create(s, { kind: 'unique', count: 8 });
    const all = await codes_of(s, id);
    expect(all).toHaveLength(8);
    for (const after of ['a', 'm', 'z', 'Aa', 'Mm', 'A:', 'A ', 'M-', 'Zz', 'é', 'MZ', 'ZZ', 'M\u0000']) {
      const page = await admin(s, 'list_coupon_codes', { coupon_id: String(id), after_code: after, limit: 10 });
      expect(page.status).toBe(200);
      const codes = (page.json['codes'] as { code: string }[]).map((row) => row.code);
      expect([after, codes]).toEqual([after, all.filter((code) => Buffer.compare(Buffer.from(code), Buffer.from(after)) > 0)]);
    }
    const lower = await admin(s, 'list_coupon_codes', { coupon_id: String(id), after_code: 'a', limit: 10 });
    expect(lower.json['codes']).toEqual([]);
  });

  it('makes every code of a code space as small as count once', async () => {
    // The last code has 1 free code in 4 for each of its 100 picks: (3/4)^100 ≈ 3e-13 that it ends in conflict.
    const s = await server({ 'coupon.codeAlphabet': 'AB', 'coupon.minCodeLength': 2, 'coupon.generatedCodeLength': 2 });
    const id = await create(s, { kind: 'unique', count: 4 });
    expect(await codes_of(s, id)).toEqual(['AA', 'AB', 'BA', 'BB']);
  });

  it('makes one coupon for two create_coupon calls with the same operation_id', async () => {
    const s = await server();
    const body = coupon_body({ code: 'ONCE1', operation_id: randomUUID() });
    const first = await admin(s, 'create_coupon', body);
    const second = await admin(s, 'create_coupon', body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json['coupon_id']).toBe(first.json['coupon_id']);
    const next = await create(s, { code: 'ONCE2' });
    expect(next).toBe(BigInt(String(first.json['coupon_id'])) + 1n);
  });

  it('gives different coupon_ids to concurrent create_coupon calls, and one of two concurrent shared calls with the same code is conflict', async () => {
    const s = await server();
    const ids = await Promise.all([create(s, { code: 'PAR1' }), create(s, { code: 'PAR2' }), create(s, { kind: 'unique', count: 5 })]);
    expect(new Set(ids).size).toBe(3);
    const same = await Promise.all([admin(s, 'create_coupon', coupon_body({ code: 'SAME1' })), admin(s, 'create_coupon', coupon_body({ code: 'SAME1' }))]);
    expect(same.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409]);
  });

  it('makes an extra_id coupon with empty items; empty items without extra_id and extra_id items over mailbox.maxAttachments are bad_request', async () => {
    // mailbox.maxAttachments 3 is the lowest value the rating_tier season_reward rows of the core test data let a server start with.
    const s = await server({ 'mailbox.maxAttachments': 3, 'coupon.maxRewardItems': 5 });
    const third = { item_id: item_id('[gold]'), amount: '1' };
    const fourth = { item_id: item_id('[testing_gold]'), amount: '1' };
    expect((await admin(s, 'create_coupon', coupon_body({ code: 'EXTRA0', items: [], extra_id: 3 }))).status).toBe(200);
    expect((await admin(s, 'create_coupon', coupon_body({ code: 'EMPTY0', items: [], extra_id: 0 }))).status).toBe(400);
    expect((await admin(s, 'create_coupon', coupon_body({ code: 'EXTRA3', items: [gold(1n), gem(1n), third], extra_id: 3 }))).status).toBe(200);
    expect((await admin(s, 'create_coupon', coupon_body({ code: 'EXTRA4', items: [gold(1n), gem(1n), third, fourth], extra_id: 3 }))).status).toBe(400);
    expect((await admin(s, 'create_coupon', coupon_body({ code: 'PLAIN4', items: [gold(1n), gem(1n), third, fourth], extra_id: 0 }))).status).toBe(200);
  });

  it('answers bad_request for create_coupon input outside the rules', async () => {
    const s = await server();
    const bad = [
      coupon_body({ code: 'AB' }),
      coupon_body({ code: 'BAD_CODE' }),
      coupon_body({ code: 'COUNTED1', count: 2 }),
      coupon_body({ kind: 'unique', code: 'UNIQUE1', count: 1 }),
      coupon_body({ kind: 'unique', count: 0 }),
      coupon_body({ kind: 'unique', count: 1, max_uses: 3 }),
      coupon_body({ code: 'WINDOW1', start_at: 2000n, end_at: 2000n }),
      coupon_body({ code: 'WINDOW2', start_at: -1n, end_at: 2000n }),
      coupon_body({ code: 'EXTRA1', extra_id: -1 }),
      coupon_body({ code: 'ITEM1', items: [{ item_id: 999_999, amount: '1' }] }),
      coupon_body({ code: 'ITEM2', items: [gold(0n)] }),
      coupon_body({ code: 'ITEM3', items: [gold(1n), gold(2n)] }),
    ];
    for (const body of bad) expect((await admin(s, 'create_coupon', body)).status).toBe(400);
    const listed = await admin(s, 'get_coupon', { coupon_id: '1' });
    expect(listed.status).toBe(404);
  });

  it('disable_coupon answers not_found for a coupon that does not exist', async () => {
    const s = await server();
    expect((await admin(s, 'disable_coupon', { coupon_id: '42' })).status).toBe(404);
  });
});
