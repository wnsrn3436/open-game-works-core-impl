import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import { open_pg_session, type PgSession } from '../../storage/dev/index.ts';
import { KindRegistry } from '../../storage/kinds.ts';
import { row_lock_key } from '../../storage/tx.ts';
import { hold_lock_key } from './pg_hold.ts';
import { runner, type DbKind } from './runner_input.ts';

export { PG_ROW_LOCK_SQL } from './pg_hold.ts';

/** The DB of one test server and its peers. */
export interface TestDatabase {
  readonly kind: DbKind;
  /** `--db`: the SQLite file path, or `postgresql`. */
  readonly db_argument: string;
  /** The PostgreSQL connection string of the new database, or null for SQLite. */
  readonly connection: string | null;
  /** The database name, or the SQLite file path. */
  readonly name: string;
  /** Removes the database. The SQLite file goes with the temporary folder. */
  drop(): Promise<void>;
}

/** The prefix of the PostgreSQL databases this process makes. A server core test reads it to see what is left. */
export function database_prefix(): string {
  return `ogw_test_${String(process.pid)}_`;
}

function admin_connection(): string {
  const connection = runner.postgresql();
  if (connection === null) throw new Error('testing: DB kind postgresql needs OGW_POSTGRESQL, which this run does not give');
  return connection;
}

/** Runs `fn` on a new `storage.open_pg_session` connection to `connection` and closes it. */
export async function with_connection<T>(connection: string, fn: (conn: PgSession) => Promise<T>): Promise<T> {
  const conn = await open_pg_session(connection);
  try {
    return await fn(conn);
  } finally {
    conn.close();
  }
}

function with_admin<T>(fn: (conn: PgSession) => Promise<T>): Promise<T> {
  return with_connection(admin_connection(), fn);
}

/** The names of the PostgreSQL databases this process made that are still there. */
export async function list_databases(): Promise<string[]> {
  return with_admin(async (conn) => {
    const rows = await conn.query('SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname', [database_prefix()]);
    return rows.map((row) => String(row.datname));
  });
}

/** A new DB for a test server: a SQLite file in `folder`, or a new database in `OGW_POSTGRESQL`. */
export async function new_database(kind: DbKind, folder: string): Promise<TestDatabase> {
  if (kind === 'sqlite') {
    const file = join(folder, 'server.db');
    return { kind, db_argument: file, connection: null, name: file, drop: () => Promise.resolve() };
  }
  const name = `${database_prefix()}${randomBytes(6).toString('hex')}`;
  const url = new URL(admin_connection());
  await with_admin(async (conn) => {
    await conn.query(`CREATE DATABASE ${name}`);
  });
  url.pathname = `/${name}`;
  return {
    kind,
    db_argument: 'postgresql',
    connection: url.toString(),
    name,
    drop: () => drop_database(name),
  };
}

/** Removes the PostgreSQL database `name` of `OGW_POSTGRESQL`, if it is there. */
export async function drop_database(name: string): Promise<void> {
  // async: a missing OGW_POSTGRESQL rejects the drop instead of throwing at the call.
  await with_admin(async (conn) => {
    await conn.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });
}

/** One saved UserState or server state item, decoded with the kind class of the contract. */
export interface StateItem {
  /** The kind message name. */
  readonly kind: string;
  readonly item_id: bigint;
  readonly value: unknown;
}

interface StateRow {
  kind: string;
  item_id: bigint;
  value: Uint8Array;
}

type Store = 'user_state' | 'server_state';

async function read_rows(database: TestDatabase, store: Store, user_id: bigint): Promise<StateRow[]> {
  if (database.connection === null) {
    const db = new DatabaseSync(database.db_argument, { readOnly: true });
    try {
      const statement = db.prepare(`SELECT kind, item_id, value FROM ${store} WHERE user_id = ? ORDER BY kind, item_id`);
      statement.setReadBigInts(true);
      return statement.all(user_id) as unknown as StateRow[];
    } finally {
      db.close();
    }
  }
  return with_connection(database.connection, async (conn) => {
    const sql = `SELECT kind, item_id, value FROM ${store} WHERE user_id = $1 ORDER BY kind, item_id`;
    const rows = await conn.query(sql, [user_id]);
    return rows.map((row) => ({ kind: String(row.kind), item_id: row.item_id as bigint, value: row.value as Uint8Array }));
  });
}

/**
 * The saved items of `store` of a user, as copies decoded from the committed rows: in the order of the contract
 * kinds, each kind by item ID. Rows of a kind the contract does not have are left out.
 */
export async function read_state(database: TestDatabase, store: Store, user_id: bigint): Promise<StateItem[]> {
  const kinds = [...CoreContract.KINDS, ...GameContract.KINDS].filter((k) => k.store === store);
  const rows = await read_rows(database, store, user_id);
  const items: StateItem[] = [];
  for (const kind of kinds) {
    const of_kind = rows.filter((row) => row.kind === kind.column).sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
    for (const row of of_kind) {
      const value = kind.kind_class.decode(new Uint8Array(row.value));
      if (value === null) throw new Error(`testing: a saved ${kind.name} item ${String(row.item_id)} of user ${String(user_id)} does not decode`);
      items.push({ kind: kind.name, item_id: row.item_id, value });
    }
  }
  return items;
}

/** The kinds of the server's contract, as `storage` looks them up for `lock_game_row`. */
const KINDS = new KindRegistry({ core_kinds: CoreContract.KINDS, game_kinds: GameContract.KINDS, contract_version: GameContract.CONTRACT_VERSION });

/**
 * The advisory lock ID that `storage.lock_game_row` takes for `table` and `key` on PostgreSQL. The key of table
 * `game_state` is `[game state kind class, key]`, as content passes it.
 */
export function game_row_lock_id(table: string, key: readonly unknown[]): bigint {
  return row_lock_key({ kinds: KINDS }, table, key);
}

/**
 * Holds a lock that `storage.lock_game_row` takes, on a connection of its own: a PostgreSQL transaction that takes
 * the advisory lock of `lock_id`, or a SQLite transaction opened with `BEGIN IMMEDIATE`, which holds back every
 * other write transaction. The returned function rolls that transaction back.
 */
export async function hold_lock(database: TestDatabase, lock_id: bigint): Promise<() => Promise<void>> {
  if (database.connection === null) {
    const db = new DatabaseSync(database.db_argument);
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (error) {
      db.close();
      throw error;
    }
    return () => {
      try {
        db.exec('ROLLBACK');
      } finally {
        db.close();
      }
      return Promise.resolve();
    };
  }
  const holder = await hold_lock_key(database.connection, lock_id);
  return () => holder.release();
}
