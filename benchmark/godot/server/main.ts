import type { StorageContent } from './core/storage/index.ts';
import type { RecordBenchTickHandler } from './generated/contract/game_contract.ts';
import { record_bench_tick } from './handlers/RecordBenchTick.ts';

/** The `core` object of `register`: the module objects this content uses. */
export interface RegisterCore {
  readonly routing: {
    register_handler(name: 'RecordBenchTick', handler: RecordBenchTickHandler): void;
  };
  readonly storage: StorageContent;
}

/** Registers the handler of every `service Game` `rpc`. The benchmark registers no hook. */
export function register(core: RegisterCore): void {
  core.routing.register_handler('RecordBenchTick', record_bench_tick(core.storage));
}
