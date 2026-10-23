/**
 * The entry of a migration process (`process.ts`). The first IPC message is the `ProcessConfig`; it starts the
 * instance and answers. Each later message is a `ProcessRequest`, answered with its value or its error.
 */
import type { QuestUserState } from '../../storage/tests/kinds.ts';
import { wait_at_gate } from '../../testing/dev/index.ts';
import type { Converter } from '../index.ts';
import { default_converters } from './contract.ts';
import { admin, next_step, server, TestClock, wait_background, type LogLine, type Server } from './helpers.ts';
import { item_gate, log_gate, type ProcessConfig, type ProcessRequest } from './process.ts';

function converters(config: ProcessConfig): Record<string, Converter> {
  const defaults = default_converters();
  const from_1 = defaults['QuestUserState:1'] as Converter;
  const from_2 = defaults['QuestUserState:2'] as Converter;
  return {
    'QuestUserState:1': (item, data) => {
      const id = (item as QuestUserState).id;
      if (config.gate_items.includes(id)) wait_at_gate(config.folder, item_gate(id));
      return from_1(item, data);
    },
    'QuestUserState:2': (item, data) => {
      if (config.broken_items.includes((item as QuestUserState).id)) throw new Error('converter bug');
      return from_2(item, data);
    },
  };
}

/** Starts the instance and waits until the `migration_batch` job run of its server start is over. */
async function start(config: ProcessConfig): Promise<Server> {
  const gated = new Set<string>();
  const s = await server({
    db: config.db,
    clock: new TestClock(config.start_at),
    settings: config.settings,
    converters: converters(config),
    on_log: (line: LogLine) => {
      const index = config.gate_logs.indexOf(String(line['message']));
      if (index < 0 || gated.has(line['message'] as string)) return;
      gated.add(line['message'] as string);
      wait_at_gate(config.folder, log_gate(index));
    },
  });
  await wait_background(s);
  return s;
}

let instance: Server | null = null;

async function answer(message: ProcessConfig | ProcessRequest): Promise<unknown> {
  if (instance === null) {
    instance = await start(message as ProcessConfig);
    return null;
  }
  const s = instance;
  const request = message as ProcessRequest;
  switch (request.op) {
    case 'step':
      await next_step(s, request.ms);
      return s.clock.now();
    case 'admin':
      return admin(s, request.name);
    case 'logs':
      return s.logs;
    case 'now':
      return s.clock.now();
  }
}

process.on('message', (envelope: { id: number; message: ProcessConfig | ProcessRequest }) => {
  answer(envelope.message).then(
    (value) => process.send?.({ id: envelope.id, value }),
    (error: unknown) => process.send?.({ id: envelope.id, error: error instanceof Error ? error.message : String(error) }),
  );
});
process.once('disconnect', () => {
  instance?.stop();
  process.exit(0);
});
