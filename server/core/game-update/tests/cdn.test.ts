import { admin, client_data_version, fake_cdn, FAKE_CDN, get, new_file, publish_body, put_calls, read_logs, served, start, upload, type TestServer } from './helpers.ts';

const BASE_URL = 'https://fake-cdn.example.com/updates/';

let server: TestServer;
let data_version: string;

beforeEach(async () => {
  data_version = client_data_version();
  server = await start({ settings: FAKE_CDN });
});

describe('cdn adapter', () => {
  it('counts as no adapter until the fake controller sets a base URL', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(200);
    expect(served(server)?.list.file_base_url).toBe('files/');
    expect(put_calls(server)).toEqual([]);
  });

  it('fails the publish with external_failed when put fails and keeps the current deploy list; on success file_base_url is the base URL', async () => {
    const fake = fake_cdn(server);
    const files = [new_file('item.bin')];
    await upload(server, files);
    await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    const before = served(server);
    fake.set_result('base_url', BASE_URL);
    fake.set_result('put', false);
    expect(await admin(server, 'publish_deploy_list', publish_body(data_version, files))).toEqual({ status: 502, body: { error: 'external_failed' } });
    expect(served(server)?.list.sequence).toBe(before?.list.sequence);
    expect(read_logs(server, 'error').some((line) => line.request === 'publish_deploy_list' && line.sha256 === files[0]?.sha256)).toBe(true);
    fake.set_result('put', true);
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(200);
    expect(served(server)?.list.file_base_url).toBe(BASE_URL);
    const put = fake.calls().find((call) => call.operation === 'put');
    expect(put?.input).toEqual({ sha256: files[0]?.sha256, bytes: files[0]?.bytes });
  });

  it('does not upload again the first file of a publish whose second upload failed', async () => {
    const fake = fake_cdn(server);
    fake.set_result('base_url', BASE_URL);
    const files = [new_file('first.bin'), new_file('second.bin')];
    await upload(server, files);
    // The fake's put result holds per operation, so it turns to failure when the first upload is recorded.
    const { storage } = server;
    const record = storage.run_game_transaction.bind(storage);
    storage.run_game_transaction = (fn) => {
      fake.set_result('put', false);
      storage.run_game_transaction = record;
      return record(fn);
    };
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(502);
    expect(put_calls(server)).toEqual([files[0]?.sha256, files[1]?.sha256]);
    fake.set_result('put', true);
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(200);
    expect(put_calls(server)).toEqual([files[0]?.sha256, files[1]?.sha256, files[1]?.sha256]);
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(200);
    expect(put_calls(server)).toHaveLength(3);
  });

  it('keeps the game_update_cdn_upload records on prune_update_files, so a pruned file uploaded again is not put again', async () => {
    const one = await start({ settings: { ...FAKE_CDN, 'game-update.keepDeployLists': 1 } });
    fake_cdn(one).set_result('base_url', BASE_URL);
    const [dropped, kept] = [new_file('dropped.bin'), new_file('kept.bin')];
    await upload(one, [dropped, kept]);
    expect((await admin(one, 'publish_deploy_list', publish_body(data_version, [dropped]))).status).toBe(200);
    expect((await admin(one, 'publish_deploy_list', publish_body(data_version, [kept]))).status).toBe(200);
    expect(put_calls(one)).toEqual([dropped.sha256, kept.sha256]);
    expect((await admin(one, 'prune_update_files')).body).toEqual({ deleted: 1 });
    expect(get(one, `/update/files/${dropped.sha256}`).status).toBe(404);
    await upload(one, [dropped]);
    expect((await admin(one, 'publish_deploy_list', publish_body(data_version, [dropped]))).status).toBe(200);
    expect(put_calls(one)).toEqual([dropped.sha256, kept.sha256]);
  });

  it('fails with external_failed when one upload passes game-update.cdnTimeoutMs', async () => {
    const quick = await start({ settings: { ...FAKE_CDN, 'game-update.cdnTimeoutMs': 50 } });
    const fake = fake_cdn(quick);
    fake.set_result('base_url', BASE_URL);
    fake.set_failure('put', 'timeout');
    const files = [new_file('item.bin')];
    await upload(quick, files);
    expect((await admin(quick, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(502);
    expect(served(quick)).toBeNull();
  });
});
