import { admin, client_data_version, new_file, other_protocol, peer, publish_body, set_time, start, START_AT, upload, type TestServer } from './helpers.ts';

const MAX_AGE_MS = 60_000n;
const REFRESH_MS = 30_000n;
const READY_AT = START_AT + MAX_AGE_MS + REFRESH_MS;

let server: TestServer;
let data_version: string;

beforeEach(async () => {
  data_version = client_data_version();
  server = await start({ settings: { 'game-update.deployListMaxAgeMs': Number(MAX_AGE_MS), 'game-update.cacheRefreshMs': Number(REFRESH_MS) } });
});

async function publish(version: string, data: string): Promise<void> {
  const files = [new_file('item.bin')];
  await upload(server, files);
  expect((await admin(server, 'publish_deploy_list', publish_body(data, files, version))).status).toBe(200);
}

describe('is_data_update_ready', () => {
  it('is false before a publish and at published_at + deployListMaxAgeMs + cacheRefreshMs - 1, true from then', async () => {
    set_time(server, READY_AT);
    expect(server.game_update.is_data_update_ready('1.0.0')).toBe(false);
    set_time(server, START_AT);
    await publish('1.0.0', data_version);
    set_time(server, READY_AT - 1n);
    expect(server.game_update.is_data_update_ready('1.0.0')).toBe(false);
    set_time(server, READY_AT);
    expect(server.game_update.is_data_update_ready('1.0.0')).toBe(true);
  });

  it('is false for an app version without a patch entry', async () => {
    await publish('1.0.0', data_version);
    set_time(server, READY_AT);
    expect(server.game_update.is_data_update_ready('2.0.0')).toBe(false);
    expect(server.game_update.is_data_update_ready('not a version')).toBe(false);
  });

  it('is false for an entry whose data_version is neither client_data_version nor compat_client_data_version', async () => {
    const compat = other_protocol(data_version);
    const compat_server = await start({ compat, settings: { 'game-update.deployListMaxAgeMs': Number(MAX_AGE_MS), 'game-update.cacheRefreshMs': Number(REFRESH_MS) } });
    const files = [new_file('item.bin')];
    await upload(compat_server, files);
    expect((await admin(compat_server, 'publish_deploy_list', publish_body(compat, files, '1.0.0'))).status).toBe(200);
    set_time(compat_server, READY_AT);
    expect(compat_server.game_update.is_data_update_ready('1.0.0')).toBe(true);
    // The same deploy list on a server instance whose server build data has no compat_client_data_version.
    expect(peer(compat_server, null).game_update.is_data_update_ready('1.0.0')).toBe(false);
  });
});
