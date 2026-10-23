/**
 * The admin operations of game-update (`game-update` `## API`, `### file upload`, `### publish_deploy_list`). Their
 * processing order, authentication, `operation_id` rule and `audit` log are `admin-api`'s.
 */
import type { DeployListCache } from './cache.ts';
import type { CdnAdapter } from './cdn.ts';
import {
  deploy_list_bytes,
  file_size_claims,
  FormatError,
  next_sequence,
  parse_deploy_list_input,
  referenced_files,
  sha256_hex,
  stored_patches,
  unknown_data_versions,
  type DeployListInput,
  type Environment,
} from './deploy_list.ts';
import { FAILED, type DbHandle, type GameTx, type GameUpdateLogging, type GameUpdateServerTime, type GameUpdateStorage } from './deps.ts';
import type { SigningKey } from './signing.ts';
import * as store from './store.ts';

/** A failure reason of a handler function or a prepare function (`admin-api`). */
export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

export type AdminOutput = Record<string, unknown>;

type AdminInputFields = Readonly<Record<string, unknown>>;

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'release';
  readonly body: 'json' | 'binary';
  /** The byte limit of a `binary` body; null for a `json` body. */
  readonly max_body_bytes: number | null;
  readonly input: Readonly<Record<string, { readonly type: { readonly kind: 'string' | 'json' }; readonly optional: boolean }>>;
  readonly user_target: null;
  /** Runs in the game tx `admin-api` opened. */
  readonly handler: (input: AdminInputFields, tx: GameTx, prepare_value: unknown, body: Uint8Array | null) => AdminOutput | AdminFailure;
  /** Runs outside the transaction before the handler function. */
  readonly prepare: ((input: AdminInputFields, body: Uint8Array | null) => Promise<unknown>) | null;
  readonly audit_args: null;
}

/** The admin operations of game-update by name: the members of the module object. */
export interface AdminOperations {
  readonly put_update_file: AdminOperation;
  readonly publish_deploy_list: AdminOperation;
  readonly get_deploy_list: AdminOperation;
  readonly get_update_signing_key: AdminOperation;
  readonly prune_update_files: AdminOperation;
}

/** The prepare value of `publish_deploy_list`. */
interface PreparedPublish {
  readonly input: DeployListInput;
  readonly file_base_url: string;
}

export interface AdminInput {
  readonly storage: GameUpdateStorage;
  readonly server_time: GameUpdateServerTime;
  readonly logging: GameUpdateLogging;
  readonly cache: DeployListCache;
  readonly environment: Environment;
  readonly client_data_version: string;
  readonly compat_client_data_version: string | null;
  /** The signing key; set at server start. */
  readonly signing_key: () => SigningKey;
  /** The `cdn` adapter in use now with its base URL, or null. */
  readonly cdn: () => { readonly adapter: CdnAdapter; readonly base_url: string } | null;
  readonly max_file_bytes: number;
  readonly max_deploy_list_bytes: number;
  readonly keep_deploy_lists: number;
  readonly cdn_timeout_ms: number;
}

/** Step 2: every file the input points to is stored with the size the input gives. */
function files_match(db: DbHandle, input: DeployListInput): boolean {
  const claims = file_size_claims(input);
  const sizes = store.file_sizes(db, claims.map((claim) => claim.sha256));
  return claims.every((claim) => sizes.get(claim.sha256) === BigInt(claim.size));
}

const STRING = { kind: 'string' } as const;
const JSON_FIELD = { kind: 'json' } as const;

export function create_admin_operations(a: AdminInput): AdminOperations {
  const log_error = (message: string, sha256: string): void => {
    a.logging.write({ kind: 'error', level: 'error', message, user_id: null, request_id: null, request: 'publish_deploy_list', fields: { sha256 } });
  };

  /** Records one upload in its own game transaction. A failed record only means a later upload repeats. */
  const record_upload = async (sha256: string): Promise<void> => {
    const result = await a.storage.run_game_transaction((tx) => {
      store.insert_upload(a.storage.db(tx), sha256, a.server_time.clock_now());
      return true;
    });
    if (result === FAILED) log_error('cdn upload record failed', sha256);
  };

  /** Step 5: uploads the files not uploaded yet, one by one, recording each right after it. */
  const upload_files = async (cdn: CdnAdapter, input: DeployListInput): Promise<AdminFailure | null> => {
    const files = referenced_files(input);
    const uploaded = store.uploaded_sha256s(a.storage.read_db(), files.map((file) => file.sha256));
    for (const file of files) {
      if (uploaded.has(file.sha256)) continue;
      const content = store.file_content(a.storage.read_db(), file.sha256);
      if (content === null) return 'conflict';
      const ok = await cdn.put(file.sha256, content, a.server_time.network_time_limit(BigInt(a.cdn_timeout_ms)));
      if (!ok) {
        log_error('cdn upload failed or passed its time limit', file.sha256);
        return 'external_failed';
      }
      await record_upload(file.sha256);
    }
    return null;
  };

  /** Steps 1 to 5, outside the transaction. */
  const prepare_publish = async (raw: AdminInputFields): Promise<PreparedPublish | AdminFailure> => {
    let input: DeployListInput;
    try {
      input = parse_deploy_list_input(raw);
    } catch (error) {
      if (error instanceof FormatError) return 'bad_request';
      throw error;
    }
    const read = a.storage.read_db();
    if (!files_match(read, input)) return 'conflict';
    if (unknown_data_versions(input, a.client_data_version, a.compat_client_data_version).length > 0) return 'conflict';
    const cdn = a.cdn();
    const file_base_url = cdn?.base_url ?? 'files/';
    const published_at = a.server_time.clock_now();
    const previous = store.current_deploy_list(read);
    const estimate = deploy_list_bytes(input, { environment: a.environment, sequence: next_sequence(previous?.sequence ?? null, published_at), published_at, file_base_url });
    if (estimate.byteLength > a.max_deploy_list_bytes) return 'conflict';
    if (cdn !== null) {
      const failure = await upload_files(cdn.adapter, input);
      if (failure !== null) return failure;
    }
    return { input, file_base_url };
  };

  /** Step 6, in the game tx `admin-api` opened. The cache changes after the commit. */
  const publish = (tx: GameTx, prepared: PreparedPublish): AdminOutput | AdminFailure => {
    if (a.storage.lock_game_row(tx, store.DEPLOY_LIST_TABLE, store.LOCK_KEY) === FAILED) return 'internal';
    const db = a.storage.db(tx);
    if (!files_match(db, prepared.input)) return 'conflict';
    const previous = store.current_deploy_list(db);
    const published_at = a.server_time.clock_now();
    const sequence = next_sequence(previous?.sequence ?? null, published_at);
    const deploy_list = deploy_list_bytes(prepared.input, { environment: a.environment, sequence, published_at, file_base_url: prepared.file_base_url });
    if (deploy_list.byteLength > a.max_deploy_list_bytes) return 'conflict';
    const signature = Buffer.from(a.signing_key().signature_json(deploy_list, sequence)).toString('utf8');
    const row = { sequence, deploy_list, signature, published_at };
    store.insert_deploy_list(db, row);
    store.keep_newest_deploy_lists(db, a.keep_deploy_lists);
    a.storage.after_commit(tx, () => {
      a.cache.set_published(row);
    });
    return { sequence: sequence.toString() };
  };

  const prune = (tx: GameTx): AdminOutput | AdminFailure => {
    if (a.storage.lock_game_row(tx, store.DEPLOY_LIST_TABLE, store.LOCK_KEY) === FAILED) return 'internal';
    const db = a.storage.db(tx);
    const kept = new Set<string>();
    for (const list of store.all_deploy_lists(db)) {
      for (const patch of stored_patches(list).values()) for (const sha256 of patch.sha256s) kept.add(sha256);
    }
    let deleted = 0;
    for (const sha256 of store.file_sha256s(db)) {
      if (kept.has(sha256)) continue;
      store.delete_file(db, sha256);
      deleted += 1;
    }
    return { deleted };
  };

  const put_file = (input: AdminInputFields, tx: GameTx, body: Uint8Array | null): AdminOutput | AdminFailure => {
    const { sha256 } = input;
    if (typeof sha256 !== 'string' || body === null) return 'bad_request';
    if (body.byteLength === 0 || body.byteLength > a.max_file_bytes || sha256_hex(body) !== sha256) return 'bad_request';
    store.insert_file(a.storage.db(tx), sha256, body, a.server_time.clock_now());
    return { sha256, size: body.byteLength };
  };

  const get_list = (tx: GameTx): AdminOutput | AdminFailure => {
    const current = store.current_deploy_list(a.storage.db(tx));
    if (current === null) return 'not_found';
    return { deploy_list: JSON.parse(Buffer.from(current.deploy_list).toString('utf8')) as unknown, signature: JSON.parse(current.signature) as unknown };
  };

  const operation = (
    name: string,
    role: AdminOperation['role'],
    handler: AdminOperation['handler'],
    options: Partial<Pick<AdminOperation, 'body' | 'max_body_bytes' | 'input' | 'prepare'>> = {},
  ): AdminOperation => ({ name, role, body: 'json', max_body_bytes: null, input: {}, user_target: null, handler, prepare: null, audit_args: null, ...options });

  return {
    put_update_file: operation('put_update_file', 'release', (input, tx, _prepared, body) => put_file(input, tx, body), {
      body: 'binary',
      max_body_bytes: a.max_file_bytes,
      input: { sha256: { type: STRING, optional: false } },
    }),
    publish_deploy_list: operation('publish_deploy_list', 'release', (_input, tx, prepared) => publish(tx, prepared as PreparedPublish), {
      input: { app: { type: JSON_FIELD, optional: false }, patches: { type: JSON_FIELD, optional: false } },
      prepare: (input) => prepare_publish(input),
    }),
    get_deploy_list: operation('get_deploy_list', 'read', (_input, tx) => get_list(tx)),
    get_update_signing_key: operation('get_update_signing_key', 'read', () => ({ key_id: a.signing_key().key_id, public_key: a.signing_key().public_key_base64 })),
    prune_update_files: operation('prune_update_files', 'release', (_input, tx) => prune(tx)),
  };
}
