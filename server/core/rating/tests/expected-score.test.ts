import { expected_score } from '../elo.ts';

describe('expected score', () => {
  it('is 91 when R_j − R_i is scale, and 909 the other way', () => {
    expect(expected_score(1000n, 1400n, 400n)).toBe(91n);
    expect(expected_score(1400n, 1000n, 400n)).toBe(909n);
    expect(expected_score(0n, 7n, 7n)).toBe(91n);
  });

  it('is 500 for equal ratings and the nearest integer otherwise', () => {
    expect(expected_score(1500n, 1500n, 400n)).toBe(500n);
    // 1000 ÷ (1 + 10^(200 ÷ 400)) = 240.253…
    expect(expected_score(1000n, 1200n, 400n)).toBe(240n);
    // 1000 ÷ (1 + 10^(−200 ÷ 400)) = 759.746…
    expect(expected_score(1200n, 1000n, 400n)).toBe(760n);
  });
});
