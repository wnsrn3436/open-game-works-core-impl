import { createHmac } from 'node:crypto';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { MAX_DURATION, start_server, started, stop_all } from './helpers.ts';

afterEach(() => {
  stop_all();
});

const START_AT = 1_800_000_123_456n;

function relays_of(transport: CoreContract.Transport): { url: string; username: string; credential: string; expires_at: bigint }[] {
  return transport.relays.map((r) => ({ url: r.url, username: r.username, credential: r.credential, expires_at: r.expires_at }));
}

describe('prepare_transport', () => {
  it('calls the turn adapter once per match and gives each match the relays the fake controller set for it, expiring at start_at + max_duration', async () => {
    const server = await started();
    const fake = server.fake;
    if (fake === null) throw new Error('no fake controller');
    fake.set_result('issue_relays', [{ url: 'turn:a.example:3478', username: 'ua', credential: 'ca' }]);
    const first = await server.p2p.prepare_transport('m-1', START_AT, MAX_DURATION);
    fake.set_result('issue_relays', [
      { url: 'turn:b.example:3478', username: 'ub', credential: 'cb' },
      { url: 'turns:b.example:5349', username: 'ub', credential: 'cb' },
    ]);
    const second = await server.p2p.prepare_transport('m-2', START_AT + 1000n, MAX_DURATION * 2n);

    expect(first.kind).toBe(CoreContract.TransportKind.TRANSPORT_KIND_P2_P);
    expect(relays_of(first)).toEqual([{ url: 'turn:a.example:3478', username: 'ua', credential: 'ca', expires_at: START_AT + MAX_DURATION }]);
    const second_expiry = START_AT + 1000n + MAX_DURATION * 2n;
    expect(relays_of(second)).toEqual([
      { url: 'turn:b.example:3478', username: 'ub', credential: 'cb', expires_at: second_expiry },
      { url: 'turns:b.example:5349', username: 'ub', credential: 'cb', expires_at: second_expiry },
    ]);
    expect(fake.calls()).toEqual([
      { operation: 'issue_relays', input: { match_id: 'm-1', expires_at: START_AT + MAX_DURATION } },
      { operation: 'issue_relays', input: { match_id: 'm-2', expires_at: second_expiry } },
    ]);
    expect(server.core_logs()).toEqual([]);
  });

  it.each(['communication_failure', 'rejected'] as const)('gives empty relays and a warn log when the turn adapter fails with %s', async (failure) => {
    const server = await started();
    server.fake?.set_result('issue_relays', [{ url: 'turn:a.example:3478', username: 'u', credential: 'c' }]);
    server.fake?.set_failure('issue_relays', failure);
    const transport = await server.p2p.prepare_transport('m-fail', START_AT, MAX_DURATION);
    expect(transport.kind).toBe(CoreContract.TransportKind.TRANSPORT_KIND_P2_P);
    expect(transport.relays).toEqual([]);
    const warns = server.core_logs().filter((line) => line.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.reason).toBe(failure);
    expect(warns[0]?.match_id).toBe('m-fail');
  });

  it('gives empty relays and a warn log when the turn adapter call passes p2p-signaling.turnTimeoutMs', async () => {
    const timeout_ms = 80;
    const server = await started({ settings: { 'p2p-signaling.turnTimeoutMs': timeout_ms } });
    server.fake?.set_result('issue_relays', [{ url: 'turn:a.example:3478', username: 'u', credential: 'c' }]);
    server.fake?.set_failure('issue_relays', 'timeout');
    const began = performance.now();
    const transport = await server.p2p.prepare_transport('m-slow', START_AT, MAX_DURATION);
    expect(performance.now() - began).toBeGreaterThanOrEqual(timeout_ms - 5);
    expect(transport.relays).toEqual([]);
    const warns = server.core_logs().filter((line) => line.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.reason).toBe('timeout');
    expect(server.fake?.calls()).toHaveLength(1);
  });

  it('does not call an adapter and logs nothing when environments.<ENV>.adapters.turn is absent', async () => {
    const server = await started({ turn: null });
    server.fake?.set_result('issue_relays', [{ url: 'turn:a.example:3478', username: 'u', credential: 'c' }]);
    const transport = await server.p2p.prepare_transport('m-none', START_AT, MAX_DURATION);
    expect(transport.kind).toBe(CoreContract.TransportKind.TRANSPORT_KIND_P2_P);
    expect(transport.relays).toEqual([]);
    expect(server.fake?.calls()).toEqual([]);
    expect(server.core_logs()).toEqual([]);
  });

  it('gives no STUN URL in LOCAL and p2p-signaling.stunUrls elsewhere', async () => {
    const stun = ['stun:stun.example:3478'];
    const local = await started({ settings: { 'p2p-signaling.stunUrls': stun } });
    expect((await local.p2p.prepare_transport('m-local', START_AT, MAX_DURATION)).stun_urls).toEqual([]);
    const dev = await started({ env: 'DEV', settings: { 'p2p-signaling.stunUrls': stun } });
    expect((await dev.p2p.prepare_transport('m-dev', START_AT, MAX_DURATION)).stun_urls).toEqual(stun);
  });

  it('makes its own fake adapter in a server instance with DEV code when the server instance gives none', async () => {
    const server = await started({ fake_override: false });
    const transport = await server.p2p.prepare_transport('m-own', START_AT, MAX_DURATION);
    expect(transport.relays).toEqual([]);
    expect(server.core_logs()).toEqual([]);
  });

  it('fails server start for adapter name fake in a server instance without DEV code that gives no fake adapter', async () => {
    expect(await start_server({ env: 'STG', turn: 'fake', fake_override: false })).toMatch(/fake/);
    const given = await started({ env: 'STG', turn: 'fake' });
    expect((await given.p2p.prepare_transport('m-stg', START_AT, MAX_DURATION)).relays).toEqual([]);
  });
});

describe('turn-coturn', () => {
  const urls = ['turn:relay.example:3478?transport=udp', 'turns:relay.example:5349'];

  it('makes one relay per URL with the TURN REST API username and the HMAC-SHA1 credential of the secret', async () => {
    const secret = 'coturn-static-auth-secret';
    const server = await started({
      env: 'DEV',
      turn: 'turn-coturn',
      settings: { 'environments.<ENV>.turnCoturn.urls': urls, 'environments.<ENV>.secrets.turn': 'turn-dev' },
      host_secrets: { 'turn-dev': secret },
    });
    const transport = await server.p2p.prepare_transport('m-coturn', START_AT, MAX_DURATION);
    const expires_at = START_AT + MAX_DURATION;
    const username = `${String(expires_at / 1000n)}:m-coturn`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    expect(relays_of(transport)).toEqual(urls.map((url) => ({ url, username, credential, expires_at })));
    expect(server.core_logs()).toEqual([]);
  });

  it('reads the secret under the secret file key turn in a server with --db, whatever the secret name is', async () => {
    const server = await started({
      turn: 'turn-coturn',
      settings: { 'environments.<ENV>.turnCoturn.urls': urls, 'environments.<ENV>.secrets.turn': 'turn-dev' },
      secrets: { turn: 'local-secret', 'turn-dev': 'host-secret' },
    });
    const transport = await server.p2p.prepare_transport('m-local', START_AT, MAX_DURATION);
    expect(transport.relays).toHaveLength(2);
    expect(transport.relays[0]?.credential).toBe(createHmac('sha1', 'local-secret').update(transport.relays[0]?.username ?? '').digest('base64'));
  });

  it('fails server start when the secret cannot be read or a URL scheme is not turn or turns', async () => {
    const missing = await start_server({
      env: 'DEV',
      turn: 'turn-coturn',
      settings: { 'environments.<ENV>.turnCoturn.urls': urls, 'environments.<ENV>.secrets.turn': 'turn-dev' },
      host_secrets: { turn: 's' },
    });
    expect(typeof missing).toBe('string');
    const bad = await start_server({
      env: 'DEV',
      turn: 'turn-coturn',
      settings: { 'environments.<ENV>.turnCoturn.urls': ['stun:relay.example:3478'], 'environments.<ENV>.secrets.turn': 'turn-dev' },
      host_secrets: { 'turn-dev': 's' },
    });
    expect(typeof bad).toBe('string');
    const unknown = await start_server({ turn: 'turn-other' });
    expect(typeof unknown).toBe('string');
  });
});
