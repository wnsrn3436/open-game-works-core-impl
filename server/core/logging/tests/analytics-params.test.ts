import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { client_name_refused, filter_params, params_bytes, server_event_problem, to_param } from '../analytics.ts';

const Kind = CoreContract.AnalyticsParamKind;
const LIMITS = { max_string_length: 10, max_event_params: 3 };

function param(key: string, kind: CoreContract.AnalyticsParamKind, set: Partial<CoreContract.AnalyticsParam> = {}): CoreContract.AnalyticsParam {
  return Object.assign(new CoreContract.AnalyticsParam(), { key, kind }, set);
}

describe('client event params', () => {
  it('drops only mismatched params, NaN and infinite doubles, and repeated keys after the first', () => {
    const params = [
      param('a', Kind.ANALYTICS_PARAM_KIND_INT, { int_value: 5n }),
      param('b', Kind.ANALYTICS_PARAM_KIND_INT, { string_value: 'x' }),
      param('c', Kind.ANALYTICS_PARAM_KIND_DOUBLE, { double_value: Number.NaN }),
      param('d', Kind.ANALYTICS_PARAM_KIND_DOUBLE, { double_value: Number.POSITIVE_INFINITY }),
      param('e', Kind.ANALYTICS_PARAM_KIND_UNSPECIFIED),
      param('a', Kind.ANALYTICS_PARAM_KIND_STRING, { string_value: 'again' }),
      param('f', Kind.ANALYTICS_PARAM_KIND_BOOL, { bool_value: true }),
      param('g', Kind.ANALYTICS_PARAM_KIND_STRING, { string_value: 's', bool_value: true }),
      param('h', Kind.ANALYTICS_PARAM_KIND_DOUBLE, { double_value: 2.5 }),
      param('i', Kind.ANALYTICS_PARAM_KIND_STRING),
      param('j', 9 as CoreContract.AnalyticsParamKind),
    ];
    const { kept, dropped } = filter_params(params);
    expect(kept.map((p) => p.key)).toEqual(['a', 'f', 'h', 'i']);
    expect(dropped).toBe(7);
  });

  it('refuses event names and param keys that are not snake_case, and event names starting with core_', () => {
    const event = (name: string, key = 'k'): CoreContract.AnalyticsEvent => Object.assign(new CoreContract.AnalyticsEvent(), { name, params: [param(key, Kind.ANALYTICS_PARAM_KIND_BOOL)] });
    expect(client_name_refused(event('stage_clear'))).toBe(false);
    for (const name of ['StageClear', '1stage', 'stage-clear', '', 'core_user_created']) expect(client_name_refused(event(name))).toBe(true);
    expect(client_name_refused(event('stage_clear', 'Key'))).toBe(true);
  });

  it('stores params as the protobuf bytes of an AnalyticsEvent with only params set, in order', () => {
    const params = [param('z', Kind.ANALYTICS_PARAM_KIND_INT, { int_value: -3n }), param('a', Kind.ANALYTICS_PARAM_KIND_STRING, { string_value: 'x' })];
    const decoded = CoreContract.AnalyticsEvent.decode(params_bytes(params));
    expect(decoded?.name).toBe('');
    expect(decoded?.time_at).toBe(0n);
    expect(decoded?.params.map((p) => [p.key, p.kind, p.int_value, p.string_value])).toEqual([
      ['z', Kind.ANALYTICS_PARAM_KIND_INT, -3n, ''],
      ['a', Kind.ANALYTICS_PARAM_KIND_STRING, 0n, 'x'],
    ]);
  });
});

describe('server event params', () => {
  it('turns a value into the kind and value field of its type', () => {
    expect([to_param('a', 7n), to_param('b', 7), to_param('c', 1.25), to_param('d', 'x'), to_param('e', false)].map((p) => [p.key, p.kind, p.int_value, p.double_value, p.string_value, p.bool_value])).toEqual([
      ['a', Kind.ANALYTICS_PARAM_KIND_INT, 7n, 0, '', false],
      ['b', Kind.ANALYTICS_PARAM_KIND_INT, 7n, 0, '', false],
      ['c', Kind.ANALYTICS_PARAM_KIND_DOUBLE, 0n, 1.25, '', false],
      ['d', Kind.ANALYTICS_PARAM_KIND_STRING, 0n, 0, 'x', false],
      ['e', Kind.ANALYTICS_PARAM_KIND_BOOL, 0n, 0, '', false],
    ]);
  });

  it('accepts a track event within the rules', () => {
    expect(server_event_problem('stage_end', [['stage', 3n], ['time', 1.5], ['boss', 'ogre']], LIMITS, false)).toBeNull();
    expect(server_event_problem('a', [], LIMITS, false)).toBeNull();
  });

  it('refuses track events that break a rule', () => {
    const broken: [string, readonly (readonly [string, bigint | number | string | boolean])[]][] = [
      ['core_user_created', [['provider', 'GUEST']]],
      ['StageClear', []],
      ['stage_clear_long', []],
      ['stage', [['Stage', 1n]]],
      ['stage', [['a', 1n], ['a', 2n]]],
      ['stage', [['a', 1n], ['b', 1n], ['c', 1n], ['d', 1n]]],
      ['stage', [['a', 'eleven char']]],
      ['stage', [['a', Number.NaN]]],
      ['stage', [['a', Number.NEGATIVE_INFINITY]]],
      ['stage', [['a', 2n ** 63n]]],
    ];
    for (const [name, params] of broken) expect(server_event_problem(name, params, LIMITS, false)).not.toBeNull();
  });

  it('accepts a core analytics event of the table and refuses other names and params', () => {
    const limits = { max_string_length: 40, max_event_params: 10 };
    expect(server_event_problem('core_shop_bought', [['product_id', 3], ['quantity', 2n]], limits, true)).toBeNull();
    expect(
      server_event_problem('core_iap_granted', [['product_id', 1], ['store', 'IAP_STORE_APPLE'], ['spend_amount', 1200n], ['test', false], ['renewal', true]], limits, true),
    ).toBeNull();
    expect(server_event_problem('core_unknown_event', [], limits, true)).not.toBeNull();
    expect(server_event_problem('stage_clear', [], limits, true)).not.toBeNull();
    expect(server_event_problem('core_shop_bought', [['product_id', 3]], limits, true)).not.toBeNull();
    expect(server_event_problem('core_shop_bought', [['product_id', 'x'], ['quantity', 2n]], limits, true)).not.toBeNull();
    expect(server_event_problem('core_shop_bought', [['product_id', 1.5], ['quantity', 2n]], limits, true)).not.toBeNull();
    expect(server_event_problem('core_shop_bought', [['product_id', 3], ['count', 2n]], limits, true)).not.toBeNull();
  });
});
