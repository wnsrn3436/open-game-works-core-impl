/** `node bin/contract-tool.js --game <dir> [--engine <engine>] --base-proto <dir> --core-settings <file> [--modules <file>] [--previous <dir>]` */
import { runTool } from './run.ts';

const result = runTool(process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
