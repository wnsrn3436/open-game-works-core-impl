import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `server/core/` of this checkout. */
const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLOCK_FILE = 'server-time/adapters/system_clock.ts';
const TIMER_FILES = ['server-time/scheduler.ts', 'server-time/network_time_limit.ts'];

// A member reference counts as a read too: `const read = Date.now; read();` reads the system clock.
const CLOCK_READS: readonly RegExp[] = [
  /\bDate\s*\.\s*now\b/,
  /\bDate\s*\[\s*['"`]now['"`]\s*\]/,
  /\bnew\s+Date\s*\(\s*\)/,
  /(?<!\bnew\s+)(?<![\w.$])Date\s*\(/,
  /\bperformance\s*\.\s*now\b/,
  /\bperformance\s*\[\s*['"`]now['"`]\s*\]/,
  /\bperformance\.timeOrigin\b/,
  /\bprocess\.hrtime\b/,
  /\bprocess\.uptime\b/,
  /\{[^}]*\bnow\b[^}]*\}\s*=\s*(globalThis\.)?(Date|performance)\b/,
];
const TIMER_USES: readonly RegExp[] = [
  /(?<![\w.$])(globalThis\.)?setTimeout\s*\(/,
  /(?<![\w.$])(globalThis\.)?setInterval\s*\(/,
  /\bAbortSignal\.timeout\s*\(/,
  /\bfrom\s+['"](node:)?timers(\/promises)?['"]/,
  /\bimport\s*\(\s*['"](node:)?timers(\/promises)?['"]\s*\)/,
];

/** Core code files below `server/core/`: TypeScript outside the modules' `tests/`. */
function core_files(): string[] {
  return readdirSync(CORE, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|mts|cts)$/.test(entry.name))
    .map((entry) => relative(CORE, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((path) => path.split('/')[1] !== 'tests');
}

function without_comments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function findings(path: string, text: string): string[] {
  const code = without_comments(text);
  const out: string[] = [];
  if (path !== CLOCK_FILE) for (const pattern of CLOCK_READS) if (pattern.test(code)) out.push(`${path}: system clock ${String(pattern)}`);
  if (!TIMER_FILES.includes(path)) for (const pattern of TIMER_USES) if (pattern.test(code)) out.push(`${path}: timer ${String(pattern)}`);
  return out;
}

describe('core code static check', () => {
  it('finds the system clock reads and timer uses it looks for', () => {
    for (const text of ['Date.now()', 'const d = new Date();', 'String(Date())', 'performance.now()', 'performance.timeOrigin', 'process.hrtime.bigint()', 'process.uptime()']) {
      expect(findings('m/x.ts', text)).toHaveLength(1);
    }
    // A reference to the clock read without a call at the reference.
    for (const text of [
      'const read = Date.now; read();',
      'function f(now = Date.now) { return now(); }',
      "const read = Date['now'];",
      'const read = performance.now.bind(performance);',
      'const { now } = performance;',
      'const { now: read } = Date;',
      'const up = process.uptime;',
    ]) {
      expect(findings('m/x.ts', text), text).not.toEqual([]);
    }
    for (const text of ['setTimeout(f, 1)', 'globalThis.setInterval(f, 1)', 'AbortSignal.timeout(5)', "import { setTimeout } from 'node:timers/promises';"]) {
      expect(findings('m/x.ts', text)).toHaveLength(1);
    }
    expect(findings('m/x.ts', 'new Date(0); // Date.now()\n/* setTimeout() */')).toEqual([]);
    expect(findings(CLOCK_FILE, 'Date.now()')).toEqual([]);
    expect(findings('server-time/scheduler.ts', 'setTimeout(f, 1)')).toEqual([]);
  });

  it('reads the system clock only in the clock adapter', () => {
    const files = core_files();
    expect(files).toContain(CLOCK_FILE);
    const out = files.flatMap((path) => findings(path, readFileSync(join(CORE, path), 'utf8')).filter((f) => f.includes('system clock')));
    expect(out).toEqual([]);
  });

  it('uses timers only in schedule_job, sleep and network_time_limit', () => {
    const files = core_files();
    for (const file of TIMER_FILES) expect(files).toContain(file);
    const out = files.flatMap((path) => findings(path, readFileSync(join(CORE, path), 'utf8')).filter((f) => f.includes('timer')));
    expect(out).toEqual([]);
  });
});
