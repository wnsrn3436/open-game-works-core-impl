import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { quest } from '../../storage/tests/kinds.ts';
import { PASS } from '../index.ts';
import { inRequest, newUser, savedState, startServer, stopAll, type Started } from './server.ts';

afterEach(() => {
  stopAll();
});

/**
 * `routing`'s processing of one request from its body: decode, field validation (`INVALID_REQUEST` on failure,
 * with the DEV `detail` `<field path>: <rule>`), then the handler in the request transaction.
 */
async function send(started: Started, userId: bigint, name: string, body: Uint8Array, handler: (ctx: RequestCtx) => void): Promise<{ code: number; detail: string }> {
  const rpc = CoreContract.RPCS.find((r) => r.name === name);
  if (rpc === undefined) throw new Error(`no rpc ${name}`);
  const message = rpc.request_class.decode(body);
  if (message === null) throw new Error('decode failed');
  return inRequest(started, userId, (ctx) => {
    const result = started.validation.validate_request(name, message);
    if (result !== PASS) return { code: CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST, detail: `${result.path}: ${result.rule}` };
    handler(ctx);
    return { code: 0, detail: '' };
  }, name);
}

describe('field validation of a request', () => {
  it('fails a request whose validator fails before its handler runs, and the saved state stays as it was', async () => {
    const started = await startServer();
    const user = await newUser(started);
    const calls: string[] = [];
    const handler = (ctx: RequestCtx): void => {
      calls.push('handler');
      started.storage.put_state(ctx, quest(1n, 1n));
    };
    const before = savedState(started, user);
    const bad = Object.assign(new CoreContract.ConfirmAgeRequest(), { birth_year_month: 999913 }).encode();
    expect(await send(started, user, 'core/ConfirmAge', bad, handler)).toEqual({ code: CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST, detail: 'birth_year_month: max' });
    expect(calls).toEqual([]);
    expect(savedState(started, user)).toEqual(before);
    const good = Object.assign(new CoreContract.ConfirmAgeRequest(), { birth_year_month: 200001 }).encode();
    expect(await send(started, user, 'core/ConfirmAge', good, handler)).toEqual({ code: 0, detail: '' });
    expect(calls).toEqual(['handler']);
    expect(savedState(started, user)).not.toEqual(before);
  });
});
