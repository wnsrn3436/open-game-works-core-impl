/**
 * The settings check of `create_server` (`### server start`): the settings values against the settings schema
 * `server/generated/core_settings_schema.json`, before any `create_<module>`.
 */
import { core_test_server_paths } from '../../testing/dev/index.ts';
import { create_server } from '../index.ts';
import { check_settings, read_settings_schema, type SettingsSchema } from '../settings_check.ts';
import { accepts, free_port } from './process_support.ts';

const run_paths = core_test_server_paths();

interface Made {
  readonly lines: Record<string, unknown>[];
  readonly reason: number | string;
  readonly modules: number;
  readonly dev_throws: boolean;
  readonly listened: boolean;
}

/** A server instance of the core test settings with `overrides` (and without the keys of `left_out`), started. */
async function make(overrides: Record<string, unknown>, left_out: readonly string[] = []): Promise<Made> {
  const settings = Object.fromEntries(Object.entries(run_paths.settings).filter(([key]) => !left_out.includes(key)));
  const lines: string[] = [];
  const port = await free_port();
  const instance = create_server({
    args: { env: 'LOCAL', port, db: ':memory:', secret_file: '/no/such/secret/file' },
    server_modules: run_paths.server_modules,
    data_folder: run_paths.data_folder,
    core_settings: settings,
    game_settings: {},
    register: () => undefined,
    dev: true,
    settings_overrides: overrides,
    log_writer: (line) => lines.push(line),
  });
  let dev_throws = false;
  try {
    instance.dev?.('server-time', 'set_clock', [{}]);
  } catch {
    dev_throws = true;
  }
  const reason = await instance.start();
  const listened = await accepts(port);
  const result = { lines: lines.map((line) => JSON.parse(line) as Record<string, unknown>), reason, modules: instance.modules().size, dev_throws, listened };
  await instance.stop();
  return result;
}

function expect_failure(made: Made, key: string, keyword: string, value_text: string | null): void {
  expect(typeof made.reason).toBe('string');
  expect(made.reason as string).toContain(key);
  expect(made.modules).toBe(0);
  expect(made.dev_throws).toBe(true);
  expect(made.listened).toBe(false);
  expect(made.lines).toHaveLength(1);
  const line = made.lines[0] as Record<string, unknown>;
  expect(line).toMatchObject({ level: 'error', kind: 'error' });
  const text = JSON.stringify(line);
  expect(text).toContain(key);
  expect(text).toContain(keyword);
  if (value_text !== null) expect(text).not.toContain(value_text);
}

describe('settings check of create_server', () => {
  it('fails a value below the minimum of its property, given as an override, with one error log line that names the key and minimum and not the value', async () => {
    expect_failure(await make({ 'routing.requestWorkers': -73 }), 'routing.requestWorkers', 'minimum', '-73');
  });

  it('fails a key that is not a property of the settings schema', async () => {
    expect_failure(await make({ 'routing.noSuchSetting': 4242 }), 'routing.noSuchSetting', 'additionalProperties', '4242');
  });

  it('fails a property in required that has no value', async () => {
    expect_failure(await make({}, ['routing.maxBodyBytes']), 'routing.maxBodyBytes', 'required', null);
  });

  it('fails a value of another type, and checks an override key with <ENV> against the DEV property of that path', async () => {
    expect_failure(await make({ 'routing.maxBodyBytes': 'many-bytes' }), 'routing.maxBodyBytes', 'type', 'many-bytes');
    expect_failure(await make({ 'environments.<ENV>.trustedProxyCount': 'two-proxies' }), 'environments.<ENV>.trustedProxyCount', 'type', 'two-proxies');
  });

  it('names every key that failed in the one log line', async () => {
    const made = await make({ 'routing.requestWorkers': 0, 'routing.opsReportIntervalMs': 0 });
    expect(made.lines).toHaveLength(1);
    expect(made.reason as string).toContain('routing.requestWorkers');
    expect(made.reason as string).toContain('routing.opsReportIntervalMs');
  });

  it('passes the core test settings with an <ENV> override of the type of its DEV property', () => {
    const schema = read_settings_schema();
    if (typeof schema === 'string') throw new Error(schema);
    expect(check_settings(schema, run_paths.settings, { 'environments.<ENV>.trustedProxyCount': 2 })).toEqual([]);
  });
});

describe('check_settings', () => {
  const schema: SettingsSchema = {
    properties: {
      a: { type: 'integer', minimum: 1, maximum: 9 },
      b: { type: 'number', exclusiveMinimum: 0 },
      c: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1 },
      d: { type: ['string', 'null'] },
      'environments.DEV.e': { type: 'object' },
    },
    required: ['a', 'b'],
  };

  it('gives each key that fails with the keyword it breaks, in byte order of key', () => {
    expect(check_settings(schema, { a: 10, b: 0, c: [], d: 3 }, { x: 1, 'environments.<ENV>.e': [] })).toEqual([
      { key: 'a', keyword: 'maximum' },
      { key: 'b', keyword: 'exclusiveMinimum' },
      { key: 'c', keyword: 'minItems' },
      { key: 'd', keyword: 'type' },
      { key: 'environments.<ENV>.e', keyword: 'type' },
      { key: 'x', keyword: 'additionalProperties' },
    ]);
    expect(check_settings(schema, { a: 1.5, b: 1, c: [-1] }, null)).toEqual([
      { key: 'a', keyword: 'type' },
      { key: 'c', keyword: 'items' },
    ]);
    expect(check_settings(schema, { b: 1 }, null)).toEqual([{ key: 'a', keyword: 'required' }]);
  });

  it('does not check the other keywords of the settings schema (enum, maxItems, uniqueItems, contains, nested properties)', () => {
    const others = {
      properties: {
        f: { type: 'string', enum: ['x'] },
        g: { type: 'array', maxItems: 1, uniqueItems: true, contains: { const: 9 } },
        h: { type: 'object', properties: { k: { type: 'integer' } }, required: ['k'], additionalProperties: false },
      },
      required: [],
    } as unknown as SettingsSchema;
    expect(check_settings(others, { f: 'y', g: [1, 1], h: { k: 'text', z: 1 } }, null)).toEqual([]);
  });

  it('passes values of their property, a null of a type with null, and an <ENV> override of its DEV property', () => {
    expect(check_settings(schema, { a: 1, b: 0.5, c: [0, 3], d: null }, { 'environments.<ENV>.e': { k: 1 } })).toEqual([]);
  });
});
