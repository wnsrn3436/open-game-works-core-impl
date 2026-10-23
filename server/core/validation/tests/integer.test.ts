import { standalone } from './standalone.ts';

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

describe('integer helpers', () => {
  const v = standalone();

  it('floor_div and floor_mod give the UtilCore numbers: floor_div(-7, 2) is -4, floor_mod(-7, 2) is 1', () => {
    expect(v.floor_div(-7n, 2n)).toBe(-4n);
    expect(v.floor_mod(-7n, 2n)).toBe(1n);
    expect(v.floor_div(7n, 2n)).toBe(3n);
    expect(v.floor_mod(7n, 2n)).toBe(1n);
    expect(v.floor_div(-8n, 2n)).toBe(-4n);
    expect(v.floor_mod(-8n, 2n)).toBe(0n);
    expect(v.floor_div(INT64_MIN, 1n)).toBe(INT64_MIN);
    expect(v.floor_mod(INT64_MIN, 3n)).toBe(1n);
  });

  it('floor_div and floor_mod give 0 when b is 0 or less', () => {
    expect(v.floor_div(5n, 0n)).toBe(0n);
    expect(v.floor_mod(5n, 0n)).toBe(0n);
    expect(v.floor_div(-5n, -1n)).toBe(0n);
    expect(v.floor_mod(-5n, -3n)).toBe(0n);
  });

  it('apply_permille gives the UtilCore numbers and (false, 0) when the int64 product overflows', () => {
    expect(v.apply_permille(1001n, 500n)).toEqual({ success: true, value: 500n });
    expect(v.apply_permille(-1001n, 500n)).toEqual({ success: true, value: -501n });
    expect(v.apply_permille(INT64_MAX, 2n)).toEqual({ success: false, value: 0n });
    expect(v.apply_permille(2n ** 62n, 2n)).toEqual({ success: false, value: 0n });
    expect(v.apply_permille(2n ** 62n, -2n)).toEqual({ success: true, value: v.floor_div(INT64_MIN, 1000n) });
  });

  it('big_floor_div and big_apply_permille give the UtilCore numbers past int64, and big_floor_div of b 0 is null', () => {
    expect(v.big_floor_div(-7n, 2n)).toBe(-4n);
    expect(v.big_apply_permille(1001n, 500n)).toBe(500n);
    expect(v.big_floor_div(10n ** 30n, 3n)).toBe(333333333333333333333333333333n);
    expect(v.big_floor_div(-(10n ** 30n) - 1n, 10n)).toBe(-(10n ** 29n) - 1n);
    expect(v.big_apply_permille(-(10n ** 25n) - 1n, 1n)).toBe(-(10n ** 22n) - 1n);
    expect(v.big_apply_permille(INT64_MAX, 2000n)).toBe(INT64_MAX * 2n);
    expect(v.big_floor_div(10n ** 30n, 0n)).toBeNull();
    expect(v.big_floor_div(10n ** 30n, -1n)).toBeNull();
  });
});
