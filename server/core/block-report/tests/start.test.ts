import { login, StartFailure } from '../../testing/dev/index.ts';
import { block_user, start, stop_all } from './kit.ts';

afterEach(async () => {
  await stop_all();
});

describe('register_block_listener', () => {
  it('fails server start with an error log when the same function is registered twice', async () => {
    const listener = (): void => {};
    const failure: unknown = await start({ listeners: [listener, listener] }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(StartFailure);
    const { message, logs } = failure as StartFailure;
    expect(message).toMatch(/register_block_listener got the same function twice/);
    // block-report's own error log line; routing logs the start failure reason as another line.
    const errors = logs.filter((line) => line.kind === 'error' && line.level === 'error' && line.message === 'register_block_listener got the same function twice');
    expect(errors).toHaveLength(1);
  });

  it('throws for a function given after server start and does not register it', async () => {
    const instance = await start();
    const calls: bigint[] = [];
    expect(() =>
      instance.block.register_block_listener((_ctx, blocker) => {
        calls.push(blocker);
      }),
    ).toThrow();
    const alice = await login(instance.server, 'alice');
    const bob = await login(instance.server, 'bob');
    expect((await block_user(alice, bob.user_id)).code).toBeNull();
    expect(calls).toEqual([]);
  });
});
