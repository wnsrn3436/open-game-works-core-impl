import * as GameDataDev from '../../../dev/generated/data/game_data_dev.ts';
import { admin, code, echo, game_register, login, logs, new_calls, send, start, stop, user_time, type TestServer } from './support.ts';

vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => (await import('./game_contract_mock.ts')).mock_game_contract(await import_original()));

/** How `live-event.on_request_start` (order 1 of the request start table) fails in these tests. */
type Failure = 'none' | 'throw' | 'reject';

const failure = globalThis as { routing_request_start_failure?: Failure };

// `live-event` whose `on_request_start` throws or returns a rejected promise as `routing_request_start_failure` says.
vi.mock('../../live-event/index.ts', async (import_original) => {
  const original = await import_original<typeof import('../../live-event/index.ts')>();
  return {
    ...original,
    create_live_event: (input: Parameters<typeof original.create_live_event>[0]) => {
      const module = original.create_live_event(input);
      const on_request_start = module.on_request_start.bind(module);
      return Object.assign(module, {
        on_request_start: (user_id: bigint): Promise<void> => {
          const mode = failure.routing_request_start_failure ?? 'none';
          if (mode === 'throw') throw new Error('live-event request start failure');
          if (mode === 'reject') return Promise.reject(new Error('live-event request start failure'));
          return on_request_start(user_id);
        },
      });
    },
  };
});

const servers: TestServer[] = [];
afterEach(async () => {
  failure.routing_request_start_failure = 'none';
  for (const server of servers.splice(0)) await stop(server);
});

describe('request start', () => {
  for (const mode of ['throw', 'reject'] as const) {
    it(`calls the next request start operations and the handler when one fails (${mode}), with an error log`, async () => {
      const calls = new_calls();
      const server = await start({ register: game_register(calls) });
      servers.push(server);
      const session = await login(server, `request_start_${mode}`);
      const now = await user_time(session);
      const mail = { template_id: GameDataDev.find_id_value('[mail_ad_reward_mail]'), args: [], attachments: [], extra_id: 0, expire_ms: 0, no_expiry: false, once_key: '' };
      expect((await admin(server, 'broadcast_mail', { operation_id: `routing-request-start-${mode}`, mail, start_at: now.toString() })).status).toBe(200);
      failure.routing_request_start_failure = mode;
      const sent = await send(session, 'Echo', echo());
      expect(code(sent)).toBe(0);
      expect(calls.echo).toBe(1);
      // mailbox.on_request_start (order 2) still ran: the broadcast mail is in this request's pending delta.
      expect(sent.envelope.pending_user_state?.entries.some((entry) => entry.kind === 'MailUserState')).toBe(true);
      expect(logs(server, 'error').filter((line) => line.message === 'on_request_start failed')).toHaveLength(1);
    });
  }
});
