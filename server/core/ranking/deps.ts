/**
 * The operations of other modules that `ranking` calls, as `ranking` uses them through their spec `## API`.
 * `storage`, `server-time` and `logging` are the merged module types; the rest are the shapes their specs give.
 */
import type * as CoreContract from '../../generated/contract/core_contract.ts';
import type { Logging } from '../logging/index.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import type { GameTx, RequestCtx, Storage } from '../storage/index.ts';

export type RankingStorage = Pick<
  Storage,
  | 'register_table'
  | 'db'
  | 'read_db'
  | 'run_user_transaction'
  | 'run_game_transaction'
  | 'lock_game_row'
  | 'after_commit'
>;

export type RankingServerTime = Pick<ServerTimeApi, 'clock_now' | 'get_period_number' | 'get_period_start' | 'get_next_reset' | 'schedule_job'>;

export type RankingLogging = Pick<Logging, 'write'>;

/** A `MailArg` of an integer value, as content code passes it to `mailbox.send_mail`. */
export interface IntMailArg {
  readonly name: string;
  readonly int_value: bigint;
}

/** The mail input of `mailbox.send_mail`. */
export interface MailInput {
  readonly template_id: number;
  readonly args: readonly IntMailArg[];
  readonly attachments: readonly CoreContract.ItemAmount[];
  readonly extra_id: number;
  readonly expire_ms: bigint;
  readonly no_expiry: boolean;
  readonly once_key: string;
}

export type MailResult = 'OK' | 'ALREADY_SENT' | 'INVALID_INPUT';

/** `mailbox.send_mail`. */
export interface RankingMailbox {
  send_mail(ctx: RequestCtx, input: MailInput): { readonly result: MailResult; readonly mail_id: bigint };
}

/** A round of `live-event.get_latest_round`: `(0, 0, 0)` when no round has started. */
export interface LatestRound {
  readonly round: number;
  readonly start_at: bigint;
  readonly end_at: bigint;
}

/** `live-event.get_latest_round`. */
export interface RankingLiveEvent {
  get_latest_round(event_id: number, time: bigint): LatestRound;
}

/** The guild of a member, as `guild.get_member` returns it. */
export interface GuildMember {
  readonly guild_id: bigint;
}

/** The `guild` operations `ranking` calls. */
export interface RankingGuild {
  get_member(ctx: RequestCtx, user_id: bigint): GuildMember | null;
  lock_guild(ctx: RequestCtx, guild_id: bigint): CoreContract.GuildInfo | null | 'FAILED';
  list_member_ids(ctx_or_tx: RequestCtx | GameTx, guild_id: bigint): readonly bigint[];
  get_guild_infos(ctx_or_tx: RequestCtx | GameTx, guild_ids: readonly bigint[]): readonly CoreContract.GuildInfo[];
  register_disband_listener(fn: (ctx_or_tx: RequestCtx | GameTx, guild_id: bigint) => void): void;
}

/** `nickname.get_nicknames`. */
export interface RankingNickname {
  get_nicknames(ctx: RequestCtx, user_ids: readonly bigint[]): readonly { readonly user_id: bigint; readonly nickname: string }[];
}

/** The module objects `ranking` reads from `modules`. `guild` and `nickname` are optional dependencies. */
export interface RankingModules {
  readonly storage: RankingStorage;
  readonly time: RankingServerTime;
  readonly logging: RankingLogging;
  readonly mailbox: RankingMailbox;
  readonly live_event: RankingLiveEvent;
  readonly guild: RankingGuild | null;
  readonly nickname: RankingNickname | null;
}

function required(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const value = modules[name];
  if (value === undefined || value === null) throw new TypeError(`ranking: module ${name} is missing`);
  return value;
}

function optional(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  return modules[name] ?? null;
}

/** The dependency module objects of the module input. A missing required dependency throws. */
export function read_modules(modules: Readonly<Record<string, unknown>>): RankingModules {
  required(modules, 'item-ledger');
  return {
    storage: required(modules, 'storage') as RankingStorage,
    time: required(modules, 'server-time') as RankingServerTime,
    logging: required(modules, 'logging') as RankingLogging,
    mailbox: required(modules, 'mailbox') as RankingMailbox,
    live_event: required(modules, 'live-event') as RankingLiveEvent,
    guild: optional(modules, 'guild') as RankingGuild | null,
    nickname: optional(modules, 'nickname') as RankingNickname | null,
  };
}
