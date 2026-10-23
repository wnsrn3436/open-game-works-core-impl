/** `node bin/data-tool.js --game <dir> ...` (`data` tool.md `## CLI`). */
import { runDataTool } from './run.ts';

const result = runDataTool(process.argv.slice(2));
for (const line of result.stdout) process.stdout.write(`${line}\n`);
for (const line of result.stderr) process.stderr.write(`${line}\n`);
process.exitCode = result.code;
