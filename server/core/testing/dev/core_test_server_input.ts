import { rmSync } from 'node:fs';
import type { TestDatabase } from './database.ts';
import {
  base_settings,
  core_test_register,
  core_test_register_dev,
  SERVER_ROOT,
  server_data_folder,
  server_module_list,
  runner,
  type DbKind,
  type RegisterFunction,
} from './runner_input.ts';
import { new_secrets, type TestSecrets } from './secrets.ts';
import { with_new_database } from './test_server.ts';

/**
 * The part of a server start input that needs no DB (`core_test_server_paths`): the core settings defaults, the server
 * module list, the server build data folder and the server root.
 */
export interface CoreTestServerPaths {
  /** The merged core settings and the game settings values core reads (`core_settings` of `create_server`). */
  readonly settings: Record<string, unknown>;
  readonly server_modules: string[];
  readonly data_folder: string;
  /** `server/` of this checkout. */
  readonly server_root: string;
}

/** `core_test_server_paths`: the server start input of `new_core_test_server_input` without a DB. It makes nothing. */
export function core_test_server_paths(): CoreTestServerPaths {
  return { settings: base_settings(), server_modules: server_module_list(), data_folder: server_data_folder(), server_root: SERVER_ROOT };
}

/**
 * The server start input of a server core test that calls `routing.create_server` itself (`new_core_test_server_input`).
 */
export interface CoreTestServerInput extends CoreTestServerPaths {
  /** The DB kind of the test DB. */
  readonly kind: DbKind;
  /** The new test DB: `db_argument` is `--db`, `connection` the PostgreSQL connection string or null for SQLite. */
  readonly database: Omit<TestDatabase, 'drop'>;
  /** New secret values: `file` is the `--secret-file` JSON object, with `db` for PostgreSQL. */
  readonly secrets: TestSecrets;
  /** `core_test_register` and `core_test_register_dev`. */
  readonly register: typeof core_test_register;
  readonly registerDev: RegisterFunction;
  /** Removes the test DB. */
  drop(): Promise<void>;
}

/** Checks a DB kind at run time, for callers without types. */
function check_kind(kind: unknown): void {
  if (kind !== 'sqlite' && kind !== 'postgresql') throw new Error(`testing: DB kind ${JSON.stringify(kind)} is not sqlite or postgresql`);
}

/**
 * `new_core_test_server_input`: the DB kind (`kind`, or `OGW_DEFAULT_DB` when not given), a new test DB of it with its
 * connection, new secret values, the core settings defaults, the server module list, the server build data folder,
 * `core_test_register` and `core_test_register_dev`, the server root, and `drop` that removes the DB.
 */
export async function new_core_test_server_input(kind?: DbKind): Promise<CoreTestServerInput> {
  // Read the inputs before the folder and the DB are made, so a missing or broken one leaves nothing behind.
  const db_kind = kind ?? runner.default_db();
  check_kind(db_kind);
  const { settings, server_modules, data_folder, server_root } = core_test_server_paths();
  const { folder, database, secrets } = await with_new_database(db_kind, 'ogw-core-test-db-', (folder, database) =>
    Promise.resolve({ folder, database, secrets: new_secrets(database.connection, []) }),
  );
  return {
    kind: db_kind,
    database: { kind: database.kind, db_argument: database.db_argument, connection: database.connection, name: database.name },
    secrets,
    settings,
    server_modules,
    data_folder,
    register: core_test_register,
    registerDev: core_test_register_dev,
    server_root,
    drop: async () => {
      try {
        await database.drop();
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  };
}
