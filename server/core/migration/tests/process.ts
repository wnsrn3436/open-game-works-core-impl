/**
 * A test instance of `migration` (`helpers.ts` `server`) in a process of its own on a test DB, driven over IPC. Its
 * converter from version 1 can wait at gate `item-<item ID>`, and a log line with a given message can wait at gate
 * `log-<n>` for the n-th gated message, so a test can hold one step at a chosen point while the test process and the
 * other processes go on. Two instances in the test process share its thread, so one cannot wait while another runs.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gates_of, type Gates } from '../../testing/dev/index.ts';
import type { AdminFailure } from '../index.ts';
import type { DbTarget, LogLine } from './helpers.ts';

/** What the child process makes its instance with. */
export interface ProcessConfig {
  readonly db: DbTarget;
  readonly start_at: bigint;
  readonly settings: Readonly<Record<string, unknown>>;
  /** Item IDs whose conversion from version 1 waits at gate `item-<item ID>`. */
  readonly gate_items: readonly bigint[];
  /** Item IDs whose conversion from version 2 throws. */
  readonly broken_items: readonly bigint[];
  /** Log messages that wait at gate `log-<message index>` the first time the instance writes them. */
  readonly gate_logs: readonly string[];
  readonly folder: string;
}

export type ProcessRequest =
  | { readonly op: 'step'; readonly ms: bigint }
  | { readonly op: 'admin'; readonly name: 'start_migration_batch' | 'get_migration_batch' | 'stop_migration_batch' }
  | { readonly op: 'logs' }
  | { readonly op: 'now' };

export interface MigrationProcess extends Gates {
  /** Moves the instance's clock and waits for the job it starts (`helpers.ts` `next_step`). Resolves with the clock time. */
  step(ms: bigint): Promise<bigint>;
  admin(name: 'start_migration_batch' | 'get_migration_batch' | 'stop_migration_batch'): Promise<Record<string, unknown> | AdminFailure>;
  logs(): Promise<LogLine[]>;
  now(): Promise<bigint>;
  stop(): Promise<void>;
}

const ENTRY = fileURLToPath(new URL('./process_main.ts', import.meta.url));

const running = new Set<MigrationProcess>();

/** The gate of the conversion from version 1 of an item. */
export function item_gate(item_id: bigint): string {
  return `item-${String(item_id)}`;
}

/** The gate of the first log line with message `gate_logs[index]`. */
export function log_gate(index: number): string {
  return `log-${String(index)}`;
}

/** Starts an instance in a child process; it is ready, and its first `migration_batch` job run is over, when this resolves. */
export async function start_process(options: Omit<ProcessConfig, 'folder' | 'gate_items' | 'broken_items' | 'gate_logs'> & Partial<Pick<ProcessConfig, 'gate_items' | 'broken_items' | 'gate_logs'>>): Promise<MigrationProcess> {
  const folder = mkdtempSync(join(tmpdir(), 'ogw-migration-process-'));
  const config: ProcessConfig = { gate_items: [], broken_items: [], gate_logs: [], ...options, folder };
  const child: ChildProcess = fork(ENTRY, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let exited = false;
  let next_id = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  child.on('message', (message: { id: number; value?: unknown; error?: string }) => {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error !== undefined) waiter?.reject(new Error(message.error));
    else waiter?.resolve(message.value);
  });
  child.once('exit', (code) => {
    exited = true;
    for (const waiter of pending.values()) waiter.reject(new Error(`the migration process exited with ${String(code)}`));
    pending.clear();
  });
  const call = (message: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (exited) {
        reject(new Error('the migration process has exited'));
        return;
      }
      const id = next_id;
      next_id += 1;
      pending.set(id, { resolve, reject });
      child.send({ id, message });
    });
  const stop = async (): Promise<void> => {
    running.delete(handle);
    if (!exited) {
      const gone = new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill();
      await gone;
    }
    rmSync(folder, { recursive: true, force: true });
  };
  const handle: MigrationProcess = {
    ...gates_of(folder, () => !exited, 'the migration process'),
    step: (ms) => call({ op: 'step', ms } satisfies ProcessRequest) as Promise<bigint>,
    admin: (name) => call({ op: 'admin', name } satisfies ProcessRequest) as Promise<Record<string, unknown> | AdminFailure>,
    logs: () => call({ op: 'logs' } satisfies ProcessRequest) as Promise<LogLine[]>,
    now: () => call({ op: 'now' } satisfies ProcessRequest) as Promise<bigint>,
    stop,
  };
  running.add(handle);
  try {
    await call(config);
  } catch (error) {
    await stop();
    throw error;
  }
  return handle;
}

/** Stops every migration process still running; a test file calls it after each test. */
export async function stop_processes(): Promise<void> {
  await Promise.all([...running].map((p) => p.stop()));
}
