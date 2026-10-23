import type { Migration, RecordResult } from '../index.ts';

/** One `migrate_snapshot` result: a record of the snapshot and what `convert_item` made of it. */
export interface SnapshotRecordResult {
  readonly table: string;
  readonly key: string;
  readonly from_version: number;
  readonly result: RecordResult;
  readonly error: string | null;
}

/** The `## DEV` operations of `migration`. */
export interface MigrationDev {
  /** Converts the records of a snapshot or game state snapshot without writing to the DB. */
  migrate_snapshot(snapshot: unknown): SnapshotRecordResult[] | 'bad_request';
}

/** A snapshot record (`user-snapshot-clone` `### snapshot`), after `check_snapshot` passed. */
interface SnapshotRecord {
  readonly table: string;
  readonly key: string;
  readonly contract_version: number;
  readonly value: string;
}

function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The DEV operations of the server instance's `migration`. */
export function create_migration_dev(migration: Migration): MigrationDev {
  return {
    migrate_snapshot: (snapshot) => {
      // A game state snapshot is a snapshot without the user's fields.
      const game_state = is_object(snapshot) && !Object.hasOwn(snapshot, 'source_user_id');
      if (migration.check_snapshot(snapshot, game_state) !== 'OK') return 'bad_request';
      const records = (snapshot as { readonly records: readonly SnapshotRecord[] }).records;
      return records.map((record) => {
        const { result, error } = migration.migrate_record(record.table, record.key, BigInt(record.contract_version), Buffer.from(record.value, 'base64'));
        return { table: record.table, key: record.key, from_version: record.contract_version, result, error };
      });
    },
  };
}
