/**
 * The result decision of `### result decision` over the stored reports. `Consensus` and `Majority` give the result
 * to confirm; `ServerReplay` gives the `input_log` to replay. The module checks the result and runs `replay_match`.
 */
import * as GameData from '../../generated/data/game_data.ts';

/** A participant's report and presence as the match record holds them. */
export interface ReportState {
  readonly reported_at: bigint;
  readonly result: Uint8Array;
  readonly input_log: Uint8Array;
  readonly left_at: bigint;
  readonly disconnected_at: bigint;
}

export type Decision =
  | { readonly kind: 'PENDING' }
  | { readonly kind: 'MISMATCH' }
  | { readonly kind: 'CONFIRMED'; readonly result: Uint8Array }
  | { readonly kind: 'REPLAY'; readonly input_log: Uint8Array };

const PENDING: Decision = { kind: 'PENDING' };
const MISMATCH: Decision = { kind: 'MISMATCH' };

function key(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function is_reported(p: ReportState): boolean {
  return p.reported_at !== 0n;
}

/** Same bytes grouped: each distinct value with its count, in first report order. */
function groups(values: readonly Uint8Array[]): { value: Uint8Array; count: number }[] {
  const by = new Map<string, { value: Uint8Array; count: number }>();
  for (const value of values) {
    const k = key(value);
    const group = by.get(k);
    if (group === undefined) by.set(k, { value, count: 1 });
    else group.count += 1;
  }
  return [...by.values()];
}

function largest(list: readonly { value: Uint8Array; count: number }[]): { value: Uint8Array; count: number } | null {
  let best: { value: Uint8Array; count: number } | null = null;
  for (const g of list) if (best === null || g.count > best.count) best = g;
  return best;
}

function consensus(participants: readonly ReportState[]): Decision {
  const reported = participants.filter(is_reported);
  const results = groups(reported.map((p) => p.result));
  if (results.length >= 2) return MISMATCH;
  const only = results[0];
  if (only !== undefined && reported.length === participants.length) return { kind: 'CONFIRMED', result: only.value };
  return PENDING;
}

function majority(participants: readonly ReportState[]): Decision {
  const n = participants.length;
  const reported = participants.filter(is_reported);
  const top = largest(groups(reported.map((p) => p.result)));
  const c = top?.count ?? 0;
  if (top !== null && 2 * c > n) return { kind: 'CONFIRMED', result: top.value };
  const m = c + (n - reported.length);
  if (2 * m <= n) return MISMATCH;
  return PENDING;
}

/** The `input_log` to replay, or null when there is none. */
function replay_log(participants: readonly ReportState[]): Uint8Array | null {
  const reported = participants.filter(is_reported);
  if (participants.length === 2) {
    const logs = groups(reported.map((p) => p.input_log));
    return logs.length === 1 ? (logs[0]?.value ?? null) : null;
  }
  const staying = reported.filter((p) => p.left_at === 0n);
  const top = largest(groups(staying.map((p) => p.input_log)));
  return top !== null && 2 * top.count > staying.length ? top.value : null;
}

function server_replay(participants: readonly ReportState[]): Decision {
  const reported = participants.filter(is_reported);
  if (participants.length === 2 && groups(reported.map((p) => p.input_log)).length >= 2) return MISMATCH;
  const present = participants.filter((p) => p.left_at === 0n && p.disconnected_at === 0n);
  if (!present.every(is_reported)) return PENDING;
  const log = replay_log(participants);
  return log === null ? MISMATCH : { kind: 'REPLAY', input_log: log };
}

/** The decision of a `PENDING` match from its reports, by the `result_rule` of its mode. */
export function decide(rule: GameData.MatchResultRule, participants: readonly ReportState[]): Decision {
  switch (rule) {
    case GameData.MatchResultRule.Consensus:
      return consensus(participants);
    case GameData.MatchResultRule.Majority:
      return majority(participants);
    case GameData.MatchResultRule.ServerReplay:
      return server_replay(participants);
    default:
      return MISMATCH;
  }
}
