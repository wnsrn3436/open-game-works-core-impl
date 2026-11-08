/**
 * A worker thread of the server process (`### server process` of `routing`): it reads the game `server/` folder
 * itself, makes one worker instance with `create_server` and the front link of this thread, and runs `start()` on it.
 * The control messages with the front go on `parentPort`; the requests go on the message port of the front link.
 */
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import type { ServerArgs } from './context.ts';
import { read_content, read_process_files } from './process_input.ts';
import { create_server, type ServerInstance } from './server.ts';

/** The data the front gives a worker thread. */
export interface WorkerInput {
  readonly args: ServerArgs;
  readonly front_port: MessagePort;
  readonly db_wait: Int32Array;
}

/** A control message of a worker thread to the front. */
export type WorkerControl = { readonly t: 'started' } | { readonly t: 'failed'; readonly reason: string };

const control = parentPort;
if (control === null) throw new Error('routing: worker_main.ts runs only in a worker thread');
const input = workerData as WorkerInput;
let instance: ServerInstance | null = null;
let stopping: Promise<void> | null = null;

/** Stops the server instance, then lets the thread end: no port keeps it alive. */
function stop(): Promise<void> {
  stopping ??= (async () => {
    try {
      await instance?.stop();
    } finally {
      input.front_port.close();
      control?.off('message', on_control);
      control?.unref();
    }
  })();
  return stopping;
}

function on_control(message: { t: string }): void {
  if (message.t === 'stop') void stop();
}

control.on('message', on_control);

async function run(): Promise<WorkerControl> {
  let made: ServerInstance;
  try {
    const files = read_process_files();
    const content = await read_content(files.dev);
    made = create_server({
      args: input.args,
      server_modules: files.server_modules,
      data_folder: files.data_folder,
      core_settings: files.settings,
      game_settings: {},
      register: content.register,
      dev: files.dev,
      register_dev: content.register_dev,
      front: { port: input.front_port, db_wait: input.db_wait },
    });
  } catch (error) {
    return { t: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  instance = made;
  if (stopping !== null) return { t: 'failed', reason: 'the server process stopped during server start' };
  const started = await made.start();
  return typeof started === 'string' ? { t: 'failed', reason: started } : { t: 'started' };
}

void run().then((result) => {
  control.postMessage(result);
  if (result.t === 'failed') void stop();
});
