/** `GetRankingTop`, `GetRankingAround`, `get_my_entry`, `get_season` (`## behavior` query). */
import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { DbHandle, GameTx, RequestCtx } from '../storage/index.ts';
import { find_board, previous_season, season_at, type Board, type Season } from './board.ts';
import { core_log, type RankingCore } from './core.ts';
import { count_ahead, read_page, read_score, type ScoreRow } from './store.ts';

type CoreErrorValue = typeof CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;

const INVALID_REQUEST: CoreErrorValue = CoreContract.CoreError.CORE_ERROR_INVALID_REQUEST;
const INT32_MAX = 2 ** 31 - 1;

/** A `RankingEntry` of a score row at `rank` (0 when out of the ranking). */
export function entry_of(board: Board, row: ScoreRow, rank: number): CoreContract.RankingEntry {
  const entry = new CoreContract.RankingEntry();
  entry.rank = rank;
  entry.score = row.score;
  if (board.guild) {
    entry.guild_id = row.entity_id;
  } else {
    entry.user_id = row.entity_id;
    entry.display = row.display;
  }
  return entry;
}

/** The entry of an entity without a score row, or without a rank: rank 0, score 0. */
function unranked(board: Board, entity_id: bigint): CoreContract.RankingEntry {
  return entry_of(board, { entity_id, score: 0n, reached_at: 0n, display: '' }, 0);
}

function copy(entry: CoreContract.RankingEntry): CoreContract.RankingEntry {
  return Object.assign(new CoreContract.RankingEntry(), entry);
}

/** The rank of a score row: rows ahead + 1, or 0 past `size`. Rows ahead are counted up to `size`. */
function rank_of(db: DbHandle, board: Board, season: bigint, row: ScoreRow): number {
  const ahead = count_ahead(db, board, board.id, season, row, board.size);
  return ahead < BigInt(board.size) ? Number(ahead) + 1 : 0;
}

/** Fills `nickname` (user board) from `nickname.get_nicknames`, `nickname.maxLookupCount` user IDs at a time. */
function fill_nicknames(core: RankingCore, ctx: RequestCtx, entries: readonly CoreContract.RankingEntry[]): void {
  const nickname = core.modules.nickname;
  const ids = [...new Set(entries.filter((e) => e.user_id !== 0n).map((e) => e.user_id))];
  if (nickname === null || ids.length === 0) return;
  const names = new Map<bigint, string>();
  const step = Math.max(1, core.settings.nickname_lookup_count);
  for (let i = 0; i < ids.length; i += step) {
    for (const found of nickname.get_nicknames(ctx, ids.slice(i, i + step))) names.set(found.user_id, found.nickname);
  }
  for (const entry of entries) if (entry.user_id !== 0n) entry.nickname = names.get(entry.user_id) ?? '';
}

/** Fills `guild_name` (guild board) from `guild.get_guild_infos`. A guild that is gone has an empty name. */
export function fill_guild_names(core: RankingCore, ctx_or_tx: RequestCtx | GameTx, entries: readonly CoreContract.RankingEntry[]): void {
  const guild = core.modules.guild;
  const ids = [...new Set(entries.filter((e) => e.guild_id !== 0n).map((e) => e.guild_id))];
  if (guild === null || ids.length === 0) return;
  const names = new Map(guild.get_guild_infos(ctx_or_tx, ids).map((info) => [info.guild_id, info.name]));
  for (const entry of entries) if (entry.guild_id !== 0n) entry.guild_name = names.get(entry.guild_id) ?? '';
}

function fill_names(core: RankingCore, ctx: RequestCtx, board: Board, entries: readonly CoreContract.RankingEntry[]): void {
  if (board.guild) fill_guild_names(core, ctx, entries);
  else fill_nicknames(core, ctx, entries);
}

/** The season a query reads: the season of `clock_now`, or the one before it. Null for a previous season that is not there. */
function query_season(core: RankingCore, board: Board, db: DbHandle, previous: boolean): Season | null {
  const now = core.modules.time.clock_now();
  return previous ? previous_season(core, board, db, now) : season_at(core, board, db, now);
}

/** `get_season`: the season of `clock_now` and its end time. */
export function get_season(core: RankingCore, ctx: RequestCtx, board_id: number): { season: bigint; season_ends_at: bigint } | 'UNKNOWN_BOARD' {
  const board = find_board(ctx.data, board_id);
  if (board === null) {
    core_log(core, 'error', 'get_season: unknown board', { board_id }, ctx);
    return 'UNKNOWN_BOARD';
  }
  const season = season_at(core, board, core.modules.storage.db(ctx), core.modules.time.clock_now());
  return { season: season.season, season_ends_at: season.ends_at };
}

/** The entity of "me" on a board: the user, or the guild `guild.get_member` gives (0 when not a member). */
function my_entity(core: RankingCore, ctx: RequestCtx, board: Board): bigint {
  if (!board.guild) return ctx.user_id;
  return core.modules.guild?.get_member(ctx, ctx.user_id)?.guild_id ?? 0n;
}

/** My entry: rank 0 and score 0 without a score row; rank 0 with the score past `size`. */
function my_entry_in(core: RankingCore, ctx: RequestCtx, board: Board, db: DbHandle, season: bigint): CoreContract.RankingEntry {
  const entity = my_entity(core, ctx, board);
  const row = entity === 0n ? null : read_score(db, board, board.id, season, entity);
  return row === null ? unranked(board, entity) : entry_of(board, row, rank_of(db, board, season, row));
}

/** `get_my_entry`. A board ID value that is not in `ranking_board` throws. */
export function get_my_entry(core: RankingCore, ctx: RequestCtx, board_id: number): CoreContract.RankingEntry {
  const board = find_board(ctx.data, board_id);
  if (board === null) throw new RangeError(`ranking: get_my_entry of board ${String(board_id)}, not in ranking_board`);
  const db = core.modules.storage.db(ctx);
  const entry = my_entry_in(core, ctx, board, db, season_at(core, board, db, core.modules.time.clock_now()).season);
  if (board.guild) fill_guild_names(core, ctx, [entry]);
  return entry;
}

function page_entries(board: Board, db: DbHandle, season: bigint, offset: number, limit: number): CoreContract.RankingEntry[] {
  const count = Math.min(limit, board.size - offset);
  return read_page(db, board, board.id, season, offset, count).map((row, i) => entry_of(board, row, offset + i + 1));
}

function cache_key(board_id: number, season: bigint, offset: number, limit: number): string {
  return `${String(board_id)}:${String(season)}:${String(offset)}:${String(limit)}`;
}

/**
 * Drops the cache entries past their time. Entries are in the order they were put, each `topCacheMs` after its put, so
 * the sweep stops at the first entry that has not expired.
 */
function sweep_top_cache(core: RankingCore, now: bigint): void {
  for (const [k, v] of core.top_cache) {
    if (now < v.expires_at) return;
    core.top_cache.delete(k);
  }
}

/** Cached entries of `(board, season, offset, limit)`; each call reads the rows once the cache entry is past its time. */
function cached_top(core: RankingCore, ctx: RequestCtx, board: Board, db: DbHandle, season: bigint, offset: number, limit: number): CoreContract.RankingEntry[] {
  const now = core.modules.time.clock_now();
  const key = cache_key(board.id, season, offset, limit);
  const hit = core.top_cache.get(key);
  if (hit !== undefined && now < hit.expires_at) return hit.entries.map(copy);
  const entries = page_entries(board, db, season, offset, limit);
  fill_names(core, ctx, board, entries);
  sweep_top_cache(core, now);
  // A key put again goes to the end, so the entries stay in put order.
  core.top_cache.delete(key);
  core.top_cache.set(key, { entries: entries.map(copy), expires_at: now + core.settings.top_cache_ms });
  return entries;
}

function valid_board(ctx: RequestCtx, board_id: unknown): Board | null {
  return typeof board_id === 'number' ? find_board(ctx.data, board_id) : null;
}

/** Core rpc `GetRankingTop`. */
export function get_ranking_top(core: RankingCore, ctx: RequestCtx, request: CoreContract.GetRankingTopRequest): CoreContract.GetRankingTopResponse | CoreErrorValue {
  const board = valid_board(ctx, request.board_id);
  const { offset, limit } = request;
  if (board === null || !Number.isInteger(offset) || offset < 0 || offset > INT32_MAX) return INVALID_REQUEST;
  if (!Number.isInteger(limit) || limit < 1 || limit > core.settings.max_page_size) return INVALID_REQUEST;
  const db = core.modules.storage.db(ctx);
  const response = new CoreContract.GetRankingTopResponse();
  const season = query_season(core, board, db, request.previous);
  if (season === null) return response;
  response.season = season.season;
  response.season_ends_at = season.ends_at;
  response.entries = offset >= board.size ? [] : cached_top(core, ctx, board, db, season.season, offset, limit);
  return response;
}

/** The rows of ranks `from` up to `to` (both included, 1-based). */
function ranks(board: Board, db: DbHandle, season: bigint, from: number, to: number): CoreContract.RankingEntry[] {
  return to < from ? [] : page_entries(board, db, season, from - 1, to - from + 1);
}

/** Core rpc `GetRankingAround`. */
export function get_ranking_around(core: RankingCore, ctx: RequestCtx, request: CoreContract.GetRankingAroundRequest): CoreContract.GetRankingAroundResponse | CoreErrorValue {
  const board = valid_board(ctx, request.board_id);
  if (board === null) return INVALID_REQUEST;
  const db = core.modules.storage.db(ctx);
  const response = new CoreContract.GetRankingAroundResponse();
  const season = query_season(core, board, db, request.previous);
  if (season === null) {
    response.my_entry = unranked(board, my_entity(core, ctx, board));
    return response;
  }
  response.season = season.season;
  response.season_ends_at = season.ends_at;
  const mine = my_entry_in(core, ctx, board, db, season.season);
  const rank = mine.rank;
  const around = core.settings.around_count;
  const before = rank === 0 ? [] : ranks(board, db, season.season, Math.max(1, rank - around), rank - 1);
  const after = rank === 0 ? [] : ranks(board, db, season.season, rank + 1, Math.min(board.size, rank + around));
  fill_names(core, ctx, board, [mine, ...before, ...after]);
  response.my_entry = mine;
  response.entries = [...before, ...after];
  return response;
}
