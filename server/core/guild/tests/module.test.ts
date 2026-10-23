/**
 * The `guild` module object made with `create_guild` on module objects that record what guild asks of them: the module
 * input holds only the keys of guild's `## settings`, `GetGuild` calls `get_public_profiles` once, and `SearchGuilds`
 * reads at most `guild.maxSearchResults` rows.
 */
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import type { RequestCtx } from '../../storage/index.ts';
import { check_hook_output } from '../../storage/hook_output.ts';
import { create_guild, type Guild } from '../index.ts';

/** The keys of guild's `## settings`, and only those. */
const SETTINGS: Readonly<Record<string, unknown>> = {
  'guild.maxMembers': 30,
  'guild.maxMembersLimit': 200,
  'guild.maxOfficers': 3,
  'guild.minNameLength': 2,
  'guild.maxNameLength': 16,
  'guild.maxDescriptionLength': 200,
  'guild.maxSearchResults': 3,
  'guild.maxJoinRequestsPerUser': 3,
  'guild.maxJoinRequestsPerGuild': 50,
  'guild.rejoinCooldownMs': 86_400_000,
  'guild.leaderInactiveMs': null,
};

const GUILD_ID = 7n;
const CTX = { user_id: 1n, request_id: 'r', request_name: 'core/GetGuild' } as unknown as RequestCtx;

interface Query {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface Fake {
  readonly guild: Guild;
  readonly queries: Query[];
  readonly profile_calls: (readonly bigint[])[];
}

function guild_row(guild_id: bigint, name: string): Record<string, unknown> {
  return {
    guild_id,
    name,
    normalized_name: name,
    description: '',
    join_type: CoreContract.GuildJoinType.GUILD_JOIN_TYPE_OPEN,
    join_value: 0n,
    leader_id: 1n,
    member_count: 1,
    max_members: 30,
    created_at: 0n,
    updated_at: 0n,
  };
}

/** A guild module on recording dependencies; the DB answers guild rows from `guilds` and `member_count` member rows. */
function fake(guilds: readonly Record<string, unknown>[], member_count: number): Fake {
  const queries: Query[] = [];
  const profile_calls: (readonly bigint[])[] = [];
  const handle = {
    query(sql: string, params: readonly unknown[]): Record<string, unknown>[] {
      queries.push({ sql, params });
      if (sql.includes('FROM guild_guild WHERE guild_id = $1')) return guilds.filter((g) => g.guild_id === params[0]);
      if (sql.includes('FROM guild_guild WHERE normalized_name')) return [...guilds];
      if (sql.includes('FROM guild_member WHERE guild_id = $1')) {
        return Array.from({ length: member_count }, (_, i) => ({
          user_id: BigInt(i + 1),
          guild_id: params[0],
          role: i === 0 ? CoreContract.GuildRole.GUILD_ROLE_LEADER : CoreContract.GuildRole.GUILD_ROLE_MEMBER,
          joined_at: BigInt(i),
          active_at: BigInt(i),
        }));
      }
      return [];
    },
  };
  const modules: Record<string, unknown> = {
    storage: {
      register_table: () => null,
      db: () => handle,
      read_db: () => handle,
      lock_game_row: () => null,
      get_user_record: () => null,
      check_hook_output,
    },
    'server-time': { now: () => 0n, is_reached_strict: () => true, clock_now: () => 0n },
    logging: { write: () => null },
    validation: {
      is_plain_text: () => true,
      normalize_text: (text: string) => text.toLowerCase(),
      check_text: () => ({ result: 'OK', banned_word_id: 0 }),
    },
    'public-profile': {
      get_public_profiles: (_ctx: RequestCtx, user_ids: readonly bigint[]) => {
        profile_calls.push([...user_ids]);
        return user_ids.map((user_id) => {
          const entry = new CoreContract.PublicProfileEntry();
          entry.user_id = user_id;
          return entry;
        });
      },
    },
  };
  return { guild: create_guild({ settings: SETTINGS, modules, server: { env: 'LOCAL' } }), queries, profile_calls };
}

describe('create_guild', () => {
  it('starts from a settings input that holds only the keys of guild\'s settings', () => {
    expect(() => fake([], 0)).not.toThrow();
  });
});

describe('GetGuild', () => {
  it('fills the profiles of every member from one get_public_profiles call', () => {
    const { guild, profile_calls } = fake([guild_row(GUILD_ID, 'home')], 150);
    const request = new CoreContract.GetGuildRequest();
    request.guild_id = GUILD_ID;
    const response = guild.GetGuild(CTX, request) as CoreContract.GetGuildResponse;
    expect(profile_calls).toHaveLength(1);
    expect(profile_calls[0]).toHaveLength(150);
    expect(response.members).toHaveLength(150);
  });
});

describe('SearchGuilds', () => {
  it('reads guild rows from the normalized name up in normalized name order, at most guild.maxSearchResults rows, and keeps the prefix matches', () => {
    const { guild, queries } = fake([guild_row(1n, 'team a'), guild_row(2n, 'team b'), guild_row(3n, 'zoo')], 0);
    const request = new CoreContract.SearchGuildsRequest();
    request.name = 'Team';
    const response = guild.SearchGuilds(CTX, request) as CoreContract.SearchGuildsResponse;
    expect(response.guilds.map((g) => g.guild_id)).toEqual([1n, 2n]);
    const search = queries.filter((q) => q.sql.includes('FROM guild_guild WHERE normalized_name'));
    expect(search).toHaveLength(1);
    expect(search[0]?.sql).toMatch(/WHERE normalized_name >= \$1 ORDER BY normalized_name ASC LIMIT \$2$/);
    expect(search[0]?.params).toEqual(['team', 3]);
  });
});
