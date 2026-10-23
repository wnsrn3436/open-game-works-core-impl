import { PG_LOCK_SQL, lock_holder, stop_all as stop_lock_holders } from '../../storage/tests/helpers.ts';
import { lock_key } from '../../storage/tx.ts';
import { HOUR, START, admin, notice_input, put, server, stop_all } from './helpers.ts';

afterEach(async () => {
  stop_lock_holders();
  await stop_all();
});

const INSERT_NOTICE =
  'INSERT INTO notice_notice (notice_id, kind, priority, start_at, end_at, platforms, languages, min_client_version, max_client_version, ' +
  'texts, image_url, shortcut_id, link_url, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';
const TEXTS = JSON.stringify([
  { language: 'en', title: 'Other', body: 'Other' },
  { language: 'ko', title: 'Other', body: 'Other' },
]);

async function listed_ids(s: Parameters<typeof put>[0]): Promise<string[]> {
  return ((await admin(s, 'list_notices', {})).json as { notices: { notice_id: string }[] }).notices.map((n) => n.notice_id);
}

describe('operation_id', () => {
  it('makes one notice for two put_notice of the same operation_id', async () => {
    const s = await server();
    const input = notice_input();
    const first = await admin(s, 'put_notice', input);
    const second = await admin(s, 'put_notice', input);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.json).toEqual(first.json);
    expect(await listed_ids(s)).toEqual([(first.json as { notice_id: string }).notice_id]);
  });

  it('is conflict for a put_notice of the same operation_id with another input', async () => {
    const s = await server();
    const input = notice_input();
    expect((await admin(s, 'put_notice', input)).status).toBe(200);
    const other = await admin(s, 'put_notice', { ...input, priority: 5 });
    expect([other.status, (other.json as { error: string }).error]).toEqual([409, 'conflict']);
    expect(await listed_ids(s)).toHaveLength(1);
  });
});

describe('notice_id', () => {
  it('gives notice_id 1 to the first put_notice of a DB with no notice_sequence row', async () => {
    const s = await server();
    expect(await put(s)).toBe(1n);
    expect(await put(s)).toBe(2n);
  });

  it('does not give again the ID of a deleted notice with the largest ID', async () => {
    const s = await server();
    await put(s);
    const largest = await put(s);
    expect((await admin(s, 'delete_notice', { notice_id: String(largest) })).status).toBe(200);
    expect(await put(s)).toBe(largest + 1n);
  });

  it('gives different notice IDs to two concurrent put_notice of different operation_id', async () => {
    const s = await server();
    expect(await put(s)).toBe(1n);
    // Another server instance's put_notice on a connection of its own: it takes the notice_sequence key 0 lock
    // (on SQLite, BEGIN IMMEDIATE holds every write), gives notice ID 2 and commits only after this instance's
    // put_notice has started. With the lock, this instance reads the sequence after that commit.
    const database = s.shared.database;
    const pg = database.kind === 'postgresql';
    const other = await lock_holder({ kind: database.kind, db: database.db_argument, secrets: { db: database.connection ?? '' } });
    await other.ok(pg ? 'BEGIN' : 'BEGIN IMMEDIATE');
    if (pg) await other.ok(PG_LOCK_SQL, [lock_key('notice_sequence', [0])]);
    const [sequence] = await other.ok('SELECT last_notice_id FROM notice_sequence WHERE id = $1', [0]);
    expect(String(sequence?.['last_notice_id'])).toBe('1');
    await other.ok('UPDATE notice_sequence SET last_notice_id = $2 WHERE id = $1', [0, 2n]);
    await other.ok(INSERT_NOTICE, [2n, 'Notice', 0, START, START + HOUR, '[]', '[]', '', '', TEXTS, '', 0, '', START]);
    const order: string[] = [];
    const putting = admin(s, 'put_notice', notice_input()).then((result) => {
      order.push('put');
      return result;
    });
    const committed = other.run('COMMIT', [], 300).then((result) => {
      order.push('commit');
      return result;
    });
    expect(await committed).toEqual({ ok: true, rows: [] });
    const result = await putting;
    expect([result.status, (result.json as { notice_id: string }).notice_id]).toEqual([200, '3']);
    expect(order).toEqual(['commit', 'put']);
    expect(await listed_ids(s)).toEqual(['1', '2', '3']);
  });
});
