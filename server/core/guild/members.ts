/**
 * Member changes several operations share: role change, disband, leaving, leader succession and `remove_user`.
 */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../storage/index.ts';
import { LOCK_FAILED, core_log, guild_db, issue_guild_id, lock, lock_with_members, member_changed, type GuildCore, type LockFailed } from './core.ts';
import { by_seniority, type CtxOrTx, type GuildDb, type GuildRole, type GuildRow, type MemberRow } from './tables.ts';

const Role = CoreContract.GuildRole;

/** Why a role change did not happen (`### leave, kick, role` role change). */
export type RoleChangeFailure = 'no_guild' | 'not_member' | 'bad_role' | 'leader' | 'officer_limit' | LockFailed;

export function is_role(role: unknown): role is GuildRole {
  return role === Role.GUILD_ROLE_LEADER || role === Role.GUILD_ROLE_OFFICER || role === Role.GUILD_ROLE_MEMBER;
}

/** The `Officer` count limit: `role` makes the target an `Officer` while `guild.maxOfficers` other members are. */
export function officer_limit(core: GuildCore, db: GuildDb, guild_id: bigint, target: MemberRow, role: GuildRole): boolean {
  if (target.role === role || role !== Role.GUILD_ROLE_OFFICER) return false;
  return db.members(guild_id).filter((m) => m.role === Role.GUILD_ROLE_OFFICER && m.user_id !== target.user_id).length >= core.settings.max_officers;
}

/** The guild `CreateGuild` and `import_guild` make: the guild row values the caller gives and its members with their roles. */
export interface NewGuild {
  readonly name: string;
  readonly description: string;
  readonly join_type: CoreContract.GuildJoinType;
  readonly join_value: bigint;
  readonly max_members: number;
  /** One `Leader` among them. */
  readonly members: readonly { readonly user_id: bigint; readonly role: GuildRole }[];
  readonly now: bigint;
}

/**
 * The creation write of `CreateGuild` steps 6 to 8 and `import_guild` steps 5 to 7: issues the guild ID, registers the
 * name, writes the guild row and a member row per member (`joined_at`, `active_at` `now`) and deletes the members' join
 * requests. Returns the guild ID, `name_taken` when another guild uses the name, or `FAILED` on a lock wait limit.
 */
export function insert_new_guild(core: GuildCore, ctx_or_tx: CtxOrTx, db: GuildDb, guild: NewGuild): bigint | 'name_taken' | LockFailed {
  const guild_id = issue_guild_id(core, ctx_or_tx);
  if (guild_id === LOCK_FAILED) return LOCK_FAILED;
  const normalized_name = core.validation.normalize_text(guild.name);
  if (db.register_name(normalized_name, guild_id) !== guild_id) return 'name_taken';
  db.insert_guild({
    guild_id,
    name: guild.name,
    normalized_name,
    description: guild.description,
    join_type: guild.join_type,
    join_value: guild.join_value,
    leader_id: guild.members.find((m) => m.role === Role.GUILD_ROLE_LEADER)?.user_id ?? 0n,
    member_count: guild.members.length,
    max_members: guild.max_members,
    created_at: guild.now,
    updated_at: guild.now,
  });
  for (const member of guild.members) {
    db.insert_member({ user_id: member.user_id, guild_id, role: member.role, joined_at: guild.now, active_at: guild.now });
    db.delete_requests_of_user(member.user_id);
  }
  return guild_id;
}

/** Joining: writes the user as a `Member`, raises `member_count`, deletes the user's join requests and calls the after hook (`Joined`). */
export function add_member(core: GuildCore, ctx: RequestCtx, db: GuildDb, guild: GuildRow, user_id: bigint): void {
  const now = core.time.now(ctx);
  db.insert_member({ user_id, guild_id: guild.guild_id, role: Role.GUILD_ROLE_MEMBER, joined_at: now, active_at: now });
  db.set_member_count(guild, guild.member_count + 1, now);
  db.delete_requests_of_user(user_id);
  member_changed(core, ctx, guild.guild_id, user_id, 'Joined');
}

/**
 * The change step of a role change on rows already locked and read again: the target gets `role`; a new `Leader`
 * makes the previous `Leader` an `Officer` (`previous_role`) and becomes `leader_id`. Calls the after hooks: the
 * target, then the previous `Leader`.
 */
export function apply_role(core: GuildCore, ctx: RequestCtx, db: GuildDb, guild: GuildRow, target: MemberRow, role: GuildRole, previous_role: GuildRole): void {
  if (target.role === role) return;
  db.set_role(target.user_id, role);
  const previous = role === Role.GUILD_ROLE_LEADER ? guild.leader_id : null;
  if (previous !== null) {
    if (previous !== target.user_id) db.set_role(previous, previous_role);
    db.set_leader(guild.guild_id, target.user_id);
  }
  member_changed(core, ctx, guild.guild_id, target.user_id, 'RoleChanged');
  if (previous !== null && previous !== target.user_id) member_changed(core, ctx, guild.guild_id, previous, 'RoleChanged');
}

/**
 * Role change(guild ID, target user ID, role): locks in lock order (the guild row, then the current `Leader`'s and the
 * target's rows for `Leader`, else the target's row), reads them again and changes the role. Nothing changes on failure.
 */
export function change_role(core: GuildCore, ctx: RequestCtx, guild_id: bigint, user_id: bigint, role: unknown): RoleChangeFailure | null {
  if (!is_role(role)) return 'bad_role';
  if (lock(core, ctx, guild_id, []) === LOCK_FAILED) return LOCK_FAILED;
  const db = guild_db(core, ctx);
  const before = db.guild(guild_id);
  if (before === null) return 'no_guild';
  if (lock(core, ctx, null, role === Role.GUILD_ROLE_LEADER ? [before.leader_id, user_id] : [user_id]) === LOCK_FAILED) return LOCK_FAILED;
  const guild = db.guild(guild_id);
  const target = db.member(user_id);
  if (guild === null) return 'no_guild';
  if (target?.guild_id !== guild_id) return 'not_member';
  if (target.role === Role.GUILD_ROLE_LEADER && role !== Role.GUILD_ROLE_LEADER) return 'leader';
  if (officer_limit(core, db, guild_id, target, role)) return 'officer_limit';
  apply_role(core, ctx, db, guild, target, role, Role.GUILD_ROLE_OFFICER);
  return null;
}

/**
 * Disband: calls the after hook (`Disbanded`) and the disband listeners in registration order, then deletes the guild,
 * name, join request and member rows. A listener's throw goes up and the transaction rolls back.
 */
export function disband(core: GuildCore, ctx: RequestCtx, db: GuildDb, guild: GuildRow, user_id: bigint): void {
  member_changed(core, ctx, guild.guild_id, user_id, 'Disbanded');
  for (const listener of core.listeners) listener(ctx, guild.guild_id);
  db.delete_guild(guild.guild_id);
  db.delete_name(guild.normalized_name, guild.guild_id);
  db.delete_requests_of_guild(guild.guild_id);
  db.delete_members(guild.guild_id);
}

/** Removes a member row and lowers `member_count`; `cooldown` writes the member's cooldown. */
export function remove_member(core: GuildCore, ctx: RequestCtx, db: GuildDb, guild: GuildRow, user_id: bigint, cooldown: boolean): GuildRow {
  const now = core.time.now(ctx);
  db.delete_member(user_id);
  const written = db.set_member_count(guild, guild.member_count - 1, now);
  if (cooldown) db.set_cooldown(user_id, now + core.settings.rejoin_cooldown_ms);
  return written;
}

/** The successor among `rows`: the earliest `Officer`, else the earliest `Member`, that `eligible` lets through. */
export function successor(rows: readonly MemberRow[], eligible: (row: MemberRow) => boolean): MemberRow | null {
  for (const role of [Role.GUILD_ROLE_OFFICER, Role.GUILD_ROLE_MEMBER]) {
    const found = rows.filter((r) => r.role === role && eligible(r)).sort(by_seniority)[0];
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * Leader succession of `GetMyGuild` (`### leader succession`). Locks the guild row and all its member rows, reads them
 * again and hands `Leader` to the successor when the condition still holds.
 */
export function leader_succession(core: GuildCore, ctx: RequestCtx, guild_id: bigint): LockFailed | null {
  const inactive_ms = core.settings.leader_inactive_ms;
  if (inactive_ms === null) return null;
  const now = core.time.now(ctx);
  const db = guild_db(core, ctx);
  const active = (row: MemberRow): boolean => row.active_at + inactive_ms > now;
  const due = (rows: readonly MemberRow[]): MemberRow | null => {
    const me = rows.find((r) => r.user_id === ctx.user_id);
    const leader = rows.find((r) => r.role === Role.GUILD_ROLE_LEADER);
    return me === undefined || leader === undefined || me.role === Role.GUILD_ROLE_LEADER || active(leader) ? null : leader;
  };
  if (due(db.members(guild_id)) === null) return null;
  const rows = lock_with_members(core, ctx, guild_id);
  if (rows === LOCK_FAILED) return LOCK_FAILED;
  const guild = db.guild(guild_id);
  const leader = due(rows);
  if (guild === null || leader === null) return null;
  const next = successor(rows, (r) => r.role !== Role.GUILD_ROLE_LEADER && active(r));
  if (next === null) return null;
  apply_role(core, ctx, db, { ...guild, leader_id: leader.user_id }, next, Role.GUILD_ROLE_LEADER, Role.GUILD_ROLE_MEMBER);
  core_log(core, ctx, 'info', 'guild leader succession', { guild_id, previous_leader: leader.user_id, new_leader: next.user_id });
  return null;
}

/**
 * `remove_user` (`### withdrawal`): takes the user out of guild tables in the lock order the spec gives. Returns
 * `FAILED` on a lock wait limit or when the user's member row moved to another guild before it was locked.
 */
export function remove_user(core: GuildCore, ctx: RequestCtx): LockFailed | null {
  const user_id = ctx.user_id;
  const db = guild_db(core, ctx);
  const first = db.member(user_id);
  const locked_guild = first === null ? null : first.guild_id;
  const locked = locked_guild === null ? lock(core, ctx, null, [user_id]) : lock_with_members(core, ctx, locked_guild, [user_id]);
  if (locked === LOCK_FAILED) return LOCK_FAILED;
  const me = db.member(user_id);
  if (me !== null && me.guild_id !== locked_guild) return LOCK_FAILED;
  db.delete_requests_of_user(user_id);
  db.delete_cooldown(user_id);
  if (me === null) return null;
  const guild = db.guild(me.guild_id);
  if (guild === null) return LOCK_FAILED;
  const rows = db.members(me.guild_id);
  if (rows.length <= 1) {
    disband(core, ctx, db, guild, user_id);
    return null;
  }
  let current = guild;
  if (me.role === Role.GUILD_ROLE_LEADER) {
    const next = successor(rows, (r) => r.user_id !== user_id);
    if (next !== null) {
      db.set_role(next.user_id, Role.GUILD_ROLE_LEADER);
      db.set_leader(guild.guild_id, next.user_id);
      current = { ...guild, leader_id: next.user_id };
      member_changed(core, ctx, guild.guild_id, next.user_id, 'RoleChanged');
    }
  }
  remove_member(core, ctx, db, current, user_id, false);
  member_changed(core, ctx, guild.guild_id, user_id, 'Left');
  return null;
}
