/**
 * The queue matching rules of `### matching` on the queue functions alone: spread, seats, teams, block relations,
 * `match_wait`. The same rules run through `/realtime` in `matching.test.ts`.
 */
import { assign_teams, blocks_either, run_queue, type MatchRule, type QueueEntry } from '../matching.ts';

const RULE: MatchRule = { min_players: 2, max_players: 2, match_wait: 30_000n, rating_spread: 0n, rating_spread_per_sec: 0n, team_size: 0 };

function solo(user_id: bigint, rating: bigint, entered_at = 0n, blocked: readonly bigint[] = []): QueueEntry {
  return { members: [{ user_id, rating, blocked: new Set(blocked) }], rating, entered_at };
}

function party(ids: readonly bigint[], ratings: readonly bigint[], entered_at = 0n): QueueEntry {
  const members = ids.map((user_id, i) => ({ user_id, rating: ratings[i] ?? 0n, blocked: new Set<bigint>() }));
  return { members, rating: ratings.reduce((a, b) => (b > a ? b : a), ratings[0] ?? 0n), entered_at };
}

function ids(entries: readonly QueueEntry[]): bigint[] {
  return entries.flatMap((e) => e.members.map((m) => m.user_id));
}

describe('run_queue', () => {
  it('makes a match of max_players entries in entry order and takes them out of the queue', () => {
    const queue = [solo(1n, 0n), solo(2n, 0n), solo(3n, 0n)];
    const steps = run_queue(queue, RULE, 0n);
    expect(steps).toHaveLength(1);
    const step = steps[0];
    expect(step?.kind).toBe('match');
    if (step?.kind === 'match') expect(ids(step.entries)).toEqual([1n, 2n]);
    expect(ids(queue)).toEqual([3n]);
  });

  it('does not group entries whose rating differs by more than the spread until waiting widens it', () => {
    const rule = { ...RULE, rating_spread: 10n, rating_spread_per_sec: 5n };
    const queue = [solo(1n, 100n), solo(2n, 130n)];
    expect(run_queue(queue, rule, 0n)).toEqual([]);
    expect(run_queue(queue, rule, 3_999n)).toEqual([]);
    const steps = run_queue(queue, rule, 4_000n);
    expect(steps.map((s) => s.kind)).toEqual(['match']);
  });

  it('at match_wait makes a match of min_players or more, else times out only e0', () => {
    const rule = { ...RULE, min_players: 2, max_players: 4 };
    const three = [solo(1n, 0n), solo(2n, 0n), solo(3n, 0n)];
    expect(run_queue(three, rule, 29_999n)).toEqual([]);
    const made = run_queue(three, rule, 30_000n);
    expect(made.map((s) => s.kind)).toEqual(['match']);
    const alone = [solo(1n, 0n), solo(2n, 0n, 20_000n)];
    const steps = run_queue(alone, { ...rule, min_players: 3 }, 30_000n);
    expect(steps.map((s) => s.kind)).toEqual(['timeout']);
    const timeout = steps[0];
    if (timeout?.kind === 'timeout') expect(ids([timeout.entry])).toEqual([1n]);
    expect(ids(alone)).toEqual([2n]);
  });

  it('does not put two entries with a block relation in one match, a party member included', () => {
    const queue = [solo(1n, 0n, 0n, [2n]), solo(2n, 0n), solo(3n, 0n)];
    const steps = run_queue(queue, RULE, 0n);
    const step = steps[0];
    if (step?.kind === 'match') expect(ids(step.entries)).toEqual([1n, 3n]);
    expect(ids(queue)).toEqual([2n]);
    const p = party([4n, 5n], [0n, 0n]);
    const blocked_by_member = solo(6n, 0n, 0n, [5n]);
    expect(blocks_either(p, blocked_by_member)).toBe(true);
    expect(blocks_either(blocked_by_member, p)).toBe(true);
    expect(blocks_either(p, solo(7n, 0n))).toBe(false);
  });

  it('places an entry only where a team has enough free seats', () => {
    const rule = { ...RULE, max_players: 4, min_players: 4, team_size: 2 };
    const queue = [solo(1n, 0n), party([2n, 3n], [0n, 0n]), party([4n, 5n], [0n, 0n]), solo(6n, 0n)];
    const steps = run_queue(queue, rule, 0n);
    const step = steps[0];
    expect(step?.kind).toBe('match');
    if (step?.kind === 'match') expect(ids(step.entries)).toEqual([1n, 2n, 3n, 6n]);
    expect(ids(queue)).toEqual([4n, 5n]);
  });
});

describe('assign_teams', () => {
  const rule: MatchRule = { ...RULE, min_players: 4, max_players: 4, team_size: 2 };

  it('puts solo ratings 100, 90, 80, 70 as 100 and 70 on team 0, 90 and 80 on team 1', () => {
    const entries = [solo(1n, 100n), solo(2n, 90n), solo(3n, 80n), solo(4n, 70n)];
    expect(assign_teams(entries, [0, 0, 1, 1], rule)).toEqual([0, 1, 1, 0]);
  });

  it('puts two parties of 2 on different teams', () => {
    const entries = [party([1n, 2n], [10n, 20n]), party([3n, 4n], [30n, 5n])];
    const teams = assign_teams(entries, [0, 1], rule);
    expect(new Set(teams).size).toBe(2);
  });

  it('keeps the step 2 teams when the rating order leaves a party without a team', () => {
    const entries = [party([1n, 2n], [50n, 50n]), solo(3n, 100n), solo(4n, 90n)];
    expect(assign_teams(entries, [0, 1, 1], rule)).toEqual([0, 1, 1]);
  });

  it('gives team 0 to every entry with team_size 0', () => {
    expect(assign_teams([solo(1n, 5n), solo(2n, 9n)], [0, 0], RULE)).toEqual([0, 0]);
  });
});
