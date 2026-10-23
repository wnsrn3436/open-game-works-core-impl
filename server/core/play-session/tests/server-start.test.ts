import { CONTINUES, INSTANT, TIMED, default_modes, harness, opened, player, stop_all } from './helpers.ts';

afterEach(async () => {
  await stop_all();
});

// The `play_session_mode` rules (`max_duration` > 0, `min_duration` < `max_duration`, `max_continue_count` ≥ 0) are
// data checks: the data tool test `play-session-checks.test.ts` gives each rule its ERROR line.
describe('server start', () => {
  it('does not start without continue_play_session while a play_session_mode row has max_continue_count 1 or more', async () => {
    const failure = await harness({ continue: null }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('continue_play_session');
  });

  it('starts without continue_play_session when no play_session_mode row has continues', async () => {
    const modes = default_modes().map((row) => ({ ...row, max_continue_count: 0 }));
    const h = await harness({ continue: null }, undefined, modes);
    const s = await player(h);
    await opened(s, h.id(INSTANT));
  });

  it('starts with continue_play_session registered and without the other hooks', async () => {
    const h = await harness({ prepare: null, verify: null, apply: null });
    expect(CONTINUES).toBeGreaterThanOrEqual(1);
    const s = await player(h);
    const started = await opened(s, h.id(TIMED));
    // The prepare_play_session default: pass with empty bytes.
    expect(started.loadout.length).toBe(0);
  });
});
