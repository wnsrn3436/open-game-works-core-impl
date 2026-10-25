import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as CoreCheatContract from '../../../dev/generated/contract/core_cheat_contract.ts';
import * as GameContract from '../../../generated/contract/game_contract.ts';
import {
  E,
  P,
  T0,
  admin,
  agreement,
  anonymous,
  auto_login,
  call,
  current_agreements,
  fake,
  guest,
  login,
  login_token_rows,
  missing,
  user_ids,
  personal_rows,
  probe,
  session_of,
  social,
  start,
  testing,
  token_hash,
  type TestServer,
} from './helpers.ts';

const TERMS = CoreContract.TermsItem.TERMS_ITEM_TERMS;
const PRIVACY = CoreContract.TermsItem.TERMS_ITEM_PRIVACY;

describe('Login', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await start();
  });
  afterAll(async () => {
    await testing.stop_test_server(server);
  });

  it('guest Login makes a user and fills every AuthResult field; remote_config is the GetRemoteConfig response', async () => {
    const { session, result } = await guest(server);
    expect(result.user_id).toBeGreaterThan(0n);
    expect(result.user_created_at).toBe(T0);
    expect(result.login_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.access_token.split('.')).toHaveLength(3);
    expect(result.access_token_expires_at).toBeGreaterThan(T0);
    expect(result.session_signing_key).not.toBe('');
    expect(result.linked_providers).toEqual([]);
    expect(result.public_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(result.consent).not.toBeNull();
    expect(result.remote_config).not.toBeNull();
    if (missing('remote-config')) {
      // Without `remote-config` in the server module list, `remote_config` has empty `entries` and `assignments`.
      expect(result.remote_config?.entries).toEqual([]);
      expect(result.remote_config?.assignments).toEqual([]);
      return;
    }
    const remote = await call<CoreContract.GetRemoteConfigResponse>(session, 'core/GetRemoteConfig', new CoreContract.GetRemoteConfigRequest());
    expect(remote.code).toBe(0);
    expect(result.remote_config?.encode()).toEqual(remote.response.encode());
  });

  it('AuthResult of Login and AutoLogin has the public code of that user, the same one at every login', async () => {
    const first = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'public-code-1');
    expect(first.result.public_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const again = await login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:public-code-1');
    expect(again.code).toBe(0);
    expect(again.response.result?.user_id).toBe(first.result.user_id);
    expect(again.response.result?.public_code).toBe(first.result.public_code);
    const auto = await auto_login(server, again.response.result?.login_token ?? '');
    expect(auto.code).toBe(0);
    expect(auto.response.result?.public_code).toBe(first.result.public_code);
    const other = await guest(server);
    expect(other.result.public_code).not.toBe(first.result.public_code);
  });

  it('a GUEST Login with a credential is INVALID_REQUEST and makes no user', async () => {
    const before = await user_ids(server);
    expect((await login(server, P.LOGIN_PROVIDER_GUEST, 'something')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await user_ids(server)).toEqual(before);
  });

  it('a Login whose provider is UNSPECIFIED or not a LoginProvider value is INVALID_REQUEST and makes no user', async () => {
    const before = await user_ids(server);
    expect((await login(server, P.LOGIN_PROVIDER_UNSPECIFIED, 'fake:a')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await login(server, 99 as CoreContract.LoginProvider, 'fake:a')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await user_ids(server)).toEqual(before);
  });

  it('an agreement list with TERMS_ITEM_UNSPECIFIED or TERMS twice is INVALID_REQUEST for Login and AutoLogin and writes nothing', async () => {
    const before = await user_ids(server);
    const unspecified = [agreement(CoreContract.TermsItem.TERMS_ITEM_UNSPECIFIED), ...current_agreements()];
    const twice = [agreement(TERMS), agreement(TERMS), agreement(PRIVACY)];
    expect((await login(server, P.LOGIN_PROVIDER_GUEST, '', unspecified)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await login(server, P.LOGIN_PROVIDER_GUEST, '', twice)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await user_ids(server)).toEqual(before);
    const user = await guest(server);
    const rows = await personal_rows(server, user.result.user_id, 'auth_terms_agreement');
    expect((await auto_login(server, user.result.login_token, unspecified)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect((await auto_login(server, user.result.login_token, twice)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
    expect(await personal_rows(server, user.result.user_id, 'auth_terms_agreement')).toEqual(rows);
    // The requested token is still the one to use: no next token was made.
    expect((await auto_login(server, user.result.login_token)).code).toBe(0);
  });

  it('a TERMS-only list is CONSENT_REQUIRED whatever is stored; an empty list passes only on stored agreements to both', async () => {
    const user = await guest(server);
    expect((await auto_login(server, user.result.login_token, [agreement(TERMS)])).code).toBe(E.CORE_ERROR_CONSENT_REQUIRED);
    const next = await auto_login(server, user.result.login_token);
    expect(next.code).toBe(0);
    const dev = await testing.login(server, 'auth_no_agreements');
    expect((await auto_login(server, dev.login_token)).code).toBe(E.CORE_ERROR_CONSENT_REQUIRED);
  });

  it('a login token keeps working however far the clock moves', async () => {
    const user = await guest(server);
    testing.advance_time(server, 10n * 365n * 86_400_000n);
    const reply = await auto_login(server, user.result.login_token);
    expect(reply.code).toBe(0);
  });

  it('a GOOGLE Login and LinkAccount where adapters.login-google is null are INVALID_REQUEST without an adapter call', async () => {
    const plain = await start({ social: false });
    try {
      expect((await login(plain, P.LOGIN_PROVIDER_GOOGLE, 'fake:g')).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
      const user = await guest(plain);
      const link = Object.assign(new CoreContract.LinkAccountRequest(), { provider: P.LOGIN_PROVIDER_GOOGLE, credential: 'fake:g' });
      expect((await call(user.session, 'core/LinkAccount', link)).code).toBe(E.CORE_ERROR_INVALID_REQUEST);
      expect(() => fake(plain, 'login-google')).toThrow(/uses no adapter for login-google/);
    } finally {
      await testing.stop_test_server(plain);
    }
  });

  it('records core_session_started for a user that allows analytics, after core_user_created when the Login made the user', async () => {
    const user = await guest(server);
    const again = await auto_login(server, user.result.login_token);
    expect(again.code).toBe(0);
    const from = user.result.user_created_at;
    const events = await admin(server, 'list_server_events', { user_id: user.result.user_id.toString(), from_at: from.toString(), to_at: (from + 86_400_000n).toString(), limit: 100 });
    expect(events.status).toBe(200);
    const names = (events.body.entries as { name: string }[]).map((e) => e.name);
    expect(names).toEqual(['core_user_created', 'core_session_started', 'core_session_started']);
  });
});

describe('Login with a newer terms version', () => {
  it('Login and AutoLogin with the previous version are CONSENT_REQUIRED', async () => {
    const server = await start({ settings: { termsDocuments: { TERMS: { version: 2, url: 'https://example.com/terms' }, PRIVACY: { version: 1, url: 'https://example.com/privacy' } } } });
    try {
      expect((await login(server, P.LOGIN_PROVIDER_GUEST)).code).toBe(E.CORE_ERROR_CONSENT_REQUIRED);
      const current = [agreement(TERMS, 2), agreement(PRIVACY, 1)];
      const user = await login(server, P.LOGIN_PROVIDER_GUEST, '', current);
      expect(user.code).toBe(0);
      expect((await auto_login(server, user.response.result?.login_token ?? '', current_agreements())).code).toBe(E.CORE_ERROR_CONSENT_REQUIRED);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});

describe('login token rows', () => {
  it('Login and AutoLogin write last_used_at at the request time: a guest is swept exactly that long after its last use', async () => {
    const after = 1_000_000n;
    const server = await start({ settings: { 'auth.inactiveGuestDeleteAfterMs': Number(after), 'auth.guestSweepIntervalMs': 1000, 'auth.guestSweepBatchSize': 1000 } });
    try {
      const user = await guest(server);
      testing.advance_time(server, 500_000n);
      const rotated = await auto_login(server, user.result.login_token);
      const result = rotated.response.result;
      expect(rotated.code).toBe(0);
      if (result === null) return;
      testing.advance_time(server, after - 1000n);
      await testing.wait_background(server);
      expect(await probe(session_of(await anonymous(server), result))).toBe(0);
      testing.advance_time(server, 1000n);
      await testing.wait_background(server);
      expect((await auto_login(server, result.login_token)).code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('the login token rows Login, AutoLogin and DevLogin issue have created_at and last_used_at at the request time', async () => {
    const server = await start();
    try {
      const row_of = async (user_id: bigint, login_token: string): Promise<Record<string, unknown> | undefined> =>
        (await login_token_rows(server, user_id)).find((row) => row.token_hash === token_hash(login_token));
      const login_at = T0 + 1_000n;
      testing.set_time(server, login_at);
      const user = await guest(server);
      expect(await row_of(user.result.user_id, user.result.login_token)).toMatchObject({ created_at: login_at, last_used_at: login_at });
      const auto_at = T0 + 7_000n;
      testing.set_time(server, auto_at);
      const next = (await auto_login(server, user.result.login_token)).response.result;
      if (next === null) throw new Error('AutoLogin failed');
      expect(await row_of(user.result.user_id, next.login_token)).toMatchObject({ created_at: auto_at, last_used_at: auto_at });
      const dev_at = T0 + 13_000n;
      testing.set_time(server, dev_at);
      const dev = await testing.login(server, 'row_times');
      expect(await row_of(dev.user_id, dev.login_token)).toMatchObject({ created_at: dev_at, last_used_at: dev_at });
    } finally {
      await testing.stop_test_server(server);
    }
  });
});

describe('DevLogin', () => {
  it('is UNAUTHORIZED on an STG server', async () => {
    const server = await start({ env: 'STG', social: false });
    try {
      const body = Object.assign(new CoreCheatContract.DevLoginRequest(), { account_name: 'stg_user' }).encode();
      const reply = (await testing.send_raw(server, 'POST', '/core/cheat/DevLogin', { 'Content-Type': 'application/x-protobuf', 'X-Ogw-Request-Id': crypto.randomUUID() }, body)) as { status: number; body: Uint8Array };
      const envelope = CoreContract.ResponseEnvelope.decode(reply.body);
      expect(envelope?.error?.code).toBe(E.CORE_ERROR_UNAUTHORIZED);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('two concurrent DevLogins of a new name get one user; the other new user is withdrawn with no user scope rows', async () => {
    const server = await start();
    try {
      const before = await user_ids(server);
      const [a, b] = await Promise.all([testing.login(server, 'same_new_name'), testing.login(server, 'same_new_name')]);
      expect(a.user_id).toBe(b.user_id);
      const made = [...(await user_ids(server))].filter((id) => !before.has(id));
      // Both requests may make a new user, or the second may already find the first one's row.
      const records = (await Promise.all(made.map((id) => admin(server, 'get_user', { user_id: id.toString() })))).filter((r) => r.status === 200);
      const live = records.filter((r) => r.body.withdrawn_at === null);
      expect(live).toHaveLength(1);
      for (const gone of records.filter((r) => r.body.withdrawn_at !== null)) expect(gone.body.user_state).toEqual({});
    } finally {
      await testing.stop_test_server(server);
    }
  });
});

describe('Login full delta', () => {
  it('a started broadcast mail is in the Login full delta', async () => {
    const server = await start();
    try {
      const first = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'broadcast-1');
      const mail = { template_id: testing.load_data().dev.find_id_value('[mail_mailbox_plain]') };
      const sent = await admin(server, 'broadcast_mail', { operation_id: 'auth-broadcast-1', mail, start_at: first.result.user_created_at.toString() });
      expect(sent.status).toBe(200);
      const again = await login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:broadcast-1');
      expect(again.code).toBe(0);
      expect(again.envelope.user_state?.full).toBe(true);
      expect(again.envelope.user_state?.entries.map((e) => e.kind)).toContain('MailUserState');
    } finally {
      await testing.stop_test_server(server);
    }
  });

  // `live-event` is not in this core yet.
  it.skipIf(missing('live-event'))('the settlement of an ended live event round is in the Login full delta', async () => {
    // `[live_event_weekly]` repeats every 7 days from 2027-01-01; its round 3 is 2027-01-15T00:00Z to 2027-01-16T00:00Z.
    const event_id = testing.load_data().dev.find_id_value('[live_event_weekly]');
    const round_end = 1_800_000_000_000n + 16n * 3_600_000n;
    let live_event: { join_event(ctx: unknown, event_id: number): string } | null = null;
    const joined: string[] = [];
    const server = await start({
      register: (core) => {
        live_event = core['live-event'] as typeof live_event;
      },
      core_test: (ctx) => {
        if (live_event !== null) joined.push(live_event.join_event(ctx, event_id));
      },
    });
    try {
      const first = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'live-event-1');
      expect((await call(first.session, 'RunCoreTest', new GameContract.RunCoreTestRequest())).code).toBe(0);
      expect(joined).toEqual(['OK']);
      testing.set_time(server, round_end);
      const again = await login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:live-event-1');
      expect(again.code).toBe(0);
      expect(again.envelope.user_state?.full).toBe(true);
      const entries = (again.envelope.user_state?.entries ?? [])
        .filter((e) => e.kind === 'LiveEventEntryUserState')
        .map((e) => CoreContract.LiveEventEntryUserState.decode(e.value));
      expect(entries.map((e) => [e?.id, e?.round, e?.settled])).toEqual([[BigInt(event_id), 3, true]]);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('ItemChange and ItemMail of out-of-request changes are in the next Login item_changes and item_mails in order', async () => {
    const data = testing.load_data();
    const gold = data.dev.find_id_value('[gold]');
    const ticket = data.dev.find_id_value('[ticket]');
    // A content admin operation whose `grant_or_mail` cannot grant over `max_amount` (5, `Reject`) and mails instead.
    interface MailboxContent {
      grant_or_mail(ctx: unknown, items: { item_id: number; amount: bigint; big_amount: string }[], source: object, template_id: number, args: unknown[]): { result: string };
    }
    const register = (core: Readonly<Record<string, unknown>>): void => {
      const mailbox = core.mailbox as MailboxContent;
      (core.routing as { register_admin_operation(operation: object): void }).register_admin_operation({
        name: 'game_overflow_mail',
        role: 'economy',
        body: 'json',
        max_body_bytes: null,
        input: { user_id: { type: { kind: 'int64' }, optional: false } },
        user_target: 'user_id',
        handler: (_input: unknown, ctx: unknown) => ({ result: mailbox.grant_or_mail(ctx, [{ item_id: ticket, amount: 9n, big_amount: '' }], {}, data.dev.find_id_value('[mail_mailbox_plain]'), []).result }),
        prepare: null,
        audit_args: null,
      });
    };
    const server = await start({ register });
    try {
      const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'queued-1');
      const user_id = user.result.user_id.toString();
      expect((await admin(server, 'grant_items', { operation_id: 'auth-queued-1', user_id, items: [{ item_id: gold, amount: '5' }] })).status).toBe(200);
      const mailed = await admin(server, 'game_overflow_mail', { user_id });
      expect(mailed.body.result).toBe('Mailed');
      expect((await admin(server, 'grant_items', { operation_id: 'auth-queued-2', user_id, items: [{ item_id: gold, amount: '7' }] })).status).toBe(200);
      const again = await login(server, P.LOGIN_PROVIDER_GOOGLE, 'fake:queued-1');
      expect(again.code).toBe(0);
      const changes = again.envelope.item_changes;
      expect(changes.map((c) => [c.source, c.ref, c.item_id, c.delta])).toEqual([
        [CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN, 'grant_items', gold, 5n],
        [CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN, 'grant_items', gold, 7n],
      ]);
      expect(again.envelope.item_mails.map((m) => [m.source, m.ref, m.items.map((i) => [i.item_id, i.amount])])).toEqual([
        [CoreContract.ItemChangeSource.ITEM_CHANGE_SOURCE_ADMIN, 'game_overflow_mail', [[ticket, 9n]]],
      ]);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});
