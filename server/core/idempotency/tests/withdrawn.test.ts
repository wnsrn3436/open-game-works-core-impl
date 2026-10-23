import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { BUMP, WITHDRAW, bump, calls, decode, new_user, rows, send, server, stop_all, token_hash, without_time, withdraw, RETENTION_MS, START_AT } from './helpers.ts';

const RESPONSE_ROWS = 'SELECT request_id FROM idempotency_response WHERE user_id = $1';
const WITHDRAWN_ROWS = 'SELECT request_name, created_at, expires_at FROM idempotency_withdrawn_response WHERE token_hash = $1 AND request_id = $2';

afterEach(() => {
  stop_all();
  calls.clear();
});

describe('withdrawn response', () => {
  it('leaves no idempotency_response row of the user after Withdraw and one idempotency_withdrawn_response row of the token hash and request ID', async () => {
    const s = await server();
    const user = await new_user(s);
    await send(s, user, BUMP, 'req-a', bump(s));
    expect(rows(s, RESPONSE_ROWS, [user]).length).toBe(1);
    const response = await send(s, user, WITHDRAW, 'req-w', withdraw(s), 'token-w');
    expect(response.error).toBeNull();
    expect(rows(s, RESPONSE_ROWS, [user])).toEqual([]);
    expect(rows(s, WITHDRAWN_ROWS, [token_hash('token-w'), 'req-w'])).toEqual([{ request_name: WITHDRAW, created_at: START_AT, expires_at: START_AT + RETENTION_MS }]);
    // The same access token and request ID get the Withdraw response again without the handler.
    s.clock.advance(5n);
    const again = await send(s, user, WITHDRAW, 'req-w', withdraw(s), 'token-w');
    expect(calls.get(WITHDRAW)).toBe(1);
    expect(again.server_time_at).toBe(START_AT + 5n);
    expect(without_time(again)).toEqual(without_time(response));
  });

  it('find_withdrawn_response replays a committed row with server_time_at changed, NAME_MISMATCH for another name, none for no row and for an expired row', async () => {
    const s = await server();
    const user = await new_user(s);
    const response = await send(s, user, WITHDRAW, 'req-w', withdraw(s), 'token-w');
    const db = s.storage.read_db();
    const hash = token_hash('token-w');
    const found = s.idempotency.find_withdrawn_response(db, hash, 'req-w', WITHDRAW, 4_242n);
    expect(found).toBeInstanceOf(Uint8Array);
    const envelope = decode(found as Uint8Array);
    expect(envelope.server_time_at).toBe(4_242n);
    expect(without_time(envelope)).toEqual(without_time(response));
    expect(s.idempotency.find_withdrawn_response(db, hash, 'req-w', 'core/ConfirmAge', 4_242n)).toBe('NAME_MISMATCH');
    expect(s.idempotency.find_withdrawn_response(db, hash, 'req-other', WITHDRAW, 4_242n)).toBeNull();
    expect(s.idempotency.find_withdrawn_response(db, token_hash('token-other'), 'req-w', WITHDRAW, 4_242n)).toBeNull();
    expect(s.idempotency.find_withdrawn_response(db, hash, 'req-w', WITHDRAW, START_AT + RETENTION_MS - 1n)).toBeInstanceOf(Uint8Array);
    expect(s.idempotency.find_withdrawn_response(db, hash, 'req-w', WITHDRAW, START_AT + RETENTION_MS)).toBeNull();
  });

  it('save_withdrawn_response of a ctx whose user_deleted is false writes no row', async () => {
    const s = await server();
    const user = await new_user(s);
    const envelope = new CoreContract.ResponseEnvelope();
    envelope.server_time_at = START_AT;
    const fields = { request_name: WITHDRAW, request_id: 'req-w', silent: false, retry: false, session_id: '', client_version: '', platform: '' };
    const deleted = await s.storage.run_request_transaction(user, fields, (ctx) => {
      s.idempotency.save_withdrawn_response(ctx, token_hash('token-w'), envelope.encode());
      return ctx.user_deleted;
    });
    expect(deleted).toBe(false);
    expect(rows(s, 'SELECT request_id FROM idempotency_withdrawn_response', [])).toEqual([]);
  });

  it('does not save the response of a request that deleted its user in idempotency_response', async () => {
    const s = await server();
    const user = await new_user(s);
    await send(s, user, WITHDRAW, 'req-w', withdraw(s), 'token-w');
    expect(rows(s, 'SELECT request_id FROM idempotency_response', [])).toEqual([]);
  });
});
