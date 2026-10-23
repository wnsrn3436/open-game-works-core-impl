import { create_cheat } from '../dev/index.ts';
import { content_rpc, server, start_server, stop_all } from './support.ts';

afterEach(stop_all);

const GRANT = content_rpc('Grant');
const RESET = content_rpc('Reset');
const ok = () => new GRANT.response_class();

describe('server start', () => {
  it('does not start when a service Cheat rpc has no cheat handler', async () => {
    const failure = await start_server({
      rpcs: [GRANT, RESET],
      register_dev: (core) => {
        core.cheat.register_cheat_handler('Grant', ok);
      },
    });
    expect(failure).toEqual(expect.stringContaining('Reset'));
  });

  it('does not start for an unknown cheat name, a second registration or a handler that is not a function', async () => {
    const cases: [string, unknown][][] = [
      [['Grant', ok], ['Nothing', ok]],
      [['Grant', ok], ['SetTimeOffset', ok]],
      [['Grant', ok], ['Grant', ok]],
      [['Grant', 'not a function']],
    ];
    for (const registrations of cases) {
      const failure = await start_server({
        rpcs: [GRANT],
        register_dev: (core) => {
          for (const [name, handler] of registrations) core.cheat.register_cheat_handler(name, handler as typeof ok);
        },
      });
      expect(typeof failure).toBe('string');
    }
  });

  it('starts with every service Cheat rpc handled, lists the cheats and refuses a registration after registerDev', async () => {
    const s = await server({
      rpcs: [GRANT, RESET],
      register_dev: (core) => {
        core.cheat.register_cheat_handler('Reset', ok);
        core.cheat.register_cheat_handler('Grant', ok);
      },
    });
    const cheat = s.cheat;
    expect(cheat.list_cheat_handlers().map((e) => [e.name, e.request_name, e.core, e.rpc.name])).toEqual([
      ['SetTimeOffset', 'core/cheat/SetTimeOffset', true, 'core/cheat/SetTimeOffset'],
      ['SetUserState', 'core/cheat/SetUserState', true, 'core/cheat/SetUserState'],
      ['DeleteUserState', 'core/cheat/DeleteUserState', true, 'core/cheat/DeleteUserState'],
      ['Grant', 'cheat/Grant', false, 'cheat/Grant'],
      ['Reset', 'cheat/Reset', false, 'cheat/Reset'],
    ]);
    expect(() => {
      cheat.register_cheat_handler('Grant', ok);
    }).toThrow();
  });

  it('starts with the generated contract, which has no service Cheat rpc in the core test data', async () => {
    const s = await server();
    const cheat = create_cheat({ settings: {}, modules: { storage: s.storage, 'server-time': s.time } });
    expect(cheat.complete_start()).toBeNull();
    expect(cheat.list_cheat_handlers().every((e) => e.core)).toBe(true);
  });

  it('throws when modules has no storage or server-time', async () => {
    const s = await server();
    expect(() => create_cheat({ settings: {}, modules: { storage: s.storage } })).toThrow(/server-time/);
    expect(() => create_cheat({ settings: {}, modules: { 'server-time': s.time } })).toThrow(/storage/);
  });
});
