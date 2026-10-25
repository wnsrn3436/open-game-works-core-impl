import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { E, P, T0, admin, call, data_folder_with, db_rows, guest, logs, personal_rows, probe, social, start, testing, token_hash, remove_data_folders, translation_binary, user_record, withdraw, type TestServer, type TestSession } from './helpers.ts';

interface Page {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
}

async function raw(server: TestServer, method: 'GET' | 'POST', headers: Record<string, string>, body = ''): Promise<Page> {
  const reply = (await testing.send_raw(server, method, '/account/deletion', headers, new TextEncoder().encode(body))) as { status: number; headers: Record<string, string>; body: Uint8Array };
  const lower = Object.fromEntries(Object.entries(reply.headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status: reply.status, headers: lower, text: new TextDecoder().decode(reply.body) };
}

function post(server: TestServer, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Page> {
  return raw(server, 'POST', { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, new URLSearchParams(form).toString());
}

async function issue(session: TestSession): Promise<CoreContract.IssueDeletionCodeResponse> {
  const reply = await call<CoreContract.IssueDeletionCodeResponse>(session, 'core/IssueDeletionCode', new CoreContract.IssueDeletionCodeRequest());
  expect(reply.code).toBe(0);
  return reply.response;
}

function by_code(public_code: string, code: string): Record<string, string> {
  return { method: 'code', confirm: 'yes', public_code, code };
}

/** A public code no user has: users are few, and a code is one of 32^8. */
const NO_USER_CODE = 'ZZZZZZZZ';

/** A page body without its per-response nonce. */
function without_nonce(text: string): string {
  return text.replace(/nonce="[^"]*"/g, 'nonce=""');
}

function wrong(code: string): string {
  return code.startsWith('0') ? `1${code.slice(1)}` : `0${code.slice(1)}`;
}

describe('IssueDeletionCode and the code method', () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await start({ settings: { 'auth.deletionCodeMaxAttempts': 3, 'auth.deletionAttemptsPerMinute': 1000 } });
  });
  afterAll(async () => {
    await testing.stop_test_server(server);
  });

  it('gives a deletion code of auth.deletionCodeLength with expires_at at request time + auth.deletionCodeTtlMs and keeps no code text; a new code voids the old one', async () => {
    const user = await guest(server);
    const first = await issue(user.session);
    expect(first.code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    expect(first.expires_at).toBe(T0 + 3_600_000n);
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/account\/deletion$/);
    const rows = await db_rows(server, 'SELECT code_hash FROM auth_deletion_code WHERE user_id = $1', [user.result.user_id]);
    expect(rows).toEqual([{ code_hash: token_hash(first.code) }]);
    expect(JSON.stringify(rows)).not.toContain(first.code);
    expect((logs(server)).some((l) => JSON.stringify(l).includes(first.code))).toBe(false);
    await issue(user.session);
    expect((await post(server, by_code(user.result.public_code, first.code))).status).toBe(403);
  });

  it('the right code deletes the account: 200, no user scope rows, the next request UNAUTHORIZED, audit reason web_deletion', async () => {
    const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'web-delete-1');
    const { code } = await issue(user.session);
    // The public code as a person may type it: lowercase with `-` after 4 characters.
    const typed = user.result.public_code.toLowerCase().replace(/(.{4})/, '$1-');
    const page = await post(server, by_code(typed, code.toLowerCase().replace(/(.{5})/, '$1-')));
    expect(page.status).toBe(200);
    expect(await personal_rows(server, user.result.user_id, 'auth_social_link')).toEqual([]);
    expect((await user_record(server, user.result.user_id))?.withdrawn_at).not.toBeNull();
    expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    const audits = (logs(server, 'audit')) as { reason?: unknown; method?: unknown }[];
    expect(audits.some((l) => l.reason === 'web_deletion' && l.method === 'code')).toBe(true);
  });

  it('a wrong code is 403 and counts an attempt; after auth.deletionCodeMaxAttempts wrong codes the right one is 403 too', async () => {
    const counted = await guest(server);
    const a = await issue(counted.session);
    for (let i = 0; i < 2; i += 1) expect((await post(server, by_code(counted.result.public_code, wrong(a.code)))).status).toBe(403);
    expect((await post(server, by_code(counted.result.public_code, a.code))).status).toBe(200);
    const spent = await guest(server);
    const b = await issue(spent.session);
    for (let i = 0; i < 3; i += 1) expect((await post(server, by_code(spent.result.public_code, wrong(b.code)))).status).toBe(403);
    expect((await post(server, by_code(spent.result.public_code, b.code))).status).toBe(403);
  });

  it('a code at its expires_at, a missing user and a withdrawn user are 403 with the same result page', async () => {
    const user = await guest(server);
    const { code, expires_at } = await issue(user.session);
    const pages: Page[] = [];
    pages.push(await post(server, by_code(NO_USER_CODE, code)));
    const left = await guest(server);
    const left_code = await issue(left.session);
    expect(await withdraw(left.session)).toBe(0);
    pages.push(await post(server, by_code(left.result.public_code, left_code.code)));
    testing.set_time(server, expires_at);
    pages.push(await post(server, by_code(user.result.public_code, code)));
    expect(pages.map((p) => p.status)).toEqual([403, 403, 403]);
    expect(new Set(pages.map((p) => without_nonce(p.text))).size).toBe(1);
  });

  it('a public_code that is not a public code input is 400 [auth_deletion_failed]; a code no user has is 403 [auth_deletion_failed]', async () => {
    const user = await guest(server);
    const { code } = await issue(user.session);
    // The result page of [auth_deletion_failed]: that of a body without confirm.
    const failed = await post(server, { method: 'code', public_code: user.result.public_code, code });
    expect(failed.status).toBe(400);
    for (const bad of [user.result.public_code.slice(0, 7), `${user.result.public_code.slice(0, 7)}U`, `${user.result.public_code}0`, user.result.user_id.toString()]) {
      const page = await post(server, by_code(bad, code));
      expect(page.status).toBe(400);
      expect(without_nonce(page.text)).toBe(without_nonce(failed.text));
    }
    const unknown = await post(server, by_code(NO_USER_CODE, code));
    expect(unknown.status).toBe(403);
    expect(without_nonce(unknown.text)).toBe(without_nonce(failed.text));
    expect(await probe(user.session)).toBe(0);
  });

  it('a body without confirm or with an unknown field is 400 and changes nothing', async () => {
    const user = await guest(server);
    const { code } = await issue(user.session);
    const before = await testing.read_user_state(server, user.result.user_id);
    const form = by_code(user.result.public_code, code);
    expect((await post(server, { method: 'code', public_code: form.public_code ?? '', code })).status).toBe(400);
    expect((await post(server, { ...form, extra: '1' })).status).toBe(400);
    expect(await testing.read_user_state(server, user.result.user_id)).toEqual(before);
    expect(await probe(user.session)).toBe(0);
  });
});

describe('the google method', () => {
  it('deletes the user linked to the fake login-google account and is 403 for an account with no link', async () => {
    const server = await start();
    try {
      const user = await social(server, P.LOGIN_PROVIDER_GOOGLE, 'web-google-1');
      expect((await post(server, { method: 'google', confirm: 'yes', credential: 'fake:not-linked' })).status).toBe(403);
      expect((await post(server, { method: 'google', confirm: 'yes', credential: 'fake:web-google-1' })).status).toBe(200);
      expect(await probe(user.session)).toBe(E.CORE_ERROR_UNAUTHORIZED);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('has no Google form and is 400 where adapters.login-google is null', async () => {
    const server = await start({ social: false });
    try {
      const page = await raw(server, 'GET', {});
      expect(page.status).toBe(200);
      expect(page.text).not.toContain('value="google"');
      expect((await post(server, { method: 'google', confirm: 'yes', credential: 'fake:x' })).status).toBe(400);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});

describe('the deletion page', () => {
  it('limits POSTs per IP and minute window with 429 and takes them again in the next window', async () => {
    const server = await start({ settings: { 'auth.deletionAttemptsPerMinute': 2 } });
    try {
      const form = { method: 'code', confirm: 'yes', public_code: NO_USER_CODE, code: '0000000000' };
      expect((await post(server, form)).status).toBe(403);
      expect((await post(server, form)).status).toBe(403);
      expect((await post(server, form)).status).toBe(429);
      testing.advance_time(server, 60_000n);
      expect((await post(server, form)).status).toBe(403);
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('is 503 for a POST during maintenance with nothing changed, while the GET page is 200', async () => {
    const server = await start();
    try {
      const user = await guest(server);
      const { code } = await issue(user.session);
      expect((await admin(server, 'set_maintenance', { enabled: true })).status).toBe(200);
      expect((await post(server, by_code(user.result.public_code, code))).status).toBe(503);
      expect((await raw(server, 'GET', {})).status).toBe(200);
      expect((await admin(server, 'set_maintenance', { enabled: false })).status).toBe(200);
      expect((await user_record(server, user.result.user_id))?.withdrawn_at).toBeNull();
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('serves the supported language that shares the primary subtag and the source language when none matches', async () => {
    const server = await start({ settings: { supportedLanguages: ['en', 'ko'], sourceLanguage: 'en' } });
    try {
      expect((await raw(server, 'GET', { 'Accept-Language': 'ko-KR' })).text).toContain('<html lang="ko">');
      expect((await raw(server, 'GET', { 'Accept-Language': 'fr-FR, de;q=0.5' })).text).toContain('<html lang="en">');
    } finally {
      await testing.stop_test_server(server);
    }
  });

  it('shows the texts of the page language translation binary and only the translation keys when that binary does not decode', async () => {
    const data = testing.load_data().data;
    const title = data.ReservedString.auth_deletion_title();
    const body = data.ReservedString.auth_deletion_body();
    const valid = translation_binary([[title, '계정 삭제'], [body, '본문']]);
    const settings = { supportedLanguages: ['en', 'ko'], sourceLanguage: 'en' };
    const good = await start({ settings, data_folder: data_folder_with({ 'translation_ko.bin': valid }) });
    try {
      const text = (await raw(good, 'GET', { 'Accept-Language': 'ko' })).text;
      expect(text).toContain('계정 삭제');
      expect(text).toContain('본문');
    } finally {
      await testing.stop_test_server(good);
    }
    // Valid entries and then a truncated entry: no partial text.
    const broken = await start({ settings, data_folder: data_folder_with({ 'translation_ko.bin': Uint8Array.from([...valid, 0x0a, 0x05, 0x0a, 0x01]) }) });
    try {
      const text = (await raw(broken, 'GET', { 'Accept-Language': 'ko' })).text;
      expect(text).not.toContain('계정 삭제');
      expect(text).not.toContain('본문');
      expect(text).toContain(title);
      expect(text).toContain(body);
    } finally {
      await testing.stop_test_server(broken);
    }
  });

  it('sends a Content-Security-Policy whose nonce the page script elements carry, on the page and the result page', async () => {
    const server = await start({ social: false, real: { 'login-google': 'login-google' }, settings: { 'loginGoogle.serverClientId': 'server-client' } });
    try {
      const page = await raw(server, 'GET', {});
      const nonce = /'nonce-([^']+)'/.exec(page.headers['content-security-policy'] ?? '')?.[1];
      expect(nonce).toBeDefined();
      const scripts = [...page.text.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) expect(script).toContain(`nonce="${nonce ?? ''}"`);
      expect(page.headers['cache-control']).toBe('no-store');
      const result = await post(server, { method: 'code', confirm: 'yes', public_code: NO_USER_CODE, code: '0000000000' });
      expect(result.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    } finally {
      await testing.stop_test_server(server);
    }
  });
});

afterAll(() => {
  remove_data_folders();
});
