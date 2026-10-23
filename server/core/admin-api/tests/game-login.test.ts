// Kill switch on a game `rpc` that has the name of a core `rpc`: game `Login` against core `core/Login`.
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { admin, CoreError, login, send, start, stop, type Server } from './helpers.ts';

// The core test data contract has no `service Game` `rpc Login`, so this file adds one next to its `rpc`s.
vi.mock('../../../generated/contract/game_contract.ts', async (import_original) => {
  const actual = await import_original<Record<string, unknown>>();
  const core = await import('../../../generated/contract/core_contract.ts');
  const game_login: CoreContract.RpcInfo = {
    name: 'Login',
    request_class: core.ResyncRequest,
    response_class: core.ResyncResponse,
    silent: false,
    retry: false,
    sensitive: false,
    errors: [],
    validate: () => null,
  };
  return { ...actual, RPCS: [...(actual.RPCS as readonly CoreContract.RpcInfo[]), game_login] };
});

/** The current version of a terms item: game settings `termsDocuments`. */
function terms_version(server: Server, key: 'TERMS' | 'PRIVACY'): number {
  const documents = server.settings().termsDocuments as Record<string, { version?: unknown } | undefined> | undefined;
  return Number(documents?.[key]?.version ?? 0);
}

describe('kill switch on a game rpc named like a core rpc', () => {
  let server: Server;
  afterEach(async () => {
    await stop(server);
  });

  it('answers FEATURE_DISABLED only to the game rpc Login when its kill switch is on, and processes core/Login', async () => {
    server = await start();
    const { session } = await login(server, 'game_login');
    expect((await send(session, 'Login', new CoreContract.ResyncRequest())).code).toBe(0);
    expect((await admin(server, 'set_kill_switch', { request_name: 'Login', enabled: true })).status).toBe(200);
    expect((await admin(server, 'get_switches')).json).toEqual({ maintenance: false, kill_switches: ['Login'] });
    expect((await send(session, 'Login', new CoreContract.ResyncRequest())).code).toBe(CoreError.CORE_ERROR_FEATURE_DISABLED);
    // core/Login is not stopped: a guest core/Login without a session gives a new session.
    const agreements = (['TERMS', 'PRIVACY'] as const).map((key) =>
      Object.assign(new CoreContract.TermsAgreement(), { item: CoreContract.TermsItem[`TERMS_ITEM_${key}`], version: terms_version(server, key) }),
    );
    const request = Object.assign(new CoreContract.LoginRequest(), { provider: CoreContract.LoginProvider.LOGIN_PROVIDER_GUEST, agreements });
    const guest = await send({ ...session, user_id: 0n, access_token: '', login_token: '', session_signing_key: '' }, 'core/Login', request);
    expect(guest.code).toBe(0);
    const result = (guest.response as CoreContract.LoginResponse).result;
    expect(result).not.toBeNull();
    expect(result?.user_id).not.toBe(0n);
    expect(result?.user_id).not.toBe(session.user_id);
    expect(result?.access_token).not.toBe('');
  });
});
