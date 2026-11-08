/**
 * The result decision of `### result decision` over the saved reports and the leaves the server observed, and the
 * integrity events of `### integrity`. `Consensus` and `Majority` give the result to confirm; `ServerReplay` gives the
 * `input_log` to replay. The module checks the result and runs `replay_match`.
 */
import * as GameData from '../../generated/data/game_data.ts';

/** A participant's report and presence as the match record holds them. */
export interface ReportState {
  readonly reported_at: bigint;
  readonly result: Uint8Array;
  readonly input_log: Uint8Array;
  readonly left_at: bigint;
}

export type Decision =
  | { readonly kind: 'PENDING' }
  | { readonly kind: 'MISMATCH' }
  | { readonly kind: 'FORFEIT' }
  | { readonly kind: 'CONFIRMED'; readonly result: Uint8Array }
  | { readonly kind: 'REPLAY'; readonly input_log: Uint8Array };

/** `MatchIntegrityKind`. */
export type IntegrityKind = 'Disagree' | 'Forfeit' | 'Missing';

const PENDING: Decision = { kind: 'PENDING' };
const MISMATCH: Decision = { kind: 'MISMATCH' };
const FORFEIT: Decision = { kind: 'FORFEIT' };

function key(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function is_reported(p: ReportState): boolean {
  return p.reported_at !== 0n;
}

/** A participant whose `left_at` is not 0 and who has no saved report. */
export function is_forfeiter(p: ReportState): boolean {
  return p.left_at !== 0n && !is_reported(p);
}

/** Every participant has a saved report or is a forfeiter. */
export function is_complete(participants: readonly ReportState[]): boolean {
  return participants.every((p) => is_reported(p) || is_forfeiter(p));
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

/** The compared value of a report: `input_log` for `ServerReplay`, `result` otherwise. */
export function compared(rule: GameData.MatchResultRule, p: ReportState): Uint8Array {
  return rule === GameData.MatchResultRule.ServerReplay ? p.input_log : p.result;
}

/** The decision when the `CONFIRMED` condition of the rule holds, or null. */
function confirmed(rule: GameData.MatchResultRule, participants: readonly ReportState[], final: boolean): Decision | null {
  const n = participants.length;
  const reported = participants.filter(is_reported);
  switch (rule) {
    case GameData.MatchResultRule.Consensus: {
      const results = groups(reported.map((p) => p.result));
      const only = results[0];
      return results.length === 1 && only !== undefined && reported.length === n ? { kind: 'CONFIRMED', result: only.value } : null;
    }
    case GameData.MatchResultRule.Majority: {
      const top = largest(groups(reported.map((p) => p.result)));
      return top !== null && 2 * top.count > n ? { kind: 'CONFIRMED', result: top.value } : null;
    }
    case GameData.MatchResultRule.ServerReplay: {
      // 2c > k with k the participants that are not forfeiters; in the final decision 2c > r with r the reports.
      const k = final ? reported.length : participants.filter((p) => !is_forfeiter(p)).length;
      const top = largest(groups(reported.map((p) => p.input_log)));
      return top !== null && top.count >= 2 && 2 * top.count > k ? { kind: 'REPLAY', input_log: top.value } : null;
    }
    default:
      return null;
  }
}

/**
 * The decision of a `PENDING` match. `at_deadline`: the decision at `deadline_at`. A complete record and a record at
 * `deadline_at` get the final decision; otherwise only the `CONFIRMED` condition decides.
 */
export function decide(rule: GameData.MatchResultRule | null, participants: readonly ReportState[], at_deadline: boolean): Decision {
  const final = at_deadline || is_complete(participants);
  if (rule === null) return final ? MISMATCH : PENDING;
  const decision = confirmed(rule, participants, final);
  if (decision !== null) return decision;
  if (!final) return PENDING;
  const forfeiter = participants.some(is_forfeiter);
  const reporter = participants.some((p) => is_reported(p) && !is_forfeiter(p));
  return forfeiter && reporter ? FORFEIT : MISMATCH;
}

/**
 * The integrity event of each index of a judged match, or null. `confirmed_value`: the confirmed compared value
 * (`replayed_input_log` for `ServerReplay`, the confirmed result otherwise) when the judgement is `CONFIRMED`.
 * `at_deadline`: the final decision at `deadline_at`, which gives `Missing`.
 */
export function integrity_events(
  rule: GameData.MatchResultRule | null,
  participants: readonly ReportState[],
  status: 'CONFIRMED' | 'FORFEIT' | 'MISMATCH',
  confirmed_value: Uint8Array | null,
  at_deadline: boolean,
): (IntegrityKind | null)[] {
  if (!participants.some((p) => is_reported(p) && !is_forfeiter(p))) return participants.map(() => null);
  const value = (p: ReportState): Uint8Array => (rule === null ? p.result : compared(rule, p));
  const reported_values = participants.filter(is_reported).map(value);
  const split = groups(reported_values).length >= 2;
  const confirmed_key = confirmed_value === null ? null : key(confirmed_value);
  return participants.map((p): IntegrityKind | null => {
    if (is_forfeiter(p)) return 'Forfeit';
    if (!is_reported(p)) return at_deadline ? 'Missing' : null;
    if (status === 'CONFIRMED') return confirmed_key !== null && key(value(p)) !== confirmed_key ? 'Disagree' : null;
    return split ? 'Disagree' : null;
  });
}
