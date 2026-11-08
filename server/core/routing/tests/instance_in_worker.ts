/**
 * A worker thread of `front-link.test.ts`: makes a server instance with `create_server` without a front link in this
 * thread, starts it, and posts the output of `start()`. A `stop` message stops it, then the thread ends.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { core_test_register, core_test_server_paths } from '../../testing/dev/index.ts';
import { create_server } from '../index.ts';

const input = workerData as { db: string; secret_file: string };
const paths = core_test_server_paths();
const instance = create_server({
  args: { env: 'LOCAL', port: 0, db: input.db, secret_file: input.secret_file },
  server_modules: paths.server_modules,
  data_folder: paths.data_folder,
  core_settings: paths.settings,
  game_settings: {},
  register: core_test_register,
  dev: true,
  log_writer: () => undefined,
});
const started = await instance.start();
parentPort?.postMessage({ started });
parentPort?.once('message', () => {
  void instance.stop().then(() => {
    parentPort?.close();
  });
});
