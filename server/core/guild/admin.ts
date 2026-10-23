/**
 * The admin operations of guild (`### admin`). `routing` hands them to `admin-api`, which checks the body, opens the
 * transaction (the out-of-request ctx of `user_id` for a user-targeted operation, else a game tx) and keeps
 * `operation_id`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { GameTx, RequestCtx } from '../storage/index.ts';
import { LOCK_FAILED, description_check, guild_db, lock, lock_with_members, member_changed, name_length_ok, type GuildCore } from './core.ts';
import { change_role, disband, insert_new_guild, remove_member } from './members.ts';
import { by_role, type GuildRow, type MemberRow } from './tables.ts';

const Role = CoreContract.GuildRole;
const JoinType = CoreContract.GuildJoinType;

export type AdminFailure = 'bad_request' | 'not_found' | 'conflict' | 'external_failed' | 'internal';

/** An admin field type (`admin-api`). */
export type FieldType =
  | { readonly kind: 'int64' }
  | { readonly kind: 'int32' }
  | { readonly kind: 'string' }
  | { readonly kind: 'enum'; readonly elements: readonly string[] }
  | { readonly kind: 'array'; readonly element: FieldType }
  | { readonly kind: 'object'; readonly fields: FieldMap };

export type FieldMap = Readonly<Record<string, { readonly type: FieldType; readonly optional: boolean }>>;

/** An admin operation object (`admin-api`): `routing` hands it to `admin-api.register_admin_operation`. */
export interface AdminOperation {
  readonly name: string;
  readonly role: 'read' | 'ops';
  readonly body: 'json';
  readonly max_body_bytes: null;
  readonly input: FieldMap;
  readonly user_target: string | null;
  readonly handler: (input: Readonly<Record<string, unknown>>, transaction: RequestCtx | GameTx, prepare_value: unknown, body: Uint8Array | null) => Record<string, unknown> | AdminFailure;
  readonly prepare: null;
  readonly audit_args: null;
}

const ROLE_NAMES = ['Leader', 'Officer', 'Member'] as const;
const JOIN_TYPE_NAMES = ['Open', 'Approval', 'Closed'] as const;
const ROLE_OF: Readonly<Record<string, CoreContract.GuildRole>> = { Leader: Role.GUILD_ROLE_LEADER, Officer: Role.GUILD_ROLE_OFFICER, Member: Role.GUILD_ROLE_MEMBER };
const JOIN_TYPE_OF: Readonly<Record<string, CoreContract.GuildJoinType>> = {
  Open: JoinType.GUILD_JOIN_TYPE_OPEN,
  Approval: JoinType.GUILD_JOIN_TYPE_APPROVAL,
  Closed: JoinType.GUILD_JOIN_TYPE_CLOSED,
};
const role_name = (role: CoreContract.GuildRole): string => ROLE_NAMES[role - 1] ?? '';
const join_type_name = (join_type: CoreContract.GuildJoinType): string => JOIN_TYPE_NAMES[join_type - 1] ?? '';

const field = (type: FieldType, optional = false): { readonly type: FieldType; readonly optional: boolean } => ({ type, optional });
const INT64 = field({ kind: 'int64' });
const INT32 = field({ kind: 'int32' });
const STRING = field({ kind: 'string' });
const ROLE = field({ kind: 'enum', elements: ROLE_NAMES });
const JOIN_TYPE = field({ kind: 'enum', elements: JOIN_TYPE_NAMES });
const MEMBERS = field({ kind: 'array', element: { kind: 'object', fields: { user_id: INT64, role: ROLE } } });

const MAX_JOIN_VALUE = 2n ** 53n - 1n;

type Input = Readonly<Record<string, unknown>>;
type Output = Record<string, unknown> | AdminFailure;

/** An admin operation in a game tx (`user_target` none). */
function game_operation(name: string, role: 'read' | 'ops', input: FieldMap, handler: (input: Input, tx: GameTx) => Output): AdminOperation {
  return { name, role, body: 'json', max_body_bytes: null, input, user_target: null, handler: (i, tx) => handler(i, tx as GameTx), prepare: null, audit_args: null };
}

/** An `ops` admin operation in the out-of-request ctx of its `user_id` (`user_target` `user_id`). */
function user_operation(name: string, input: FieldMap, handler: (input: Input, ctx: RequestCtx) => Output): AdminOperation {
  return { name, role: 'ops', body: 'json', max_body_bytes: null, input, user_target: 'user_id', handler: (i, ctx) => handler(i, ctx as RequestCtx), prepare: null, audit_args: null };
}

const big = (input: Input, key: string): bigint => input[key] as bigint;
const str = (input: Input, key: string): string => input[key] as string;

/** The name rule of `rename_guild`: plain text within `guild.maxNameLength` that passes the shared length rule. */
function name_ok(core: GuildCore, name: string): boolean {
  return core.validation.is_plain_text(name, core.settings.max_name_length) && name_length_ok(core, name);
}

/** The description rule of `set_guild_description` and `import_guild`: `description_check` is not `INVALID`. */
function description_ok(core: GuildCore, description: string): boolean {
  return description_check(core, description).result !== 'INVALID';
}

function guild_json(guild: GuildRow, members: readonly MemberRow[]): Record<string, unknown> {
  return {
    guild_id: String(guild.guild_id),
    name: guild.name,
    normalized_name: guild.normalized_name,
    description: guild.description,
    join_type: join_type_name(guild.join_type),
    join_value: String(guild.join_value),
    leader_id: String(guild.leader_id),
    member_count: guild.member_count,
    max_members: guild.max_members,
    joinable: guild.joinable,
    created_at: String(guild.created_at),
    updated_at: String(guild.updated_at),
    members: [...members].sort(by_role).map((m) => ({ user_id: String(m.user_id), role: role_name(m.role), joined_at: String(m.joined_at), active_at: String(m.active_at) })),
  };
}

export function get_guild(core: GuildCore): AdminOperation {
  return game_operation('get_guild', 'read', { guild_id: INT64 }, (input, tx) => {
    const db = guild_db(core, tx);
    const guild = db.guild(big(input, 'guild_id'));
    return guild === null ? 'not_found' : guild_json(guild, db.members(guild.guild_id));
  });
}

export function rename_guild(core: GuildCore): AdminOperation {
  return game_operation('rename_guild', 'ops', { operation_id: STRING, guild_id: INT64, name: STRING }, (input, tx) => {
    const name = str(input, 'name');
    if (!name_ok(core, name)) return 'bad_request';
    const guild_id = big(input, 'guild_id');
    if (lock(core, tx, guild_id, []) === LOCK_FAILED) return 'internal';
    const db = guild_db(core, tx);
    const guild = db.guild(guild_id);
    if (guild === null) return 'not_found';
    const normalized_name = core.validation.normalize_text(name);
    if (normalized_name !== guild.normalized_name) {
      if (db.register_name(normalized_name, guild_id) !== guild_id) return 'conflict';
      db.delete_name(guild.normalized_name, guild_id);
    }
    db.set_name(guild_id, name, normalized_name, core.time.clock_now());
    return {};
  });
}

export function set_guild_description(core: GuildCore): AdminOperation {
  return game_operation('set_guild_description', 'ops', { operation_id: STRING, guild_id: INT64, description: STRING }, (input, tx) => {
    const description = str(input, 'description');
    if (!description_ok(core, description)) return 'bad_request';
    const guild_id = big(input, 'guild_id');
    if (lock(core, tx, guild_id, []) === LOCK_FAILED) return 'internal';
    const db = guild_db(core, tx);
    if (db.guild(guild_id) === null) return 'not_found';
    db.set_description(guild_id, description);
    return {};
  });
}

export function set_guild_member_role(core: GuildCore): AdminOperation {
  return user_operation('set_guild_member_role', { operation_id: STRING, guild_id: INT64, user_id: INT64, role: ROLE }, (input, ctx) => {
    switch (change_role(core, ctx, big(input, 'guild_id'), big(input, 'user_id'), ROLE_OF[str(input, 'role')])) {
      case null:
        return {};
      case 'no_guild':
        return 'not_found';
      case 'officer_limit':
        return 'conflict';
      case LOCK_FAILED:
        return 'internal';
      default:
        return 'bad_request';
    }
  });
}

export function kick_guild_member(core: GuildCore): AdminOperation {
  return user_operation('kick_guild_member', { operation_id: STRING, guild_id: INT64, user_id: INT64 }, (input, ctx) => {
    const guild_id = big(input, 'guild_id');
    const user_id = big(input, 'user_id');
    if (lock(core, ctx, guild_id, [user_id]) === LOCK_FAILED) return 'internal';
    const db = guild_db(core, ctx);
    const guild = db.guild(guild_id);
    if (guild === null) return 'not_found';
    const target = db.member(user_id);
    if (target?.guild_id !== guild_id || target.role === Role.GUILD_ROLE_LEADER) return 'bad_request';
    remove_member(core, ctx, db, guild, user_id, true);
    member_changed(core, ctx, guild_id, user_id, 'Kicked');
    return {};
  });
}

export function disband_guild(core: GuildCore): AdminOperation {
  return user_operation('disband_guild', { operation_id: STRING, guild_id: INT64, user_id: INT64 }, (input, ctx) => {
    const guild_id = big(input, 'guild_id');
    const rows = lock_with_members(core, ctx, guild_id);
    if (rows === LOCK_FAILED) return 'internal';
    const db = guild_db(core, ctx);
    let guild = db.guild(guild_id);
    if (guild === null) return 'not_found';
    const leader = rows.find((m) => m.role === Role.GUILD_ROLE_LEADER);
    if (leader?.user_id !== big(input, 'user_id')) return 'bad_request';
    for (const member of rows) {
      if (member.user_id === leader.user_id) continue;
      guild = remove_member(core, ctx, db, guild, member.user_id, false);
      member_changed(core, ctx, guild_id, member.user_id, 'Kicked');
    }
    disband(core, ctx, db, guild, leader.user_id);
    return {};
  });
}

interface ImportMember {
  readonly user_id: bigint;
  readonly role: CoreContract.GuildRole;
}

/** Step 2 of `import_guild`: the members, `max_members`, `join_value`, name and description rules. */
function import_input_ok(core: GuildCore, input: Readonly<Record<string, unknown>>, members: readonly ImportMember[]): boolean {
  const max_members = input.max_members as number;
  const join_value = big(input, 'join_value');
  const count = (role: CoreContract.GuildRole): number => members.filter((m) => m.role === role).length;
  return (
    members.length > 0 &&
    count(Role.GUILD_ROLE_LEADER) === 1 &&
    new Set(members.map((m) => m.user_id)).size === members.length &&
    max_members >= 1 &&
    max_members <= core.settings.max_members_limit &&
    members.length <= max_members &&
    count(Role.GUILD_ROLE_OFFICER) <= core.settings.max_officers &&
    join_value >= 0n &&
    join_value <= MAX_JOIN_VALUE &&
    name_ok(core, str(input, 'name')) &&
    description_ok(core, str(input, 'description'))
  );
}

export function import_guild(core: GuildCore): AdminOperation {
  const input_fields: FieldMap = { operation_id: STRING, name: STRING, description: STRING, join_type: JOIN_TYPE, join_value: INT64, max_members: INT32, members: MEMBERS };
  return game_operation('import_guild', 'ops', input_fields, (input, tx) => {
    if (core.env === 'PROD') return 'conflict';
    const members = (input.members as readonly { user_id: bigint; role: string }[]).map((m) => ({ user_id: m.user_id, role: ROLE_OF[m.role] ?? Role.GUILD_ROLE_UNSPECIFIED }));
    if (!import_input_ok(core, input, members)) return 'bad_request';
    if (lock(core, tx, null, members.map((m) => m.user_id)) === LOCK_FAILED) return 'internal';
    const handle = core.storage.db(tx);
    for (const member of members) {
      const record = core.storage.get_user_record(handle, member.user_id);
      if (record === null || record.withdrawn_at !== null) return 'not_found';
    }
    const db = guild_db(core, tx);
    if (members.some((m) => db.member(m.user_id) !== null)) return 'conflict';
    const guild_id = insert_new_guild(core, tx, db, {
      name: str(input, 'name'),
      description: str(input, 'description'),
      join_type: JOIN_TYPE_OF[str(input, 'join_type')] ?? JoinType.GUILD_JOIN_TYPE_UNSPECIFIED,
      join_value: big(input, 'join_value'),
      max_members: input.max_members as number,
      members,
      now: core.time.clock_now(),
    });
    if (guild_id === LOCK_FAILED) return 'internal';
    if (guild_id === 'name_taken') return 'conflict';
    return { guild_id: String(guild_id) };
  });
}
