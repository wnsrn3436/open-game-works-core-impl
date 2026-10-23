/**
 * The entry of a peer process (`peer_process.ts`): `node peer_process_main.ts <config file>`. It starts the server
 * instance, waits for the job runs of its server start, sends its port over IPC, and stops on `SIGTERM` or when the
 * test process goes away.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { core_test_register_dev } from './runner_input.ts';
import { new_fake_adapter, type ServerInstance } from './server_binding.ts';
import { new_test_instance, wait_idle } from './test_server.ts';
import { TestClock } from './test_clock.ts';
import { wait_at_gate, type PeerConfig, type PeerContext, type PeerRegister } from './peer_process.ts';

const config = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as PeerConfig;

function send(message: unknown): void {
  process.send?.(message);
}

async function main(): Promise<void> {
  const maker = ((await import(pathToFileURL(config.register_module).href)) as Record<string, PeerRegister>)[config.register_name];
  if (typeof maker !== 'function') throw new Error(`${config.register_module} has no export ${config.register_name}`);
  let instance: ServerInstance | null = null;
  const peer: PeerContext = {
    wait: (name, note) => {
      wait_at_gate(config.folder, name, note);
    },
    modules: () => {
      if (instance === null) throw new Error('the peer server instance is not made yet');
      return instance.modules();
    },
  };
  const fake_adapters: Record<string, unknown> = {};
  for (const key of config.fake_keys) fake_adapters[key] = (await new_fake_adapter(key)).adapter;
  // The log lines of a peer process go nowhere: the test reads what its requests answer.
  const made = await new_test_instance({
    environment: 'LOCAL',
    matchmaker: false,
    db_argument: config.db_argument,
    secret_file: config.secret_file,
    server_modules: config.server_modules,
    data_folder: config.data_folder,
    settings: config.settings,
    overrides: config.overrides,
    key_sources: {},
    fake_adapters,
    register: maker(peer),
    registerDev: core_test_register_dev,
    clock: new TestClock(BigInt(config.start_at)),
    seed_of: () => null,
    log_writer: () => undefined,
  });
  instance = made;
  const started = await made.start();
  if (typeof started === 'string') throw new Error(started);
  await wait_idle(made, BigInt(config.background_wait_ms));
  const stop = (): void => {
    void made.stop().finally(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);
  send({ port: started });
}

main().catch((error: unknown) => {
  send({ error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
