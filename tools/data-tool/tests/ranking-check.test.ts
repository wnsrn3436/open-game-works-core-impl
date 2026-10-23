/**
 * The data check of `ranking` (`src/checks/ranking.ts`): each rule of its `## data` makes an ERROR line, so the
 * binary build fails and the server does not start with that data.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeCsv } from '../src/csv.ts';
import { fixture, lines, run, table } from './helpers.ts';

/** `open-game-works-core-impl/core-spec/`: the module objects `ogw core spec` wrote from the harness spec. */
const CORE_SPEC = resolve(import.meta.dirname, '..', '..', '..', 'core-spec');

interface SpecTable {
  name: string;
  columns: { name: string; type: string; target: string }[];
}

function spec(name: string): { tables: SpecTable[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(join(CORE_SPEC, `${name}.json`), 'utf8')) as { tables: SpecTable[] } & Record<string, unknown>;
}

const MODULES = ['ranking', 'server-time', 'live-event', 'mailbox', 'item-ledger'].map(spec);
const SPEC = { version: '1.0.0', modules: MODULES };

function header(name: string): string[] {
  const def = MODULES.flatMap((m) => m.tables).find((t) => t.name === name);
  if (def === undefined) throw new Error(`no table ${name} in core-spec`);
  return def.columns.map((c) => `${c.name}|${c.type}|${c.target}`);
}

const MAIL = '[mail_rank]';
const BOARD = (id: string, cycle: string, live: string, size: string, mail: string): string[] => [id, 'Board', 'Desc', 'Best', 'User', cycle, live, size, mail];

const BASE = {
  item: [['[gold]', 'Gold', 'Currency', '1000', 'Reject']],
  mail_template: [[MAIL, 'Reward', 'Rank {rank} of season {season}']],
  live_event: [['[weekend]', 'Weekend', '2026-01-03T00:00:00Z', '2026-01-05T00:00:00Z', 'null', 'null', 'false']],
  ranking_board: [BOARD('[daily]', 'Daily', 'null', '10', MAIL), BOARD('[plain]', 'null', 'null', '10', 'null'), BOARD('[event]', 'null', '[weekend]', '5', MAIL)],
  ranking_reward: [
    ['[daily]', '1', '1', '[gold] 100'],
    ['[daily]', '2', '10', '[gold] 10'],
  ],
};

type Tables = Partial<Record<keyof typeof BASE, string[][]>>;

function check(tables: Tables, settings: Record<string, unknown> = {}): ReturnType<typeof run> {
  const rows = { ...BASE, ...tables };
  const files: Record<string, string> = Object.fromEntries(Object.entries(rows).map(([name, r]) => [`data/tables/${name}.csv`, table(header(name), r)]));
  const named = [...rows.item, ...rows.live_event, ...rows.ranking_board].map((r) => [r[1] ?? '', r[0] ?? '', '', '']);
  files['data/glossary.csv'] = writeCsv([['source', 'id_name', 'note', 'source_hash'], ...named]);
  return run(fixture({ coreSpec: SPEC, modules: ['ranking'], files, settings: { sourceLanguage: 'en', supportedLanguages: ['en'], ...settings } }));
}

/** ERROR lines of a code, without the message. */
function errors(r: ReturnType<typeof run>, code: string): string[] {
  return lines(r, code)
    .filter((l) => l.split(' ')[1] === 'ERROR')
    .map((l) => l.split(' ')[0] ?? '');
}

describe('ranking data check', () => {
  test('data that keeps every rule has no ERROR line', () => {
    const r = check({});
    expect(r.stdout.filter((l) => l.includes(' ERROR '))).toEqual([]);
    expect(r.code).toBe(0);
  });

  test('a ranking_board size below 1 is out_of_range', () => {
    const r = check({ ranking_board: [...BASE.ranking_board, BOARD('[zero]', 'null', 'null', '0', 'null')] });
    expect(errors(r, 'out_of_range')).toEqual(['data/tables/ranking_board.csv:8:8']);
    expect(r.code).toBe(1);
  });

  test('a ranking_board row with both cycle and live_event is out_of_range', () => {
    const r = check({ ranking_board: [...BASE.ranking_board, BOARD('[both]', 'Weekly', '[weekend]', '5', 'null')] });
    expect(errors(r, 'out_of_range')).toEqual(['data/tables/ranking_board.csv:8:7']);
    expect(r.code).toBe(1);
  });

  test('a ranking_reward id that is not a ranking_board ID name is ref_missing', () => {
    const r = check({ ranking_reward: [...BASE.ranking_reward, ['[gold]', '1', '1', '[gold] 1']] });
    expect(errors(r, 'ref_missing')).toEqual(['data/tables/ranking_reward.csv:7:1']);
    expect(r.code).toBe(1);
  });

  test('a ranking_reward range outside 1 to the board size, or reversed, is out_of_range', () => {
    const r = check({
      ranking_reward: [
        ['[event]', '0', '1', '[gold] 1'],
        ['[event]', '3', '2', '[gold] 1'],
        ['[event]', '4', '6', '[gold] 1'],
      ],
    });
    expect(errors(r, 'out_of_range')).toEqual(['data/tables/ranking_reward.csv:5:2', 'data/tables/ranking_reward.csv:6:2', 'data/tables/ranking_reward.csv:7:2']);
    expect(r.code).toBe(1);
  });

  test('two ranges of one board that overlap are out_of_range', () => {
    const r = check({ ranking_reward: [...BASE.ranking_reward, ['[daily]', '10', '10', '[gold] 1']] });
    expect(errors(r, 'out_of_range')).toEqual(['data/tables/ranking_reward.csv:7:2']);
    expect(r.code).toBe(1);
  });

  test('a ranking_reward row of a board whose reward_mail is null is out_of_range', () => {
    const r = check({ ranking_reward: [...BASE.ranking_reward, ['[plain]', '1', '1', '[gold] 1']] });
    expect(errors(r, 'out_of_range')).toEqual(['data/tables/ranking_reward.csv:7:1']);
    expect(r.code).toBe(1);
  });

  test('a reward of more items than mailbox.maxAttachments is not a data check finding (server start checks it)', () => {
    const r = check({ ranking_reward: [['[daily]', '1', '1', '[gold] 1, [gold] 2, [gold] 3']] }, { core: { 'mailbox.maxAttachments': 2 } });
    expect(errors(r, 'out_of_range')).toEqual([]);
  });
});
