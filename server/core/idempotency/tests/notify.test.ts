import { NOTIFY_RETENTION_MS, START_AT, new_user, rows, server, stop_all } from './helpers.ts';

const SOURCE = 'iap-apple';
const ROW = 'SELECT created_at, expires_at FROM idempotency_notify WHERE source = $1 AND notify_id = $2';

afterEach(() => {
  stop_all();
});

describe('notify ID', () => {
  it('answers DUPLICATE to the second claim_notify of a notify ID, in a game transaction or a user transaction', async () => {
    const s = await server();
    const user = await new_user(s);
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('FIRST');
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('DUPLICATE');
    expect(await s.storage.run_rollback_transaction(user, (ctx) => s.idempotency.claim_notify(ctx, SOURCE, 'n-1'))).toBe('DUPLICATE');
    // Another source is another key.
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, 'ads-admob', 'n-1'))).toBe('FIRST');
    expect(rows(s, ROW, [SOURCE, 'n-1'])).toEqual([{ created_at: START_AT, expires_at: START_AT + NOTIFY_RETENTION_MS }]);
  });

  it('answers FIRST to claim_notify of a notify ID whose row is expired but not deleted yet', async () => {
    const s = await server();
    await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'));
    s.clock.advance(NOTIFY_RETENTION_MS - 1n);
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('DUPLICATE');
    s.clock.advance(1n);
    expect(rows(s, ROW, [SOURCE, 'n-1']).length).toBe(1);
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('FIRST');
    const now = START_AT + NOTIFY_RETENTION_MS;
    expect(rows(s, ROW, [SOURCE, 'n-1'])).toEqual([{ created_at: now, expires_at: now + NOTIFY_RETENTION_MS }]);
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('DUPLICATE');
  });

  it('answers FIRST at the next resend of a notify ID whose processing rolled back', async () => {
    const s = await server();
    const user = await new_user(s);
    const fields = { request_name: 'test/Notify', request_id: 'req-n', silent: false, retry: false, session_id: '', client_version: '', platform: '' };
    let claimed: string | null = null;
    const failed = await s.storage.run_request_transaction(user, fields, (ctx) => {
      claimed = s.idempotency.claim_notify(ctx, SOURCE, 'n-1');
      return 1;
    });
    expect(failed).toBe(1);
    expect(claimed).toBe('FIRST');
    expect(rows(s, ROW, [SOURCE, 'n-1'])).toEqual([]);
    expect(await s.storage.run_rollback_transaction(user, (ctx) => s.idempotency.claim_notify(ctx, SOURCE, 'n-1'))).toBe('FIRST');
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('FIRST');
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'n-1'))).toBe('DUPLICATE');
  });

  it('throws for a notify ID of 0 bytes or over idempotency.maxNotifyIdBytes', async () => {
    const s = await server({ 'idempotency.maxNotifyIdBytes': 4 });
    await expect(s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, ''))).rejects.toThrow();
    await expect(s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'é123'))).rejects.toThrow();
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'é12'))).toBe('FIRST');
    expect(await s.storage.run_game_transaction((tx) => s.idempotency.claim_notify(tx, SOURCE, 'abcd'))).toBe('FIRST');
  });
});
