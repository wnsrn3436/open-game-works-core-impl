import { randomBytes } from 'node:crypto';
import type { DbHandle } from '../deps.ts';
import { delete_files, file_sizes, insert_file, insert_upload, SHA256_CHUNK, uploaded_sha256s } from '../store.ts';
import { admin, client_data_version, get, new_file, publish_body, sha256_of, start, START_AT, upload, type TestServer } from './helpers.ts';

let server: TestServer;

beforeEach(async () => {
  server = await start();
});

/** A DB handle over `db` that records each statement it runs. */
function counted(db: DbHandle): { readonly db: DbHandle; readonly statements: string[] } {
  const statements: string[] = [];
  const query = (sql: string, params?: Parameters<DbHandle['query']>[1]): ReturnType<DbHandle['query']> => {
    statements.push(sql);
    return db.query(sql, params);
  };
  return { db: { query } as unknown as DbHandle, statements };
}

/** Stores `count` files of sizes 16 to 22 in one game tx, with an upload record for every other one. Gives sha256 → size. */
async function store_files(count: number): Promise<Map<string, bigint>> {
  const files = Array.from({ length: count }, (_, i) => new Uint8Array(randomBytes((i % 7) + 16)));
  const sizes = new Map(files.map((bytes) => [sha256_of(bytes), BigInt(bytes.byteLength)]));
  await server.storage.run_game_transaction((tx) => {
    const db = server.storage.db(tx);
    files.forEach((bytes, i) => {
      insert_file(db, sha256_of(bytes), bytes, START_AT);
      if (i % 2 === 0) insert_upload(db, sha256_of(bytes), START_AT);
    });
    return true;
  });
  return sizes;
}

describe('reads and deletes by sha256', () => {
  it('file_sizes and uploaded_sha256s read 2 * SHA256_CHUNK + 1 sha256s with one statement per chunk', async () => {
    const sizes = await store_files(2 * SHA256_CHUNK);
    const missing = new_file('missing.bin').sha256;
    const asked = [...sizes.keys(), missing];
    const read = counted(server.storage.read_db());
    expect(file_sizes(read.db, asked)).toEqual(sizes);
    expect(read.statements).toHaveLength(3);
    const uploaded = counted(server.storage.read_db());
    expect(uploaded_sha256s(uploaded.db, asked)).toEqual(new Set([...sizes.keys()].filter((_, i) => i % 2 === 0)));
    expect(uploaded.statements).toHaveLength(3);
  });

  it('delete_files deletes SHA256_CHUNK + 1 files with one statement per chunk and counts only the files it deleted', async () => {
    const sha256s = [...(await store_files(SHA256_CHUNK + 1)).keys()];
    const result = await server.storage.run_game_transaction((tx) => {
      const deleting = counted(server.storage.db(tx));
      const deleted = delete_files(deleting.db, [...sha256s, new_file('missing.bin').sha256]);
      return { deleted, statements: deleting.statements.length };
    });
    expect(result).toEqual({ deleted: SHA256_CHUNK + 1, statements: 2 });
    expect(file_sizes(server.storage.read_db(), sha256s).size).toBe(0);
  });

  it('prune_update_files deletes and counts more than SHA256_CHUNK unreferenced files and keeps the referenced one', async () => {
    const loose = [...(await store_files(SHA256_CHUNK + 1)).keys()];
    const kept = [new_file('kept.bin')];
    await upload(server, kept);
    expect((await admin(server, 'publish_deploy_list', publish_body(client_data_version(), kept))).status).toBe(200);
    expect(await admin(server, 'prune_update_files')).toEqual({ status: 200, body: { deleted: SHA256_CHUNK + 1 } });
    expect(file_sizes(server.storage.read_db(), loose).size).toBe(0);
    expect(get(server, `/update/files/${kept[0]?.sha256 ?? ''}`).status).toBe(200);
  });
});
