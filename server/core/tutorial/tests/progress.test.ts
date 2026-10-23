import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as Testing from '../../testing/dev/index.ts';
import { SAVE, delta_rows, error_code, in_request, run_core_test, save, start, stop, stored, type Env } from './helpers.ts';

const INVALID_REQUEST = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
const INTERNAL = CoreContract.CoreError.CORE_ERROR_INTERNAL;

describe('SaveTutorialProgress', () => {
  let env: Env;
  beforeEach(async () => {
    env = await start();
  });
  afterEach(async () => {
    await stop(env);
  });

  it('writes the TutorialProgressUserState row and puts the changed row in the response delta', async () => {
    const session = await Testing.login(env.server, 'writer');
    const { envelope, response } = await Testing.send(session, SAVE, save(env.first, 2));
    expect(error_code(envelope)).toBe(0);
    expect(response).toBeInstanceOf(CoreContract.SaveTutorialProgressResponse);
    expect(await stored(env, session.user_id)).toEqual([[env.first, 2]]);
    expect(delta_rows(envelope.user_state)).toEqual([[env.first, 2]]);

    const next = await Testing.send(session, SAVE, save(env.second, 1));
    expect(error_code(next.envelope)).toBe(0);
    const both: [number, number][] = [
      [env.first, 2],
      [env.second, 1],
    ];
    both.sort((a, b) => a[0] - b[0]);
    expect(await stored(env, session.user_id)).toEqual(both);
    expect(delta_rows(next.envelope.user_state)).toEqual([[env.second, 1]]);

    const later = await Testing.send(session, SAVE, save(env.first, 3));
    expect(error_code(later.envelope)).toBe(0);
    expect(delta_rows(later.envelope.user_state)).toEqual([[env.first, 3]]);
    expect(await in_request(env, session, (ctx) => env.tutorial.get_tutorial_step(ctx, env.first))).toBe(3);
  });

  it('succeeds without changing the row or the delta for a step smaller than or equal to the stored one', async () => {
    const session = await Testing.login(env.server, 'repeat');
    expect(error_code((await Testing.send(session, SAVE, save(env.first, 2))).envelope)).toBe(0);

    for (const step of [2, 1]) {
      const { envelope, response } = await Testing.send(session, SAVE, save(env.first, step));
      expect(error_code(envelope)).toBe(0);
      expect(response).toBeInstanceOf(CoreContract.SaveTutorialProgressResponse);
      expect(delta_rows(envelope.user_state)).toEqual([]);
      expect(await stored(env, session.user_id)).toEqual([[env.first, 2]]);
    }
  });

  it('answers INVALID_REQUEST without changing the row for a step not in tutorial_step and a tutorial_id not in tutorial', async () => {
    const session = await Testing.login(env.server, 'invalid');
    expect(error_code((await Testing.send(session, SAVE, save(env.first, 1))).envelope)).toBe(0);

    const missing_tutorial = Math.max(env.first, env.second) + 1000;
    const cases: [number, number][] = [
      [env.first, 4], // [tutorial_first] has steps 1 to 3
      [env.second, 3], // [tutorial_second] has steps 1 and 2
      [missing_tutorial, 1],
      [env.first, 0],
      [env.first, -1],
    ];
    for (const [tutorial_id, step] of cases) {
      const { envelope, response } = await Testing.send(session, SAVE, save(tutorial_id, step));
      expect(error_code(envelope)).toBe(INVALID_REQUEST);
      expect(response).toBeNull();
      expect(delta_rows(envelope.user_state)).toEqual([]);
      expect(await stored(env, session.user_id)).toEqual([[env.first, 1]]);
    }
  });

  it('leaves a warn core log for a (tutorial_id, step) not in tutorial_step', async () => {
    const session = await Testing.login(env.server, 'warned');
    const { envelope } = await Testing.send(session, SAVE, save(env.first, 4));
    expect(error_code(envelope)).toBe(INVALID_REQUEST);
    const lines = Testing.read_logs(env.server, 'core', 'warn').filter((line: Record<string, unknown>) => line.module === 'tutorial');
    expect(lines).toHaveLength(1);
    const [line] = lines;
    if (line === undefined) throw new Error('no tutorial warn line');
    expect(line).toMatchObject({ level: 'warn', kind: 'core', request: SAVE, tutorial_id: env.first, step: 4 });
    expect(String(line.user_id)).toBe(String(session.user_id));
  });

  it('answers a request sent again with the same request ID with the first response except server_time_at', async () => {
    const session = await Testing.login(env.server, 'replay');
    const request_id = '6f1f6d3e-8f0a-4c3b-9a55-2d9a3b7e1c01';
    const first = await Testing.send(session, SAVE, save(env.first, 2), request_id);
    expect(error_code(first.envelope)).toBe(0);
    Testing.advance_time(env.server, 1000n);
    const again = await Testing.send(session, SAVE, save(env.first, 2), request_id);

    const without_time = (envelope: CoreContract.ResponseEnvelope): Uint8Array => {
      const copy = CoreContract.ResponseEnvelope.decode(envelope.encode());
      if (copy === null) throw new Error('undecodable ResponseEnvelope');
      copy.server_time_at = 0n;
      return copy.encode();
    };
    expect(without_time(again.envelope)).toEqual(without_time(first.envelope));
    expect(delta_rows(again.envelope.user_state)).toEqual([[env.first, 2]]);
    expect(await stored(env, session.user_id)).toEqual([[env.first, 2]]);
  });

  it('get_tutorial_step answers 0 without a row and throws for a negative or non-integer tutorial ID value', async () => {
    const session = await Testing.login(env.server, 'reader');
    expect(await in_request(env, session, (ctx) => env.tutorial.get_tutorial_step(ctx, env.second))).toBe(0);
    for (const tutorial_id of [-1, 1.5]) {
      const envelope = await run_core_test(env, session, (ctx) => {
        env.tutorial.get_tutorial_step(ctx, tutorial_id);
      });
      expect(error_code(envelope)).toBe(INTERNAL);
    }
  });
});
