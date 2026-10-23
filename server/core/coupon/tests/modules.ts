/**
 * `coupon` with its dependency closure (`server-time`, `storage`, `logging`, `item-ledger`, `mailbox`) made directly
 * in dependency order, for the items that read coupon's own tables through `storage`.
 */
import type * as GameData from '../../../generated/data/game_data.ts';
import { create_item_ledger } from '../../item-ledger/index.ts';
import { create_logging } from '../../logging/index.ts';
import { create_mailbox } from '../../mailbox/index.ts';
import { create_server_time, type ServerTime } from '../../server-time/index.ts';
import { create_server_time_dev } from '../../server-time/dev/index.ts';
import { create_storage, type Storage } from '../../storage/index.ts';
import { TestClock, core_settings, new_db, test_server, type DbTarget } from '../../storage/tests/helpers.ts';
import { create_coupon, type CouponModule } from '../index.ts';

export { TestClock };

export interface StartOptions {
  /** Another server instance on this database. */
  readonly db?: DbTarget;
  /** The server build data in place of the core test data's. */
  readonly data?: GameData.DataSet;
}

interface Lifecycle {
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
}

export interface Modules {
  readonly db: DbTarget;
  readonly clock: TestClock;
  readonly time: ServerTime;
  readonly storage: Storage;
  readonly coupon: CouponModule;
  readonly log_lines: string[];
  stop(): void;
}

/** Starts the modules on a new DB of the run's DB kind, or returns the server start failure reason. */
export async function start_modules(start_at: bigint, settings: Readonly<Record<string, unknown>> = {}, options: StartOptions = {}): Promise<Modules | string> {
  const target = options.db ?? (await new_db());
  const merged = { ...core_settings(), ...settings };
  const clock = new TestClock(start_at);
  const time = create_server_time({ settings: { ...merged, dailyResetOffsetMs: 0 }, modules: {} });
  create_server_time_dev(time).set_clock(clock);
  const log_lines: string[] = [];
  const base_server = test_server(target, {
    server_modules: ['coupon', 'item-ledger', 'logging', 'mailbox', 'server-time', 'storage'],
    write_log_line: (line: string) => {
      log_lines.push(line);
    },
  });
  const server = options.data === undefined ? base_server : { ...base_server, data: options.data };
  const storage = create_storage({ settings: merged, modules: { 'server-time': time }, server });
  const base = { storage, 'server-time': time };
  const logging = create_logging({ settings: merged, modules: base, server });
  const item_ledger = create_item_ledger({ settings: merged, modules: { ...base, logging }, server });
  const mailbox = create_mailbox({ settings: merged, modules: { ...base, logging, 'item-ledger': item_ledger }, server });
  const coupon = create_coupon({ settings: merged, modules: { ...base, logging, 'item-ledger': item_ledger, mailbox }, server });
  const modules: Lifecycle[] = [time, storage, logging, item_ledger, mailbox, coupon];
  for (const module of modules) module.begin_start();
  let failure: string | null = null;
  for (const module of modules) {
    failure = module.complete_start();
    if (failure !== null) break;
  }
  const stop = (): void => {
    for (const module of [...modules].reverse()) module.stop();
  };
  if (failure !== null) {
    stop();
    return failure;
  }
  // Server start ends: every job runs once.
  time.end_start();
  return { db: target, clock, time, storage, coupon, log_lines, stop };
}
