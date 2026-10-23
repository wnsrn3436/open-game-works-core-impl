import * as CoreContract from '../../generated/contract/core_contract.ts';
import type { ServerTimeApi } from '../server-time/index.ts';
import { bad_coturn_url, create_turn_coturn_adapter } from './adapters/turn_coturn.ts';
import { SessionStore, type Connection, type ParticipantChange } from './sessions.ts';
import { is_relay_list, is_turn_adapter, on_abort, type TurnAdapter, type TurnRelayCredential } from './turn.ts';

export type { Connection, ParticipantChange, ParticipantChangeKind } from './sessions.ts';
export type { TurnAdapter, TurnFailure, TurnRelayCredential } from './turn.ts';

const MODULE = 'p2p-signaling';
const JOB_SWEEP = 'p2p_session_sweep';

/** The `logging` log entry fields p2p-signaling writes (`logging` `## API` `write`). */
export interface CoreLogEntry {
  readonly kind: 'core';
  readonly level: 'debug' | 'warn';
  readonly message: string;
  readonly user_id: bigint | null;
  readonly request_id: null;
  readonly request: null;
  readonly fields: Readonly<Record<string, string | number | bigint | boolean>>;
}

/** The `logging` operation p2p-signaling calls. */
export interface LoggingWrite {
  write(entry: CoreLogEntry): void;
}

/** The fields of the module input `server` (`server-core` `## module`) that p2p-signaling reads. */
export interface P2pSignalingServer {
  readonly env: 'LOCAL' | 'DEV' | 'STG' | 'PROD';
  /** `--db`: set in a LOCAL server and a test server, null elsewhere. */
  readonly db: string | null;
  read_secret(name: string): string | null;
  /** The fake adapter override by adapter key. */
  readonly fake_adapters: Readonly<Record<string, unknown>>;
}

/**
 * The module input (`server-core` `## module`). `settings` holds the keys of `## settings`; the keys with `<ENV>` hold
 * the value of this server instance's environment. `modules` holds `server-time` and `logging`.
 */
export interface P2pSignalingInput {
  readonly settings: Readonly<Record<string, unknown>>;
  readonly modules: Readonly<Record<string, unknown>>;
  readonly server: P2pSignalingServer;
}

/** What only the DEV code gives p2p-signaling (`dev/index.ts`). */
export interface P2pSignalingDevCode {
  /** A new fake `turn` adapter, for adapter name `fake` when the server instance gives none. */
  create_fake_turn(): TurnAdapter;
}

/** The `## API` operations of `p2p-signaling`, the lifecycle and the slot its DEV code fills. */
export interface P2pSignaling {
  prepare_transport(match_id: string, start_at: bigint, max_duration: bigint): Promise<CoreContract.Transport>;
  open_match_session(
    match_id: string,
    players: readonly CoreContract.MatchPlayer[],
    connections: readonly Connection[],
    transport: CoreContract.Transport,
    expires_at: bigint,
  ): ParticipantChange[];
  handle_frame(connection: Connection, frame: CoreContract.MatchmakerFrame): ParticipantChange | null;
  connection_closed(connection: Connection): ParticipantChange | null;
  begin_start(): void;
  complete_start(): string | null;
  stop(): void;
  /** For the DEV code: called before `begin_start` in a server instance with DEV code. */
  include_dev_code(dev: P2pSignalingDevCode): void;
}

function integer_setting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`p2p-signaling: setting ${key} is not an integer`);
  return value;
}

function strings_setting(settings: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = settings[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`p2p-signaling: setting ${key} is not a string list`);
  const list: unknown[] = value;
  if (!list.every((v): v is string => typeof v === 'string')) throw new TypeError(`p2p-signaling: setting ${key} is not a string list`);
  return [...list];
}

function module_of(modules: Readonly<Record<string, unknown>>, name: string): unknown {
  const value = modules[name];
  if (value === undefined || value === null) throw new TypeError(`p2p-signaling: module ${name} is missing`);
  return value;
}

/** Makes `p2p-signaling` for one server instance. A missing or malformed setting, or a missing module, throws. */
export function create_p2p_signaling(input: P2pSignalingInput): P2pSignaling {
  const { settings, modules, server } = input;
  const time = module_of(modules, 'server-time') as ServerTimeApi;
  const logging = module_of(modules, 'logging') as LoggingWrite;
  const stun_urls = strings_setting(settings, 'p2p-signaling.stunUrls');
  const turn_timeout_ms = integer_setting(settings, 'p2p-signaling.turnTimeoutMs');
  const max_payload_bytes = integer_setting(settings, 'p2p-signaling.maxPayloadBytes');
  const sweep_interval_ms = integer_setting(settings, 'p2p-signaling.sweepIntervalMs');
  const adapter_name = settings['environments.<ENV>.adapters.turn'] ?? null;
  const coturn_urls = strings_setting(settings, 'environments.<ENV>.turnCoturn.urls');
  const secret_setting = settings['environments.<ENV>.secrets.turn'];
  // A LOCAL server and a test server read the secret file key; the others the host secret store name.
  const secret_name = server.db !== null ? 'turn' : typeof secret_setting === 'string' ? secret_setting : '';

  const start_errors: string[] = [];
  let dev: P2pSignalingDevCode | null = null;
  let adapter: TurnAdapter | null = null;

  const log = (level: 'debug' | 'warn', message: string, user_id: bigint | null, fields: Readonly<Record<string, string | number | bigint | boolean>>): void => {
    logging.write({ kind: 'core', level, message, user_id, request_id: null, request: null, fields: { module: MODULE, ...fields } });
  };

  const store = new SessionStore({
    max_payload_bytes,
    clock_now: () => time.clock_now(),
    dropped: (connection, frame_kind, reason) => {
      log('debug', `${frame_kind} frame dropped`, connection.user_id, { frame: frame_kind, reason });
    },
  });

  const pick_adapter = (): TurnAdapter | null => {
    if (adapter_name === null) return null;
    if (adapter_name === 'turn-coturn') {
      const bad_url = bad_coturn_url(coturn_urls);
      if (bad_url !== null) {
        start_errors.push(`p2p-signaling: coturn relay URL ${JSON.stringify(bad_url)} is not turn or turns`);
        return null;
      }
      const secret = server.read_secret(secret_name);
      if (secret === null || secret === '') {
        start_errors.push(`p2p-signaling: secret ${secret_name} of turn-coturn cannot be read`);
        return null;
      }
      return create_turn_coturn_adapter(coturn_urls, secret);
    }
    if (adapter_name !== 'fake') {
      start_errors.push(`p2p-signaling: unknown turn adapter ${JSON.stringify(adapter_name)}`);
      return null;
    }
    const given = server.fake_adapters.turn;
    if (is_turn_adapter(given)) return given;
    if (dev !== null) return dev.create_fake_turn();
    start_errors.push('p2p-signaling: turn adapter fake needs DEV code');
    return null;
  };

  /** The relays of a match, or the failure that empties them. */
  const issue_relays = async (match_id: string, expires_at: bigint): Promise<TurnRelayCredential[] | string> => {
    if (adapter === null) return [];
    const signal = time.network_time_limit(BigInt(turn_timeout_ms));
    let result: unknown;
    try {
      result = await Promise.race([adapter.issue_relays(match_id, expires_at, signal), on_abort(signal)]);
    } catch {
      return 'communication_failure';
    }
    if (typeof result === 'string') return result;
    if (!is_relay_list(result)) return 'invalid_result';
    return result.map((relay) => ({ url: relay.url, username: relay.username, credential: relay.credential }));
  };

  return {
    async prepare_transport(match_id, start_at, max_duration) {
      const expires_at = start_at + max_duration;
      const transport = new CoreContract.Transport();
      transport.kind = CoreContract.TransportKind.TRANSPORT_KIND_P2_P;
      transport.stun_urls = server.env === 'LOCAL' ? [] : [...stun_urls];
      const relays = await issue_relays(match_id, expires_at);
      if (typeof relays === 'string') {
        log('warn', 'turn relays not issued', null, { match_id, reason: relays });
        return transport;
      }
      transport.relays = relays.map((relay) => {
        const r = new CoreContract.TransportRelay();
        r.url = relay.url;
        r.username = relay.username;
        r.credential = relay.credential;
        r.expires_at = expires_at;
        return r;
      });
      return transport;
    },
    open_match_session: (match_id, players, connections, transport, expires_at) => store.open(match_id, players, connections, transport, expires_at),
    handle_frame: (connection, frame) => store.handle(connection, frame),
    connection_closed: (connection) => store.closed(connection),
    begin_start() {
      adapter = pick_adapter();
      time.schedule_job(JOB_SWEEP, BigInt(sweep_interval_ms), () => {
        store.sweep();
      });
    },
    complete_start: () => start_errors[0] ?? null,
    stop() {
      store.clear();
      adapter = null;
    },
    include_dev_code(code) {
      dev = code;
    },
  };
}
