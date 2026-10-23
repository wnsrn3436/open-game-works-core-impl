import { login } from '../../testing/dev/index.ts';
import { block_user, start, stop_all } from './kit.ts';

afterEach(async () => {
  await stop_all();
});

describe('register_block_listener', () => {
  it('fails server start when the same function is registered twice', async () => {
    const listener = (): void => {};
    await expect(start({ listeners: [listener, listener] })).rejects.toThrow();
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
