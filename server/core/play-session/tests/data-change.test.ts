import { CoreError, INSTANT, TIMED, data_with_modes, default_modes, finish, harness, opened, player, restart_with_data, stop_all } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

describe('a play session of a mode that left the data', () => {
  it('answers PLAY_SESSION_NOT_FOUND without a hook after a restart without the mode row, and the next StartPlaySession replaces the row', async () => {
    const modes = default_modes();
    const h = await harness({}, undefined, modes);
    const timed = h.id(TIMED);
    const s = await player(h);
    const old = await opened(s, timed);

    await restart_with_data(h, data_with_modes(modes.filter((row) => row.id !== timed)));
    const before = h.calls.length;
    expect((await finish(s, old.play_session_id)).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    expect(h.calls.length).toBe(before);
    const next = await opened(s, h.id(INSTANT));

    await restart_with_data(h, data_with_modes(modes));
    expect((await finish(s, old.play_session_id)).code).toBe(CoreError.CORE_ERROR_PLAY_SESSION_NOT_FOUND);
    expect((await finish(s, next.play_session_id)).code).toBe(0);
    expect(h.calls.filter((c) => c.hook === 'apply_play_session').length).toBe(1);
  });
});
