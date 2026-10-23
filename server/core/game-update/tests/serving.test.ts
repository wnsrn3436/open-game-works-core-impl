import {
  admin,
  advance_time,
  client_data_version,
  get,
  new_file,
  peer,
  publish_body,
  served,
  start,
  stop,
  upload,
  wait_background,
  type TestServer,
} from './helpers.ts';

let data_version: string;

beforeAll(() => {
  data_version = client_data_version();
});

describe('serving without a cdn adapter', () => {
  it('has file_base_url files/ and serves the uploaded bytes at /update/files/<sha256>', async () => {
    const server = await start();
    try {
      const files = [new_file('item.bin', 300)];
      await upload(server, files);
      await admin(server, 'publish_deploy_list', publish_body(data_version, files));
      expect(served(server)?.list.file_base_url).toBe('files/');
      const file = get(server, `/update/files/${files[0]?.sha256 ?? ''}`);
      expect(file.status).toBe(200);
      expect(Buffer.from(file.body).equals(Buffer.from(files[0]?.bytes ?? []))).toBe(true);
      expect(file.headers['content-type']).toBe('application/octet-stream');
    } finally {
      stop(server);
    }
  });

  it('answers HTTP 404 with no body for no deploy list, a missing file and a sha256 that is not 64 lowercase hex', async () => {
    const server = await start();
    try {
      for (const path of ['/update/deploy_list.json', '/update/deploy_list.json.sig', `/update/files/${'a'.repeat(64)}`, `/update/files/${'A'.repeat(64)}`, '/update/files/abc']) {
        const answer = get(server, path);
        expect(answer.status).toBe(404);
        expect(answer.body.byteLength).toBe(0);
      }
    } finally {
      stop(server);
    }
  });
});

describe('Cache-Control', () => {
  it('is max-age of the settings ms divided by 1000, immutable for files', async () => {
    const server = await start({ settings: { 'game-update.deployListMaxAgeMs': 45_999, 'game-update.fileMaxAgeMs': 86_400_500 } });
    try {
      const files = [new_file('item.bin')];
      await upload(server, files);
      await admin(server, 'publish_deploy_list', publish_body(data_version, files));
      expect(get(server, '/update/deploy_list.json').headers['cache-control']).toBe('public, max-age=45');
      expect(get(server, '/update/deploy_list.json.sig').headers['cache-control']).toBe('public, max-age=45');
      expect(get(server, `/update/files/${files[0]?.sha256 ?? ''}`).headers['cache-control']).toBe('public, max-age=86400, immutable');
    } finally {
      stop(server);
    }
  });
});

describe('cache', () => {
  it('serves a deploy list another server instance published within game-update.cacheRefreshMs', async () => {
    const server: TestServer = await start({ settings: { 'game-update.cacheRefreshMs': 30_000 } });
    const other = peer(server);
    try {
      const files = [new_file('item.bin')];
      await upload(server, files);
      await admin(server, 'publish_deploy_list', publish_body(data_version, files));
      served(other);
      await admin(other, 'publish_deploy_list', publish_body(data_version, files));
      const published = served(other)?.list.sequence;
      expect(served(server)?.list.sequence).not.toBe(published);
      advance_time(server, 30_000n);
      await wait_background(server);
      expect(served(server)?.list.sequence).toBe(published);
    } finally {
      stop(other);
      stop(server);
    }
  });

  it('serves its own publish at once', async () => {
    const server = await start();
    try {
      const files = [new_file('item.bin')];
      await upload(server, files);
      const first = await admin(server, 'publish_deploy_list', publish_body(data_version, files));
      // The cache holds the first deploy list, so only the publish's after_commit function can change it.
      expect(String(served(server)?.list.sequence)).toBe(first.body.sequence);
      const answer = await admin(server, 'publish_deploy_list', publish_body(data_version, files));
      expect(answer.body.sequence).not.toBe(first.body.sequence);
      expect(String(served(server)?.list.sequence)).toBe(answer.body.sequence);
    } finally {
      stop(server);
    }
  });
});
