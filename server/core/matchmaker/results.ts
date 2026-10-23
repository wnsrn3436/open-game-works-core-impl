/**
 * Match records after creation: `ReportMatchResult` (`### ReportMatchResult`), the result decision, the apply of
 * each index (`### apply`), participant changes, and the work of job `matchmaker_sweep`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type { GameTx, RequestCtx } from '../storage/index.ts';
import type { ParticipantChange } from './deps.ts';
import { decide } from './judge.ts';
import {
  MATCH_TABLE,
  due_applies,
  due_deadlines,
  insert_record,
  read_record,
  record_input,
  write_apply_state,
  write_match,
  write_participant,
  type MatchRecord,
  type ParticipantRecord,
} from './records.ts';
import { CoreError, log_error, retry_delay, type Env } from './shared.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Status = CoreContract.MatchJudgeStatus;

/** A judged report: the record stays `PENDING`, or it is decided, or a hook failed (the request fails). */
type Judged = 'PENDING' | 'DECIDED' | { readonly hook_failure: string };

/** The apply hook's outcome in a savepoint: `pass`, a `GameError` (rolled back), or a hook failure. */
type Applied = 'pass' | 'rejected' | { readonly hook_failure: string };

export interface Results {
  /** The core `rpc` handler `ReportMatchResult`. */
  report(ctx: RequestCtx, request: CoreContract.ReportMatchResultRequest): CoreContract.ReportMatchResultResponse | number;
  /** Saves a new match record in one game transaction; false when it failed. */
  create(record: MatchRecord): Promise<boolean>;
  /** Writes a participant change of `p2p-signaling` to a `PENDING` record. */
  participant_change(change: ParticipantChange): Promise<void>;
  /** The work of job `matchmaker_sweep`: deadline decisions, then the applies that are due. */
  sweep(): Promise<void>;
}

function status_value(record: MatchRecord): CoreContract.MatchJudgeStatus {
  if (record.status === 'CONFIRMED') return Status.MATCH_JUDGE_STATUS_CONFIRMED;
  if (record.status === 'MISMATCH') return Status.MATCH_JUDGE_STATUS_MISMATCH;
  return Status.MATCH_JUDGE_STATUS_PENDING;
}

function response(status: CoreContract.MatchJudgeStatus): CoreContract.ReportMatchResultResponse {
  const out = new CoreContract.ReportMatchResultResponse();
  out.status = status;
  return out;
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function create_results(env: Env): Results {
  const { storage, server_time, settings } = env;
  /** Applies running in this server instance, by `<match_id>:<index>`. */
  const running = new Set<string>();
  /** The participant changes of each match, written one after another. */
  const change_chains = new Map<string, Promise<void>>();

  const now = (): bigint => server_time.clock_now();

  /** A `CONFIRMED` result must decode as `MatchResult` and pass `validation.validate_message`. */
  const valid_result = (result: Uint8Array): boolean => {
    const message = GameContract.MatchResult.decode(result);
    return message !== null && env.validation.validate_message('MatchResult', message) === 'pass';
  };

  const valid_input_log = (record: MatchRecord, input_log: Uint8Array): boolean => {
    if (record.data_version !== env.server.client_data_version) return false;
    const message = GameContract.MatchInputLog.decode(input_log);
    return message !== null && env.validation.validate_message('MatchInputLog', message) === 'pass';
  };

  const decided = (record: MatchRecord, status: 'CONFIRMED' | 'MISMATCH', at: bigint, result: Uint8Array = new Uint8Array(0)): void => {
    record.status = status;
    record.decided_at = at;
    record.result = result;
    for (const p of record.participants) if (!p.applied) p.next_attempt_at = at;
  };

  /** Writes a decision made in this transaction: the match row, each index's `next_attempt_at`, the apply state. */
  const write_decision = (ctx_or_tx: RequestCtx | GameTx, record: MatchRecord, at: bigint): void => {
    const db = storage.db(ctx_or_tx);
    write_match(db, record, ['status', 'decided_at', 'result', 'replayed_input_log']);
    for (const p of record.participants) write_participant(db, record, p, ['next_attempt_at', 'applied', 'last_failure']);
    write_apply_state(db, record, at, settings.record_retention_ms);
  };

  /** `replay_match` with the replay `input_log`: the result to confirm, `reject`, or a hook failure. */
  const replay = (record: MatchRecord, input_log: Uint8Array): Uint8Array | 'reject' | { readonly hook_failure: string } => {
    const hook = env.hooks.replay_match;
    if (hook === null) return 'reject';
    record.replayed_input_log = input_log;
    const random = storage.create_random(storage.make_purpose_seed('match_simulation', record.seed));
    let out: unknown;
    try {
      out = hook(record_input(record), input_log, random, env.server.data, env.server.data_version);
    } catch (error) {
      return { hook_failure: `replay_match threw: ${message_of(error)}` };
    }
    if (out === 'reject' || out instanceof Uint8Array) return out;
    return { hook_failure: 'replay_match returned a value that is neither result bytes nor reject' };
  };

  /** The result decision of a `PENDING` record after a report was stored. */
  const judge = (record: MatchRecord, at: bigint): Judged => {
    const mode = env.server.data.MatchModeTable;
    const rule = mode.has_row(record.mode_id) ? mode.get_row(record.mode_id).result_rule : null;
    const decision = rule === null ? { kind: 'MISMATCH' as const } : decide(rule, record.participants);
    switch (decision.kind) {
      case 'PENDING':
        return 'PENDING';
      case 'MISMATCH':
        decided(record, 'MISMATCH', at);
        return 'DECIDED';
      case 'CONFIRMED':
        if (valid_result(decision.result)) decided(record, 'CONFIRMED', at, decision.result);
        else decided(record, 'MISMATCH', at);
        return 'DECIDED';
      case 'REPLAY': {
        if (!valid_input_log(record, decision.input_log)) {
          decided(record, 'MISMATCH', at);
          return 'DECIDED';
        }
        const out = replay(record, decision.input_log);
        if (typeof out === 'object' && !(out instanceof Uint8Array)) return out;
        if (out instanceof Uint8Array && valid_result(out)) decided(record, 'CONFIRMED', at, out);
        else decided(record, 'MISMATCH', at);
        return 'DECIDED';
      }
    }
  };

  /** Calls the apply hook of the record's status for one index in a savepoint, with change source `Match`. */
  const apply_in = (ctx: RequestCtx, record: MatchRecord, p: ParticipantRecord): Applied => {
    const input = record_input(record);
    const result_hook = env.hooks.apply_match_result;
    const mismatch_hook = env.hooks.apply_match_mismatch;
    let call: (() => unknown) | null = null;
    if (record.status === 'CONFIRMED' && result_hook !== null) call = () => result_hook(ctx, input, p.index, record.result);
    if (record.status === 'MISMATCH' && mismatch_hook !== null) call = () => mismatch_hook(ctx, input, p.index);
    if (call === null) return 'pass';
    const run = call;
    const name = record.status === 'CONFIRMED' ? 'apply_match_result' : 'apply_match_mismatch';
    const state: { failure: string | null } = { failure: null };
    const out = storage.run_savepoint(ctx, () =>
      storage.with_hook_change_source(ctx, CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_MATCH, record.match_id, () => {
        let value: unknown;
        try {
          value = run();
        } catch (error) {
          state.failure = `${name} threw: ${message_of(error)}`;
          return CoreError.CORE_ERROR_INTERNAL;
        }
        try {
          return storage.check_hook_output(name, value);
        } catch (error) {
          state.failure = message_of(error);
          return CoreError.CORE_ERROR_INTERNAL;
        }
      }),
    );
    if (state.failure !== null) return { hook_failure: state.failure };
    return out === 'pass' ? 'pass' : 'rejected';
  };

  /** Marks an index whose apply hook returned a `GameError`; logs when the failure kind changed. */
  const mark_rejected = (record: MatchRecord, p: ParticipantRecord, ctx: RequestCtx | null): (() => void) => {
    const before = p.last_failure;
    p.applied = true;
    p.last_failure = 'REJECTED';
    return () => {
      if (before !== 'REJECTED') log_error(env, 'match apply rejected', { match_id: record.match_id, index: p.index }, p.user_id, ctx);
    };
  };

  /** Starts the out-of-request apply of these indices after the transaction of `ctx` commits. */
  const apply_after_commit = (ctx: RequestCtx, match_id: string, indices: readonly number[]): void => {
    if (indices.length === 0) return;
    storage.after_commit(ctx, async () => {
      await Promise.all(indices.map((index) => apply_index(match_id, index)));
    });
  };

  const report = (ctx: RequestCtx, request: CoreContract.ReportMatchResultRequest): CoreContract.ReportMatchResultResponse | number => {
    if (!UUID_V4.test(request.match_id)) return CoreError.CORE_ERROR_INVALID_REQUEST;
    if (storage.lock_game_row(ctx, MATCH_TABLE, [request.match_id]) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
    const db = storage.db(ctx);
    const at = now();
    const record = read_record(db, request.match_id, at);
    if (record === null) return CoreError.CORE_ERROR_MATCH_NOT_FOUND;
    const me = record.participants.find((p) => p.user_id === ctx.user_id);
    if (me === undefined) return CoreError.CORE_ERROR_MATCH_NOT_PARTICIPANT;
    if (record.status !== 'PENDING') return response(status_value(record));
    if (record.deadline_at <= at) {
      decided(record, 'MISMATCH', at);
      write_decision(ctx, record, at);
      apply_after_commit(ctx, record.match_id, record.participants.map((p) => p.index));
      return response(Status.MATCH_JUDGE_STATUS_MISMATCH);
    }
    if (me.reported_at !== 0n) return CoreError.CORE_ERROR_MATCH_ALREADY_REPORTED;
    me.reported_at = at;
    me.result = request.result;
    me.input_log = request.input_log;
    write_participant(db, record, me, ['reported_at', 'result', 'input_log']);
    const judged = judge(record, at);
    if (typeof judged === 'object') {
      log_error(env, judged.hook_failure, { match_id: record.match_id }, null, ctx);
      return CoreError.CORE_ERROR_INTERNAL;
    }
    if (judged === 'PENDING') return response(Status.MATCH_JUDGE_STATUS_PENDING);
    const applied = apply_in(ctx, record, me);
    if (typeof applied === 'object') {
      log_error(env, applied.hook_failure, { match_id: record.match_id, index: me.index }, null, ctx);
      return CoreError.CORE_ERROR_INTERNAL;
    }
    let log_rejected = (): void => {};
    if (applied === 'rejected') log_rejected = mark_rejected(record, me, ctx);
    else me.applied = true;
    write_decision(ctx, record, at);
    log_rejected();
    apply_after_commit(ctx, record.match_id, record.participants.filter((p) => p !== me).map((p) => p.index));
    return response(status_value(record));
  };

  /**
   * Runs one game transaction on a locked record; nothing when the record is missing. A lock wait over the limit
   * changes nothing and, like a failed transaction, leaves an error log.
   */
  const on_locked = async (match_id: string, fn: (tx: GameTx, record: MatchRecord, at: bigint) => void): Promise<void> => {
    const out = await storage.run_game_transaction((tx) => {
      if (storage.lock_game_row(tx, MATCH_TABLE, [match_id]) === 'FAILED') return 'LOCK_FAILED' as const;
      const at = now();
      const record = read_record(storage.db(tx), match_id, at);
      if (record !== null) fn(tx, record, at);
      return 'DONE' as const;
    });
    if (out !== 'DONE') log_error(env, 'match record transaction failed', { match_id });
  };

  /**
   * `FAILED` apply: one more attempt counted, the next attempt time, or giving up at the attempt limit. The error log
   * (with the hook failure, when a hook failed) is only for a failure after another result and for giving up.
   */
  const mark_failed = async (match_id: string, index: number, hook_failure: string | null): Promise<void> => {
    const logs: (() => void)[] = [];
    await on_locked(match_id, (tx, record, at) => {
      const p = record.participants[index];
      if (p === undefined || p.applied) return;
      const before = p.last_failure;
      p.attempts += 1;
      p.last_failure = 'FAILED';
      if (p.attempts >= settings.apply_retry_max_attempts) p.applied = true;
      else p.next_attempt_at = at + retry_delay(settings, p.attempts);
      const db = storage.db(tx);
      write_participant(db, record, p, ['attempts', 'last_failure', 'applied', 'next_attempt_at']);
      write_apply_state(db, record, at, settings.record_retention_ms);
      const fields = { match_id, index, attempts: p.attempts };
      if (before !== 'FAILED') {
        logs.push(() => {
          log_error(env, 'match apply failed', hook_failure === null ? fields : { ...fields, failure: hook_failure }, p.user_id);
        });
      }
      if (p.applied) {
        logs.push(() => {
          log_error(env, 'match apply given up', fields, p.user_id);
        });
      }
    });
    for (const log of logs) log();
  };

  /** A withdrawn user's index: marked without applying. */
  const mark_withdrawn = (match_id: string, index: number): Promise<void> =>
    on_locked(match_id, (tx, record, at) => {
      const p = record.participants[index];
      if (p === undefined || p.applied) return;
      p.applied = true;
      write_participant(storage.db(tx), record, p, ['applied']);
      write_apply_state(storage.db(tx), record, at, settings.record_retention_ms);
    });

  /** The out-of-request apply of one index: one `run_user_transaction` of that user. */
  const apply_index = async (match_id: string, index: number): Promise<void> => {
    const key = `${match_id}:${String(index)}`;
    if (running.has(key) || env.stopped()) return;
    running.add(key);
    try {
      const user_id = participant_user(match_id, index);
      if (user_id === null) return;
      const state: { failure: string | null; log_rejected: () => void } = { failure: null, log_rejected: () => {} };
      let result: string;
      try {
        result = await apply_transaction(user_id, match_id, index, state);
      } catch (error) {
        // A throw after the hook (a DB or storage error) rolled the apply back: it is a FAILED apply, counted and
        // given up at the attempt limit like the others.
        if (env.stopped()) return;
        result = 'FAILED';
        state.failure = `the apply transaction threw: ${message_of(error)}`;
      }
      if (result === 'COMMITTED') {
        state.log_rejected();
        return;
      }
      if (result === 'WITHDRAWN') {
        await mark_withdrawn(match_id, index);
        return;
      }
      await mark_failed(match_id, index, state.failure === 'lock' ? null : state.failure);
    } catch (error) {
      if (!env.stopped()) log_error(env, `match apply threw: ${message_of(error)}`, { match_id, index });
    } finally {
      running.delete(key);
    }
  };

  /** The user transaction of one apply attempt; `state` gets the failure and the deferred rejection log. */
  const apply_transaction = (user_id: bigint, match_id: string, index: number, state: { failure: string | null; log_rejected: () => void }): Promise<string> =>
    storage.run_user_transaction(user_id, (ctx) => {
      if (storage.lock_game_row(ctx, MATCH_TABLE, [match_id]) === 'FAILED') {
        state.failure = 'lock';
        return CoreError.CORE_ERROR_INTERNAL;
      }
      const at = now();
      const db = storage.db(ctx);
      const record = read_record(db, match_id, at);
      const p = record?.participants[index];
      if (record === null || p === undefined || p.applied || record.status === 'PENDING') return 'pass';
      const applied = apply_in(ctx, record, p);
      if (typeof applied === 'object') {
        state.failure = applied.hook_failure;
        return CoreError.CORE_ERROR_INTERNAL;
      }
      if (applied === 'rejected') state.log_rejected = mark_rejected(record, p, null);
      else p.applied = true;
      write_participant(db, record, p, ['applied', 'last_failure']);
      write_apply_state(db, record, at, settings.record_retention_ms);
      return 'pass';
    });

  /** The user ID of an index of a decided record not yet marked, read outside a transaction; null otherwise. */
  const participant_user = (match_id: string, index: number): bigint | null => {
    const record = read_record(read_db(), match_id, now());
    const p = record?.participants[index];
    if (record === null || p === undefined || p.applied || record.status === 'PENDING') return null;
    return p.user_id;
  };

  const read_db = (): ReturnType<typeof storage.read_db> => storage.read_db();

  const create = async (record: MatchRecord): Promise<boolean> => {
    try {
      const out = await storage.run_game_transaction((tx) => {
        insert_record(storage.db(tx), record);
        return { saved: true };
      });
      return out !== 'FAILED';
    } catch {
      return false;
    }
  };

  const write_change = (change: ParticipantChange): Promise<void> =>
    on_locked(change.match_id, (tx, record, at) => {
      if (record.status !== 'PENDING') return;
      const p = record.participants[change.index];
      if (p === undefined) return;
      if (change.kind === 'LEFT') {
        p.left_at = at;
        write_participant(storage.db(tx), record, p, ['left_at']);
      } else {
        p.disconnected_at = change.kind === 'DISCONNECTED' ? at : 0n;
        write_participant(storage.db(tx), record, p, ['disconnected_at']);
      }
    });

  const participant_change = (change: ParticipantChange): Promise<void> => {
    const before = change_chains.get(change.match_id) ?? Promise.resolve();
    const next = before.then(() => write_change(change)).catch((error: unknown) => {
      if (!env.stopped()) log_error(env, `participant change failed: ${message_of(error)}`, { match_id: change.match_id, index: change.index });
    });
    change_chains.set(change.match_id, next);
    void next.finally(() => {
      if (change_chains.get(change.match_id) === next) change_chains.delete(change.match_id);
    });
    return next;
  };

  /** Job functions log their own failure and do not throw (`server-time`). */
  const sweep = async (): Promise<void> => {
    try {
      await run_sweep();
    } catch (error) {
      if (!env.stopped()) log_error(env, `matchmaker_sweep threw: ${message_of(error)}`, {});
    }
  };

  const run_sweep = async (): Promise<void> => {
    for (const match_id of due_deadlines(read_db(), now())) {
      if (env.stopped()) return;
      await on_locked(match_id, (tx, record, at) => {
        if (record.status !== 'PENDING' || record.deadline_at > at) return;
        decided(record, 'MISMATCH', at);
        write_decision(tx, record, at);
      });
    }
    for (const match_id of due_applies(read_db(), now())) {
      if (env.stopped()) return;
      const record = read_record(read_db(), match_id, now());
      if (record === null) continue;
      const at = now();
      for (const p of record.participants) {
        if (!p.applied && p.next_attempt_at <= at) await apply_index(match_id, p.index);
      }
    }
  };

  return { report, create, participant_change, sweep };
}
