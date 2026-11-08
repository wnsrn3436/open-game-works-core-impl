/**
 * Match records after creation: `ReportMatchResult` (`### ReportMatchResult`), the result decision
 * (`### result decision`) with its integrity events (`### integrity`), the apply of each index (`### apply`),
 * participant changes with the decision after a `left_at` write (`### connection`), and the work of job
 * `matchmaker_sweep`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import * as GameContract from '../../generated/contract/game_contract.ts';
import type * as GameData from '../../generated/data/game_data.ts';
import type { GameTx, RequestCtx } from '../storage/index.ts';
import type { ParticipantChange } from './deps.ts';
import { decide, integrity_events, type IntegrityKind } from './judge.ts';
import {
  INTEGRITY_TABLE,
  MATCH_TABLE,
  due_applies,
  due_deadlines,
  flag_count,
  insert_integrity,
  insert_record,
  read_record,
  record_input,
  status_value,
  write_apply_state,
  write_match,
  write_participant,
  type MatchRecord,
  type ParticipantRecord,
} from './records.ts';
import { CoreError, log_core, log_error, retry_delay, type Env } from './shared.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const Status = CoreContract.MatchJudgeStatus;

/** A hook failure (a throw or a wrong output): the message of its error log. */
interface HookFailure {
  readonly hook_failure: string;
}

/**
 * A judgement: the record stays `PENDING`, or it is decided, or a hook failed (the request fails), or an integrity
 * lock was `FAILED` (the judging transaction fails).
 */
type Judged = 'PENDING' | 'DECIDED' | 'LOCK_FAILED' | HookFailure;

/** The apply hook's outcome in a savepoint: `pass`, a `GameError` (rolled back), or a hook failure. */
type Applied = 'pass' | 'rejected' | HookFailure;

/**
 * Where a judgement runs: in `ReportMatchResult` a throw or a wrong output of `replay_match` fails the request; in
 * the decision transaction after a `left_at` write and in job `matchmaker_sweep` it makes the match `MISMATCH`.
 */
type ReplayFailure = 'fail' | 'mismatch';

export interface Results {
  /** The core `rpc` handler `ReportMatchResult`. */
  report(ctx: RequestCtx, request: CoreContract.ReportMatchResultRequest): CoreContract.ReportMatchResultResponse | number;
  /** Saves a new match record in one game transaction; false when it failed. */
  create(record: MatchRecord): Promise<boolean>;
  /**
   * Writes a participant change of `p2p-signaling` to a `PENDING` record, after the earlier changes of that match.
   * Resolves when the first attempt ended; the retries of a failed `LEFT` run behind.
   */
  participant_change(change: ParticipantChange): Promise<void>;
  /** The work of job `matchmaker_sweep`: deadline decisions, then the applies that are due. */
  sweep(): Promise<void>;
}

function response(status: CoreContract.MatchJudgeStatus): CoreContract.ReportMatchResultResponse {
  const out = new CoreContract.ReportMatchResultResponse();
  out.status = status;
  return out;
}

function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function is_hook_failure(value: unknown): value is HookFailure {
  return typeof value === 'object' && value !== null && 'hook_failure' in value;
}

export function create_results(env: Env): Results {
  const { storage, server_time, settings } = env;
  /** Applies running in this server instance, by `<match_id>:<index>`. */
  const running = new Set<string>();
  /** The first attempts of the participant changes of each match, written one after another. */
  const change_chains = new Map<string, Promise<void>>();

  const now = (): bigint => server_time.clock_now();

  /** `matchmaker.recordRetentionMs`, or the larger of it and `matchmaker.flagWindowMs` with an integrity event. */
  const retention_of = (record: MatchRecord): bigint =>
    record.integrity && settings.flag_window_ms > settings.record_retention_ms ? settings.flag_window_ms : settings.record_retention_ms;

  const mode_rule = (record: MatchRecord): GameData.MatchResultRule | null => {
    const table = env.server.data.MatchModeTable;
    return table.has_row(record.mode_id) ? table.get_row(record.mode_id).result_rule : null;
  };

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

  const decided = (record: MatchRecord, status: 'CONFIRMED' | 'MISMATCH' | 'FORFEIT', at: bigint, result: Uint8Array = new Uint8Array(0)): void => {
    record.status = status;
    record.decided_at = at;
    record.result = result;
    for (const p of record.participants) if (!p.applied) p.next_attempt_at = at;
  };

  /** Writes a decision made in this transaction: the match row, each index's `next_attempt_at`, the apply state. */
  const write_decision = (ctx_or_tx: RequestCtx | GameTx, record: MatchRecord, at: bigint): void => {
    const db = storage.db(ctx_or_tx);
    write_match(db, record, ['status', 'decided_at', 'result', 'replayed_input_log', 'integrity']);
    for (const p of record.participants) write_participant(db, record, p, ['next_attempt_at', 'applied', 'last_failure']);
    write_apply_state(db, record, at, retention_of);
  };

  /** `replay_match` with the replay `input_log`: the result to confirm, `reject`, or a hook failure. */
  const replay = (record: MatchRecord, input_log: Uint8Array): Uint8Array | 'reject' | HookFailure => {
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

  /**
   * Writes the integrity events of a judgement, each user's key `(user_id, "")` of `matchmaker_integrity` locked
   * first in ascending order of user ID, and registers the flag notice of a user whose flag count reached its key.
   * False when a lock was `FAILED`.
   */
  const write_integrity = (ctx_or_tx: RequestCtx | GameTx, record: MatchRecord, kinds: readonly (IntegrityKind | null)[], at: bigint): boolean => {
    const events = record.participants
      .map((p, i) => ({ user_id: p.user_id, kind: kinds[i] ?? null }))
      .filter((e): e is { user_id: bigint; kind: IntegrityKind } => e.kind !== null)
      .sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0));
    if (events.length === 0) return true;
    for (const e of events) {
      if (storage.lock_game_row(ctx_or_tx, INTEGRITY_TABLE, [e.user_id, '']) === 'FAILED') return false;
    }
    const db = storage.db(ctx_or_tx);
    for (const e of events) insert_integrity(db, { user_id: e.user_id, match_id: record.match_id, kind: e.kind, at }, settings.flag_window_ms);
    record.integrity = true;
    for (const e of events) {
      const count = flag_count(db, e.user_id, e.kind, at, settings.flag_window_ms);
      if (count !== settings.flag_counts[e.kind]) continue;
      storage.on_commit(ctx_or_tx, () => {
        log_core(env, 'warn', 'match integrity flag', { module: 'matchmaker', integrity_kind: e.kind, flag_count: count }, e.user_id);
      });
    }
    return true;
  };

  /**
   * The result decision of a `PENDING` record (`### result decision`), with its integrity events. `at_deadline`: the
   * final decision at `deadline_at`.
   */
  const judge = (ctx_or_tx: RequestCtx | GameTx, record: MatchRecord, at: bigint, at_deadline: boolean, on_replay_failure: ReplayFailure): Judged => {
    const rule = mode_rule(record);
    const decision = decide(rule, record.participants, at_deadline);
    let confirmed_value: Uint8Array | null = null;
    switch (decision.kind) {
      case 'PENDING':
        return 'PENDING';
      case 'MISMATCH':
      case 'FORFEIT':
        decided(record, decision.kind, at);
        break;
      case 'CONFIRMED':
        if (valid_result(decision.result)) {
          decided(record, 'CONFIRMED', at, decision.result);
          confirmed_value = decision.result;
        } else {
          decided(record, 'MISMATCH', at);
        }
        break;
      case 'REPLAY': {
        const out = valid_input_log(record, decision.input_log) ? replay(record, decision.input_log) : 'reject';
        if (is_hook_failure(out)) {
          if (on_replay_failure === 'fail') return out;
          log_error(env, out.hook_failure, { match_id: record.match_id });
          decided(record, 'MISMATCH', at);
        } else if (out instanceof Uint8Array && valid_result(out)) {
          decided(record, 'CONFIRMED', at, out);
          confirmed_value = record.replayed_input_log;
        } else {
          decided(record, 'MISMATCH', at);
        }
        break;
      }
    }
    const status = record.status === 'PENDING' ? 'MISMATCH' : record.status;
    const kinds = integrity_events(rule, record.participants, status, confirmed_value, at_deadline);
    return write_integrity(ctx_or_tx, record, kinds, at) ? 'DECIDED' : 'LOCK_FAILED';
  };

  /** The apply hook of the record's status for one index, in a savepoint, with change source `Match`. */
  const apply_in = (ctx: RequestCtx, record: MatchRecord, p: ParticipantRecord): Applied => {
    const input = record_input(record);
    const { apply_match_result, apply_match_forfeit, apply_match_mismatch } = env.hooks;
    let call: (() => unknown) | null = null;
    let name = '';
    if (record.status === 'CONFIRMED' && apply_match_result !== null) {
      name = 'apply_match_result';
      call = () => apply_match_result(ctx, input, p.index, record.result);
    } else if (record.status === 'FORFEIT' && apply_match_forfeit !== null) {
      name = 'apply_match_forfeit';
      call = () => apply_match_forfeit(ctx, input, p.index);
    } else if (record.status === 'MISMATCH' && apply_match_mismatch !== null) {
      name = 'apply_match_mismatch';
      call = () => apply_match_mismatch(ctx, input, p.index);
    }
    if (call === null) return 'pass';
    const run = call;
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

  /** Starts the out-of-request apply of these indices after the transaction commits. */
  const apply_after_commit = (ctx_or_tx: RequestCtx | GameTx, match_id: string, indices: readonly number[]): void => {
    if (indices.length === 0) return;
    storage.after_commit(ctx_or_tx, async () => {
      await Promise.all(indices.map((index) => apply_index(match_id, index)));
    });
  };

  const all_indices = (record: MatchRecord): number[] => record.participants.map((p) => p.index);

  /**
   * Step 5 of `### ReportMatchResult`: the final decision with the saved reports, without saving this report; every
   * participant is applied out of request after the commit.
   */
  const report_after_deadline = (ctx: RequestCtx, record: MatchRecord, at: bigint): CoreContract.ReportMatchResultResponse | number => {
    const judged = judge(ctx, record, at, true, 'fail');
    if (judged === 'LOCK_FAILED') return CoreError.CORE_ERROR_INTERNAL;
    if (is_hook_failure(judged)) {
      log_error(env, judged.hook_failure, { match_id: record.match_id }, null, ctx);
      return CoreError.CORE_ERROR_INTERNAL;
    }
    write_decision(ctx, record, at);
    apply_after_commit(ctx, record.match_id, all_indices(record));
    return response(status_value(record.status));
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
    if (record.status !== 'PENDING') return response(status_value(record.status));
    if (record.deadline_at <= at) return report_after_deadline(ctx, record, at);
    // A participant that left before reporting is a forfeiter, and no report of it is judged.
    if (me.left_at !== 0n) return response(Status.MATCH_JUDGE_STATUS_PENDING);
    if (me.reported_at !== 0n) return CoreError.CORE_ERROR_MATCH_ALREADY_REPORTED;
    me.reported_at = at;
    me.result = request.result;
    me.input_log = request.input_log;
    write_participant(db, record, me, ['reported_at', 'result', 'input_log']);
    const judged = judge(ctx, record, at, false, 'fail');
    if (judged === 'LOCK_FAILED') return CoreError.CORE_ERROR_INTERNAL;
    if (is_hook_failure(judged)) {
      log_error(env, judged.hook_failure, { match_id: record.match_id }, null, ctx);
      return CoreError.CORE_ERROR_INTERNAL;
    }
    if (judged === 'PENDING') return response(Status.MATCH_JUDGE_STATUS_PENDING);
    const applied = apply_in(ctx, record, me);
    if (is_hook_failure(applied)) {
      log_error(env, applied.hook_failure, { match_id: record.match_id, index: me.index }, null, ctx);
      return CoreError.CORE_ERROR_INTERNAL;
    }
    let log_rejected = (): void => {};
    if (applied === 'rejected') log_rejected = mark_rejected(record, me, ctx);
    else me.applied = true;
    write_decision(ctx, record, at);
    log_rejected();
    apply_after_commit(ctx, record.match_id, record.participants.filter((p) => p !== me).map((p) => p.index));
    return response(status_value(record.status));
  };

  /**
   * Runs one game transaction on the locked record; nothing when the record is missing. `fn` returns `ROLLBACK` to
   * roll back. The result is false when the lock was `FAILED`, `fn` rolled back, or the transaction failed or threw.
   */
  const on_locked = async (match_id: string, fn: (tx: GameTx, record: MatchRecord, at: bigint) => 'ROLLBACK' | undefined): Promise<boolean> => {
    try {
      const out = await storage.run_game_transaction((tx) => {
        if (storage.lock_game_row(tx, MATCH_TABLE, [match_id]) === 'FAILED') return CoreError.CORE_ERROR_INTERNAL;
        const at = now();
        const record = read_record(storage.db(tx), match_id, at);
        if (record !== null && fn(tx, record, at) === 'ROLLBACK') return CoreError.CORE_ERROR_INTERNAL;
        return { done: true };
      });
      return typeof out === 'object';
    } catch (error) {
      if (!env.stopped()) log_error(env, `match record transaction threw: ${message_of(error)}`, { match_id });
      return false;
    }
  };

  /**
   * `FAILED` apply: one more attempt counted, the next attempt time, or giving up at the attempt limit. The error log
   * (with the hook failure, when a hook failed) is only for a failure after another result and for giving up.
   */
  const mark_failed = async (match_id: string, index: number, hook_failure: string | null): Promise<void> => {
    const logs: (() => void)[] = [];
    const ok = await on_locked(match_id, (tx, record, at) => {
      const p = record.participants[index];
      if (p === undefined || p.applied) return;
      const before = p.last_failure;
      p.attempts += 1;
      p.last_failure = 'FAILED';
      if (p.attempts >= settings.apply_retry_max_attempts) p.applied = true;
      else p.next_attempt_at = at + retry_delay(settings, p.attempts);
      const db = storage.db(tx);
      write_participant(db, record, p, ['attempts', 'last_failure', 'applied', 'next_attempt_at']);
      write_apply_state(db, record, at, retention_of);
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
    if (!ok && !env.stopped()) log_error(env, 'match record transaction failed', { match_id });
    for (const log of logs) log();
  };

  /** A withdrawn user's index: marked without applying. */
  const mark_withdrawn = async (match_id: string, index: number): Promise<void> => {
    const ok = await on_locked(match_id, (tx, record, at) => {
      const p = record.participants[index];
      if (p === undefined || p.applied) return;
      p.applied = true;
      write_participant(storage.db(tx), record, p, ['applied']);
      write_apply_state(storage.db(tx), record, at, retention_of);
    });
    if (!ok && !env.stopped()) log_error(env, 'match record transaction failed', { match_id });
  };

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
      if (is_hook_failure(applied)) {
        state.failure = applied.hook_failure;
        return CoreError.CORE_ERROR_INTERNAL;
      }
      if (applied === 'rejected') state.log_rejected = mark_rejected(record, p, null);
      else p.applied = true;
      write_participant(db, record, p, ['applied', 'last_failure']);
      write_apply_state(db, record, at, retention_of);
      return 'pass';
    });

  /** The user ID of an index of a decided record not yet marked, read outside a transaction; null otherwise. */
  const participant_user = (match_id: string, index: number): bigint | null => {
    const record = read_record(storage.read_db(), match_id, now());
    const p = record?.participants[index];
    if (record === null || p === undefined || p.applied || record.status === 'PENDING') return null;
    return p.user_id;
  };

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

  /**
   * The decision transaction after a `left_at` write commits: a `PENDING` record gets the result decision, and when
   * it decides, every participant is applied out of request after the commit. It is not retried.
   */
  const decide_after_left = async (match_id: string): Promise<void> => {
    if (env.stopped()) return;
    const ok = await on_locked(match_id, (tx, record, at) => {
      if (record.status !== 'PENDING') return;
      const judged = judge(tx, record, at, record.deadline_at <= at, 'mismatch');
      if (judged === 'LOCK_FAILED') return 'ROLLBACK';
      if (judged !== 'DECIDED') return undefined;
      write_decision(tx, record, at);
      apply_after_commit(tx, record.match_id, all_indices(record));
    });
    if (!ok && !env.stopped()) log_error(env, 'match decision after a leave failed', { match_id });
  };

  /** One attempt of a participant change; false when its game transaction failed. */
  const write_change = (change: ParticipantChange): Promise<boolean> =>
    on_locked(change.match_id, (tx, record, at) => {
      if (record.status !== 'PENDING') return;
      const p = record.participants[change.index];
      if (p === undefined) return;
      const db = storage.db(tx);
      switch (change.kind) {
        case 'LEFT':
          p.left_at = at;
          write_participant(db, record, p, ['left_at']);
          storage.after_commit(tx, () => decide_after_left(change.match_id));
          return;
        case 'ENDED':
          p.ended_at = at;
          write_participant(db, record, p, ['ended_at']);
          return;
        case 'DISCONNECTED':
        case 'REJOINED':
          p.disconnected_at = change.kind === 'DISCONNECTED' ? at : 0n;
          write_participant(db, record, p, ['disconnected_at']);
          return;
      }
    });

  /** The retries of a `LEFT` whose first attempt failed: after g(a), until `matchmaker.applyRetryMaxAttempts` in all. */
  const retry_left = async (change: ParticipantChange): Promise<void> => {
    const fields = { match_id: change.match_id, index: change.index, change: change.kind };
    for (let failed = 1; failed < settings.apply_retry_max_attempts; failed += 1) {
      await server_time.sleep(retry_delay(settings, failed));
      if (env.stopped()) return;
      if (await write_change(change)) return;
    }
    if (!env.stopped()) log_error(env, 'participant change dropped', { ...fields, attempts: settings.apply_retry_max_attempts });
  };

  /** The first attempt of a change; a failed `LEFT` starts its retries behind and the next change goes on. */
  const first_attempt = async (change: ParticipantChange): Promise<void> => {
    if (env.stopped()) return;
    if (await write_change(change)) return;
    if (env.stopped()) return;
    const fields = { match_id: change.match_id, index: change.index, change: change.kind };
    if (change.kind !== 'LEFT') {
      log_error(env, 'participant change failed', fields);
      return;
    }
    log_error(env, 'participant change failed', { ...fields, attempts: 1 });
    if (settings.apply_retry_max_attempts <= 1) {
      log_error(env, 'participant change dropped', { ...fields, attempts: 1 });
      return;
    }
    void retry_left(change).catch((error: unknown) => {
      if (!env.stopped()) log_error(env, `participant change retry threw: ${message_of(error)}`, fields);
    });
  };

  const participant_change = (change: ParticipantChange): Promise<void> => {
    const before = change_chains.get(change.match_id) ?? Promise.resolve();
    const next = before.then(() => first_attempt(change)).catch((error: unknown) => {
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
    for (const match_id of due_deadlines(storage.read_db(), now())) {
      if (env.stopped()) return;
      const ok = await on_locked(match_id, (tx, record, at) => {
        if (record.status !== 'PENDING' || record.deadline_at > at) return;
        if (judge(tx, record, at, true, 'mismatch') === 'LOCK_FAILED') return 'ROLLBACK';
        write_decision(tx, record, at);
        return undefined;
      });
      // A judgement that failed is made again at the next run of the job.
      if (!ok && !env.stopped()) log_error(env, 'match deadline decision failed', { match_id });
    }
    for (const match_id of due_applies(storage.read_db(), now())) {
      if (env.stopped()) return;
      const record = read_record(storage.read_db(), match_id, now());
      if (record === null) continue;
      const at = now();
      for (const p of record.participants) {
        if (!p.applied && p.next_attempt_at <= at) await apply_index(match_id, p.index);
      }
    }
  };

  return { report, create, participant_change, sweep };
}
