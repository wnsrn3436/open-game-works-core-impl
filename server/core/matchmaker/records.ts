/**
 * The match record: table `matchmaker_match` (one row per match) and `matchmaker_participant` (one row per index),
 * both scope `game` with expiry column `expires_at`. A transaction locks the match row with `storage.lock_game_row`
 * before it reads or writes either table.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { DbHandle } from '../storage/index.ts';
import type { MatchmakerStorage } from './deps.ts';
import type { IntegrityKind, ReportState } from './judge.ts';

export const MATCH_TABLE = 'matchmaker_match';
export const PARTICIPANT_TABLE = 'matchmaker_participant';
export const INTEGRITY_TABLE = 'matchmaker_integrity';

export type MatchStatus = 'PENDING' | 'CONFIRMED' | 'MISMATCH' | 'FORFEIT';
/** `MatchSource` of the match record input. */
export type MatchSource = 'Queue' | 'Room';
/** The result of the last failed apply of an index; empty without one. */
export type ApplyFailure = '' | 'REJECTED' | 'FAILED';

export interface ParticipantRecord extends ReportState {
  readonly index: number;
  readonly user_id: bigint;
  readonly rating: bigint;
  readonly team: number;
  readonly party: number;
  reported_at: bigint;
  result: Uint8Array;
  input_log: Uint8Array;
  left_at: bigint;
  ended_at: bigint;
  disconnected_at: bigint;
  applied: boolean;
  attempts: number;
  next_attempt_at: bigint;
  last_failure: ApplyFailure;
}

export interface MatchRecord {
  readonly match_id: string;
  readonly mode_id: number;
  status: MatchStatus;
  readonly source: MatchSource;
  readonly lockstep: boolean;
  readonly seed: bigint;
  readonly created_at: bigint;
  readonly start_at: bigint;
  readonly deadline_at: bigint;
  decided_at: bigint;
  readonly data_version: string;
  readonly client_version: string;
  /** The confirmed result; empty unless `CONFIRMED`. */
  result: Uint8Array;
  replayed_input_log: Uint8Array;
  /** The smallest `next_attempt_at` of the indices not marked once decided; null otherwise. */
  next_apply_at: bigint | null;
  /** Set when every index is marked; null before. */
  expires_at: bigint | null;
  /** True when the judgement wrote an integrity event. */
  integrity: boolean;
  readonly participants: ParticipantRecord[];
}

/** The match record input of the apply hooks and `replay_match` (`## hook`). */
export interface MatchRecordInput {
  readonly match_id: string;
  readonly mode_id: number;
  /** The `MatchJudgeStatus` of the judgement; `PENDING` in `replay_match`. */
  readonly status: CoreContract.MatchJudgeStatus;
  readonly user_ids: readonly bigint[];
  readonly ratings: readonly bigint[];
  readonly teams: readonly number[];
  readonly parties: readonly number[];
  readonly participants: readonly {
    readonly reported_at: bigint;
    readonly result: Uint8Array;
    readonly input_log: Uint8Array;
    readonly left_at: bigint;
    readonly ended_at: bigint;
    readonly disconnected_at: bigint;
  }[];
  readonly seed: bigint;
  readonly start_at: bigint;
  readonly data_version: string;
  readonly client_version: string;
  readonly source: MatchSource;
  readonly replayed_input_log: Uint8Array;
}

type Row = Readonly<Record<string, unknown>>;
/** A query parameter of the DB handle. */
type Param = NonNullable<Parameters<DbHandle['query']>[1]>[number];

/** What a new match record is made from; every index starts without a report and not marked. */
export interface NewRecord {
  readonly match_id: string;
  readonly mode_id: number;
  readonly source: MatchSource;
  readonly lockstep: boolean;
  readonly seed: bigint;
  readonly created_at: bigint;
  /** `prepare_time` of the mode. */
  readonly prepare_time: bigint;
  /** `max_duration` of the mode, or `matchmaker.lockstepMaxDurationMs` for a lockstep match. */
  readonly duration: bigint;
  /** `matchmaker.reportMarginMs`. */
  readonly report_margin_ms: bigint;
  readonly data_version: string;
  readonly client_version: string;
  readonly seats: readonly { readonly user_id: bigint; readonly rating: bigint; readonly team: number; readonly party: number }[];
}

/**
 * A `PENDING` match record (match creation step 1): `start_at` = `created_at` + `prepare_time`, `deadline_at` =
 * `start_at` + duration + `matchmaker.reportMarginMs`.
 */
export function build_record(input: NewRecord): MatchRecord {
  const start_at = input.created_at + input.prepare_time;
  return {
    match_id: input.match_id,
    mode_id: input.mode_id,
    status: 'PENDING',
    source: input.source,
    lockstep: input.lockstep,
    seed: input.seed,
    created_at: input.created_at,
    start_at,
    deadline_at: start_at + input.duration + input.report_margin_ms,
    decided_at: 0n,
    data_version: input.data_version,
    client_version: input.client_version,
    result: new Uint8Array(0),
    replayed_input_log: new Uint8Array(0),
    next_apply_at: null,
    expires_at: null,
    integrity: false,
    participants: input.seats.map((s, index) => ({
      index,
      user_id: s.user_id,
      rating: s.rating,
      team: s.team,
      party: s.party,
      reported_at: 0n,
      result: new Uint8Array(0),
      input_log: new Uint8Array(0),
      left_at: 0n,
      ended_at: 0n,
      disconnected_at: 0n,
      applied: false,
      attempts: 0,
      next_attempt_at: 0n,
      last_failure: '',
    })),
  };
}

const MATCH_COLUMNS = [
  ['match_id', 'string'],
  ['mode_id', 'int32'],
  ['status', 'string'],
  ['source', 'string'],
  ['lockstep', 'bool'],
  ['seed', 'int64'],
  ['created_at', 'int64'],
  ['start_at', 'int64'],
  ['deadline_at', 'int64'],
  ['decided_at', 'int64'],
  ['data_version', 'string'],
  ['client_version', 'string'],
  ['result', 'bytes'],
  ['replayed_input_log', 'bytes'],
  ['next_apply_at', 'int64?'],
  ['expires_at', 'int64?'],
  ['integrity', 'bool?'],
] as const;

const PARTICIPANT_COLUMNS = [
  ['match_id', 'string'],
  ['idx', 'int32'],
  ['user_id', 'int64'],
  ['rating', 'int64'],
  ['team', 'int32'],
  ['party', 'int32'],
  ['reported_at', 'int64'],
  ['result', 'bytes'],
  ['input_log', 'bytes'],
  ['left_at', 'int64'],
  ['disconnected_at', 'int64'],
  ['applied', 'bool'],
  ['attempts', 'int32'],
  ['next_attempt_at', 'int64'],
  ['last_failure', 'string'],
  ['expires_at', 'int64?'],
  ['ended_at', 'int64?'],
] as const;

const INTEGRITY_COLUMNS = [
  ['user_id', 'int64'],
  ['match_id', 'string'],
  ['kind', 'string'],
  ['at', 'int64'],
  ['expires_at', 'int64'],
] as const;

type MatchColumn = (typeof MATCH_COLUMNS)[number][0];
type ParticipantColumn = (typeof PARTICIPANT_COLUMNS)[number][0];

/**
 * Registers the match record tables and `matchmaker_integrity` (`storage.register_table`). The indices of the match
 * table serve the two `matchmaker_sweep` queries, and `(kind, at)` the flag query of `list_match_flags`.
 */
export function register_tables(storage: MatchmakerStorage): void {
  storage.register_table(MATCH_TABLE, 'game', MATCH_COLUMNS.map(([name, type]) => ({ name, type })), ['match_id'], 'expires_at', null, null, [
    ['status', 'deadline_at'],
    ['next_apply_at'],
  ]);
  storage.register_table(PARTICIPANT_TABLE, 'game', PARTICIPANT_COLUMNS.map(([name, type]) => ({ name, type })), ['match_id', 'idx'], 'expires_at', null, 'user_id');
  storage.register_table(INTEGRITY_TABLE, 'game', INTEGRITY_COLUMNS.map(([name, type]) => ({ name, type })), ['user_id', 'match_id'], 'expires_at', null, 'user_id', [
    ['kind', 'at'],
  ]);
}

function placeholders(n: number): string {
  return Array.from({ length: n }, (_, i) => `$${String(i + 1)}`).join(', ');
}

const INSERT_MATCH = `INSERT INTO ${MATCH_TABLE} (${MATCH_COLUMNS.map((c) => c[0]).join(', ')}) VALUES (${placeholders(MATCH_COLUMNS.length)})`;
const INSERT_PARTICIPANT =
  `INSERT INTO ${PARTICIPANT_TABLE} (${PARTICIPANT_COLUMNS.map((c) => c[0]).join(', ')}) VALUES (${placeholders(PARTICIPANT_COLUMNS.length)})`;
const SELECT_MATCH = `SELECT ${MATCH_COLUMNS.map((c) => c[0]).join(', ')} FROM ${MATCH_TABLE} WHERE match_id = $1`;
const SELECT_PARTICIPANTS = `SELECT ${PARTICIPANT_COLUMNS.map((c) => c[0]).join(', ')} FROM ${PARTICIPANT_TABLE} WHERE match_id = $1 ORDER BY idx`;
/** At most this many match IDs per sweep query page. */
const PAGE = 100;
const DUE_DEADLINES =
  `SELECT match_id FROM ${MATCH_TABLE} WHERE status = 'PENDING' AND deadline_at <= $1 AND match_id > $2 ORDER BY match_id LIMIT ${String(PAGE)}`;
const DUE_APPLIES =
  `SELECT match_id FROM ${MATCH_TABLE} WHERE next_apply_at <= $1 AND match_id > $2 ORDER BY match_id LIMIT ${String(PAGE)}`;

function match_value(r: MatchRecord, column: MatchColumn): Param {
  return r[column];
}

function participant_value(p: ParticipantRecord, column: ParticipantColumn, r: MatchRecord): Param {
  if (column === 'match_id') return r.match_id;
  if (column === 'idx') return p.index;
  if (column === 'expires_at') return r.expires_at;
  return p[column];
}

export function insert_record(db: DbHandle, r: MatchRecord): void {
  db.query(INSERT_MATCH, MATCH_COLUMNS.map(([c]) => match_value(r, c)));
  for (const p of r.participants) db.query(INSERT_PARTICIPANT, PARTICIPANT_COLUMNS.map(([c]) => participant_value(p, c, r)));
}

function big(v: unknown): bigint {
  return typeof v === 'bigint' ? v : BigInt(typeof v === 'number' ? v : 0);
}

function big_or_null(v: unknown): bigint | null {
  return v === null || v === undefined ? null : big(v);
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(big(v));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function bytes(v: unknown): Uint8Array {
  return v instanceof Uint8Array ? v : new Uint8Array(0);
}

function bool(v: unknown): boolean {
  return v === true || v === 1 || v === 1n;
}

function participant_of(row: Row): ParticipantRecord {
  const failure = str(row['last_failure']);
  return {
    index: num(row['idx']),
    user_id: big(row['user_id']),
    rating: big(row['rating']),
    team: num(row['team']),
    party: num(row['party']),
    reported_at: big(row['reported_at']),
    result: bytes(row['result']),
    input_log: bytes(row['input_log']),
    left_at: big(row['left_at']),
    ended_at: big(row['ended_at']),
    disconnected_at: big(row['disconnected_at']),
    applied: bool(row['applied']),
    attempts: num(row['attempts']),
    next_attempt_at: big(row['next_attempt_at']),
    last_failure: failure === 'REJECTED' || failure === 'FAILED' ? failure : '',
  };
}

/** The match record, or null when there is none or it expired (expiry column ≤ `now`). */
export function read_record(db: DbHandle, match_id: string, now: bigint): MatchRecord | null {
  const row = db.query(SELECT_MATCH, [match_id])[0];
  if (row === undefined) return null;
  const expires_at = big_or_null(row['expires_at']);
  if (expires_at !== null && expires_at <= now) return null;
  const participants = db.query(SELECT_PARTICIPANTS, [match_id]).map(participant_of);
  if (participants.length === 0) return null;
  const status = str(row['status']);
  return {
    match_id,
    mode_id: num(row['mode_id']),
    status: status === 'CONFIRMED' || status === 'MISMATCH' || status === 'FORFEIT' ? status : 'PENDING',
    source: str(row['source']) === 'Room' ? 'Room' : 'Queue',
    lockstep: bool(row['lockstep']),
    seed: big(row['seed']),
    created_at: big(row['created_at']),
    start_at: big(row['start_at']),
    deadline_at: big(row['deadline_at']),
    decided_at: big(row['decided_at']),
    data_version: str(row['data_version']),
    client_version: str(row['client_version']),
    result: bytes(row['result']),
    replayed_input_log: bytes(row['replayed_input_log']),
    next_apply_at: big_or_null(row['next_apply_at']),
    expires_at,
    integrity: bool(row['integrity']),
    participants,
  };
}

/** Writes the given columns of the match row. */
export function write_match(db: DbHandle, r: MatchRecord, columns: readonly MatchColumn[]): void {
  if (columns.length === 0) return;
  const set = columns.map((c, i) => `${c} = $${String(i + 2)}`).join(', ');
  db.query(`UPDATE ${MATCH_TABLE} SET ${set} WHERE match_id = $1`, [r.match_id, ...columns.map((c) => match_value(r, c))]);
}

/** Writes the given columns of one participant row. */
export function write_participant(db: DbHandle, r: MatchRecord, p: ParticipantRecord, columns: readonly ParticipantColumn[]): void {
  if (columns.length === 0) return;
  const set = columns.map((c, i) => `${c} = $${String(i + 3)}`).join(', ');
  db.query(
    `UPDATE ${PARTICIPANT_TABLE} SET ${set} WHERE match_id = $1 AND idx = $2`,
    [r.match_id, p.index, ...columns.map((c) => participant_value(p, c, r))],
  );
}

/**
 * Recomputes `next_apply_at` and, when every index is marked, `expires_at` (`now` + retention), and writes them to
 * both tables. `retention_ms` is `matchmaker.recordRetentionMs`, or the larger of it and `matchmaker.flagWindowMs` for
 * a match whose judgement wrote an integrity event (`retention_of`).
 */
export function write_apply_state(db: DbHandle, r: MatchRecord, now: bigint, retention_ms: (r: MatchRecord) => bigint): void {
  const waiting = r.participants.filter((p) => !p.applied);
  r.next_apply_at = r.status === 'PENDING' || waiting.length === 0 ? null : waiting.reduce((min, p) => (p.next_attempt_at < min ? p.next_attempt_at : min), waiting[0]?.next_attempt_at ?? 0n);
  if (r.status !== 'PENDING' && waiting.length === 0 && r.expires_at === null) {
    r.expires_at = now + retention_ms(r);
    db.query(`UPDATE ${PARTICIPANT_TABLE} SET expires_at = $2 WHERE match_id = $1`, [r.match_id, r.expires_at]);
  }
  write_match(db, r, ['next_apply_at', 'expires_at']);
}

function due(db: DbHandle, sql: string, now: bigint): string[] {
  const out: string[] = [];
  let after = '';
  for (;;) {
    const page = db.query(sql, [now, after]).map((row) => str(row['match_id']));
    out.push(...page);
    const last = page[page.length - 1];
    if (page.length < PAGE || last === undefined) return out;
    after = last;
  }
}

/** Match IDs of `PENDING` records whose `deadline_at` ≤ `now`. */
export function due_deadlines(db: DbHandle, now: bigint): string[] {
  return due(db, DUE_DEADLINES, now);
}

/** Match IDs of decided records with an index not marked whose `next_attempt_at` ≤ `now`. */
export function due_applies(db: DbHandle, now: bigint): string[] {
  return due(db, DUE_APPLIES, now);
}

const STATUS_VALUE: Readonly<Record<MatchStatus, CoreContract.MatchJudgeStatus>> = {
  PENDING: CoreContract.MatchJudgeStatus.MATCH_JUDGE_STATUS_PENDING,
  CONFIRMED: CoreContract.MatchJudgeStatus.MATCH_JUDGE_STATUS_CONFIRMED,
  MISMATCH: CoreContract.MatchJudgeStatus.MATCH_JUDGE_STATUS_MISMATCH,
  FORFEIT: CoreContract.MatchJudgeStatus.MATCH_JUDGE_STATUS_FORFEIT,
};

/** The `MatchJudgeStatus` value of a record status. */
export function status_value(status: MatchStatus): CoreContract.MatchJudgeStatus {
  return STATUS_VALUE[status];
}

export function record_input(r: MatchRecord): MatchRecordInput {
  return {
    match_id: r.match_id,
    mode_id: r.mode_id,
    status: status_value(r.status),
    user_ids: r.participants.map((p) => p.user_id),
    ratings: r.participants.map((p) => p.rating),
    teams: r.participants.map((p) => p.team),
    parties: r.participants.map((p) => p.party),
    participants: r.participants.map((p) => ({
      reported_at: p.reported_at,
      result: p.result,
      input_log: p.input_log,
      left_at: p.left_at,
      ended_at: p.ended_at,
      disconnected_at: p.disconnected_at,
    })),
    seed: r.seed,
    start_at: r.start_at,
    data_version: r.data_version,
    client_version: r.client_version,
    source: r.source,
    replayed_input_log: r.replayed_input_log,
  };
}

/** An integrity event row of `matchmaker_integrity`. */
export interface IntegrityEvent {
  readonly user_id: bigint;
  readonly match_id: string;
  readonly kind: IntegrityKind;
  readonly at: bigint;
}

const INSERT_INTEGRITY = `INSERT INTO ${INTEGRITY_TABLE} (user_id, match_id, kind, at, expires_at) VALUES ($1, $2, $3, $4, $5)`;
const COUNT_FLAG = `SELECT COUNT(*) AS n FROM ${INTEGRITY_TABLE} WHERE user_id = $1 AND kind = $2 AND at > $3 AND expires_at > $4`;
const FLAGGED = `SELECT user_id, COUNT(*) AS n FROM ${INTEGRITY_TABLE} WHERE kind = $1 AND at > $2 AND expires_at > $3 AND user_id > $4 GROUP BY user_id HAVING COUNT(*) >= $5 ORDER BY user_id LIMIT $6`;
const FLAG_MATCHES = `SELECT match_id FROM ${INTEGRITY_TABLE} WHERE user_id = $1 AND kind = $2 AND at > $3 AND expires_at > $4 ORDER BY at, match_id`;
const MATCH_INTEGRITY = `SELECT kind FROM ${INTEGRITY_TABLE} WHERE user_id = $1 AND match_id = $2 AND expires_at > $3`;

/** Writes one integrity event; it counts and is kept until `at` + `matchmaker.flagWindowMs`. */
export function insert_integrity(db: DbHandle, event: IntegrityEvent, window_ms: bigint): void {
  db.query(INSERT_INTEGRITY, [event.user_id, event.match_id, event.kind, event.at, event.at + window_ms]);
}

/** The flag count of a user and kind: its events whose `at` > `now` − `matchmaker.flagWindowMs`. */
export function flag_count(db: DbHandle, user_id: bigint, kind: IntegrityKind, now: bigint, window_ms: bigint): number {
  return num(db.query(COUNT_FLAG, [user_id, kind, now - window_ms, now])[0]?.['n'] ?? 0);
}

/** The flags of a kind: users whose flag count is `threshold` or more, user ID ascending, after `after_user_id`. */
export function flagged_users(
  db: DbHandle,
  kind: IntegrityKind,
  now: bigint,
  window_ms: bigint,
  threshold: number,
  after_user_id: bigint | null,
  limit: number,
): { user_id: bigint; count: number; match_ids: string[] }[] {
  // User IDs are 1 or more (`auth`), so -1 is before every user.
  const rows = db.query(FLAGGED, [kind, now - window_ms, now, after_user_id ?? -1n, threshold, limit]);
  return rows.map((row) => {
    const user_id = big(row['user_id']);
    const match_ids = db.query(FLAG_MATCHES, [user_id, kind, now - window_ms, now]).map((r) => str(r['match_id']));
    return { user_id, count: num(row['n']), match_ids };
  });
}

/** The `MatchIntegrityKind` of the integrity event of a user in a match, or null. */
export function integrity_of(db: DbHandle, user_id: bigint, match_id: string, now: bigint): IntegrityKind | null {
  const kind = str(db.query(MATCH_INTEGRITY, [user_id, match_id, now])[0]?.['kind']);
  return kind === 'Disagree' || kind === 'Forfeit' || kind === 'Missing' ? kind : null;
}
