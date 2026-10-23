import * as GameContract from '../../../generated/contract/game_contract.ts';
import { ItemChangeResult, change_failure_code, content_change_source, has_core_once_key_prefix } from '../index.ts';
import { CoreError, request, Source, start, stop, user, type Env } from './helpers.ts';

let env: Env;

beforeAll(async () => {
  env = await start();
});

afterAll(() => {
  stop();
});

const GAME_ERROR = GameContract.GameError.GAME_ERROR_CORE_TEST;

describe('change_failure_code', () => {
  test('NOT_ENOUGH is ITEM_NOT_ENOUGH, LIMIT_EXCEEDED is ITEM_LIMIT_EXCEEDED, a GameError is itself and the rest is INTERNAL', () => {
    const cases = [
      [ItemChangeResult.NOT_ENOUGH, CoreError.CORE_ERROR_ITEM_NOT_ENOUGH],
      [ItemChangeResult.LIMIT_EXCEEDED, CoreError.CORE_ERROR_ITEM_LIMIT_EXCEEDED],
      [GAME_ERROR, GAME_ERROR],
      [ItemChangeResult.INVALID_AMOUNT, CoreError.CORE_ERROR_INTERNAL],
      [ItemChangeResult.UNKNOWN_ITEM, CoreError.CORE_ERROR_INTERNAL],
      [ItemChangeResult.UNSUPPORTED_ITEM, CoreError.CORE_ERROR_INTERNAL],
      [ItemChangeResult.ALREADY_APPLIED, CoreError.CORE_ERROR_INTERNAL],
      [ItemChangeResult.REJECTED, CoreError.CORE_ERROR_INTERNAL],
    ] as const;
    for (const [result, code] of cases) {
      expect(env.module.change_failure_code(result)).toBe(code);
      expect(change_failure_code(result)).toBe(code);
    }
  });
});

describe('module object', () => {
  test('has content_change_source, has_core_once_key_prefix and change_failure_code that behave like the exported functions', async () => {
    const { user_id } = await user(env);
    const r = await request(env, user_id, (ctx) => ({
      module_left_out: env.module.content_change_source(ctx),
      left_out: content_change_source(ctx, undefined),
      module_given: env.module.content_change_source(ctx, { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'r1', once_key: 'k1' }),
      given: content_change_source(ctx, { source: Source.ITEM_CHANGE_SOURCE_ADMIN, ref: 'r1', once_key: 'k1' }),
    }), 'core/TestSource');
    expect(r.out.module_left_out).toEqual({ source: Source.ITEM_CHANGE_SOURCE_REQUEST, ref: 'core/TestSource', once_key: '' });
    expect(r.out.left_out).toEqual(r.out.module_left_out);
    expect(r.out.module_given).toEqual({ source: Source.ITEM_CHANGE_SOURCE_REQUEST, ref: 'r1', once_key: 'k1' });
    expect(r.out.given).toEqual(r.out.module_given);
    for (const once_key of ['mail:1', 'shop:x', 'admin:', 'user:mail:1', 'mail', '']) {
      expect(env.module.has_core_once_key_prefix(once_key)).toBe(has_core_once_key_prefix(once_key));
    }
    expect(env.module.has_core_once_key_prefix('mail:1')).toBe(true);
    expect(env.module.has_core_once_key_prefix('user:mail:1')).toBe(false);
  });
});
