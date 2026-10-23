import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { ProfileUserState, QuestUserState } from '../../storage/tests/kinds.ts';
import type { Converter, Migration } from '../index.ts';
import type { KindClass } from '../../storage/index.ts';
import { new_db, server, start_server, stop_all, type ServerOptions } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const keep: Converter = (item) => item;

/** A `register` (or `before_start`) that registers `keep` for the kind and from version. */
function converter(kind: KindClass, from_version: number): (m: Migration) => void {
  return (m) => {
    m.register_converter(kind, from_version, keep);
  };
}

async function start_failure(options: Omit<ServerOptions, 'db'>): Promise<string> {
  const started = start_server({ ...options, db: await new_db() });
  if (typeof started !== 'string') {
    started.stop();
    throw new Error('the server started');
  }
  return started;
}

describe('register_converter', () => {
  it('a (kind, from version) not in GameContract.CONVERTERS stops server start', async () => {
    const failure = await start_failure({ register: converter(ProfileUserState, 1) });
    expect(failure).toContain('ProfileUserState from version 1 is not in GameContract.CONVERTERS');
  });

  it('a (kind, from version) of GameContract.CONVERTERS left unregistered stops server start', async () => {
    const failure = await start_failure({ converters: { 'DeckUserState:2': null } });
    expect(failure).toContain('DeckUserState from version 2 of GameContract.CONVERTERS is not registered');
  });

  it('a kind outside user_state.proto, server_state.proto and game_state.proto stops server start', async () => {
    const core_kind = CoreContract.KINDS[0]?.kind_class;
    if (core_kind === undefined) throw new Error('no core kind');
    const failure = await start_failure({ register: converter(core_kind, 1) });
    expect(failure).toContain('is not a kind of user_state.proto, server_state.proto or game_state.proto');
  });

  it('a from version below 1 or not below the current contract version stops server start', async () => {
    expect(await start_failure({ register: converter(QuestUserState, 0) })).toContain('from version 0 of QuestUserState is not in [1, 3)');
    expect(await start_failure({ register: converter(QuestUserState, 3) })).toContain('from version 3 of QuestUserState is not in [1, 3)');
  });

  it('the same (kind, from version) registered twice stops server start', async () => {
    const failure = await start_failure({ register: converter(QuestUserState, 1) });
    expect(failure).toContain('QuestUserState from version 1 is registered twice');
  });

  it('a call outside register stops server start, and a call after server start throws', async () => {
    expect(await start_failure({ before_start: converter(QuestUserState, 1) })).toContain('called outside register');
    const s = await server();
    expect(() => {
      s.migration.register_converter(QuestUserState, 1, keep);
    }).toThrow();
  });
});
