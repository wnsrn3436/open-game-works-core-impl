import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { call_dev, login, read_user_state, send, start_test_server, stop_test_server } from '../dev/index.ts';
import { error_code, gold_id, gold_of, set_gold } from './helpers.ts';

describe('call_dev', () => {
  it('throws for an operation outside the testing DEV operation table', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'outside');
      await expect(call_dev(server, 'item-ledger', 'add_items', [], session.user_id)).rejects.toThrow();
      await expect(call_dev(server, 'server-time', 'set_clock', [])).rejects.toThrow();
      await expect(call_dev(server, 'storage', 'set_seed_provider', [])).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  });

  it('set_balance with a user ID commits; its failure value comes back with the state unchanged; a withdrawn user throws', async () => {
    const server = await start_test_server();
    try {
      const session = await login(server, 'balance');
      const ok = await set_gold(server, session.user_id, 123n);
      expect(await gold_of(server, session.user_id)).toBe(123n);
      const before = await read_user_state(server, session.user_id);
      expect(ok).toBe('OK');
      const failure = await call_dev(server, 'item-ledger', 'set_balance', [gold_id() + 100_000, 5n], session.user_id);
      expect(failure).toBe('UNKNOWN_ITEM');
      expect(await read_user_state(server, session.user_id)).toEqual(before);
      expect(error_code(await send(session, 'core/Withdraw', new CoreContract.WithdrawRequest()))).toBe(0);
      await expect(set_gold(server, session.user_id, 1n)).rejects.toThrow();
    } finally {
      await stop_test_server(server);
    }
  });
});
