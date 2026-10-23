import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { SAVE, delta_rows, dev_login, error_code, in_request, run_core_test, save, start, stop, stored, type Env } from './helpers.ts';

const INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;

/** The member `name` of a module object content `register(core)` got. */
function content_operation(object: unknown, name: string): unknown {
  return (object as Record<string, unknown>)[name];
}

describe('TutorialProgressUserState', () => {
  let env: Env;
  beforeEach(async () => {
    env = await start();
  });
  afterEach(async () => {
    await stop(env);
  });

  it('is in the full UserState of the DevLogin response', async () => {
    const session = await Testing.login(env.server, 'returning');
    expect(error_code((await Testing.send(session, SAVE, save(env.first, 3))).envelope)).toBe(0);
    expect(error_code((await Testing.send(session, SAVE, save(env.second, 1))).envelope)).toBe(0);

    const { envelope, response } = await Testing.send_cheat(session, 'core/cheat/DevLogin', dev_login('returning'));
    expect(error_code(envelope)).toBe(0);
    expect(response).toBeInstanceOf(CoreCheatContract.DevLoginResponse);
    expect(envelope.user_state?.full).toBe(true);
    const expected: [number, number][] = [
      [env.first, 3],
      [env.second, 1],
    ];
    expected.sort((a, b) => a[0] - b[0]);
    expect(delta_rows(envelope.user_state)).toEqual(expected);
  });

  it('rejects a direct write of a content handler in storage', async () => {
    const session = await Testing.login(env.server, 'content');
    expect(error_code((await Testing.send(session, SAVE, save(env.first, 1))).envelope)).toBe(0);
    const content_storage = env.storage;
    // Content register(core) gets no put_core_state or delete_core_state; a call of one ends the request with INTERNAL.
    const put_core_state = content_operation(env.core.storage, 'put_core_state');
    const delete_core_state = content_operation(env.core.storage, 'delete_core_state');
    expect(put_core_state).toBeUndefined();
    expect(delete_core_state).toBeUndefined();

    const row = new CoreContract.TutorialProgressUserState();
    row.id = BigInt(env.first);
    row.step = 3;
    const writes: ((ctx: RequestCtx) => void)[] = [
      (ctx) => {
        content_storage.put_state(ctx, row);
      },
      (ctx) => {
        content_storage.delete_state(ctx, CoreContract.TutorialProgressUserState, BigInt(env.first));
      },
      (ctx) => {
        (put_core_state as (ctx: RequestCtx, value: unknown) => void)(ctx, row);
      },
      (ctx) => {
        (delete_core_state as (ctx: RequestCtx, kind: unknown, item_id: bigint) => void)(ctx, CoreContract.TutorialProgressUserState, BigInt(env.first));
      },
    ];
    for (const write of writes) {
      const envelope = await run_core_test(env, session, write);
      expect(error_code(envelope)).toBe(INTERNAL);
      expect(delta_rows(envelope.user_state)).toEqual([]);
      expect(await stored(env, session.user_id)).toEqual([[env.first, 1]]);
    }
  });

  it('gives content register(core) only get_tutorial_step of tutorial', async () => {
    const session = await Testing.login(env.server, 'tutor');
    expect(error_code((await Testing.send(session, SAVE, save(env.first, 2))).envelope)).toBe(0);
    for (const name of ['SaveTutorialProgress', 'write_step', 'has_step', 'set_tutorial_step']) {
      expect(content_operation(env.core.tutorial, name)).toBeUndefined();
    }
    expect(await in_request(env, session, (ctx) => env.tutorial.get_tutorial_step(ctx, env.first))).toBe(2);

    // A content handler that calls write_step to lower, delete or raise the step past tutorial_step ends with INTERNAL.
    const write_step = content_operation(env.core.tutorial, 'write_step') as (ctx: RequestCtx, tutorial_id: number, step: number) => void;
    for (const step of [1, 0, 99]) {
      const envelope = await run_core_test(env, session, (ctx) => {
        write_step(ctx, env.first, step);
      });
      expect(error_code(envelope)).toBe(INTERNAL);
      expect(delta_rows(envelope.user_state)).toEqual([]);
      expect(await stored(env, session.user_id)).toEqual([[env.first, 2]]);
    }
  });

  it('set_tutorial_step lowers the step and deletes the row at 0', async () => {
    const session = await Testing.login(env.server, 'dev');
    expect(error_code((await Testing.send(session, SAVE, save(env.first, 3))).envelope)).toBe(0);

    await Testing.call_dev(env.server, 'tutorial', 'set_tutorial_step', [env.first, 1], session.user_id);
    expect(await stored(env, session.user_id)).toEqual([[env.first, 1]]);
    expect(await in_request(env, session, (ctx) => env.tutorial.get_tutorial_step(ctx, env.first))).toBe(1);

    // After lowering, a SaveTutorialProgress above the new step changes progress again.
    const raised = await Testing.send(session, SAVE, save(env.first, 2));
    expect(delta_rows(raised.envelope.user_state)).toEqual([[env.first, 2]]);

    await Testing.call_dev(env.server, 'tutorial', 'set_tutorial_step', [env.first, 0], session.user_id);
    expect(await stored(env, session.user_id)).toEqual([]);
    expect(await in_request(env, session, (ctx) => env.tutorial.get_tutorial_step(ctx, env.first))).toBe(0);

    // A step that is not 0 and not in tutorial_step throws and changes nothing.
    await expect(Testing.call_dev(env.server, 'tutorial', 'set_tutorial_step', [env.first, 4], session.user_id)).rejects.toThrow();
    await expect(Testing.call_dev(env.server, 'tutorial', 'set_tutorial_step', [env.first, -1], session.user_id)).rejects.toThrow();
    expect(await stored(env, session.user_id)).toEqual([]);
  });
});
