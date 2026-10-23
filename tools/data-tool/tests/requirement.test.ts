/** Requirement expressions: rows, names, pre-order numbering and the build target of each row. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import protobuf from 'protobufjs';
import { describe, expect, test } from 'vitest';
import { parseRequirement, rowKeyPart } from '../src/requirement.ts';
import { enums, fixture, run, table, type Fixture } from './helpers.ts';

const TYPES = 'element,target,value,#comment\nLevel,none,true,\nCleared,ref<quest.id>,false,\nCycle,enum<Reset>,false,\n';

function game(files: Record<string, string>): Fixture {
  return fixture({
    files: {
      'data/tables/quest.csv': table(['id|id(key)|All'], [['[q1]'], ['[q2]']]),
      'data/enums.csv': enums([['RequirementType', 'Level', 1], ['RequirementType', 'Cleared', 2], ['RequirementType', 'Cycle', 3], ['Reset', 'Daily', 1], ['Reset', 'WeekEnd', 2]]),
      'data/requirement_types.csv': TYPES,
      ...files,
    },
  });
}

/** ID names of the `requirement` rows in the server table binary. */
function serverRows(f: Fixture): { name: string; row: Record<string, unknown> }[] {
  const root = new protobuf.Root();
  root.resolvePath = (_o: string, t: string) => (t === 'ogw/core.proto' ? join(f.baseProto, 'ogw', 'core.proto') : t);
  root.loadSync(join(f.game, 'server', 'generated', 'data', 'game_data.proto'), { keepCase: true });
  const type = root.lookupType('ogw.data.RequirementTable');
  const bytes = readFileSync(join(f.game, 'server', 'build', 'data', 'requirement.bin'));
  const rows = (type.toObject(type.decode(bytes), { longs: String, defaults: true }) as { rows: Record<string, unknown>[] }).rows;
  const names = new Map(Object.entries(JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>).map(([k, v]) => [v, k]));
  return rows.map((row) => ({ name: names.get(row.id as number) ?? '', row }));
}

describe('requirement expression', () => {
  test('parsing: & and | in parentheses, one operator per parenthesis, single parentheses unwrap', () => {
    expect(parseRequirement('Level(1)')).toEqual({ ok: true, node: { kind: 'cond', type: 'Level', args: ['1'] } });
    expect(parseRequirement(' ( Level(1) ) ')).toEqual({ ok: true, node: { kind: 'cond', type: 'Level', args: ['1'] } });
    const p = parseRequirement('Level(1) | (Cleared([q1]) & Cycle(Daily))');
    expect(p.ok && p.node.kind === 'group' && p.node.logic).toBe('Any');
    expect(parseRequirement('Level(1) & Level(2) | Level(3)').ok).toBe(false);
    expect(parseRequirement('Level(1) Level(2)').ok).toBe(false);
    expect(parseRequirement('level(1)').ok).toBe(false);
  });

  test('row key parts: ID name inner, negative integer as n, enum element as snake_case', () => {
    expect(rowKeyPart('id', '[hero_a]')).toBe('hero_a');
    expect(rowKeyPart('int', '-12')).toBe('n12');
    expect(rowKeyPart('enum', 'WeekEnd')).toBe('week_end');
  });

  test('rows are named by table, column, row key and pre-order number, with targets and values', () => {
    const f = game({
      'data/tables/event.csv': table(['id|id|All', 'day|int|All', 'reset|enum<Reset>|All', 'open|requirement<id,day,reset>|Server'], [
        ['[e]', '-3', 'WeekEnd', '(Level(5) | Cleared([q2])) & Cycle(WeekEnd)'],
      ]),
    });
    expect(run(f).code).toBe(0);
    const rows = serverRows(f);
    expect(rows.map((r) => r.name)).toEqual([
      '[req__event__open__e__n3__week_end__1]', '[req__event__open__e__n3__week_end__2]', '[req__event__open__e__n3__week_end__3]',
      '[req__event__open__e__n3__week_end__4]', '[req__event__open__e__n3__week_end__5]',
    ]);
    const ids = JSON.parse(readFileSync(f.registry, 'utf8')) as Record<string, number>;
    const [top, any, level, cleared, cycle] = rows.map((r) => r.row);
    expect(top).toMatchObject({ type: 0, logic: 1, children: [ids['[req__event__open__e__n3__week_end__2]'], ids['[req__event__open__e__n3__week_end__5]']] });
    expect(any).toMatchObject({ type: 0, logic: 2 });
    expect(level).toMatchObject({ type: 1, target_id: 0, value: '5', logic: 0, children: [] });
    expect(cleared).toMatchObject({ type: 2, target_id: ids['[q2]'], value: '0' });
    expect(cycle).toMatchObject({ type: 3, target_id: 2 });
  });

  test('a row is in a build target when its cell, a cell that names it, or a parent row is', () => {
    const f = game({
      'data/tables/door.csv': table(['id|id(key)|All', 'client_rule|requirement|Client', 'server_rule|requirement|Server', 'pointer|string|Server'], [
        ['[d1]', 'Level(1) & Level(2)', 'Level(3)', ''],
        ['[d2]', 'Level(4)', '', 'see [req__door__client_rule__d2__1]'],
      ]),
      'data/system/game_setting.csv': table(['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'], [['[gate]', 'Client', 'requirement', 'Level(9)']]),
    });
    expect(run(f).code).toBe(0);
    expect(serverRows(f).map((r) => r.name).sort()).toEqual(['[req__door__client_rule__d2__1]', '[req__door__server_rule__d1__1]']);
  });

  test('every row of an expression is in the build targets of its top row: a Server cell names the top of a Client expression', () => {
    const f = game({
      'data/tables/door.csv': table(['id|id(key)|All', 'client_rule|requirement|Client', 'pointer|string|Server'], [
        ['[d1]', 'Level(1) & (Level(2) | Level(3))', 'see [req__door__client_rule__d1__1]'],
        ['[d2]', 'Level(4) & Level(5)', ''],
      ]),
    });
    expect(run(f).code).toBe(0);
    expect(serverRows(f).map((r) => r.name).sort()).toEqual([
      '[req__door__client_rule__d1__1]', '[req__door__client_rule__d1__2]', '[req__door__client_rule__d1__3]',
      '[req__door__client_rule__d1__4]', '[req__door__client_rule__d1__5]',
    ]);
  });

  test('the value cell of game_setting and reserved_id names a row with the target of its row, not of the value column', () => {
    const f = game({
      'data/tables/door.csv': table(['id|id(key)|All', 'client_rule|requirement|Client'], [['[d1]', 'Level(1)'], ['[d2]', 'Level(2)'], ['[d3]', 'Level(3)']]),
      'data/system/reserved_id.csv': table(['id|id(key)|All', 'target|string|None', 'value|string|All'], [
        ['[client_gate]', 'Client', '[req__door__client_rule__d1__1]'], ['[server_gate]', 'Server', '[req__door__client_rule__d2__1]'],
      ]),
      'data/system/game_setting.csv': table(['id|id(key)|All', 'target|string|None', 'data_type|string|None', 'value|string|All'], [
        ['[client_note]', 'Client', 'string', 'see [req__door__client_rule__d1__1]'], ['[server_note]', 'Server', 'string', 'see [req__door__client_rule__d3__1]'],
      ]),
    });
    expect(run(f).code).toBe(0);
    expect(serverRows(f).map((r) => r.name).sort()).toEqual(['[req__door__client_rule__d2__1]', '[req__door__client_rule__d3__1]']);
  });
});
