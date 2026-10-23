import { createHash } from 'node:crypto';
import {
  admin,
  client_data_version,
  get,
  max_body_bytes,
  new_file,
  other_protocol,
  publish_body,
  put_file,
  put_file_past_body_limit,
  served,
  set_time,
  signature_verifies,
  start,
  stop,
  START_AT,
  upload,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
let data_version: string;

beforeEach(async () => {
  data_version = client_data_version();
  server = await start();
});

describe('signature', () => {
  it('serves the published deploy list and a signature the get_update_signing_key public key verifies', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(200);
    const key = await admin(server, 'get_update_signing_key');
    const list = served(server);
    if (list === null) throw new Error('no deploy list');
    expect(signature_verifies(key.body.public_key as string, list.bytes, list.signature.signature)).toBe(true);
  });

  it('gives a 32 byte public key whose SHA-256 hex starts with key_id, the key_id of the signature JSON', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    const key = await admin(server, 'get_update_signing_key');
    const public_key = Buffer.from(key.body.public_key as string, 'base64');
    expect(public_key).toHaveLength(32);
    expect(public_key.toString('base64')).toBe(key.body.public_key);
    expect(key.body.key_id).toBe(createHash('sha256').update(public_key).digest('hex').slice(0, 16));
    expect(served(server)?.signature.key_id).toBe(key.body.key_id);
  });

  it('puts the deploy list sequence in its signature JSON', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    const list = served(server);
    expect(list?.signature.sequence).toBe(list?.list.sequence);
  });
});

describe('sequence', () => {
  it('is published_at on a DB without a deploy list, rises on the same input, and is max(previous + 1, published_at)', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    const first = await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    expect(first.body.sequence).toBe(String(START_AT));
    expect(served(server)?.list.published_at).toBe(Number(START_AT));
    const second = await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    expect(second.body.sequence).toBe(String(START_AT + 1n));
    set_time(server, START_AT + 60_000n);
    const third = await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    expect(third.body.sequence).toBe(String(START_AT + 60_000n));
  });

  it('gives two concurrent publishes different sequences', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    const answers = await Promise.all([
      admin(server, 'publish_deploy_list', publish_body(data_version, files)),
      admin(server, 'publish_deploy_list', publish_body(data_version, files)),
    ]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(answers[0].body.sequence).not.toBe(answers[1].body.sequence);
  });
});

describe('conflict', () => {
  it('rejects a missing file and a size mismatch with conflict and keeps the current deploy list', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    const before = served(server);
    const missing = await admin(server, 'publish_deploy_list', publish_body(data_version, [new_file('other.bin')]));
    expect(missing).toEqual({ status: 409, body: { error: 'conflict' } });
    const body = publish_body(data_version, files) as { patches: Record<string, { data_files: { size: number }[] }> };
    (body.patches['1.0.0']?.data_files[0] as { size: number }).size += 1;
    expect((await admin(server, 'publish_deploy_list', body)).status).toBe(409);
    expect(Buffer.from(served(server)?.bytes ?? []).equals(Buffer.from(before?.bytes ?? []))).toBe(true);
  });

  it('rejects a data_version that is neither client_data_version nor compat_client_data_version', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    expect((await admin(server, 'publish_deploy_list', publish_body(other_protocol(data_version), files))).status).toBe(409);
    expect(served(server)).toBeNull();
  });

  it('publishes an entry whose data_version is compat_client_data_version', async () => {
    const compat = other_protocol(data_version);
    const compat_server = await start({ compat });
    try {
      const files = [new_file('item.bin')];
      await upload(compat_server, files);
      expect((await admin(compat_server, 'publish_deploy_list', publish_body(compat, files))).status).toBe(200);
      expect((await admin(compat_server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(200);
    } finally {
      stop(compat_server);
    }
  });

  it('rejects a deploy list over game-update.maxDeployListBytes', async () => {
    const small = await start({ settings: { 'game-update.maxDeployListBytes': 300 } });
    try {
      const files = [new_file('a.bin'), new_file('b.bin'), new_file('c.bin')];
      await upload(small, files);
      expect((await admin(small, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(409);
    } finally {
      stop(small);
    }
  });
});

describe('bad_request', () => {
  const bad_bodies = (files: { name: string; bytes: Uint8Array; sha256: string }[]): Record<string, unknown>[] => {
    const entry = (change: (patch: Record<string, unknown>) => void): Record<string, unknown> => {
      const body = publish_body(data_version, files) as { patches: Record<string, Record<string, unknown>> };
      change(body.patches['1.0.0'] as Record<string, unknown>);
      return body;
    };
    const file = files[0] as { name: string; bytes: Uint8Array; sha256: string };
    const item = { name: file.name, size: file.bytes.byteLength, sha256: file.sha256 };
    return [
      entry((p) => (p.data_files = [item, item])),
      entry((p) => (p.bundle_files = [{ bundle: 'ui', ...item }])),
      entry((p) => (p.data_files = [{ ...item, name: '.item' }])),
      entry((p) => (p.data_files = [{ ...item, name: 'item.tmp' }])),
      entry((p) => (p.data_files = [{ ...item, name: 'item.bak' }])),
      entry((p) => (p.data_files = [{ ...item, name: 'Item.BIN' }])),
      entry((p) => (p.data_files = [{ ...item, size: 0 }])),
      entry((p) => (p.translation_files = [{ language: 'ko', ...item }, { language: 'ko', ...item, name: 'other.bin' }])),
      entry((p) => (p.extra = true)),
      { ...publish_body(data_version, files), extra: 1 },
      { app: { android: { min_version: '1.0', recommended_version: '1.0.0', store_url: 'https://a.example.com' } }, patches: {} },
      { app: { android: { min_version: '2.0.0', recommended_version: '1.0.0', store_url: 'https://a.example.com' } }, patches: {} },
      { app: {}, patches: { 'v1.0.0': (publish_body(data_version, files).patches as Record<string, unknown>)['1.0.0'] } },
    ];
  };

  it('rejects format violations with bad_request and keeps the current deploy list', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    for (const body of bad_bodies(files)) {
      expect(await admin(server, 'publish_deploy_list', body)).toEqual({ status: 400, body: { error: 'bad_request' } });
    }
    expect(served(server)).toBeNull();
  });
});

describe('put_update_file', () => {
  it('rejects a body whose SHA-256 is not the query sha256 and does not store it', async () => {
    const file = new_file('item.bin');
    const wrong = new_file('other.bin').sha256;
    expect(await put_file(server, file.bytes, wrong)).toEqual({ status: 400, body: { error: 'bad_request' } });
    expect(get(server, `/update/files/${wrong}`).status).toBe(404);
    expect(get(server, `/update/files/${file.sha256}`).status).toBe(404);
  });

  it('stores a file once and answers sha256 and size for the same file again', async () => {
    const file = new_file('item.bin', 100);
    expect(await put_file(server, file.bytes)).toEqual({ status: 200, body: { sha256: file.sha256, size: 100 } });
    expect(await put_file(server, file.bytes)).toEqual({ status: 200, body: { sha256: file.sha256, size: 100 } });
  });

  it('rejects an empty body', async () => {
    expect((await put_file(server, new Uint8Array())).status).toBe(400);
  });

  it('has game-update.maxFileBytes as its body limit and rejects a body over it with bad_request in its handler too', async () => {
    const small = await start({ settings: { 'game-update.maxFileBytes': 100 } });
    try {
      expect(max_body_bytes(small, 'put_update_file')).toBe(100);
      const over = new_file('over.bin', 101);
      expect(await put_file_past_body_limit(small, over.bytes)).toEqual({ status: 400, body: { error: 'bad_request' } });
      expect(get(small, `/update/files/${over.sha256}`).status).toBe(404);
      const limit = new_file('limit.bin', 100);
      expect(await put_file(small, limit.bytes)).toEqual({ status: 200, body: { sha256: limit.sha256, size: 100 } });
    } finally {
      stop(small);
    }
  });
});

describe('prune_update_files', () => {
  it('keeps the files of the kept deploy lists and deletes the others', async () => {
    const kept = [new_file('kept.bin')];
    const loose = new_file('loose.bin');
    await upload(server, [...kept, loose]);
    await admin(server, 'publish_deploy_list', publish_body(data_version, kept));
    expect((await admin(server, 'prune_update_files')).body).toEqual({ deleted: 1 });
    expect(Buffer.from(get(server, `/update/files/${kept[0]?.sha256 ?? ''}`).body).equals(Buffer.from(kept[0]?.bytes ?? []))).toBe(true);
    expect(get(server, `/update/files/${loose.sha256}`).status).toBe(404);
  });

  it('keeps only the newest game-update.keepDeployLists deploy lists, so the files of older ones go', async () => {
    const keep = await start({ settings: { 'game-update.keepDeployLists': 2 } });
    try {
      const [a, b, c] = [new_file('a.bin'), new_file('b.bin'), new_file('c.bin')];
      await upload(keep, [a, b, c]);
      for (const file of [a, b, c]) await admin(keep, 'publish_deploy_list', publish_body(data_version, [file]));
      await admin(keep, 'prune_update_files');
      expect(get(keep, `/update/files/${a.sha256}`).status).toBe(404);
      expect(get(keep, `/update/files/${b.sha256}`).status).toBe(200);
      expect(get(keep, `/update/files/${c.sha256}`).status).toBe(200);
    } finally {
      stop(keep);
    }
  });

  it('with a concurrent publish: a successful publish keeps all its files, a publish after the prune took them is conflict', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    const [published] = await Promise.all([admin(server, 'publish_deploy_list', publish_body(data_version, files)), admin(server, 'prune_update_files')]);
    const list = served(server);
    if (published.status === 200) {
      expect(Buffer.from(get(server, `/update/files/${files[0]?.sha256 ?? ''}`).body).equals(Buffer.from(files[0]?.bytes ?? []))).toBe(true);
      expect(list).not.toBeNull();
    } else {
      expect(published).toEqual({ status: 409, body: { error: 'conflict' } });
      expect(list).toBeNull();
    }
  });

  it('makes a later publish of a pruned file conflict and keeps the current deploy list', async () => {
    const files = [new_file('item.bin')];
    await upload(server, files);
    await admin(server, 'prune_update_files');
    expect((await admin(server, 'publish_deploy_list', publish_body(data_version, files))).status).toBe(409);
    expect(served(server)).toBeNull();
  });
});

describe('get_deploy_list', () => {
  it('is not_found before a publish and gives the deploy list and signature after', async () => {
    expect((await admin(server, 'get_deploy_list')).status).toBe(404);
    const files = [new_file('item.bin')];
    await upload(server, files);
    await admin(server, 'publish_deploy_list', publish_body(data_version, files));
    const answer = await admin(server, 'get_deploy_list');
    expect(answer.status).toBe(200);
    expect(answer.body.deploy_list).toMatchObject({ format: 1, environment: 'LOCAL', app: publish_body(data_version, files).app });
    expect((answer.body.signature as { sequence: number }).sequence).toBe((answer.body.deploy_list as { sequence: number }).sequence);
  });
});
