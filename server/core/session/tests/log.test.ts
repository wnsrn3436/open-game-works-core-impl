import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import * as testing from '../../testing/dev/index.ts';
import { sign_request } from '../index.ts';
import { login, new_user, signed, start, stop_all, verify } from './session_kit.ts';

afterEach(() => {
  stop_all();
});

/** Replaces `write` of a stream with `fn` and returns the function that puts the stream back. */
function replace_write(stream: NodeJS.WriteStream, fn: (chunk: unknown) => boolean): () => void {
  const own = Object.getOwnPropertyDescriptor(stream, 'write');
  Object.defineProperty(stream, 'write', { value: fn, configurable: true, writable: true });
  return () => {
    if (own === undefined) Reflect.deleteProperty(stream, 'write');
    else Object.defineProperty(stream, 'write', own);
  };
}

/** Collects what is written to stdout, stderr and the console while `fn` runs. */
function captured(fn: () => void): string {
  const lines: string[] = [];
  const keep = (chunk: unknown): boolean => {
    lines.push(typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk));
    return true;
  };
  const saved_console = globalThis.console;
  const fake = (...args: unknown[]): void => {
    keep(args.map(String).join(' '));
  };
  globalThis.console = { ...saved_console, log: fake, info: fake, warn: fake, error: fake, debug: fake, trace: fake };
  const restore = [replace_write(process.stdout, keep), replace_write(process.stderr, keep)];
  try {
    fn();
  } finally {
    for (const back of restore) back();
    globalThis.console = saved_console;
  }
  return lines.join('\n');
}

describe('log', () => {
  it('has no signature of a request whose signature fails: session writes no log', async () => {
    const instance = await start({ 'session.signatureWindowMs': 1000 });
    const user = await new_user(instance.storage);
    const { session_id, signing_key } = await login(instance, user);
    const now = instance.time.clock_now();
    const bad = { ...signed(signing_key, 'core/Resync', now), name: 'Resync' };
    const late = signed(signing_key, 'core/Resync', now + 1001n);
    const unknown = signed('another-key', 'core/Resync', now);
    const output = captured(() => {
      expect(verify(instance, user, session_id, bad)).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
      expect(verify(instance, user, session_id, late)).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
      expect(verify(instance, user, session_id, unknown)).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
    });
    expect(output).toBe('');
    for (const signature of [bad.signature, late.signature, unknown.signature, signing_key]) expect(output).not.toContain(signature);
  });

  it('has no log call in the session code', () => {
    const folder = new URL('../', import.meta.url);
    const files = readdirSync(folder).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(new URL(name, folder), 'utf8');
      expect(text).not.toMatch(/\bconsole\.|process\.(stdout|stderr)|write_log_line/);
    }
  });

  it('has no signature of a request whose signature fails: no log line of the server holds the sent signature or the key', async () => {
    const server = await testing.start_test_server();
    try {
      const session = await testing.login(server, 'signaturelog');
      const ok = await testing.send(session, 'core/Resync', new CoreContract.ResyncRequest());
      expect(ok.envelope.error).toBeNull();
      const timestamp = ok.envelope.server_time_at;
      const body = new CoreContract.ResyncRequest().encode();
      const changed_body = Uint8Array.from([...body, 0x00]);
      const sent: { request_id: string; signature: string; raw_body: Uint8Array }[] = [];
      for (const [name, raw_body] of [['core/Resync', changed_body], ['Resync', body]] as const) {
        const request_id = randomUUID();
        const signature = sign_request(session.session_signing_key, name, request_id, String(timestamp), body);
        sent.push({ request_id, signature, raw_body });
      }
      for (const { request_id, signature, raw_body } of sent) {
        const result = await testing.send(session, 'core/Resync', new CoreContract.ResyncRequest(), request_id, timestamp, undefined, { 'X-Ogw-Signature': signature }, raw_body);
        expect(result.envelope.error?.code).toBe(CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED);
      }
      await testing.wait_background(server);
      const lines = testing.read_logs(server);
      // The second failure in the security log window is counted, not written: only the first has its `security` line.
      expect(lines.some((line) => line.kind === 'security' && line.request_id === sent[0]?.request_id)).toBe(true);
      for (const { request_id } of sent) expect(lines.some((line) => line.kind === 'request' && line.request_id === request_id)).toBe(true);
      const text = lines.map((line) => JSON.stringify(line)).join('\n');
      for (const { signature } of sent) expect(text).not.toContain(signature);
      expect(text).not.toContain(session.session_signing_key);
    } finally {
      await testing.stop_test_server(server);
    }
  });
});
