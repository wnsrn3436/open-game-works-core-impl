import { below_min_version, DeployListCache } from '../cache.ts';
import { deploy_list_bytes, parse_deploy_list_input } from '../deploy_list.ts';
import { DEPLOY_LIST_TABLE } from '../store.ts';
import type { StoredDeployList } from '../store.ts';
import { compareVersions, parseVersion } from '../../validation/helper.ts';
import { admin, advance_time, client_data_version, new_file, peer, publish_body, read_logs, start, START_AT, upload, wait_background, type TestServer } from './helpers.ts';

const REFRESH_MS = 30_000n;

/** A publish body whose `app` entry of android has `min_version`. */
function body(data_version: string, files: Parameters<typeof publish_body>[1], min_version: string): Record<string, unknown> {
  const out = publish_body(data_version, files, '2.0.0');
  return { ...out, app: { android: { min_version, recommended_version: '2.0.0', store_url: 'https://play.example.com/app' } } };
}

async function publish(server: TestServer, min_version: string): Promise<void> {
  const files = [new_file('item.bin')];
  await upload(server, files);
  expect((await admin(server, 'publish_deploy_list', body(client_data_version(), files, min_version))).status).toBe(200);
}

describe('is_below_min_version', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await start({ settings: { 'game-update.cacheRefreshMs': Number(REFRESH_MS) } });
  });

  it('is false without a current deploy list', () => {
    expect(server.game_update.is_below_min_version('0.0.1', 'android')).toBe(false);
  });

  it('is true only below min_version of the app entry of that platform, by version order', async () => {
    await publish(server, '1.2.0');
    expect(server.game_update.is_below_min_version('1.1.9', 'android')).toBe(true);
    expect(server.game_update.is_below_min_version('0.9.99', 'android')).toBe(true);
    expect(server.game_update.is_below_min_version('1.2.0', 'android')).toBe(false);
    // 1.10.0 is above 1.2.0 by integer comparison, not by text order.
    expect(server.game_update.is_below_min_version('1.10.0', 'android')).toBe(false);
    // A platform without an app entry.
    expect(server.game_update.is_below_min_version('1.1.9', 'ios')).toBe(false);
    expect(server.game_update.is_below_min_version('1.1.9', '')).toBe(false);
  });

  it('is false for an app version that validation.parse_version does not read, the empty one included', async () => {
    await publish(server, '1.2.0');
    for (const version of ['', '1.1', '1.1.9.0', '01.1.9', 'v1.1.9', ' 1.1.9']) {
      expect(server.game_update.is_below_min_version(version, 'android')).toBe(false);
    }
  });

  it('is true on another server instance within game-update.cacheRefreshMs after it publishes a higher min_version', async () => {
    const other = peer(server);
    await publish(server, '1.0.0');
    expect(other.game_update.is_below_min_version('1.1.9', 'android')).toBe(false);
    await publish(other, '1.2.0');
    // The publishing instance has the new deploy list right after commit.
    await wait_background(other);
    expect(other.game_update.is_below_min_version('1.1.9', 'android')).toBe(true);
    expect(server.game_update.is_below_min_version('1.1.9', 'android')).toBe(false);
    advance_time(server, REFRESH_MS);
    await wait_background(server);
    expect(server.game_update.is_below_min_version('1.1.9', 'android')).toBe(true);
  });

  it('is false with an error log when the deploy list read throws', async () => {
    await server.storage.run_game_transaction((tx) =>
      server.storage.db(tx).query(`INSERT INTO ${DEPLOY_LIST_TABLE} (sequence, deploy_list, signature, published_at) VALUES ($1, $2, $3, $4)`, [START_AT, new Uint8Array(Buffer.from('not json')), '{}', START_AT]),
    );
    const other = peer(server);
    await wait_background(other);
    const before = read_logs(other, 'error').length;
    expect(other.game_update.is_below_min_version('1.1.9', 'android')).toBe(false);
    const errors = read_logs(other, 'error').slice(before);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.message)).toContain('is_below_min_version');
  });
});

describe('minimum app version decision', () => {
  // The operations validation.parse_version and validation.compare_versions are.
  const validation = { parse_version: parseVersion, compare_versions: compareVersions };

  function row(app: Record<string, unknown>): StoredDeployList {
    const input = parse_deploy_list_input({ app, patches: {} });
    const deploy_list = deploy_list_bytes(input, { environment: 'LOCAL', sequence: 1n, published_at: 1n, file_base_url: 'files/' });
    return { sequence: 1n, deploy_list, signature: '{}', published_at: 1n };
  }

  it('reads min_version per platform from the cached deploy list', () => {
    const entry = (min_version: string) => ({ min_version, recommended_version: '9.0.0', store_url: 'https://store.example.com/app' });
    const cache = new DeployListCache(() => row({ android: entry('1.2.0'), ios: entry('2.0.0') }));
    expect(below_min_version(cache.current(), '1.5.0', 'android', validation)).toBe(false);
    expect(below_min_version(cache.current(), '1.5.0', 'ios', validation)).toBe(true);
    expect(below_min_version(cache.current(), '1.5.0', 'web', validation)).toBe(false);
    expect(below_min_version(null, '1.5.0', 'ios', validation)).toBe(false);
  });
});
