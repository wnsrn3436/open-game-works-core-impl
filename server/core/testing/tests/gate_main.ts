/**
 * A process that waits at gates (`peer-process.test.ts`): `node gate_main.ts <folder> <note length> <gate>...`. At each
 * gate it waits with a note of that many `n` characters, as a peer process's hook does.
 */
import { wait_at_gate } from '../dev/index.ts';

const [folder = '', length = '0', ...gates] = process.argv.slice(2);
for (const gate of gates) wait_at_gate(folder, gate, 'n'.repeat(Number(length)));
