import { balance, items, logs, request, Source, start, stop, user, type Env } from './helpers.ts';

let env: Env;

beforeAll(async () => {
  env = await start({ env: 'STG' });
});

afterAll(() => {
  stop();
});

describe('STG', () => {
  test('a source Cheat change ends INTERNAL with a security log', async () => {
    const { user_id } = await user(env);
    await expect(request(env, user_id, (ctx) => env.storage.with_hook_change_source(ctx, Source.ITEM_CHANGE_SOURCE_CHEAT, 'core/cheat/X', () => env.ledger.add_items(ctx, items(['[gold]', 1]))))).rejects.toThrow();
    await expect(request(env, user_id, (ctx) => env.module.add_items(ctx, items(['[gold]', 1]), { source: Source.ITEM_CHANGE_SOURCE_CHEAT, ref: 'x' }))).rejects.toThrow();
    expect(await balance(env, user_id, '[gold]')).toBe(0n);
    // `security` lines of one user and reason are grouped into a window: the first one is written.
    expect(logs(env, 'security').filter((l) => l['user_id'] === user_id.toString() && l['reason'] === 'cheat_source_closed').length).toBe(1);
    expect(await request(env, user_id, (ctx) => env.ledger.add_items(ctx, items(['[gold]', 1])))).toMatchObject({ out: 'OK' });
  });

  test('the server instance has no DEV code', () => {
    expect(env.server.dev).toBeNull();
  });
});
