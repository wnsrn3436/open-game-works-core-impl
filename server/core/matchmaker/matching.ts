/**
 * The queue matching of `### matching`: one queue's entries grouped into matches by rating spread, seats, teams and
 * block relations, and the team assignment of a made match. Pure functions over the queue in the server instance's
 * memory; the module runs them on each `matchmaker_tick`.
 */

/** A member of a queue entry: the user, the user's rating and the block list read when the member entered. */
export interface QueueMember {
  readonly user_id: bigint;
  readonly rating: bigint;
  readonly blocked: ReadonlySet<bigint>;
}

/** A queue entry: one user, or a party (room members in room order). Its rating is the largest member rating. */
export interface QueueEntry {
  readonly members: readonly QueueMember[];
  readonly rating: bigint;
  readonly entered_at: bigint;
}

/** The `match_mode` values matching reads. */
export interface MatchRule {
  readonly min_players: number;
  readonly max_players: number;
  readonly match_wait: bigint;
  readonly rating_spread: bigint;
  readonly rating_spread_per_sec: bigint;
  readonly team_size: number;
}

/** One result of a queue run: a match of entries with each entry's team, or `e0` timed out. */
export type QueueStep<E extends QueueEntry> =
  | { readonly kind: 'match'; readonly entries: readonly E[]; readonly teams: readonly number[] }
  | { readonly kind: 'timeout'; readonly entry: E };

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** True when a member of one entry is on the block list of a member of the other. */
export function blocks_either(a: QueueEntry, b: QueueEntry): boolean {
  for (const x of a.members) {
    for (const y of b.members) {
      if (x.blocked.has(y.user_id) || y.blocked.has(x.user_id)) return true;
    }
  }
  return false;
}

/** The team of the smallest number with at least `size` free seats, or -1. */
function first_team(seats: readonly number[], size: number): number {
  return seats.findIndex((free) => free >= size);
}

interface Collected<E extends QueueEntry> {
  readonly entries: E[];
  readonly teams: number[];
  readonly count: number;
}

/** Step 2: entries from e0 in queue order within the spread that fit the seats and have no block relation. */
function collect<E extends QueueEntry>(queue: readonly E[], rule: MatchRule, spread: bigint): Collected<E> {
  const e0 = queue[0];
  const entries: E[] = [];
  const teams: number[] = [];
  let count = 0;
  if (e0 === undefined) return { entries, teams, count };
  const seats = rule.team_size > 0 ? new Array<number>(Math.floor(rule.max_players / rule.team_size)).fill(rule.team_size) : [];
  for (const entry of queue) {
    const size = entry.members.length;
    if (abs(entry.rating - e0.rating) > spread) continue;
    if (count + size > rule.max_players) continue;
    const team = rule.team_size > 0 ? first_team(seats, size) : 0;
    if (team < 0) continue;
    if (entries.some((e) => blocks_either(e, entry))) continue;
    entries.push(entry);
    teams.push(team);
    count += size;
    if (rule.team_size > 0) seats[team] = (seats[team] ?? 0) - size;
  }
  return { entries, teams, count };
}

/**
 * The team assignment of a made match: entries in rating order (larger first, then queue order) each go to the team
 * with enough free seats and the smallest member rating sum (then the smallest number). When an entry has no such
 * team, the step 2 teams stay. With `team_size` 0 every entry is team 0.
 */
export function assign_teams(entries: readonly QueueEntry[], collected_teams: readonly number[], rule: MatchRule): number[] {
  if (rule.team_size <= 0) return entries.map(() => 0);
  const team_count = Math.floor(rule.max_players / rule.team_size);
  const seats = new Array<number>(team_count).fill(rule.team_size);
  const sums = new Array<bigint>(team_count).fill(0n);
  const order = entries.map((_, i) => i).sort((a, b) => {
    const ra = entries[a]?.rating ?? 0n;
    const rb = entries[b]?.rating ?? 0n;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return a - b;
  });
  const teams = new Array<number>(entries.length).fill(0);
  for (const i of order) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const size = entry.members.length;
    let best = -1;
    for (let t = 0; t < team_count; t += 1) {
      if ((seats[t] ?? 0) < size) continue;
      if (best < 0 || (sums[t] ?? 0n) < (sums[best] ?? 0n)) best = t;
    }
    if (best < 0) return [...collected_teams];
    teams[i] = best;
    seats[best] = (seats[best] ?? 0) - size;
    sums[best] = (sums[best] ?? 0n) + entry.members.reduce((sum, m) => sum + m.rating, 0n);
  }
  return teams;
}

function remove<E>(queue: E[], entries: readonly E[]): void {
  for (const entry of entries) {
    const at = queue.indexOf(entry);
    if (at >= 0) queue.splice(at, 1);
  }
}

/**
 * One `matchmaker_tick` run over one queue at `now`: steps 1 to 5 repeated until the queue ends. Made matches and
 * timed out entries leave `queue`, which is the queue in entry order.
 */
export function run_queue<E extends QueueEntry>(queue: E[], rule: MatchRule, now: bigint): QueueStep<E>[] {
  const steps: QueueStep<E>[] = [];
  for (;;) {
    const e0 = queue[0];
    if (e0 === undefined) return steps;
    const waited = now - e0.entered_at;
    const spread = rule.rating_spread + rule.rating_spread_per_sec * (waited / 1000n);
    const got = collect(queue, rule, spread);
    if (got.count === rule.max_players || (waited >= rule.match_wait && got.count >= rule.min_players)) {
      remove(queue, got.entries);
      steps.push({ kind: 'match', entries: got.entries, teams: assign_teams(got.entries, got.teams, rule) });
      continue;
    }
    if (waited >= rule.match_wait) {
      remove(queue, [e0]);
      steps.push({ kind: 'timeout', entry: e0 });
      continue;
    }
    return steps;
  }
}
