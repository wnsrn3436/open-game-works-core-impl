/**
 * Every server core setting of integer type at its schema `minimum`: a value the schema allows does not stop a server
 * from starting. `schedule_job` makes a period below 1 a server start failure, so a period key of minimum 0 fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { start_test_server, stop_test_server } from '../../testing/dev/index.ts';

const ROOT = new URL('../../../../', import.meta.url);

/**
 * The keys left at their default, each with the condition that makes its minimum stop a server. Every other server core
 * setting of integer type is at its minimum, so a new key whose minimum stops a server fails this test.
 */
const AT_DEFAULT: Readonly<Record<string, string>> = {
  // A condition with another core setting.
  'idempotency.responseRetentionMs': 'more than 2 x session.signatureWindowMs and more than NetworkCore.maxRetryAgeMs + NetworkCore.requestTimeoutMs',
  'mailbox.maxExpireMs': 'mailbox.defaultExpireMs or more',
  'push.leaseMs': 'more than push.retryMaxAttempts x (push.sendTimeoutMs + push.retryIntervalMs)',
  // A condition with a game settings value.
  'auth.childAgeYears': 'a value of consent.ageBandBoundaries',
  'auth.digitalConsentAgeYears': 'a value of consent.ageBandBoundaries',
  'auth.maxAgeYears': 'the largest value of consent.ageBandBoundaries or more',
  // A condition with the rows of the core test data.
  'mailbox.maxAttachments': 'the number of rewards of the ranking_reward and rating_tier rows or more',
  'matchmaker.maxPlayers': 'max_players of the match_mode rows or more',
  'remote-config.maxStringBytes': 'the bytes of the String default_value rows or more',
  // A start condition on the key alone that its schema minimum does not hold.
  'idempotency.maxNotifyIdBytes': 'ads-reward needs 36 or more, the bytes of a reward notify ID',
  'mailbox.defaultExpireMs': 'mailbox needs 1 or more',
  // A real time limit that a PostgreSQL connection and schema lock take longer than.
  'storage.dbAnswerWaitMs': 'the time limit of connecting to PostgreSQL at server start',
  'storage.schemaLockWaitMs': 'the time limit of the schema lock at server start, which the wait for a free connection takes from',
  // The test helper, not the server, reads it: the wait for the server start jobs of a test server.
  'testing.backgroundWaitTimeoutMs': 'more than the server start jobs of a test server take',
};

interface SpecFile {
  readonly side: string;
  readonly settings: readonly { readonly key: string; readonly type: string; readonly source: string }[];
}

function read_json(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
}

/** The keys of the `core` integer settings rows of the server module specs. */
function server_integer_keys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(new URL('core-spec/', ROOT))) {
    const spec = read_json(`core-spec/${file}`) as SpecFile;
    if (spec.side !== 'server') continue;
    for (const row of spec.settings) if (row.source === 'core' && (row.type === 'integer' || row.type === 'integer?')) keys.add(row.key);
  }
  return [...keys].sort();
}

const schema = (read_json('settings/core-settings.schema.json') as { properties: Readonly<Record<string, { readonly minimum?: number }>> }).properties;

describe('server core settings at their schema minimum', () => {
  it('has a schema minimum for every server core setting of integer type', () => {
    expect(server_integer_keys().filter((key) => schema[key]?.minimum === undefined)).toEqual([]);
    expect(server_integer_keys().length).toBeGreaterThan(0);
  });

  it('starts a server with every one of them at its minimum, matchmaker included', async () => {
    const settings: Record<string, number> = {};
    for (const key of server_integer_keys()) {
      const minimum = schema[key]?.minimum;
      if (minimum !== undefined && !(key in AT_DEFAULT)) settings[key] = minimum;
    }
    const server = await start_test_server(undefined, undefined, undefined, true, undefined, settings);
    await stop_test_server(server);
  }, 60_000);

  it('names only keys that are server core settings in the list of keys left at their default', () => {
    const keys = server_integer_keys();
    expect(Object.keys(AT_DEFAULT).filter((key) => !keys.includes(key))).toEqual([]);
  });
});
