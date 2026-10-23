import { StartFailure, start_test_server } from '../../testing/dev/index.ts';
import { at, make_register, mission_row, M, new_hooks, new_slot, start, stop_all, test_settings } from './support.ts';

afterEach(stop_all);

describe('server start', () => {
  it('does not start and leaves an error log when a mission row has extra_grant true and content registered no grant_mission_extra', async () => {
    expect(mission_row(M.extra).extra_grant).toBe(true);
    const failure = await start_test_server(
      at(2026, 12, 2, 12), undefined, 'LOCAL', undefined, undefined, test_settings(), make_register(new_hooks(), new_slot(), false),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StartFailure);
    const { message, logs } = failure as StartFailure;
    expect(message).toContain('grant_mission_extra');
    expect(logs.some((line) => line.level === 'error' && typeof line.message === 'string' && line.message.includes(message))).toBe(true);
  });

  it('starts with grant_mission_extra registered', async () => {
    const s = await start();
    expect(s.server.port).toBeGreaterThan(0);
  });
});
