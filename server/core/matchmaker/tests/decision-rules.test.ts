/**
 * The decision table of `### result decision` on the decision function alone. The full report flow, with result
 * checks and `replay_match`, runs through `ReportMatchResult` in `results.test.ts`.
 */
import * as GameData from '../../../generated/data/game_data.ts';
import { decide, type ReportState } from '../judge.ts';

const Rule = GameData.MatchResultRule;

function b(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

interface Spec {
  readonly result?: Uint8Array;
  readonly log?: Uint8Array;
  readonly left?: boolean;
  readonly disconnected?: boolean;
}

/** A participant: reported when it has a result or log. */
function p(spec: Spec = {}): ReportState {
  const reported = spec.result !== undefined || spec.log !== undefined;
  return {
    reported_at: reported ? 1n : 0n,
    result: spec.result ?? new Uint8Array(0),
    input_log: spec.log ?? new Uint8Array(0),
    left_at: spec.left === true ? 1n : 0n,
    disconnected_at: spec.disconnected === true ? 1n : 0n,
  };
}

describe('decide', () => {
  it('Consensus: CONFIRMED when all report the same result, MISMATCH on two different results, else PENDING', () => {
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p()])).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p({ result: b(1) })])).toEqual({ kind: 'CONFIRMED', result: b(1) });
    expect(decide(Rule.Consensus, [p({ result: b(1) }), p({ result: b(2) }), p()])).toEqual({ kind: 'MISMATCH' });
  });

  it('Majority: 2 of 3 same results confirm; a 2-player split is MISMATCH', () => {
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(1) }), p()])).toEqual({ kind: 'CONFIRMED', result: b(1) });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(2) }), p()])).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(2) }), p({ result: b(3) })])).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p({ result: b(2) })])).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.Majority, [p({ result: b(1) }), p()])).toEqual({ kind: 'PENDING' });
  });

  it('ServerReplay with 2: different logs are MISMATCH, the same logs replay', () => {
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) })])).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) })])).toEqual({ kind: 'REPLAY', input_log: b(1) });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p()])).toEqual({ kind: 'PENDING' });
  });

  it('ServerReplay with 3: first two different logs wait; the third picks the majority or makes MISMATCH', () => {
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p()])).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p({ log: b(2) })])).toEqual({ kind: 'REPLAY', input_log: b(2) });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p({ log: b(3) })])).toEqual({ kind: 'MISMATCH' });
  });

  it('ServerReplay does not wait for participants that left or disconnected, and a left report does not count with 3', () => {
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p(), p({ left: true })])).toEqual({ kind: 'PENDING' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(1) }), p({ left: true })])).toEqual({ kind: 'REPLAY', input_log: b(1) });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ disconnected: true })])).toEqual({ kind: 'REPLAY', input_log: b(1) });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2), left: true })])).toEqual({ kind: 'MISMATCH' });
    expect(decide(Rule.ServerReplay, [p({ log: b(1) }), p({ log: b(2) }), p({ log: b(2), left: true })])).toEqual({ kind: 'MISMATCH' });
  });
});
