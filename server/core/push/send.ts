/**
 * Job `push_send` (`### send`): takes due records under a lease, sends them to their target devices in batches
 * by user ID with `cursor_user_id`, holds ad pushes during the night window, and sends held pushes once it ends.
 */
import { randomBytes } from 'node:crypto';
import * as GameData from '../../generated/data/game_data.ts';
import { PLATFORM_PROVIDER, PROVIDER_KEY, type Provider, type PushPayload, type SendOutcome, type SendResult } from './adapter.ts';
import { format_text } from './format.ts';
import { log, type DbHandle, type GameTx, type LogEntry, type PushCore } from './core.ts';
import { T_DEVICE, T_HELD, T_RECORD, arg_values, finish_params, parse_args, parse_target, type Status, type StoredArg, type Target } from './store.ts';

const DAY_MS = 86_400_000n;
const MINUTE_MS = 60_000n;

function floor_mod(a: bigint, b: bigint): bigint {
  const r = a % b;
  return r < 0n ? r + b : r;
}

/**
 * When the device's local time `now` + `offset_ms` is in the night window, the clock time the window ends;
 * otherwise null (`### send` ad push).
 */
export function night_window_end(start_minute: number, end_minute: number, now: bigint, offset_ms: bigint): bigint | null {
  const local = now + offset_ms;
  const in_day = floor_mod(local, DAY_MS);
  const minute = in_day / MINUTE_MS;
  const s = BigInt(start_minute);
  const e = BigInt(end_minute);
  const inside = s < e ? minute >= s && minute < e : minute >= s || minute < e;
  if (!inside) return null;
  let end = local - in_day + e * MINUTE_MS;
  if (end <= local) end += DAY_MS;
  return end - offset_ms;
}

/** A `push_device` row. */
interface Device {
  readonly user_id: bigint;
  readonly device_token: string;
  readonly session_id: string;
  readonly provider: Provider;
  readonly language: string;
  readonly timezone_offset_ms: bigint;
  readonly ad_allowed: boolean;
  readonly night_allowed: boolean;
}

const DEVICE_SELECT = 'user_id, device_token, session_id, provider, language, timezone_offset_ms, ad_allowed, night_allowed';

function device_of(row: Record<string, unknown>): Device {
  return {
    user_id: row.user_id as bigint,
    device_token: row.device_token as string,
    session_id: row.session_id as string,
    provider: row.provider as Provider,
    language: row.language as string,
    timezone_offset_ms: row.timezone_offset_ms as bigint,
    ad_allowed: row.ad_allowed === true,
    night_allowed: row.night_allowed === true,
  };
}

/** One record being sent by this instance. */
interface Sending {
  readonly push_id: bigint;
  readonly message_id: number;
  readonly args: readonly StoredArg[];
  readonly target: Target;
  readonly owner: string;
  cursor: bigint;
  /** The `lease_until` this instance last wrote with its `lease_owner`. */
  lease_until: bigint;
  /** A failure of this record was logged: the first adapter failure, and the first empty text slot. */
  adapter_failure_logged: boolean;
  text_failure_logged: boolean;
}

/** A record to send with the failures this instance logged for it (`## error`: once per record). */
function new_sending(core: PushCore, fields: Omit<Sending, 'adapter_failure_logged' | 'text_failure_logged'>, failed_before: boolean): Sending {
  const logged = core.logged_failures.get(fields.push_id);
  return { ...fields, adapter_failure_logged: failed_before || logged?.adapter === true, text_failure_logged: logged?.text === true };
}

/**
 * Keeps the logged failures of a record in this instance until its held rows can no longer be due: they are due
 * within a day of the batch that held them and expire `push.maxDelayMs` after that.
 */
function keep_logged(core: PushCore, sending: Sending): void {
  if (!sending.adapter_failure_logged && !sending.text_failure_logged) return;
  const before = core.logged_failures.get(sending.push_id);
  core.logged_failures.set(sending.push_id, {
    adapter: sending.adapter_failure_logged || before?.adapter === true,
    text: sending.text_failure_logged || before?.text === true,
    until: core.time.clock_now() + DAY_MS + core.settings.max_delay_ms,
  });
}

/**
 * An `error` log of job `push_send`. A failure after the module's `stop()` began is not logged (`server-time` job):
 * it comes from the instance stopping, such as a DB connection closed under a running transaction.
 */
function report(core: PushCore, message: string, fields: LogEntry['fields']): void {
  if (running(core)) log(core, 'error', message, fields);
}

function drop_old_logged(core: PushCore): void {
  const now = core.time.clock_now();
  for (const [push_id, logged] of core.logged_failures) {
    if (logged.until <= now) core.logged_failures.delete(push_id);
  }
}

/** The next batch of target devices after the cursor, by user ID (`### send` target device). */
function select_devices(core: PushCore, db: DbHandle, target: Target, cursor: bigint): Device[] {
  const params: (bigint | number | string)[] = [cursor, core.settings.send_batch_size];
  const where = ['user_id > $1'];
  const list = (values: readonly (bigint | string)[]): string => {
    if (values.length === 0) return '(NULL)';
    const at = params.length;
    params.push(...values);
    return `(${values.map((_, i) => `$${String(at + i + 1)}`).join(', ')})`;
  };
  if ('user_ids' in target) {
    where.push(`user_id IN ${list([...new Set(target.user_ids)])}`);
  } else {
    const f = target.filter;
    if (f.platforms.length > 0) where.push(`provider IN ${list([...new Set(f.platforms.map((p) => PLATFORM_PROVIDER[p]).filter((p) => p !== undefined))])}`);
    if (f.languages.length > 0) where.push(`language IN ${list(f.languages)}`);
    if (f.active_within_ms > 0n) {
      params.push(core.time.clock_now() - f.active_within_ms);
      where.push(`updated_at >= $${String(params.length)}`);
    }
  }
  const rows = db.query(`SELECT ${DEVICE_SELECT} FROM ${T_DEVICE} WHERE ${where.join(' AND ')} ORDER BY user_id, device_token LIMIT $2`, params);
  return rows.map(device_of);
}

/** The text of a device: its language's translations of `title` and `body` with the args filled. */
function payload_of(core: PushCore, sending: Sending, device: Device): PushPayload {
  const row = core.server.data.PushMessageTable.get_row(sending.message_id);
  const values = arg_values(sending.args);
  const missing: string[] = [];
  const slots: string[] = [];
  const text = (key: string): string => {
    const source = core.translations.text(device.language, key);
    if (source === null) {
      missing.push(key);
      return '';
    }
    const formatted = format_text(source, values, device.language, device.timezone_offset_ms);
    slots.push(...formatted.errors);
    return formatted.text;
  };
  let title = text(row.title);
  const body = text(row.body);
  if (row.kind === GameData.PushKind.Ad) {
    const label_key = core.server.data.PushMessageTable.get_row(core.server.data.ReservedId.push_ad_label()).title;
    const label = core.translations.text(device.language, label_key);
    if (label === null) missing.push(label_key);
    title = `${label ?? ''} ${title}`;
  }
  if ((missing.length > 0 || slots.length > 0) && !sending.text_failure_logged) {
    sending.text_failure_logged = true;
    keep_logged(core, sending);
    report(core, 'push text has an empty part', { push_id: sending.push_id.toString(), language: device.language, missing_keys: missing.join(','), empty_slots: slots.join(',') });
  }
  return { title, body, data: { message_id: String(sending.message_id), push_id: sending.push_id.toString() } };
}

/** One token's result with the adapter's failure reason, when it gave one. */
interface TokenResult {
  readonly result: SendResult;
  readonly reason: string | null;
}

/** What one `adapter.send` call gave: a result per token, or why the call failed for every token. */
type SendReply = { readonly results: readonly TokenResult[] } | { readonly failure: string };

/** An adapter's outcome for a token, with its failure reason when the adapter gave one. */
function token_result(outcome: SendOutcome): TokenResult {
  if (typeof outcome === 'string') return { result: outcome, reason: null };
  return { result: 'FAILED', reason: outcome.reason === '' ? null : outcome.reason };
}

/**
 * Why a call threw, for the failure log: the error's name and message with the device tokens and the push text
 * taken out (`### send`: the log has no device token, title or body).
 */
function thrown_reason(error: unknown, tokens: readonly string[], payload: PushPayload): string {
  return `adapter threw ${error instanceof Error ? error.name : typeof error}: ${redacted(error instanceof Error ? error.message : String(error), tokens, payload)}`;
}

/** A text with the device tokens (raw and URI-encoded) and the push text replaced by `[redacted]`. */
function redacted(text: string, tokens: readonly string[], payload: PushPayload): string {
  let out = text;
  const secrets = [...tokens.flatMap((t) => [t, encodeURIComponent(t)]), payload.title, payload.body].filter((v) => v !== '');
  for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) out = out.split(secret).join('[redacted]');
  return out;
}

/** `adapter.send` within `push.sendTimeoutMs`. A time limit, a throw and a result of the wrong length fail every token. */
async function send_once(core: PushCore, provider: Provider, tokens: readonly string[], payload: PushPayload): Promise<SendReply> {
  const adapter = core.adapters.get(PROVIDER_KEY[provider]);
  if (adapter === undefined) return { failure: `no adapter for ${provider}` };
  let signal: AbortSignal;
  try {
    signal = core.time.network_time_limit(core.settings.send_timeout_ms);
  } catch (error) {
    return { failure: `no time limit: ${error instanceof Error ? error.message : String(error)}` };
  }
  const aborted = new Promise<null>((resolve) => {
    if (signal.aborted) resolve(null);
    signal.addEventListener('abort', () => {
      resolve(null);
    }, { once: true });
  });
  try {
    const result = await Promise.race([adapter.send(tokens, payload, signal), aborted]);
    if (result === null) return { failure: 'time limit push.sendTimeoutMs' };
    if (result.length !== tokens.length) return { failure: `adapter gave ${String(result.length)} results for ${String(tokens.length)} tokens` };
    return { results: result.map(token_result) };
  } catch (error) {
    return { failure: thrown_reason(error, tokens, payload) };
  }
}

/** Sends one payload to tokens with retries (`### send` adapter result): `OK`, `INVALID_TOKEN` or `FAILED` per token. */
async function send_with_retry(core: PushCore, sending: Sending, provider: Provider, tokens: readonly string[], payload: PushPayload): Promise<SendResult[]> {
  const results: SendResult[] = tokens.map(() => 'FAILED');
  let pending = tokens.map((_, i) => i);
  const attempts = Math.max(1, core.settings.retry_max_attempts);
  for (let attempt = 1; attempt <= attempts && pending.length > 0 && running(core); attempt++) {
    const sent = pending.map((i) => tokens[i] as string);
    const reply = await send_once(core, provider, sent, payload);
    const still: number[] = [];
    let reason = 'failure' in reply ? reply.failure : null;
    pending.forEach((index, i) => {
      const r = 'results' in reply ? (reply.results[i] as TokenResult) : { result: 'FAILED' as const, reason: null };
      if (r.result !== 'FAILED') results[index] = r.result;
      else {
        still.push(index);
        reason ??= r.reason;
      }
    });
    pending = still;
    if (pending.length === 0) break;
    if (!sending.adapter_failure_logged && running(core)) {
      sending.adapter_failure_logged = true;
      keep_logged(core, sending);
      const fields = { push_id: sending.push_id.toString(), provider, attempt, devices: pending.length, reason: reason === null ? 'adapter result FAILED' : redacted(reason, sent, payload) };
      report(core, 'push adapter failed', fields);
    }
    if (attempt < attempts) await core.time.sleep(core.settings.retry_interval_ms);
  }
  return results;
}

/** What one batch did, written in the batch's game transaction. */
interface BatchOutcome {
  devices: number;
  sent: number;
  invalid: number;
  failed: number;
  consent_skipped: number;
  held: number;
  /** Rows to delete: (device token, user ID, session ID or null for any session). */
  readonly remove: [string, bigint, string | null][];
  readonly hold: [bigint, bigint][];
}

async function process_batch(core: PushCore, sending: Sending, devices: readonly Device[], ad: boolean): Promise<BatchOutcome> {
  const out: BatchOutcome = { devices: 0, sent: 0, invalid: 0, failed: 0, consent_skipped: 0, held: 0, remove: [], hold: [] };
  const groups = new Map<string, { provider: Provider; payload: PushPayload; devices: Device[] }>();
  const now = core.time.clock_now();
  for (const device of devices) {
    if (core.session.check_current(device.user_id, device.session_id) !== 'pass') {
      out.remove.push([device.device_token, device.user_id, device.session_id]);
      continue;
    }
    out.devices++;
    if (ad && !device.ad_allowed) {
      out.consent_skipped++;
      continue;
    }
    const night_end = ad && !device.night_allowed ? night_window_end(core.settings.night_start_minute, core.settings.night_end_minute, now, device.timezone_offset_ms) : null;
    if (night_end !== null) {
      out.held++;
      out.hold.push([device.user_id, night_end]);
      continue;
    }
    const payload = payload_of(core, sending, device);
    const key = JSON.stringify([device.provider, payload.title, payload.body]);
    const group = groups.get(key) ?? { provider: device.provider, payload, devices: [] };
    group.devices.push(device);
    groups.set(key, group);
  }
  await Promise.all([...groups.values()].map(async (group) => {
    const results = await send_with_retry(core, sending, group.provider, group.devices.map((d) => d.device_token), group.payload);
    results.forEach((r, i) => {
      const device = group.devices[i] as Device;
      if (r === 'OK') out.sent++;
      else if (r === 'FAILED') out.failed++;
      else {
        out.invalid++;
        out.remove.push([device.device_token, device.user_id, null]);
      }
    });
  }));
  return out;
}

function remove_devices(db: DbHandle, rows: readonly [string, bigint, string | null][]): void {
  for (const [token, user_id, session_id] of rows) {
    if (session_id === null) db.query(`DELETE FROM ${T_DEVICE} WHERE device_token = $1 AND user_id = $2`, [token, user_id]);
    else db.query(`DELETE FROM ${T_DEVICE} WHERE device_token = $1 AND user_id = $2 AND session_id = $3`, [token, user_id, session_id]);
  }
}

/**
 * A write of a record under its lease (`### send`): a batch result or the end of the record. A `FAILED` game
 * transaction is written again after `push.retryIntervalMs`, up to `push.retryMaxAttempts` attempts and only while
 * `clock_now` + `push.retryIntervalMs` < `lease_until`, so no other instance takes the lease meanwhile. The `error`
 * log is written at the first failure and when the write stops; a first failure that stops is one log.
 * The value of `fn`, or null when it was not written: the record then stops as on a lost lease, and the instance that
 * takes the lease next goes on from the cursor.
 */
async function write_under_lease<T>(core: PushCore, sending: Sending, write: 'batch' | 'finish', fn: (tx: GameTx) => T): Promise<T | null> {
  const attempts = Math.max(1, core.settings.retry_max_attempts);
  for (let attempt = 1; running(core); attempt++) {
    const result = await core.storage.run_game_transaction(fn);
    if (result !== 'FAILED') return result;
    const retry = attempt < attempts && core.time.clock_now() + core.settings.retry_interval_ms < sending.lease_until;
    if (attempt === 1 || !retry) report(core, `push ${write} write failed`, { push_id: sending.push_id.toString(), attempt, retry });
    if (!retry) return null;
    await core.time.sleep(core.settings.retry_interval_ms);
  }
  return null;
}

/** Writes a batch under the lease: false when another instance holds the lease now or the write failed. */
async function write_batch(core: PushCore, sending: Sending, cursor: bigint, o: BatchOutcome): Promise<boolean> {
  const result = await write_under_lease(core, sending, 'batch', (tx) => {
    const db = core.storage.db(tx);
    const lease_until = core.time.clock_now() + core.settings.lease_ms;
    const rows = db.query(
      `UPDATE ${T_RECORD} SET cursor_user_id = $3, device_count = device_count + $4, sent_count = sent_count + $5, invalid_count = invalid_count + $6,
         failed_count = failed_count + $7, consent_skipped_count = consent_skipped_count + $8, held_count = held_count + $9, lease_until = $10
       WHERE push_id = $1 AND lease_owner = $2 AND status = 'SENDING' RETURNING push_id`,
      [sending.push_id, sending.owner, cursor, o.devices, o.sent, o.invalid, o.failed, o.consent_skipped, o.held, lease_until],
    );
    if (rows.length === 0) return null;
    remove_devices(db, o.remove);
    for (const [user_id, send_at] of o.hold) {
      db.query(
        `INSERT INTO ${T_HELD} (push_id, user_id, send_at, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT (push_id, user_id) DO NOTHING`,
        [sending.push_id, user_id, send_at, send_at + core.settings.max_delay_ms],
      );
    }
    return lease_until;
  });
  if (result === null) return false;
  sending.lease_until = result;
  return true;
}

/** Ends a record under the lease: `SENT`, or `FAILED` when it had devices and every one failed. */
async function finish(core: PushCore, sending: Sending): Promise<void> {
  const result = await write_under_lease(core, sending, 'finish', (tx) => {
    const db = core.storage.db(tx);
    const [row] = db.query(`SELECT device_count, failed_count, sent_count, invalid_count, consent_skipped_count, held_count FROM ${T_RECORD} WHERE push_id = $1 AND lease_owner = $2 AND status = 'SENDING'`, [sending.push_id, sending.owner]);
    if (row === undefined) return { row: null };
    const status = (row.device_count as bigint) >= 1n && row.failed_count === row.device_count ? 'FAILED' : 'SENT';
    if (!end_sending(core, db, sending.push_id, sending.owner, status)) return { row: null };
    return { row, status };
  });
  if (result === null || result.row === null) return;
  const row = result.row;
  const fields = {
    push_id: sending.push_id.toString(), status: result.status, device_count: Number(row.device_count), sent_count: Number(row.sent_count),
    invalid_count: Number(row.invalid_count), failed_count: Number(row.failed_count), consent_skipped_count: Number(row.consent_skipped_count), held_count: Number(row.held_count),
  };
  log(core, 'info', 'push sent', fields);
  if ((row.failed_count as bigint) > 0n) report(core, 'push ended with failed devices', fields);
}

/**
 * Ends a `SENDING` record with a final status and `lease_until` 0: under the lease of `owner`, or under any lease when
 * `owner` is null. Whether it ended.
 */
function end_sending(core: PushCore, db: DbHandle, push_id: bigint, owner: string | null, status: Status): boolean {
  const lease = owner === null ? '' : ' AND lease_owner = $5';
  return db.query(
    `UPDATE ${T_RECORD} SET status = $1, finished_at = $2, expires_at = $3, lease_until = 0 WHERE push_id = $4 AND status = 'SENDING'${lease} RETURNING push_id`,
    owner === null ? [...finish_params(core, status), push_id] : [...finish_params(core, status), push_id, owner],
  ).length > 0;
}

/** The one `error` log of a record whose message is not in the server build data. */
function report_missing_message(core: PushCore, sending: Sending): void {
  report(core, 'push message is not in the server build data', { push_id: sending.push_id.toString(), message_id: sending.message_id });
}

/**
 * Ends a record whose message is not in the server build data (a data update after `queue_push`): `FAILED` without a
 * send, its `push_held` rows deleted, in one game transaction under the lease, and one `error` log.
 */
async function fail_missing_message(core: PushCore, sending: Sending): Promise<void> {
  const ended = await write_under_lease(core, sending, 'finish', (tx) => {
    const db = core.storage.db(tx);
    if (!end_sending(core, db, sending.push_id, sending.owner, 'FAILED')) return false;
    db.query(`DELETE FROM ${T_HELD} WHERE push_id = $1`, [sending.push_id]);
    return true;
  });
  if (ended === true) report_missing_message(core, sending);
}

/** Sends a record from its cursor to the end while this instance holds the lease. */
async function send_record(core: PushCore, sending: Sending): Promise<void> {
  if (!has_message(core, sending.message_id)) {
    await fail_missing_message(core, sending);
    return;
  }
  const ad = core.server.data.PushMessageTable.get_row(sending.message_id).kind === GameData.PushKind.Ad;
  while (running(core)) {
    const devices = select_devices(core, core.storage.read_db(), sending.target, sending.cursor);
    if (devices.length === 0) {
      await finish(core, sending);
      return;
    }
    const outcome = await process_batch(core, sending, devices, ad);
    // A stopped instance did not end the batch: the instance that takes the lease next sends it from the cursor.
    if (!running(core)) return;
    const cursor = (devices[devices.length - 1] as Device).user_id;
    if (!(await write_batch(core, sending, cursor, outcome))) return;
    sending.cursor = cursor;
    keep_logged(core, sending);
  }
}

function has_message(core: PushCore, message_id: number): boolean {
  return core.server.data.PushMessageTable.has_row(message_id);
}

/** A due record as the job picked it: the claim is a conditional write on these values. */
interface Candidate {
  readonly push_id: bigint;
  readonly status: 'SCHEDULED' | 'SENDING';
  readonly send_at: bigint;
  readonly lease_owner: string;
  readonly lease_until: bigint;
}

/**
 * Takes the lease of a due record, or ends a late `SCHEDULED` one as `EXPIRED`. The record to send, or null. A record
 * with `failed_count` above 0 logged its first adapter failure already, on the instance that held the lease before.
 */
async function claim(core: PushCore, c: Candidate): Promise<Sending | null> {
  const owner = randomBytes(16).toString('base64url');
  const now = core.time.clock_now();
  const lease_until = now + core.settings.lease_ms;
  const late = c.status === 'SCHEDULED' && c.send_at < now - core.settings.max_delay_ms;
  const result = await core.storage.run_game_transaction((tx) => {
    const db = core.storage.db(tx);
    const same = 'push_id = $1 AND status = $2 AND lease_owner = $3 AND lease_until = $4';
    if (late) {
      const [status, finished_at, expires_at] = finish_params(core, 'EXPIRED');
      const rows = db.query(`UPDATE ${T_RECORD} SET status = $5, finished_at = $6, expires_at = $7 WHERE ${same} RETURNING push_id`, [c.push_id, c.status, c.lease_owner, c.lease_until, status, finished_at, expires_at]);
      return { expired: rows.length > 0, row: null };
    }
    const [row] = db.query(
      `UPDATE ${T_RECORD} SET status = 'SENDING', lease_owner = $5, lease_until = $6 WHERE ${same} RETURNING push_id, message_id, args, target, cursor_user_id, failed_count`,
      [c.push_id, c.status, c.lease_owner, c.lease_until, owner, lease_until],
    );
    return { expired: false, row: row ?? null };
  });
  if (result === 'FAILED') {
    report(core, 'push lease write failed', { push_id: c.push_id.toString() });
    return null;
  }
  if (result.expired) log(core, 'info', 'push expired', { push_id: c.push_id.toString() });
  const row = result.row;
  if (row === null) return null;
  return new_sending(core, {
    push_id: c.push_id, message_id: row.message_id as number, args: parse_args(row.args as string), target: parse_target(row.target as string),
    owner, cursor: row.cursor_user_id as bigint, lease_until,
  }, (row.failed_count as bigint) > 0n);
}

/**
 * Sends up to `push.sendBatchSize` held pushes whose night window has ended (`### send` `push_held`): it takes each
 * row in its own game transaction, then sends the taken ones at once. The held rows of one record share its failure
 * logs. True when there may be more due rows.
 */
async function send_held_batch(core: PushCore): Promise<boolean> {
  const now = core.time.clock_now();
  const rows = core.storage.read_db().query(
    `SELECT push_id, user_id FROM ${T_HELD} WHERE send_at <= $1 AND expires_at > $1 ORDER BY send_at, push_id, user_id LIMIT $2`,
    [now, core.settings.send_batch_size],
  );
  const sendings = new Map<bigint, Sending | null>();
  for (const held of rows) {
    const push_id = held.push_id as bigint;
    if (!sendings.has(push_id)) sendings.set(push_id, held_sending(core, push_id));
  }
  const taken: [bigint, bigint][] = [];
  const dropped = new Set<bigint>();
  let failed = false;
  for (const held of rows) {
    if (!running(core)) return false;
    const push_id = held.push_id as bigint;
    const user_id = held.user_id as bigint;
    const sending = sendings.get(push_id) ?? null;
    if (sending !== null && !has_message(core, sending.message_id)) {
      if (!dropped.has(push_id)) {
        if (await drop_held(core, sending)) dropped.add(push_id);
        else failed = true;
      }
      continue;
    }
    const result = await core.storage.run_game_transaction((tx) => ({
      taken: core.storage.db(tx).query(`DELETE FROM ${T_HELD} WHERE push_id = $1 AND user_id = $2 RETURNING push_id`, [push_id, user_id]).length > 0,
    }));
    if (result === 'FAILED') failed = true;
    else if (result.taken) taken.push([push_id, user_id]);
  }
  await Promise.all(taken.map(([push_id, user_id]) => send_one_held(core, sendings.get(push_id) ?? null, user_id)));
  // A row whose take failed stays due; a batch of only such rows ends the run so the next run tries again.
  return rows.length === core.settings.send_batch_size && !(failed && taken.length === 0 && dropped.size === 0);
}

/**
 * Deletes the `push_held` rows of a record whose message is not in the server build data, without a send (`### send`),
 * in one game transaction. A `SENDING` record ends `FAILED` in it, so its lease holder's writes no longer match; an
 * ended record keeps its status. The record row is locked before the delete, as a batch write of its lease holder
 * locks it before it adds `push_held` rows: that batch write commits before the delete reads the rows, or waits for
 * this transaction and then does not match the ended record. The instance whose delete takes the rows logs the
 * record's one `error` log. False when the game transaction is `FAILED`: the rows stay due and the next run tries
 * again.
 */
async function drop_held(core: PushCore, sending: Sending): Promise<boolean> {
  // A number a game transaction function returns is a failure code that rolls it back, so the count is in an object.
  const result = await core.storage.run_game_transaction((tx) => {
    const db = core.storage.db(tx);
    db.query(`UPDATE ${T_RECORD} SET lease_until = lease_until WHERE push_id = $1`, [sending.push_id]);
    const deleted = db.query(`DELETE FROM ${T_HELD} WHERE push_id = $1 RETURNING user_id`, [sending.push_id]).length;
    if (deleted > 0) end_sending(core, db, sending.push_id, null, 'FAILED');
    return { deleted };
  });
  if (result === 'FAILED') {
    report(core, 'push held drop failed', { push_id: sending.push_id.toString() });
    return false;
  }
  if (result.deleted > 0) report_missing_message(core, sending);
  return true;
}

/**
 * The record of held rows, or null when it is gone. A record with `failed_count` above 0 logged its first adapter
 * failure already, on this instance or another.
 */
function held_sending(core: PushCore, push_id: bigint): Sending | null {
  const [record] = core.storage.read_db().query(`SELECT message_id, args, failed_count FROM ${T_RECORD} WHERE push_id = $1`, [push_id]);
  if (record === undefined) return null;
  return new_sending(core, {
    push_id, message_id: record.message_id as number, args: parse_args(record.args as string), target: { user_ids: [] }, owner: '', cursor: 0n, lease_until: 0n,
  }, (record.failed_count as bigint) > 0n);
}

async function send_one_held(core: PushCore, sending: Sending | null, user_id: bigint): Promise<void> {
  if (sending === null) return;
  const push_id = sending.push_id;
  const [row] = core.storage.read_db().query(`SELECT ${DEVICE_SELECT} FROM ${T_DEVICE} WHERE user_id = $1 ORDER BY device_token LIMIT 1`, [user_id]);
  if (row === undefined) return;
  const device = device_of(row);
  if (core.session.check_current(device.user_id, device.session_id) !== 'pass') {
    await core.storage.run_game_transaction((tx) => {
      remove_devices(core.storage.db(tx), [[device.device_token, device.user_id, device.session_id]]);
      return { done: true };
    });
    return;
  }
  if (!device.ad_allowed) return;
  const [result] = await send_with_retry(core, sending, device.provider, [device.device_token], payload_of(core, sending, device));
  const column = result === 'OK' ? 'sent_count' : result === 'INVALID_TOKEN' ? 'invalid_count' : 'failed_count';
  const written = await core.storage.run_game_transaction((tx) => {
    const tx_db = core.storage.db(tx);
    tx_db.query(`UPDATE ${T_RECORD} SET ${column} = ${column} + 1 WHERE push_id = $1`, [push_id]);
    if (result === 'INVALID_TOKEN') remove_devices(tx_db, [[device.device_token, device.user_id, null]]);
    return { done: true };
  });
  if (written === 'FAILED') report(core, 'push held result write failed', { push_id: push_id.toString() });
}

/** Whether the instance is still started; it can stop while a job waits. */
function running(core: PushCore): boolean {
  return core.phase === 'started';
}

/** Claims and sends the due records (`### send`). */
async function send_due_records(core: PushCore): Promise<void> {
  const now = core.time.clock_now();
  const rows = core.storage.read_db().query(
    `SELECT push_id, status, send_at, lease_owner, lease_until FROM ${T_RECORD}
     WHERE (status = 'SCHEDULED' AND send_at <= $1) OR (status = 'SENDING' AND lease_until <= $1) ORDER BY send_at, push_id`,
    [now],
  );
  for (const row of rows) {
    if (!running(core)) return;
    const sending = await claim(core, row as unknown as Candidate);
    if (sending !== null) await send_record(core, sending);
  }
}

/**
 * One run of job `push_send`. Held pushes go a batch at a time between rounds of due records, so many held rows do
 * not keep a record that becomes due meanwhile waiting past `push.maxDelayMs`.
 */
async function run(core: PushCore): Promise<void> {
  drop_old_logged(core);
  for (;;) {
    const more = await send_held_batch(core);
    if (!running(core)) return;
    await send_due_records(core);
    if (!more || !running(core)) return;
  }
}

/** The job function of `push_send`: it logs its failure instead of throwing. */
export function push_send_job(core: PushCore): () => Promise<void> {
  return async () => {
    try {
      await run(core);
    } catch (error) {
      if (!running(core)) return;
      try {
        log(core, 'error', 'job push_send failed', { error: error instanceof Error ? error.message : String(error) });
      } catch {
        // The log writer failed too; the next run tries again.
      }
    }
  };
}
