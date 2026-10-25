import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import { advance_time, read_logs, send_cheat, stop_test_server, wait_background } from '../../testing/dev/index.ts';
import type { Storage } from '../../storage/index.ts';
import type { UserSnapshot } from '../snapshot.ts';
import {
  RETENTION_MS,
  START_AT,
  SWEEP_MS,
  admin,
  changeable,
  cloneRecords,
  dumpDb,
  exportSnapshot,
  imported,
  importSnapshot,
  listClones,
  loginAgain,
  newUser,
  resync,
  richUser,
  sessionRows,
  startServer,
  userMark,
  userRows,
  withdraw,
  without,
  type AdminReply,
  type Core,
  type Server,
  type Session,
} from './helpers.ts';

/** A source snapshot imported into a new target. */
async function cloned(server: Server, core: Core): Promise<{ source: Session; target: Session; snapshot: UserSnapshot }> {
  const source = await richUser(server, core, 'source');
  const target = await richUser(server, core, 'target');
  const snapshot = await exportSnapshot(server, source.user_id);
  imported(await importSnapshot(server, target.user_id, snapshot));
  return { source, target, snapshot };
}

/** Whether a `dumpDb` row has an `expires_at` the clock reached: `storage` may delete it without a clone wipe. */
function expired(row: string, core: Core): boolean {
  const expires_at = (JSON.parse(row) as Record<string, unknown>)['expires_at'];
  return typeof expires_at === 'string' && BigInt(expires_at.slice(0, -1)) <= core['server-time'].clock_now();
}

/** The `audit` log lines of clone wipes of a target. */
function auditWipes(server: Server, target: bigint): Readonly<Record<string, unknown>>[] {
  return read_logs(server, 'audit').filter((line) => line['reason'] === 'clone_wiped' && String(line['target_user_id']) === String(target));
}

/** The `source_user_id` of each clone wipe `audit` line of a target. */
function auditWipeSources(server: Server, target: bigint): string[] {
  return auditWipes(server, target).map((line) => String(line['source_user_id']));
}

/** Makes `storage.lock_game_row` on the clone record of the targets in `failing` return `FAILED`. */
function failCloneLocks(core: Core, failing: Set<bigint>): () => void {
  const storage = core.storage as { lock_game_row: Storage['lock_game_row'] };
  const original = storage.lock_game_row;
  storage.lock_game_row = (ctx_or_tx, table, key) => {
    if (table === 'user_snapshot_clone_record' && failing.has(key[0] as bigint)) return 'FAILED';
    return original(ctx_or_tx, table, key);
  };
  return () => {
    storage.lock_game_row = original;
  };
}

/** The `error` log lines of failed sweep clone wipes of a target. */
function sweepErrors(server: Server, target: bigint): Readonly<Record<string, unknown>>[] {
  return read_logs(server, 'error').filter((line) => line['message'] === 'clone sweep failed' && String(line['user_id']) === String(target));
}

async function wipeClone(server: Server, target: bigint, cloned_at?: string): Promise<number> {
  const body = cloned_at === undefined ? { target_user_id: String(target) } : { target_user_id: String(target), cloned_at };
  return (await admin(server, 'wipe_clone', body)).status;
}

describe('clone record and sweep', () => {
  let server: Server;
  let core: Core;

  beforeEach(async () => {
    ({ server, core } = await startServer());
  });

  afterEach(async () => {
    await stop_test_server(server);
  });

  it('import writes a clone record that list_clones shows, and the sweep wipes it after cloneRetentionMs', async () => {
    const { source, target, snapshot } = await cloned(server, core);
    const clones = await listClones(server);
    const cloned_at = BigInt(clones[0]?.cloned_at ?? '0');
    expect(cloned_at).toBe(core['server-time'].clock_now());
    expect(clones).toEqual([
      {
        target_user_id: String(target.user_id),
        source_environment: 'LOCAL',
        source_user_id: String(source.user_id),
        cloned_at: String(cloned_at),
        expires_at: String(cloned_at + RETENTION_MS),
      },
    ]);
    const before = dumpDb(core);
    advance_time(server, RETENTION_MS - 1n);
    await wait_background(server);
    expect(cloneRecords(core).length).toBe(1);
    advance_time(server, 1n);
    await wait_background(server);
    expect(cloneRecords(core)).toEqual([]);
    expect(await userRows(core, target.user_id)).toEqual([]);
    expect(sessionRows(core, target.user_id)).toEqual([]);
    expect(await resync(target)).not.toBeNull();
    // The target's rows of the excluded tables stay.
    const tables = changeable(snapshot);
    const after = without(dumpDb(core), tables);
    for (const [table, rows] of without(before, tables)) {
      const kept = after.get(table) ?? [];
      for (const row of rows.filter((r) => r.includes(userMark(target.user_id)) && !expired(r, core))) expect(kept).toContain(row);
    }
    expect(auditWipeSources(server, target.user_id)).toEqual([String(source.user_id)]);
  });

  it('list_clones returns clone records in ascending target_user_id order', async () => {
    const source = await richUser(server, core, 'source');
    const targets = [await newUser(server, 'target'), await newUser(server, 'target'), await newUser(server, 'target')];
    const snapshot = await exportSnapshot(server, source.user_id);
    for (const target of [...targets].reverse()) imported(await importSnapshot(server, target.user_id, snapshot));
    const ids = targets.map((t) => t.user_id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect((await listClones(server)).map((c) => c.target_user_id)).toEqual(ids.map(String));
  });

  it('a failed clone wipe transaction makes wipe_clone 500 internal and changes nothing', async () => {
    const { target } = await cloned(server, core);
    const rows = await userRows(core, target.user_id);
    const clones = cloneRecords(core);
    const sessions = sessionRows(core, target.user_id);
    const restore = failCloneLocks(core, new Set([target.user_id]));
    let reply: AdminReply;
    try {
      reply = await admin(server, 'wipe_clone', { target_user_id: String(target.user_id) });
    } finally {
      restore();
    }
    expect(reply.status).toBe(500);
    expect(reply.json).toEqual({ error: 'internal' });
    expect(cloneRecords(core)).toEqual(clones);
    expect(await userRows(core, target.user_id)).toEqual(rows);
    expect(sessionRows(core, target.user_id)).toEqual(sessions);
    expect(auditWipes(server, target.user_id)).toEqual([]);
    // The game transaction of a withdrawn target fails the same.
    await withdraw(await loginAgain(server, target.user_id));
    const withdrawn = failCloneLocks(core, new Set([target.user_id]));
    try {
      expect(await wipeClone(server, target.user_id)).toBe(500);
    } finally {
      withdrawn();
    }
    expect(cloneRecords(core)).toEqual(clones);
    expect(await wipeClone(server, target.user_id)).toBe(200);
  });

  it('a failed sweep clone wipe logs error, the sweep still wipes the next clone, and the next cycle wipes the failed one', async () => {
    // The sweep goes in target_user_id order, and random user IDs need not follow the order the clones were made.
    const [one, two] = [await cloned(server, core), await cloned(server, core)];
    const [first, second] = one.target.user_id < two.target.user_id ? [one, two] : [two, one];
    const rows = await userRows(core, first.target.user_id);
    const restore = failCloneLocks(core, new Set([first.target.user_id]));
    try {
      advance_time(server, RETENTION_MS);
      await wait_background(server);
    } finally {
      restore();
    }
    expect(sweepErrors(server, first.target.user_id).length).toBeGreaterThan(0);
    expect(cloneRecords(core).map((r) => BigInt(String(r['target_user_id'])))).toEqual([first.target.user_id]);
    expect(await userRows(core, first.target.user_id)).toEqual(rows);
    expect(await userRows(core, second.target.user_id)).toEqual([]);
    expect(auditWipes(server, second.target.user_id).length).toBe(1);
    advance_time(server, SWEEP_MS);
    await wait_background(server);
    expect(cloneRecords(core)).toEqual([]);
    expect(await userRows(core, first.target.user_id)).toEqual([]);
    expect(auditWipes(server, first.target.user_id).length).toBe(1);
  });

  it('wipe_clone wipes the same, and a target without a clone record is not_found', async () => {
    const { source, target } = await cloned(server, core);
    const reply = await admin(server, 'wipe_clone', { target_user_id: String(target.user_id) });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({});
    expect(auditWipeSources(server, target.user_id)).toEqual([String(source.user_id)]);
    expect(cloneRecords(core)).toEqual([]);
    expect(await userRows(core, target.user_id)).toEqual([]);
    expect(sessionRows(core, target.user_id)).toEqual([]);
    expect(await wipeClone(server, target.user_id)).toBe(404);
    const other = await newUser(server, 'other');
    expect(await wipeClone(server, other.user_id)).toBe(404);
  });

  it('wipe_clone with the cloned_at of list_clones after a new import is not_found and leaves the new clone', async () => {
    const { target, snapshot } = await cloned(server, core);
    const old = (await listClones(server))[0]?.cloned_at;
    advance_time(server, 1_000n);
    await wait_background(server);
    imported(await importSnapshot(server, target.user_id, snapshot));
    const fresh = (await listClones(server))[0]?.cloned_at;
    expect(fresh).not.toBe(old);
    expect(await wipeClone(server, target.user_id, old)).toBe(404);
    expect((await listClones(server)).map((c) => c.cloned_at)).toEqual([fresh]);
    expect((await userRows(core, target.user_id)).length).toBe(snapshot.records.length);
    expect(await wipeClone(server, target.user_id, fresh)).toBe(200);
  });

  it('a new import that lands between the sweep reading an expired record and its clone wipe stays', async () => {
    const { target, snapshot } = await cloned(server, core);
    // The sweep reads the expired clone record and then opens the clone wipe's user transaction. The test sends
    // the new import at that point, once, and lets the clone wipe go on after the import answered.
    const storage = core.storage as { run_user_transaction: Storage['run_user_transaction'] };
    const original = storage.run_user_transaction;
    const race: { reply: Promise<AdminReply> | null } = { reply: null };
    storage.run_user_transaction = (user_id, fn) => {
      if (race.reply !== null || user_id !== target.user_id) return original(user_id, fn);
      race.reply = importSnapshot(server, target.user_id, snapshot);
      return race.reply.then(() => original(user_id, fn));
    };
    try {
      advance_time(server, RETENTION_MS);
      await wait_background(server);
    } finally {
      storage.run_user_transaction = original;
    }
    if (race.reply === null) throw new Error('the sweep did not open a clone wipe');
    imported(await race.reply);
    const clones = await listClones(server);
    expect(clones.length).toBe(1);
    expect(BigInt(clones[0]?.expires_at ?? '0')).toBe(START_AT + RETENTION_MS + RETENTION_MS);
    expect((await userRows(core, target.user_id)).length).toBe(snapshot.records.length);
    expect(auditWipes(server, target.user_id)).toEqual([]);
  });

  it('of two wipe_clone at once, one wipes and the other is not_found', async () => {
    const { target } = await cloned(server, core);
    const statuses = await Promise.all([wipeClone(server, target.user_id), wipeClone(server, target.user_id)]);
    expect(statuses.sort()).toEqual([200, 404]);
    expect(auditWipes(server, target.user_id).length).toBe(1);
  });

  it('wipe_clone of a target that withdrew after the import deletes the clone record and logs clone_wiped', async () => {
    const { source, target } = await cloned(server, core);
    await withdraw(await loginAgain(server, target.user_id));
    expect(await wipeClone(server, target.user_id)).toBe(200);
    expect(cloneRecords(core)).toEqual([]);
    expect(auditWipeSources(server, target.user_id)).toEqual([String(source.user_id)]);
    expect(await wipeClone(server, target.user_id)).toBe(404);

    const second = await cloned(server, core);
    await withdraw(await loginAgain(server, second.target.user_id));
    const statuses = await Promise.all([wipeClone(server, second.target.user_id), wipeClone(server, second.target.user_id)]);
    expect(statuses.sort()).toEqual([200, 404]);
  });

  it('cloned_at of a target with a cheat time offset is clock_now, and the sweep wipes it when clock_now reaches expires_at', async () => {
    const source = await richUser(server, core, 'source');
    const target = await richUser(server, core, 'target');
    const request = new CoreCheatContract.SetTimeOffsetRequest();
    request.offset_ms = 30n * 86_400_000n;
    expect((await send_cheat(target, 'core/cheat/SetTimeOffset', request)).envelope.error).toBeNull();
    imported(await importSnapshot(server, target.user_id, await exportSnapshot(server, source.user_id)));
    const clone = (await listClones(server))[0];
    if (clone === undefined) throw new Error('no clone record');
    expect(BigInt(clone.cloned_at)).toBe(core['server-time'].clock_now());
    advance_time(server, BigInt(clone.expires_at) - BigInt(clone.cloned_at) - 1n);
    await wait_background(server);
    expect(cloneRecords(core).length).toBe(1);
    advance_time(server, 1n);
    await wait_background(server);
    expect(cloneRecords(core)).toEqual([]);
  });
});
