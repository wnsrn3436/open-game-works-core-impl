/**
 * A PostgreSQL frontend/backend protocol 3.0 client: startup, cleartext, MD5 and SCRAM-SHA-256 authentication,
 * optional TLS, and the extended query protocol with `$n` parameters. Results come back in text format and are read
 * by column type: `int8` is bigint, `int2` and `int4` are number, `bool` is boolean, `bytea` is Uint8Array.
 * A connection that failed or closed stays failed; its owner opens a new one.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export type PgValue = bigint | number | boolean | string | Uint8Array | null;
export type PgRow = Record<string, PgValue>;

/** A server ErrorResponse, or `CONN` for a connection that failed or closed. */
export class PgError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: 'disable' | 'prefer' | 'require' | 'verify';
}

/** Reads a `postgresql://user:password@host:port/database?sslmode=...` connection string. */
export function parse_connection_string(text: string): PgConfig {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new PgError('CONN', 'the PostgreSQL connection string is not a postgresql:// URL');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new PgError('CONN', 'the PostgreSQL connection string is not a postgresql:// URL');
  const mode = url.searchParams.get('sslmode') ?? 'prefer';
  const ssl = mode === 'disable' ? 'disable' : mode === 'require' ? 'require' : mode.startsWith('verify') ? 'verify' : 'prefer';
  return {
    host: url.hostname === '' ? 'localhost' : url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port === '' ? 5432 : Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || decodeURIComponent(url.username),
    ssl,
  };
}

const OID_BOOL = 16;
const OID_BYTEA = 17;
const OID_INT8 = 20;
const OID_INT2 = 21;
const OID_INT4 = 23;
const OID_OID = 26;

function decode_hex(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text.startsWith('\\x') ? text.slice(2) : text, 'hex'));
}

function text_value(oid: number, text: string): PgValue {
  switch (oid) {
    case OID_BOOL:
      return text === 't';
    case OID_BYTEA:
      return decode_hex(text);
    case OID_INT8:
      return BigInt(text);
    case OID_INT2:
    case OID_INT4:
    case OID_OID:
      return Number(text);
    default:
      return text;
  }
}

/** Outgoing message builder. */
class Out {
  private readonly parts: Buffer[] = [];

  int16(v: number): this {
    const b = Buffer.alloc(2);
    b.writeInt16BE(v);
    this.parts.push(b);
    return this;
  }

  int32(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    this.parts.push(b);
    return this;
  }

  cstr(s: string): this {
    this.parts.push(Buffer.from(s, 'utf8'), Buffer.from([0]));
    return this;
  }

  bytes(b: Uint8Array): this {
    this.parts.push(Buffer.from(b));
    return this;
  }

  /** The message with a type byte (or none for the startup message) and its length. */
  message(type: string | null): Buffer {
    const body = Buffer.concat(this.parts);
    const len = Buffer.alloc(4);
    len.writeInt32BE(body.length + 4);
    return type === null ? Buffer.concat([len, body]) : Buffer.concat([Buffer.from(type, 'ascii'), len, body]);
  }
}

interface Message {
  type: string;
  body: Buffer;
}

/** The rows of a statement and its CommandComplete tag (for example `DELETE 3` or `COMMIT`). */
export interface PgResult {
  readonly rows: PgRow[];
  readonly tag: string;
}

/** The row count of a CommandComplete tag: its last word (`INSERT 0 5`, `DELETE 5`); 0 for a tag without one. */
export function tag_count(tag: string): number {
  const last = tag.slice(tag.lastIndexOf(' ') + 1);
  return /^[0-9]+$/.test(last) ? Number(last) : 0;
}

function error_fields(body: Buffer): { code: string; message: string } {
  let code = '';
  let message = '';
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const field = String.fromCharCode(body[i] as number);
    const end = body.indexOf(0, i + 1);
    const value = body.toString('utf8', i + 1, end);
    if (field === 'C') code = value;
    if (field === 'M') message = value;
    i = end + 1;
  }
  return { code, message };
}

function scram_proof(password: string, client_nonce: string, server_first: string): { final: string; server_signature: Buffer } {
  const attrs = new Map(server_first.split(',').map((p) => [p.slice(0, 1), p.slice(2)] as const));
  const nonce = attrs.get('r') ?? '';
  const salt = Buffer.from(attrs.get('s') ?? '', 'base64');
  const iterations = Number(attrs.get('i') ?? '0');
  if (!nonce.startsWith(client_nonce) || iterations < 1) throw new PgError('CONN', 'invalid SCRAM server message');
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const client_key = createHmac('sha256', salted).update('Client Key').digest();
  const stored_key = createHash('sha256').update(client_key).digest();
  const without_proof = `c=biws,r=${nonce}`;
  const auth_message = `n=,r=${client_nonce},${server_first},${without_proof}`;
  const signature = createHmac('sha256', stored_key).update(auth_message).digest();
  const proof = Buffer.from(client_key.map((b, i) => b ^ (signature[i] as number)));
  const server_key = createHmac('sha256', salted).update('Server Key').digest();
  return { final: `${without_proof},p=${proof.toString('base64')}`, server_signature: createHmac('sha256', server_key).update(auth_message).digest() };
}

/** One connection. Queries run one at a time in call order. */
export class PgConnection {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private readonly inbox: Message[] = [];
  private waiter: (() => void) | null = null;
  private failure: PgError | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(socket: Socket) {
    this.socket = socket;
    this.listen();
  }

  /**
   * Connects and authenticates. `signal` aborts the whole connect (the socket, TLS and authentication): it then rejects
   * with a `CONN` PgError. `keepalive_ms` turns on TCP keepalive after that idle time.
   */
  static async connect(config: PgConfig, signal: AbortSignal | null = null, keepalive_ms = 0): Promise<PgConnection> {
    const socket = await open_socket(config, signal, keepalive_ms);
    const conn = new PgConnection(socket);
    const abort = (): void => {
      conn.close('the connect to PostgreSQL went over its time limit');
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted === true) abort();
      if (config.ssl !== 'disable') await conn.upgrade(config);
      await conn.startup(config);
    } catch (error) {
      conn.close();
      throw error instanceof PgError ? error : new PgError('CONN', error instanceof Error ? error.message : String(error));
    } finally {
      signal?.removeEventListener('abort', abort);
    }
    return conn;
  }

  /** True once the connection failed or closed: every later statement rejects. */
  get failed(): boolean {
    return this.failure !== null;
  }

  /** Runs one statement with the extended query protocol. A failed statement rejects with a PgError. */
  query(sql: string, params: readonly PgValue[] = []): Promise<PgRow[]> {
    return this.execute(sql, params).then((result) => result.rows);
  }

  /** `query` that also gives the statement's CommandComplete tag. */
  execute(sql: string, params: readonly PgValue[] = []): Promise<PgResult> {
    const run = this.queue.then(() => this.extended(sql, params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Closes the connection; a statement waiting for its answer rejects with a `CONN` PgError of `reason`. */
  close(reason = 'the connection is closed'): void {
    if (this.failure === null) {
      try {
        this.socket.write(new Out().message('X'));
      } catch {
        // The socket is gone already.
      }
    }
    this.fail(new PgError('CONN', reason));
    this.socket.destroy();
  }

  private listen(): void {
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.split();
    });
    this.socket.on('error', (error) => {
      this.fail(new PgError('CONN', error.message));
    });
    this.socket.on('close', () => {
      this.fail(new PgError('CONN', 'the server closed the connection'));
    });
  }

  private split(): void {
    while (this.buffer.length >= 5) {
      const len = this.buffer.readInt32BE(1);
      if (this.buffer.length < len + 1) break;
      this.inbox.push({ type: String.fromCharCode(this.buffer[0] as number), body: this.buffer.subarray(5, len + 1) });
      this.buffer = this.buffer.subarray(len + 1);
    }
    this.wake();
  }

  private fail(error: PgError): void {
    if (this.failure === null) this.failure = error;
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  private async next(): Promise<Message> {
    for (;;) {
      const message = this.inbox.shift();
      if (message !== undefined) {
        if (message.type !== 'N' && message.type !== 'S' && message.type !== 'A') return message;
        continue;
      }
      if (this.failure !== null) throw this.failure;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }

  private send(buffer: Buffer): void {
    if (this.failure !== null) throw this.failure;
    this.socket.write(buffer);
  }

  private async upgrade(config: PgConfig): Promise<void> {
    this.socket.removeAllListeners('data');
    const answer = await new Promise<string>((resolve, reject) => {
      this.socket.once('data', (chunk: Buffer) => {
        resolve(String.fromCharCode(chunk[0] as number));
      });
      this.socket.once('error', reject);
      this.socket.once('close', () => {
        reject(this.failure ?? new PgError('CONN', 'the server closed the connection'));
      });
      this.socket.write(new Out().int32(80877103).message(null));
    });
    if (answer !== 'S') {
      if (config.ssl === 'require' || config.ssl === 'verify') throw new PgError('CONN', 'the server does not support TLS');
      this.socket.removeAllListeners();
      this.listen();
      return;
    }
    const plain = this.socket;
    plain.removeAllListeners();
    this.socket = await new Promise<Socket>((resolve, reject) => {
      const secure = tlsConnect({ socket: plain, servername: config.host, rejectUnauthorized: config.ssl === 'verify' }, () => {
        resolve(secure);
      });
      secure.once('error', reject);
      // A close of the connection (its time limit) while TLS starts ends the wait.
      this.socket = secure;
      secure.once('close', () => {
        reject(this.failure ?? new PgError('CONN', 'the server closed the connection'));
      });
    });
    this.listen();
  }

  private async startup(config: PgConfig): Promise<void> {
    this.send(new Out().int32(196608).cstr('user').cstr(config.user).cstr('database').cstr(config.database).cstr('client_encoding').cstr('UTF8').cstr('').message(null));
    let scram: { nonce: string; server_signature: Buffer | null } | null = null;
    for (;;) {
      const message = await this.next();
      if (message.type === 'E') {
        const { code, message: text } = error_fields(message.body);
        throw new PgError(code, text);
      }
      if (message.type === 'Z') return;
      if (message.type !== 'R') continue;
      scram = this.authenticate(config, message.body, scram);
    }
  }

  private authenticate(config: PgConfig, body: Buffer, scram: { nonce: string; server_signature: Buffer | null } | null): { nonce: string; server_signature: Buffer | null } | null {
    const kind = body.readInt32BE(0);
    switch (kind) {
      case 0:
        return scram;
      case 3:
        this.send(new Out().cstr(config.password).message('p'));
        return scram;
      case 5: {
        const inner = createHash('md5').update(config.password + config.user).digest('hex');
        const outer = createHash('md5').update(inner).update(body.subarray(4, 8)).digest('hex');
        this.send(new Out().cstr(`md5${outer}`).message('p'));
        return scram;
      }
      case 10: {
        const nonce = randomBytes(18).toString('base64');
        const first = Buffer.from(`n,,n=,r=${nonce}`, 'utf8');
        this.send(new Out().cstr('SCRAM-SHA-256').int32(first.length).bytes(first).message('p'));
        return { nonce, server_signature: null };
      }
      case 11: {
        if (scram === null) throw new PgError('CONN', 'unexpected SCRAM message');
        const { final, server_signature } = scram_proof(config.password, scram.nonce, body.toString('utf8', 4));
        this.send(new Out().bytes(Buffer.from(final, 'utf8')).message('p'));
        return { nonce: scram.nonce, server_signature };
      }
      case 12: {
        const verifier = body.toString('utf8', 4).split(',').find((p) => p.startsWith('v='));
        if (scram?.server_signature == null || verifier === undefined || !Buffer.from(verifier.slice(2), 'base64').equals(scram.server_signature)) {
          throw new PgError('CONN', 'the server SCRAM signature does not match');
        }
        return scram;
      }
      default:
        throw new PgError('CONN', `unsupported PostgreSQL authentication method ${String(kind)}`);
    }
  }

  private async extended(sql: string, params: readonly PgValue[]): Promise<PgResult> {
    const bind = new Out().cstr('').cstr('').int16(params.length);
    for (const p of params) bind.int16(p instanceof Uint8Array ? 1 : 0);
    bind.int16(params.length);
    for (const p of params) {
      if (p === null) {
        bind.int32(-1);
        continue;
      }
      const bytes = p instanceof Uint8Array ? Buffer.from(p) : Buffer.from(typeof p === 'boolean' ? (p ? 'true' : 'false') : String(p), 'utf8');
      bind.int32(bytes.length).bytes(bytes);
    }
    bind.int16(0);
    this.send(
      Buffer.concat([
        new Out().cstr('').cstr(sql).int16(0).message('P'),
        bind.message('B'),
        new Out().bytes(Buffer.from('P', 'ascii')).cstr('').message('D'),
        new Out().cstr('').int32(0).message('E'),
        new Out().message('S'),
      ]),
    );
    return this.results();
  }

  private async results(): Promise<PgResult> {
    let columns: { name: string; oid: number }[] = [];
    const rows: PgRow[] = [];
    let error: PgError | null = null;
    let tag = '';
    for (;;) {
      const message = await this.next();
      switch (message.type) {
        case 'T':
          columns = read_columns(message.body);
          break;
        case 'D':
          rows.push(read_row(message.body, columns));
          break;
        case 'C':
          tag = message.body.toString('utf8', 0, Math.max(0, message.body.indexOf(0)));
          break;
        case 'E': {
          const { code, message: text } = error_fields(message.body);
          error = new PgError(code, text);
          break;
        }
        case 'Z':
          if (error !== null) throw error;
          return { rows, tag };
        default:
          break;
      }
    }
  }
}

function read_columns(body: Buffer): { name: string; oid: number }[] {
  const count = body.readInt16BE(0);
  const columns: { name: string; oid: number }[] = [];
  let i = 2;
  for (let c = 0; c < count; c += 1) {
    const end = body.indexOf(0, i);
    const name = body.toString('utf8', i, end);
    i = end + 1;
    columns.push({ name, oid: body.readInt32BE(i + 6) });
    i += 18;
  }
  return columns;
}

function read_row(body: Buffer, columns: readonly { name: string; oid: number }[]): PgRow {
  const row: PgRow = {};
  const count = body.readInt16BE(0);
  let i = 2;
  for (let c = 0; c < count; c += 1) {
    const len = body.readInt32BE(i);
    i += 4;
    const column = columns[c] ?? { name: String(c), oid: 0 };
    if (len < 0) {
      row[column.name] = null;
      continue;
    }
    row[column.name] = text_value(column.oid, body.toString('utf8', i, i + len));
    i += len;
  }
  return row;
}

function open_socket(config: PgConfig, signal: AbortSignal | null, keepalive_ms: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const where = `${config.host}:${String(config.port)}`;
    if (signal?.aborted === true) {
      reject(new PgError('CONN', `the connect to PostgreSQL at ${where} went over its time limit`));
      return;
    }
    const socket = netConnect({ host: config.host, port: config.port });
    const abort = (): void => {
      socket.destroy();
      reject(new PgError('CONN', `the connect to PostgreSQL at ${where} went over its time limit`));
    };
    signal?.addEventListener('abort', abort, { once: true });
    socket.setNoDelay(true);
    if (keepalive_ms > 0) socket.setKeepAlive(true, keepalive_ms);
    socket.once('connect', () => {
      signal?.removeEventListener('abort', abort);
      socket.removeAllListeners('error');
      resolve(socket);
    });
    socket.once('error', (error) => {
      signal?.removeEventListener('abort', abort);
      reject(new PgError('CONN', `cannot connect to PostgreSQL at ${where}: ${error.message}`));
    });
  });
}
