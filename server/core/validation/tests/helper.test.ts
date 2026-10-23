import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameData from '../../../generated/data/game_data.ts';
import { emptyData, standalone, withContainer } from './standalone.ts';

const Kind = CoreContract.AnalyticsParamKind;

describe('is_in_range', () => {
  const v = standalone();

  it('is true from min to max and false outside, for number and bigint', () => {
    expect(v.is_in_range(1, 1, 10)).toBe(true);
    expect(v.is_in_range(10, 1, 10)).toBe(true);
    expect(v.is_in_range(0, 1, 10)).toBe(false);
    expect(v.is_in_range(11, 1, 10)).toBe(false);
    expect(v.is_in_range(2n ** 62n, 0, 2n ** 63n - 1n)).toBe(true);
    expect(v.is_in_range(2n ** 63n, 0, 2n ** 63n - 1n)).toBe(false);
    expect(v.is_in_range(-5n, -5, 0n)).toBe(true);
  });

  it('is false for a number that is not an integer', () => {
    expect(v.is_in_range(Number.NaN, 0, 10)).toBe(false);
    expect(v.is_in_range(Number.POSITIVE_INFINITY, 0, 10)).toBe(false);
    expect(v.is_in_range(1.5, 0, 10)).toBe(false);
    expect(v.is_in_range(5, Number.NEGATIVE_INFINITY, 10)).toBe(false);
  });
});

describe('has_table_id', () => {
  const items = new GameData.ItemTable([Object.assign(new GameData.ItemRow(), { id: 11 })]);
  const rewards = new GameData.AttendanceRewardTable([Object.assign(new GameData.AttendanceRewardRow(), { id: 21 })]);
  const v = standalone(withContainer(withContainer(emptyData(), 'ItemTable', items), 'AttendanceRewardTable', rewards));

  it('is true for an ID value in the table id and false for others', () => {
    expect(v.has_table_id('item', 11)).toBe(true);
    expect(v.has_table_id('item', 12)).toBe(false);
    expect(v.has_table_id('item', 0)).toBe(false);
    expect(v.has_table_id('item', -11)).toBe(false);
    expect(v.has_table_id('attendance_reward', 21)).toBe(true);
    expect(v.has_table_id('attendance_reward', 11)).toBe(false);
  });

  it('throws for a table the server build data does not have', () => {
    expect(() => v.has_table_id('no_such_table', 1)).toThrow();
    expect(() => v.has_table_id('Item', 11)).toThrow();
    expect(() => v.has_table_id('constructor', 1)).toThrow();
  });
});

describe('is_unique', () => {
  const v = standalone();

  it('compares the integers and strings of the key function', () => {
    expect(v.is_unique([1, 2, 3], (x) => x)).toBe(true);
    expect(v.is_unique([1, 2, 1], (x) => x)).toBe(false);
    expect(v.is_unique([1, 1n], (x) => x)).toBe(false);
    expect(v.is_unique(['a', 'b'], (x) => x)).toBe(true);
    expect(v.is_unique(['a', 'a'], (x) => x)).toBe(false);
    expect(v.is_unique(['1', 1], (x) => x)).toBe(true);
    expect(v.is_unique([{ id: 3n }, { id: 4n }, { id: 3n }], (x) => x.id)).toBe(false);
    expect(v.is_unique([], (x: number) => x)).toBe(true);
  });

  it('throws for a key that is not an integer or a string', () => {
    expect(() => v.is_unique([1.5], (x) => x)).toThrow();
  });
});

describe('is_kind_consistent', () => {
  const v = standalone();
  const fields = new Map<number, readonly string[]>([
    [Kind.ANALYTICS_PARAM_KIND_INT, ['int_value']],
    [Kind.ANALYTICS_PARAM_KIND_DOUBLE, ['double_value']],
    [Kind.ANALYTICS_PARAM_KIND_STRING, ['string_value']],
  ]);
  const param = (values: Partial<CoreContract.AnalyticsParam>): CoreContract.AnalyticsParam => Object.assign(new CoreContract.AnalyticsParam(), values);

  it('is true when only the kind field and the fields of the selected kind have values', () => {
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT, int_value: 5n }), 'kind', fields)).toBe(true);
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_STRING, string_value: 'x' }), 'kind', fields)).toBe(true);
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_DOUBLE }), 'kind', fields)).toBe(true);
  });

  it('rejects a message with a value in a field the selected kind does not use', () => {
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT, string_value: 'x' }), 'kind', fields)).toBe(false);
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT, double_value: -0 }), 'kind', fields)).toBe(false);
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT, bool_value: true }), 'kind', fields)).toBe(false);
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT, key: 'k' }), 'kind', fields)).toBe(false);
  });

  it('is false for the _UNSPECIFIED kind and for a kind not in the list', () => {
    expect(v.is_kind_consistent(param({}), 'kind', fields)).toBe(false);
    expect(v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_BOOL, bool_value: true }), 'kind', fields)).toBe(false);
  });

  it('checks repeated and message fields against their defaults', () => {
    const kinds = new Map<number, readonly string[]>([[1, ['credential']]]);
    const login = (values: Partial<CoreContract.LoginRequest>): CoreContract.LoginRequest => Object.assign(new CoreContract.LoginRequest(), values);
    expect(v.is_kind_consistent(login({ provider: 1, credential: 'c' }), 'provider', kinds)).toBe(true);
    expect(v.is_kind_consistent(login({ provider: 1, agreements: [new CoreContract.TermsAgreement()] }), 'provider', kinds)).toBe(false);
  });

  it('throws for a field name the message does not have', () => {
    expect(() => v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT }), 'type', fields)).toThrow();
    expect(() => v.is_kind_consistent(param({ kind: Kind.ANALYTICS_PARAM_KIND_INT }), 'kind', new Map([[1, ['no_field']]]))).toThrow();
  });
});

describe('is_platform', () => {
  const v = standalone();

  it('is true for the six platforms only', () => {
    for (const platform of ['android', 'ios', 'web', 'windows', 'macos', 'linux']) expect(v.is_platform(platform)).toBe(true);
    for (const text of ['', 'Android', 'IOS', 'iOS', 'mac', 'osx', ' web', 'linux ']) expect(v.is_platform(text)).toBe(false);
  });
});

describe('parse_version', () => {
  const v = standalone();

  it('reads 1.0.0 and 0.10.2', () => {
    expect(v.parse_version('1.0.0')).toEqual({ major: 1n, minor: 0n, patch: 0n });
    expect(v.parse_version('0.10.2')).toEqual({ major: 0n, minor: 10n, patch: 2n });
  });

  it('is none for 01.0.0, 1.0, 1.0.0.0, 1.-1.0 and the empty string', () => {
    for (const text of ['01.0.0', '1.02.0', '1.00.0', '1.0.00', '1.0', '1.0.0.0', '1.-1.0', '', ' 1.0.0', '1.0.0 ', 'a.b.c', '1.0.0-beta', '１.0.0']) expect(v.parse_version(text)).toBeNull();
  });

  it('reads parts beyond 2^53 exactly', () => {
    expect(v.parse_version('9007199254740993.0.1')).toEqual({ major: 9007199254740993n, minor: 0n, patch: 1n });
    expect(v.parse_version('12345678901234567890.0.1')).toEqual({ major: 12345678901234567890n, minor: 0n, patch: 1n });
  });
});

describe('compare_versions', () => {
  const v = standalone();
  const version = (text: string): NonNullable<ReturnType<typeof v.parse_version>> => {
    const parsed = v.parse_version(text);
    if (parsed === null) throw new Error(`not a version: ${text}`);
    return parsed;
  };

  it('judges 1.10.0 higher than 1.9.0', () => {
    expect(v.compare_versions(version('1.10.0'), version('1.9.0'))).toBeGreaterThan(0);
    expect(v.compare_versions(version('1.9.0'), version('1.10.0'))).toBeLessThan(0);
  });

  it('compares major, then minor, then patch', () => {
    expect(v.compare_versions(version('2.0.0'), version('1.99.99'))).toBeGreaterThan(0);
    expect(v.compare_versions(version('1.2.3'), version('1.2.4'))).toBeLessThan(0);
    expect(v.compare_versions(version('1.2.3'), version('1.2.3'))).toBe(0);
  });
});
