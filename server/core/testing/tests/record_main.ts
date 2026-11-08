/**
 * A process that appends test record lines (`test-record.test.ts`): `node record_main.ts <tag> <count> <name length>`
 * appends `<count>` `admin` lines whose operation is `<tag>` and that many `n` characters, as a test worker does.
 */
import { record } from '../dev/test_record.ts';

const [tag = '', count = '0', length = '0'] = process.argv.slice(2);
for (let i = 0; i < Number(count); i += 1) record({ kind: 'admin', operation: `${tag}${'n'.repeat(Number(length))}`, status: 200 });
