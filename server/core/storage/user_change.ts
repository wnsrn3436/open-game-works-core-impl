/**
 * User changes (`storage` `### user change`): one user's transaction changes another user's saved state after
 * commit, as an out-of-request change of the target user.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import { DbError, is_db_failure } from './db/types.ts';
import {
  adapter_of,
  big,
  bytes,
  q,
  StorageMisuse,
  user_state_of,
  writable,
  type FailureCode,
  type Pass,
  type StorageCore,
  type UserChangeApply,
  type UserChangeFail,
  type UserChangeFailure,
} from './core.ts';
import type { RequestCtx } from './request_ctx.ts';
import { after_commit, lock_row, run_game, run_user_transaction, track, with_hook_change_source } from './tx.ts';

/** A core module's change name: `<module>.<snake_case>`. */
const CORE_CHANGE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
/** Content's change name: snake_case without `.`. */
const CONTENT_CHANGE_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** Who registers a change name: a core module (the module object) or content (member `content`). */
export type ChangeCaller = 'module' | 'content';

interface ChangeRow {
  readonly change_id: bigint;
  readonly name: string;
  readonly sender_id: bigint;
  readonly target_id: bigint;
  readonly payload: Uint8Array;
  readonly phase: string;
  readonly fail_reason: string;
  readonly fail_code: number;
  readonly attempts: number;
}

const COLUMNS = 'change_id, name, sender_id, target_id, payload, phase, fail_reason, fail_code, attempts';

function change_row(row: Record<string, unknown>): ChangeRow {
  return {
    change_id: big(row.change_id as bigint),
    name: String(row.name),
    sender_id: big(row.sender_id as bigint),
    target_id: big(row.target_id as bigint),
    payload: bytes(row.payload as Uint8Array),
    phase: String(row.phase),
    fail_reason: String(row.fail_reason),
    fail_code: Number(row.fail_code),
    attempts: Number(row.attempts),
  };
}

/** Registers a change name; returns why server start fails, or null. */
export function register_user_change(core: StorageCore, caller: ChangeCaller, name: unknown, apply: unknown, fail: unknown): string | null {
  if (typeof name !== 'string' || !(caller === 'module' ? CORE_CHANGE_NAME : CONTENT_CHANGE_NAME).test(name)) {
    return caller === 'module' ? `core module user change name ${String(name)} is not <module>.<snake_case>` : `content user change name ${String(name)} is not snake_case without a dot`;
  }
  if (typeof apply !== 'function' || typeof fail !== 'function') return `user change ${name} needs an apply function and a fail function`;
  if (core.changes.has(name)) return `user change ${name} is registered twice`;
  core.changes.set(name, { apply: apply as UserChangeApply, fail: fail as UserChangeFail });
  return null;
}

export function send_user_change(core: StorageCore, ctx: unknown, target_id: unknown, name: unknown, payload: unknown): void {
  const state = user_state_of(core, ctx);
  writable(state);
  if (typeof name !== 'string' || !core.changes.has(name)) throw new StorageMisuse(`storage: user change ${String(name)} is not registered`);
  if (typeof target_id !== 'bigint' || target_id < 1n || target_id === state.user_id) throw new StorageMisuse(`storage: user change target ${String(target_id)} is not another user`);
  if (!(payload instanceof Uint8Array)) throw new StorageMisuse('storage: the user change payload is not bytes');
  if (payload.length > core.settings.user_change_max_bytes) throw new StorageMisuse(`storage: user change payload of ${String(payload.length)} bytes is over storage.userChangeMaxBytes`);
  const now = core.time.clock_now();
  const row = q(
    state,
    'INSERT INTO user_change (name, sender_id, target_id, payload, phase, fail_reason, fail_code, attempts, next_attempt_at, created_at) ' +
      `VALUES ($1, $2, $3, $4, 'apply', '', 0, 0, $5, $6) RETURNING change_id`,
    [name, state.user_id, target_id, payload, now, now],
  )[0];
  const change_id = big(row?.change_id);
  after_commit(core, ctx, () => process_row(core, change_id));
}

/** Reads the row under its row lock inside a user transaction. */
function locked_row(core: StorageCore, ctx: RequestCtx, change_id: bigint): ChangeRow | null {
  const state = user_state_of(core, ctx);
  if (lock_row(state, 'user_change', [change_id]) === 'FAILED') throw new DbError('lock', 'user_change', 'storage: the user change row lock failed');
  const row = q(state, `SELECT ${COLUMNS} FROM user_change WHERE change_id = $1`, [change_id])[0];
  return row === undefined ? null : change_row(row);
}

type Outcome = 'done' | 'rejected' | 'withdrawn' | 'failed';

/** The largest `fail_code` (an `int32` column). */
const FAIL_CODE_MAX = 2147483647;

/**
 * The apply function's output: `pass`, or a failure code (`CoreError` 1 to 999, `GameError` 1000 and up). Any other
 * output is a wrong output form and throws, so the apply transaction rolls back as a throw.
 */
function apply_output(name: string, output: unknown): Pass | FailureCode {
  if (output === 'pass') return 'pass';
  if (typeof output === 'number' && Number.isSafeInteger(output) && output >= 1 && output <= FAIL_CODE_MAX) return output;
  const shown = typeof output === 'string' ? JSON.stringify(output) : typeof output === 'number' ? String(output) : output === null ? 'null' : typeof output;
  throw new TypeError(`user change ${name} apply returned ${shown}, not pass or a failure code`);
}

/** Step 1: the apply function in the target user's transaction. */
async function apply_step(core: StorageCore, change_id: bigint, target_id: bigint): Promise<{ outcome: Outcome; code: FailureCode }> {
  let code: FailureCode = 0;
  let result;
  try {
    result = await run_user_transaction(core, target_id, (ctx) => {
      const row = locked_row(core, ctx, change_id);
      if (row?.phase !== 'apply') return 'pass';
      const change = core.changes.get(row.name);
      if (change === undefined) return 'pass';
      const applied = apply_output(
        row.name,
        with_hook_change_source(core, ctx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_USER_CHANGE, `${row.name}:${String(change_id)}`, () =>
          change.apply(ctx, row.sender_id, row.payload),
        ),
      );
      if (applied !== 'pass') {
        code = applied;
        return applied;
      }
      q(user_state_of(core, ctx), 'DELETE FROM user_change WHERE change_id = $1', [change_id]);
      return 'pass';
    });
  } catch {
    return { outcome: 'failed', code };
  }
  if (result === 'COMMITTED') return { outcome: 'done', code };
  if (result === 'REJECTED') return { outcome: 'rejected', code };
  if (result === 'WITHDRAWN') return { outcome: 'withdrawn', code };
  return { outcome: 'failed', code };
}

function failure_of(row: ChangeRow): UserChangeFailure {
  if (row.fail_reason === 'rejected') return { reason: 'rejected', code: row.fail_code };
  if (row.fail_reason === 'withdrawn') return { reason: 'withdrawn' };
  return { reason: 'failed' };
}

/** Step 3: the fail function in the sender's transaction; a withdrawn sender's row is deleted. */
async function fail_step(core: StorageCore, change_id: bigint, sender_id: bigint): Promise<'done' | 'failed'> {
  let result;
  try {
    result = await run_user_transaction(core, sender_id, (ctx) => {
      const row = locked_row(core, ctx, change_id);
      if (row?.phase !== 'fail') return 'pass';
      const change = core.changes.get(row.name);
      // Only the server instance that registered the name handles its row.
      if (change === undefined) return 'pass';
      with_hook_change_source(core, ctx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_USER_CHANGE, `${row.name}:${String(change_id)}`, () => {
        change.fail(ctx, row.target_id, row.payload, failure_of(row));
      });
      q(user_state_of(core, ctx), 'DELETE FROM user_change WHERE change_id = $1', [change_id]);
      return 'pass';
    });
  } catch {
    return 'failed';
  }
  if (result === 'WITHDRAWN') {
    const deleted = await game_write(core, 'DELETE FROM user_change WHERE change_id = $1', [change_id]);
    return deleted ? 'done' : 'failed';
  }
  return result === 'COMMITTED' ? 'done' : 'failed';
}

/** One statement in a game transaction; false when it failed. */
async function game_write(core: StorageCore, sql: string, params: readonly (bigint | number | string)[]): Promise<boolean> {
  try {
    const result = await run_game(core, (tx) => {
      const state = core.states.get(tx);
      if (state !== undefined) q(state, sql, params);
    });
    return result !== 'FAILED';
  } catch (error) {
    if (is_db_failure(error)) return false;
    throw error;
  }
}

/** The wait before attempt `attempts + 1`: the first interval, then times the factor, up to the maximum. */
export function retry_interval(core: StorageCore, attempts: number): bigint {
  const max = BigInt(core.settings.retry_max_interval_ms);
  let interval = BigInt(core.settings.retry_initial_ms);
  for (let i = 1; i < attempts; i += 1) interval = (interval * BigInt(core.settings.retry_factor_permille)) / 1000n;
  return interval > max ? max : interval;
}

function to_fail(core: StorageCore, row: ChangeRow, reason: 'rejected' | 'withdrawn' | 'failed', code: FailureCode): Promise<boolean> {
  return game_write(
    core,
    `UPDATE user_change SET phase = 'fail', fail_reason = $1, fail_code = $2, attempts = 0, next_attempt_at = $3 WHERE change_id = $4 AND phase = 'apply' AND attempts = $5`,
    [reason, reason === 'rejected' ? code : 0, core.time.clock_now(), row.change_id, row.attempts],
  );
}

/** Step 4: one more attempt later, or the next step after the last attempt. */
async function retry(core: StorageCore, row: ChangeRow): Promise<'fail' | 'end'> {
  const attempts = row.attempts + 1;
  if (attempts >= core.settings.retry_max_attempts) {
    if (row.phase === 'apply') return (await to_fail(core, row, 'failed', 0)) ? 'fail' : 'end';
    await game_write(core, `DELETE FROM user_change WHERE change_id = $1 AND phase = 'fail' AND attempts = $2`, [row.change_id, row.attempts]);
    return 'end';
  }
  await game_write(core, 'UPDATE user_change SET attempts = $1, next_attempt_at = $2 WHERE change_id = $3 AND phase = $4 AND attempts = $5', [
    attempts,
    core.time.clock_now() + retry_interval(core, attempts),
    row.change_id,
    row.phase,
    row.attempts,
  ]);
  return 'end';
}

function read_row(core: StorageCore, change_id: bigint): ChangeRow | null {
  const row = adapter_of(core).read.query(`SELECT ${COLUMNS} FROM user_change WHERE change_id = $1`, [change_id])[0];
  return row === undefined ? null : change_row(row);
}

async function fail_phase(core: StorageCore, change_id: bigint): Promise<void> {
  const row = read_row(core, change_id);
  if (row?.phase !== 'fail') return;
  if ((await fail_step(core, change_id, row.sender_id)) === 'failed') await retry(core, row);
}

/** The row processing order of one `user_change` row. A row of a name this instance did not register stays as it is. */
export async function process_row(core: StorageCore, change_id: bigint): Promise<void> {
  if (core.phase === 'stopped') return;
  const row = read_row(core, change_id);
  if (row === null || !core.changes.has(row.name)) return;
  if (row.phase === 'fail') {
    await fail_phase(core, change_id);
    return;
  }
  const applied = await apply_step(core, change_id, row.target_id);
  if (applied.outcome === 'done') return;
  if (applied.outcome === 'failed') {
    if ((await retry(core, row)) === 'fail') await fail_phase(core, change_id);
    return;
  }
  if (await to_fail(core, row, applied.outcome, applied.code)) await fail_phase(core, change_id);
}

/**
 * Applies the due rows of the change names this instance registered, oldest `next_attempt_at` first, up to
 * `storage.userChangeBatchSize`. Rows of other names are left to the server instances that registered them, and rows
 * whose processing threw outside the apply and fail functions are left out until the process ends.
 */
export async function run_user_changes(core: StorageCore): Promise<number | 'FAILED'> {
  const names = [...core.changes.keys()];
  if (names.length === 0) return 0;
  const skipped = [...core.skipped_changes];
  const skip = skipped.length === 0 ? '' : ` AND change_id NOT IN (${skipped.map((_, i) => `$${String(i + names.length + 3)}`).join(', ')})`;
  let rows;
  try {
    rows = adapter_of(core).read.query(
      `SELECT change_id FROM user_change WHERE next_attempt_at <= $1 AND name IN (${names.map((_, i) => `$${String(i + 3)}`).join(', ')})${skip} ORDER BY next_attempt_at, change_id LIMIT $2`,
      [core.time.clock_now(), core.settings.user_change_batch_size, ...names, ...skipped],
    );
  } catch (error) {
    if (is_db_failure(error)) return 'FAILED';
    throw error;
  }
  // A DB failure past the first read (a `read_row` on a lost read connection) ends the run as `FAILED`. Any other
  // throw of one row is outside the apply and fail functions, which run inside transactions that catch their throws:
  // the row is left out of later runs, the rows after it still run, and one error naming every such row is thrown
  // after the batch.
  const outcome: { failed: boolean; thrown: { change_id: bigint; error: unknown }[] } = { failed: false, thrown: [] };
  for (const row of rows) {
    const change_id = big(row.change_id);
    await track(
      core,
      process_row(core, change_id).catch((error: unknown) => {
        if (is_db_failure(error)) outcome.failed = true;
        else {
          core.skipped_changes.add(change_id);
          outcome.thrown.push({ change_id, error });
        }
      }),
    );
    if (outcome.failed) break;
  }
  const first = outcome.thrown[0];
  if (first !== undefined) {
    const ids = outcome.thrown.map((t) => String(t.change_id)).join(', ');
    const reason = first.error instanceof Error ? first.error.message : String(first.error);
    throw new Error(
      `storage: the processing of user change change_id ${ids} threw outside its apply and fail functions; this server instance leaves it out of run_user_changes until the process ends: ${reason}`,
      { cause: first.error },
    );
  }
  return outcome.failed ? 'FAILED' : rows.length;
}
