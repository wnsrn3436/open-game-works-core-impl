/** Job `ranking_season` (`## behavior` season reward): season close, reward mails, reward retry, retention. */
import { randomBytes } from 'node:crypto';
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { DbHandle, FailureCode, GameTx, Pass, RequestCtx, UserTxResult } from '../storage/index.ts';
import { find_board, type Board } from './board.ts';
import { core_log, type RankingCore, type SeasonReward } from './core.ts';
import type { MailInput } from './deps.ts';
import { entry_of, fill_guild_names } from './query.ts';
import {
  add_failed,
  advance_cursor,
  close_season,
  delete_retry,
  delete_season,
  extend_lease,
  finish_pass,
  insert_retry,
  read_after,
  read_due_retries,
  read_due_seasons,
  read_expired_seasons,
  take_lease,
  update_retry,
  type ScoreRow,
  type SeasonRow,
} from './store.ts';

export const JOB_NAME = 'ranking_season';

/** Score rows read at a time while a season closes; each one is still processed in its own transactions. */
const READ_BATCH = 100;

const INTERNAL: FailureCode = CoreContract.CoreError.CORE_ERROR_INTERNAL;

/** A new secure random lease owner. */
export function new_lease_owner(): string {
  return randomBytes(16).toString('hex');
}

/** g(a): g(0) is `rewardRetryInitialMs`; g(a) = min(⌊g(a − 1) × factor ÷ 1000⌋, `rewardRetryMaxIntervalMs`). */
export function retry_interval(core: Pick<RankingCore, 'settings'>, attempts: number): bigint {
  const s = core.settings;
  let interval = s.reward_retry_initial_ms;
  for (let a = 1; a <= attempts; a += 1) {
    const next = (interval * s.reward_retry_factor_permille) / 1000n;
    interval = next < s.reward_retry_max_interval_ms ? next : s.reward_retry_max_interval_ms;
  }
  return interval;
}

/** Splits attachments into lists of at most `size` in order; an empty list is one empty list. */
export function split_attachments<T>(items: readonly T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

/** The `once_key` of the k-th mail (1-based) of a season reward. */
export function reward_once_key(board_id: number, season: bigint, k: number): string {
  const base = `ranking:${String(board_id)}:${String(season)}`;
  return k === 1 ? base : `${base}:${String(k)}`;
}

/** Hook `ranking_season_reward` default: the `reward` of the `ranking_reward` row of the board whose range has the rank. */
function default_reward(ctx: RequestCtx, board: Board, rank: number): SeasonReward {
  const rows = ctx.data.RankingRewardTable.get_rows(board.id).filter((row) => row.rank_from <= rank && rank <= row.rank_to);
  return { attachments: rows.flatMap((row) => row.reward), extra_id: 0 };
}

function item_amount(value: unknown): CoreContract.ItemAmount | null {
  if (value instanceof CoreContract.ItemAmount) return value;
  const v = value as Partial<CoreContract.ItemAmount> | null;
  if (v === null || typeof v !== 'object' || typeof v.item_id !== 'number' || typeof v.amount !== 'bigint') return null;
  const item = new CoreContract.ItemAmount();
  item.item_id = v.item_id;
  item.amount = v.amount;
  item.big_amount = typeof v.big_amount === 'string' ? v.big_amount : '';
  return item;
}

/** The hook output as a `SeasonReward`, or null when its form is wrong. */
function reward_of(output: unknown): SeasonReward | null {
  const o = output as Partial<SeasonReward> | null;
  if (o === null || typeof o !== 'object' || !Array.isArray(o.attachments) || typeof o.extra_id !== 'number' || !Number.isSafeInteger(o.extra_id)) return null;
  const attachments = (o.attachments as unknown[]).map(item_amount);
  const items = attachments.filter((a) => a !== null);
  return items.length === attachments.length ? { attachments: items, extra_id: o.extra_id } : null;
}

interface SeasonRef {
  readonly board: Board;
  readonly season: bigint;
  readonly end_at: bigint;
}

/** Hook `ranking_season_reward` or its default. A throw or a wrong output form throws, so the processing is `FAILED`. */
function season_reward(core: RankingCore, ctx: RequestCtx, ref: SeasonRef, entry: CoreContract.RankingEntry): SeasonReward {
  const hook = core.hook_slots.ranking_season_reward;
  if (hook === null) return default_reward(ctx, ref.board, entry.rank);
  const reward = reward_of(hook(ctx, ref.board.id, ref.season, ref.end_at, entry));
  if (reward === null) throw new TypeError('hook ranking_season_reward returned a wrong output form');
  return reward;
}

/** The change function of one user's processing: the reward mails of `once_key` `ranking:<board>:<season>[:<k>]`. */
function send_reward(core: RankingCore, ctx: RequestCtx, ref: SeasonRef, entry: CoreContract.RankingEntry): Pass | FailureCode {
  const reward = season_reward(core, ctx, ref, entry);
  if (reward.attachments.length === 0 && reward.extra_id === 0) return 'pass';
  const parts = split_attachments(reward.attachments, core.settings.max_attachments);
  for (const [i, attachments] of parts.entries()) {
    const input: MailInput = {
      template_id: ref.board.reward_mail,
      args: [
        { name: 'rank', int_value: BigInt(entry.rank) },
        { name: 'season', int_value: ref.season },
      ],
      attachments,
      extra_id: i === 0 ? reward.extra_id : 0,
      expire_ms: 0n,
      no_expiry: false,
      once_key: reward_once_key(ref.board.id, ref.season, i + 1),
    };
    const sent = core.modules.mailbox.send_mail(ctx, input);
    // `send_mail` logs its `INVALID_INPUT`; the processing is `REJECTED`.
    if (sent.result !== 'OK' && sent.result !== 'ALREADY_SENT') return INTERNAL;
  }
  return 'pass';
}

/** The result of one user's processing, and the thrown message of a `FAILED` that threw. */
interface UserOutcome {
  readonly result: UserTxResult;
  readonly reason: string | null;
}

/** One user's processing: an out-of-request change of that user. A throw (a hook throw included) is `FAILED`. */
async function reward_user(core: RankingCore, ref: SeasonRef, entry: CoreContract.RankingEntry, user_id: bigint): Promise<UserOutcome> {
  try {
    return { result: await core.modules.storage.run_user_transaction(user_id, (ctx) => send_reward(core, ctx, ref, entry)), reason: null };
  } catch (error) {
    return { result: 'FAILED', reason: error instanceof Error ? error.message : String(error) };
  }
}

function outcome_fields(ref: SeasonRef, user_id: bigint, done: UserOutcome): Record<string, bigint | number | string | null> {
  return { board_id: ref.board.id, season: ref.season, user_id, reason: done.reason };
}

/**
 * An `error` log of the job, unless `ranking`'s `stop()` began: a failure after that (e.g. a DB connection closed
 * under a running transaction) is not logged.
 */
function report(core: RankingCore, message: string, fields: Readonly<Record<string, bigint | number | string | null>>): void {
  if (!is_stopped(core)) core_log(core, 'error', message, fields);
}

/** What one user's processing adds: `failed_count` and whether a retry row goes in. Logs `REJECTED` and the first `FAILED`. */
function outcome(core: RankingCore, ref: SeasonRef, user_id: bigint, done: UserOutcome): { failed: number; retry: boolean } {
  if (done.result === 'REJECTED') {
    report(core, 'season reward rejected', outcome_fields(ref, user_id, done));
    return { failed: 1, retry: false };
  }
  if (done.result === 'FAILED') {
    report(core, 'season reward failed', outcome_fields(ref, user_id, done));
    return core.settings.reward_retry_max_attempts >= 1 ? { failed: 0, retry: true } : { failed: 1, retry: false };
  }
  return { failed: 0, retry: false };
}

/** Whether the server instance has stopped; read through a call because it changes while the job awaits. */
function is_stopped(core: RankingCore): boolean {
  return core.stopped;
}

function lease_end(core: RankingCore): bigint {
  return core.modules.time.clock_now() + core.settings.season_job_lease_ms;
}

async function game_tx<T>(core: RankingCore, fn: (tx: GameTx) => T): Promise<T | null> {
  const result = await core.modules.storage.run_game_transaction(fn);
  return result === 'FAILED' || typeof result === 'number' ? null : result;
}

/** Puts the retry row of a `FAILED` user, first tried `rewardRetryInitialMs` from now. */
function put_retry(core: RankingCore, db: DbHandle, ref: SeasonRef, user_id: bigint, entry: CoreContract.RankingEntry): void {
  insert_retry(db, ref.board.id, ref.season, user_id, entry.encode(), core.modules.time.clock_now() + core.settings.reward_retry_initial_ms);
}

/** Writes the retry row of a `FAILED` user when the lease is still held (and extends it). False when the lease is lost. */
async function after_member(core: RankingCore, ref: SeasonRef, owner: string, user_id: bigint, entry: CoreContract.RankingEntry, retry: boolean): Promise<boolean> {
  const done = await game_tx(core, (tx) => {
    const db = core.modules.storage.db(tx);
    if (!extend_lease(db, ref.board.id, ref.season, owner, lease_end(core))) return { ok: false };
    if (retry) put_retry(core, db, ref, user_id, entry);
    return { ok: true };
  });
  return done?.ok === true;
}

/** Step 4: moves the cursor past one score row, with its retry row. False when the lease is lost or the write failed. */
async function after_row(core: RankingCore, ref: SeasonRef, owner: string, row: ScoreRow, rank: number, failed: number, retry: { user_id: bigint; entry: CoreContract.RankingEntry } | null): Promise<boolean> {
  const done = await game_tx(core, (tx) => {
    const db = core.modules.storage.db(tx);
    if (!advance_cursor(db, ref.board.id, ref.season, owner, row, rank, failed, lease_end(core))) return { ok: false };
    if (retry !== null) put_retry(core, db, ref, retry.user_id, retry.entry);
    return { ok: true };
  });
  return done?.ok === true;
}

/**
 * Whether a processing result ends the pass without writing it: a `FAILED` after `stop()` began (e.g. a DB connection
 * closed under the transaction) moves no cursor, counts no failure and puts no retry row; the next holder redoes it.
 */
function stopped_failure(core: RankingCore, done: UserOutcome): boolean {
  return done.result === 'FAILED' && is_stopped(core);
}

async function process_user_row(core: RankingCore, ref: SeasonRef, owner: string, row: ScoreRow, rank: number): Promise<boolean> {
  const entry = entry_of(ref.board, row, rank);
  const done = await reward_user(core, ref, entry, row.entity_id);
  if (stopped_failure(core, done)) return false;
  const { failed, retry } = outcome(core, ref, row.entity_id, done);
  return after_row(core, ref, owner, row, rank, failed, retry ? { user_id: row.entity_id, entry } : null);
}

/** The guild processing: each member's processing at the time of processing, then step 4 for the guild row. */
async function process_guild_row(core: RankingCore, ref: SeasonRef, owner: string, row: ScoreRow, rank: number): Promise<boolean> {
  const entry = entry_of(ref.board, row, rank);
  const guild = core.modules.guild;
  const members = await game_tx(core, (tx) => {
    fill_guild_names(core, tx, [entry]);
    return { ids: guild === null ? [] : [...guild.list_member_ids(tx, row.entity_id)] };
  });
  if (members === null) return false;
  let failed = 0;
  for (const user_id of members.ids) {
    const done = await reward_user(core, ref, entry, user_id);
    if (stopped_failure(core, done)) return false;
    const counted = outcome(core, ref, user_id, done);
    failed += counted.failed;
    if (!(await after_member(core, ref, owner, user_id, entry, counted.retry))) return false;
  }
  return after_row(core, ref, owner, row, rank, failed, null);
}

function log_closed(core: RankingCore, row: SeasonRow | null): void {
  if (row?.status === 'Closed' && row.failed_count >= 1n) {
    core_log(core, 'error', 'season closed with rewards given up', { board_id: row.board_id, season: row.season, failed_count: row.failed_count });
  }
}

/** Steps 3 to 5 for a `Closing` season whose lease `owner` holds. */
export async function close_pass(core: RankingCore, season: SeasonRow, owner: string): Promise<void> {
  const board = find_board(core.data, season.board_id);
  if (board === null || board.reward_mail === 0) {
    await game_tx(core, (tx) => ({ row: close_season(core.modules.storage.db(tx), season.board_id, season.season, owner) }));
    return;
  }
  const ref: SeasonRef = { board, season: season.season, end_at: season.end_at };
  let cursor = season.cursor;
  let rank = season.cursor_rank;
  while (rank < board.size && !is_stopped(core)) {
    const rows = read_after(core.modules.storage.read_db(), board, board.id, season.season, cursor, Math.min(READ_BATCH, board.size - rank));
    if (rows.length === 0) break;
    for (const row of rows) {
      rank += 1;
      const kept = board.guild ? await process_guild_row(core, ref, owner, row, rank) : await process_user_row(core, ref, owner, row, rank);
      if (!kept || is_stopped(core)) return;
      cursor = row;
    }
  }
  // A stop() that began before the first row (e.g. under the lease transaction) leaves the season to the next holder.
  if (is_stopped(core)) return;
  const done = await game_tx(core, (tx) => ({ row: finish_pass(core.modules.storage.db(tx), board.id, season.season, owner) }));
  log_closed(core, done?.row ?? null);
}

/** Reward retry of a `Retrying` season whose lease `owner` holds. */
async function reward_retry(core: RankingCore, season: SeasonRow, owner: string): Promise<void> {
  const board = find_board(core.data, season.board_id);
  if (board === null) {
    await game_tx(core, (tx) => ({ row: close_season(core.modules.storage.db(tx), season.board_id, season.season, owner) }));
    return;
  }
  const ref: SeasonRef = { board, season: season.season, end_at: season.end_at };
  const due = read_due_retries(core.modules.storage.read_db(), board.id, season.season, core.modules.time.clock_now());
  for (const retry of due) {
    const entry = CoreContract.RankingEntry.decode(retry.entry) ?? new CoreContract.RankingEntry();
    const tried = await reward_user(core, ref, entry, retry.user_id);
    // A FAILED after stop() began does not use up an attempt.
    if (stopped_failure(core, tried)) return;
    const result = tried.result;
    const attempts = retry.attempts + 1;
    const give_up = result === 'REJECTED' || (result === 'FAILED' && attempts >= core.settings.reward_retry_max_attempts);
    const done = await game_tx(core, (tx) => {
      const db = core.modules.storage.db(tx);
      if (!extend_lease(db, board.id, season.season, owner, lease_end(core))) return { ok: false };
      if (result === 'FAILED' && !give_up) {
        update_retry(db, board.id, season.season, retry.user_id, attempts, core.modules.time.clock_now() + retry_interval(core, attempts));
        return { ok: true };
      }
      delete_retry(db, board.id, season.season, retry.user_id);
      if (give_up) add_failed(db, board.id, season.season, owner, 1);
      return { ok: true };
    });
    if (done?.ok !== true || is_stopped(core)) return;
    if (give_up) core_log(core, 'error', result === 'REJECTED' ? 'season reward retry rejected' : 'season reward given up', outcome_fields(ref, retry.user_id, tried));
  }
  const done = await game_tx(core, (tx) => ({ row: finish_pass(core.modules.storage.db(tx), board.id, season.season, owner) }));
  log_closed(core, done?.row ?? null);
}

/** Steps 1 and 2 for one season row: takes its lease, then closes or retries it. */
async function process_due(core: RankingCore, seen: SeasonRow): Promise<void> {
  const owner = new_lease_owner();
  const taken = await game_tx(core, (tx) => ({ row: take_lease(core.modules.storage.db(tx), seen, owner, lease_end(core)) }));
  const row = taken?.row ?? null;
  if (row === null) return;
  if (row.status === 'Retrying') await reward_retry(core, row, owner);
  else await close_pass(core, row, owner);
}

/** Step 6: each `Closed` season past `ranking.seasonRetentionMs` goes, with its score rows. */
async function apply_retention(core: RankingCore): Promise<void> {
  const limit = core.modules.time.clock_now() - core.settings.season_retention_ms;
  for (const { board_id, season } of read_expired_seasons(core.modules.storage.read_db(), limit)) {
    if (is_stopped(core)) return;
    await game_tx(core, (tx) => {
      delete_season(core.modules.storage.db(tx), board_id, season);
      return { deleted: true };
    });
  }
}

/** The job function of `ranking_season`. It logs its own failure, but not one after `stop()` began, and does not throw. */
export async function run_season_job(core: RankingCore): Promise<void> {
  try {
    for (const row of read_due_seasons(core.modules.storage.read_db(), core.modules.time.clock_now())) {
      if (is_stopped(core)) return;
      await process_due(core, row);
    }
    await apply_retention(core);
  } catch (error) {
    report(core, `job ranking_season: ${error instanceof Error ? error.message : String(error)}`, {});
  }
}
