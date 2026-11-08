/**
 * The admin operations of matchmaker (`## API` admin operation): `list_match_flags` and `get_match`, role `read`.
 * Their processing order, authentication, body rules and `audit` log are `admin-api`'s.
 */
import type { GameTx } from '../storage/index.ts';
import type { IntegrityKind } from './judge.ts';
import { flagged_users, integrity_of, read_record } from './records.ts';
import type { Env } from './shared.ts';

type AdminInputFields = Readonly<Record<string, unknown>>;
type AdminFailure = 'bad_request' | 'not_found';
type FieldType =
  | { readonly kind: 'int64' }
  | { readonly kind: 'int32' }
  | { readonly kind: 'string' }
  | { readonly kind: 'enum'; readonly elements: readonly string[] };

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: Readonly<Record<string, { readonly type: FieldType; readonly optional: boolean }>>;
  readonly user_target: null;
  /** Runs in the game tx `admin-api` opened, wrapped in `storage.run_read_only` for role `read`. */
  readonly handler: (input: AdminInputFields, tx: GameTx) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

export interface MatchmakerAdminOperations {
  readonly list_match_flags: AdminOperation;
  readonly get_match: AdminOperation;
}

const KINDS: readonly IntegrityKind[] = ['Disagree', 'Forfeit', 'Missing'];

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function admin_operations(env: Env): MatchmakerAdminOperations {
  const { storage, settings } = env;

  const list_match_flags: AdminOperation = {
    name: 'list_match_flags',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: {
      kind: { type: { kind: 'enum', elements: KINDS }, optional: false },
      after_user_id: { type: { kind: 'int64' }, optional: true },
      limit: { type: { kind: 'int32' }, optional: false },
    },
    user_target: null,
    handler: (input, tx) => {
      const kind = input['kind'] as IntegrityKind;
      const after = input['after_user_id'];
      const limit = input['limit'] as number;
      const flags = flagged_users(
        storage.db(tx),
        kind,
        env.server_time.clock_now(),
        settings.flag_window_ms,
        settings.flag_counts[kind],
        typeof after === 'bigint' ? after : null,
        limit,
      );
      return { flags: flags.map((f) => ({ user_id: f.user_id, count: f.count, match_ids: f.match_ids })) };
    },
    prepare: null,
    audit_args: null,
  };

  const get_match: AdminOperation = {
    name: 'get_match',
    role: 'read',
    body: 'json',
    max_body_bytes: null,
    input: { match_id: { type: { kind: 'string' }, optional: false } },
    user_target: null,
    handler: (input, tx) => {
      const db = storage.db(tx);
      const at = env.server_time.clock_now();
      const record = read_record(db, input['match_id'] as string, at);
      if (record === null) return 'not_found';
      return {
        match: {
          match_id: record.match_id,
          mode_id: record.mode_id,
          status: `MATCH_JUDGE_STATUS_${record.status}`,
          source: record.source,
          created_at: record.created_at,
          start_at: record.start_at,
          deadline_at: record.deadline_at,
          decided_at: record.decided_at,
          data_version: record.data_version,
          client_version: record.client_version,
          replayed_input_log: base64(record.replayed_input_log),
          participants: record.participants.map((p) => ({
            user_id: p.user_id,
            team: p.team,
            party: p.party,
            rating: p.rating,
            reported_at: p.reported_at,
            result: base64(p.result),
            input_log: base64(p.input_log),
            left_at: p.left_at,
            ended_at: p.ended_at,
            disconnected_at: p.disconnected_at,
            integrity: integrity_of(db, p.user_id, record.match_id, at),
          })),
        },
      };
    },
    prepare: null,
    audit_args: null,
  };

  return { list_match_flags, get_match };
}
