/**
 * The decision table of `### result decision` and the integrity events of `### integrity` on the decision functions
 * alone. The full report flow, with result checks and `replay_match`, runs through `ReportMatchResult` in
 * `results.test.ts` and `forfeit.test.ts`.
 */
import * as GameData from '../../../generated/data/game_data.ts';
import { decide, integrity_events, type ReportState } from '../judge.ts';

const Rule = GameData.MatchResultRule;

function b(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

interface Spec {
  readonly result?: Uint8Array;
  readonly log?: Uint8Array;
  readonly left?: boolean;
}

/** A participant: reported when it has a result or log. */
function p(spec: Spec = {}): ReportState {
  const reported = spec.result !== undefined || spec.log !== undefined;
  return {
    reported_at: reported ? 1n : 0n,
    result: spec.result ?? new Uint8Array(0),
    input_log: spec.log ?? new Uint8Array(0),
    left_at: spec.left === true ? 1n : 0n,
  };
}

describe('decide', () => {
  it('Consensus: CONFIRMED when all report the same result; a complete record without it is MISMATCH, else PENDING', () => {
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p()], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p({ result: b(1) })], false)).toEqual({ kind: 'CONFIRMED', result: b(1) });
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p({ result: b(2) })], false)).toEqual({ kind: 'MISMATCH' });
    // Two different results of 3 wait for the third report: no report alone decides before the record is complete.
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p({ result: b(2) }), p()], false)).toEqual({ kind: 'PENDING' });
  });

  it('Majority: 2 of 3 same results confirm; a complete 2-player split is MISMATCH', () => {
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(1) }), p()], false)).toEqual({ kind: 'CONFIRMED', result: b(1) });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(2) }), p()], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(2) }), p({ result: b(3) })], false)).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(2) })], false)).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p()], false)).toEqual({ kind: 'PENDING' });
  });

  it('ServerReplay with 2: the same logs replay, different logs are MISMATCH, and one report never decides', () => {
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) })], false)).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) })], false)).toEqual({ kind: 'REPLAY', input_log: b(1) });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p()], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p()], true)).toEqual({ kind: 'MISMATCH' });
  });

  it('ServerReplay with 3: first two different logs wait; the third picks the majority or makes MISMATCH', () => {
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p()], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p({ log: b(2) })], false)).toEqual({ kind: 'REPLAY', input_log: b(2) });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p({ log: b(3) })], false)).toEqual({ kind: 'MISMATCH' });
  });

  it('ServerReplay counts against the participants that are not forfeiters, and against the reports at deadline_at', () => {
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p(), p({ left: true })], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) }), p({ left: true })], false)).toEqual({ kind: 'REPLAY', input_log: b(1) });
    // 2 same of 4 participants: 2c > k fails before deadline_at, 2c > r holds at it.
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) }), p(), p()], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) }), p(), p()], true)).toEqual({ kind: 'REPLAY', input_log: b(1) });
    // A participant that reported before it left is not a forfeiter.
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2), left: true })], false)).toEqual({ kind: 'MISMATCH' });
  });

  it('FORFEIT: the final decision without CONFIRMED, with a forfeiter and a report of a participant that is not one', () => {
    for (const rule of [Rule.Consensus, Rule.Majority, Rule.ServerReplay]) {
      expect(decide(rule, [p({ result: b(1), log: b(1) }), p({ left: true })], false)).toEqual({ kind: 'FORFEIT' });
      // No report at all: a match not played.
      expect(decide(rule, [p(), p({ left: true })], true)).toEqual({ kind: 'MISMATCH' });
    }
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p({ result: b(2) }), p({ left: true })], false)).toEqual({ kind: 'FORFEIT' });
    // A participant without a report that is not a forfeiter keeps the record from being complete.
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p(), p({ left: true })], false)).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p(), p({ left: true })], true)).toEqual({ kind: 'FORFEIT' });
  });
});

describe('integrity_events', () => {
  it('gives Disagree to reporters of another compared value, Forfeit to forfeiters and Missing only at deadline_at', () => {
    expect(integrity_events(Rule.Majority, [p({ result: b(1) }), p({ result: b(1) }), p({ result: b(2) })], 'CONFIRMED', b(1), false)).toEqual([null, null, 'Disagree']);
    expect(integrity_events(Rule.Consensus, [p({ result: b(1) }), p({ result: b(2) })], 'MISMATCH', null, false)).toEqual(['Disagree', 'Disagree']);
    expect(integrity_events(Rule.Consensus, [p({ result: b(1) }), p({ result: b(2) }), p({ left: true })], 'FORFEIT', null, false)).toEqual(['Disagree', 'Disagree', 'Forfeit']);
    expect(integrity_events(Rule.Consensus, [p({ result: b(1) }), p()], 'MISMATCH', null, true)).toEqual([null, 'Missing']);
    expect(integrity_events(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) }), p()], 'CONFIRMED', b(1), false)).toEqual([null, null, null]);
    // ServerReplay compares input_log, not result.
    expect(integrity_events(Rule.ServerReplay, [p({ result: b(1), log: b(3) }), p({ result: b(2), log: b(3) })], 'CONFIRMED', b(3), false)).toEqual([null, null]);
  });

  it('gives no event when no participant that is not a forfeiter reported', () => {
    expect(integrity_events(Rule.Consensus, [p(), p({ left: true })], 'MISMATCH', null, true)).toEqual([null, null]);
  });
});
