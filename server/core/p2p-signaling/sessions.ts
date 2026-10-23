import * as CoreContract from '../../generated/contract/core_contract.ts';

const Kind = CoreContract.MatchmakerFrameKind;

/**
 * A connection `matchmaker` passes: an authenticated `/realtime` WebSocket with its user, frame sending and closing.
 * p2p-signaling tells connections apart by object identity.
 */
export interface Connection {
  readonly user_id: bigint;
  send(frame: CoreContract.MatchmakerFrame): void;
  close(): void;
}

/** How a participant's binding to a match session changed. */
export type ParticipantChangeKind = 'LEFT' | 'DISCONNECTED' | 'REJOINED';

/** A participant change: the match, the participant index and how it changed. */
export interface ParticipantChange {
  readonly match_id: string;
  readonly index: number;
  readonly kind: ParticipantChangeKind;
}

/** The signaling state of one match, in the server instance's memory. */
interface MatchSession {
  readonly match_id: string;
  readonly players: readonly CoreContract.MatchPlayer[];
  /** The connection bound to each index, or null. */
  readonly bound: (Connection | null)[];
  /** The indices that left. They stay until the session is removed. */
  readonly left: Set<number>;
  readonly transport: CoreContract.Transport;
  readonly expires_at: bigint;
}

/** What the session store needs from its module. */
export interface SessionEnv {
  readonly max_payload_bytes: number;
  clock_now(): bigint;
  /** A `debug` log of a dropped frame. */
  dropped(connection: Connection, frame_kind: string, reason: string): void;
}

function frame(kind: CoreContract.MatchmakerFrameKind, fill: (f: CoreContract.MatchmakerFrame) => void): CoreContract.MatchmakerFrame {
  const f = new CoreContract.MatchmakerFrame();
  f.kind = kind;
  fill(f);
  return f;
}

function index_frame(kind: CoreContract.MatchmakerFrameKind, index: number): CoreContract.MatchmakerFrame {
  return frame(kind, (f) => {
    f.index = index;
  });
}

/** The match sessions of one server instance and the session each connection is bound to. */
export class SessionStore {
  readonly #env: SessionEnv;
  readonly #sessions = new Map<string, MatchSession>();
  readonly #binding = new Map<Connection, { readonly session: MatchSession; readonly index: number }>();

  constructor(env: SessionEnv) {
    this.#env = env;
  }

  clear(): void {
    this.#sessions.clear();
    this.#binding.clear();
  }

  open(
    match_id: string,
    players: readonly CoreContract.MatchPlayer[],
    connections: readonly Connection[],
    transport: CoreContract.Transport,
    expires_at: bigint,
  ): ParticipantChange[] {
    if (this.#sessions.has(match_id)) throw new TypeError(`open_match_session: match ${match_id} has a session`);
    if (connections.length !== players.length) throw new TypeError('open_match_session: one connection per player');
    if (new Set(connections).size !== connections.length) throw new TypeError('open_match_session: a connection is given twice');
    const indices = players.map((player) => player.index);
    if (indices.some((index, i) => index !== i)) throw new TypeError('open_match_session: player indices are not 0 to count − 1 in order');
    const changes: ParticipantChange[] = [];
    for (const connection of connections) {
      const change = this.#leave(connection);
      if (change !== null) changes.push(change);
    }
    const session: MatchSession = { match_id, players: [...players], bound: [...connections], left: new Set(), transport, expires_at };
    this.#sessions.set(match_id, session);
    connections.forEach((connection, index) => this.#binding.set(connection, { session, index }));
    return changes;
  }

  handle(connection: Connection, f: CoreContract.MatchmakerFrame): ParticipantChange | null {
    switch (f.kind) {
      case Kind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL:
        this.#signal(connection, f);
        return null;
      case Kind.MATCHMAKER_FRAME_KIND_MATCH_LEAVE:
        return this.#match_leave(connection, f.match_id);
      case Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOIN:
        return this.#rejoin(connection, f.match_id);
      default:
        return null;
    }
  }

  closed(connection: Connection): ParticipantChange | null {
    const bound = this.#unbind(connection);
    if (bound === null) return null;
    return { match_id: bound.session.match_id, index: bound.index, kind: 'DISCONNECTED' };
  }

  /** Removes the sessions with no bound connection and the sessions whose `expires_at` ≤ `clock_now`. */
  sweep(): void {
    const now = this.#env.clock_now();
    for (const session of [...this.#sessions.values()]) {
      if (session.expires_at > now && session.bound.some((c) => c !== null)) continue;
      for (const connection of session.bound) if (connection !== null) this.#binding.delete(connection);
      this.#sessions.delete(session.match_id);
    }
  }

  #signal(connection: Connection, f: CoreContract.MatchmakerFrame): void {
    const kind = 'PEER_SIGNAL';
    const bound = this.#binding.get(connection);
    if (bound === undefined) {
      this.#env.dropped(connection, kind, 'not_in_session');
      return;
    }
    const { session, index } = bound;
    if (f.index < 0 || f.index >= session.players.length || f.index === index) {
      this.#env.dropped(connection, kind, 'bad_index');
      return;
    }
    const target = session.bound[f.index] ?? null;
    if (target === null) {
      this.#env.dropped(connection, kind, 'target_not_bound');
      return;
    }
    if (f.payload.length < 1 || f.payload.length > this.#env.max_payload_bytes) {
      this.#env.dropped(connection, kind, 'bad_payload_length');
      return;
    }
    target.send(
      frame(Kind.MATCHMAKER_FRAME_KIND_PEER_SIGNAL, (out) => {
        out.index = index;
        out.payload = f.payload;
      }),
    );
  }

  #match_leave(connection: Connection, match_id: string): ParticipantChange | null {
    const bound = this.#binding.get(connection);
    if (bound?.session.match_id !== match_id) {
      this.#env.dropped(connection, 'MATCH_LEAVE', 'not_in_session');
      return null;
    }
    return this.#leave(connection);
  }

  /** Takes the connection out of its session as a leave: the index becomes a left index. */
  #leave(connection: Connection): ParticipantChange | null {
    const bound = this.#unbind(connection);
    if (bound === null) return null;
    bound.session.left.add(bound.index);
    return { match_id: bound.session.match_id, index: bound.index, kind: 'LEFT' };
  }

  /** Takes the connection out of its session and sends `PEER_LEFT` to the other bound participants. */
  #unbind(connection: Connection): { readonly session: MatchSession; readonly index: number } | null {
    const bound = this.#binding.get(connection);
    if (bound === undefined) return null;
    this.#binding.delete(connection);
    const { session, index } = bound;
    session.bound[index] = null;
    this.#broadcast(session, index, index_frame(Kind.MATCHMAKER_FRAME_KIND_PEER_LEFT, index));
    return bound;
  }

  #rejoin(connection: Connection, match_id: string): ParticipantChange | null {
    const session = this.#sessions.get(match_id);
    const index = session?.players.findIndex((player) => player.user_id === connection.user_id) ?? -1;
    const current = this.#binding.get(connection);
    const ok =
      session !== undefined &&
      index >= 0 &&
      this.#env.clock_now() < session.expires_at &&
      !session.left.has(index) &&
      (current === undefined || current.session === session);
    if (!ok) {
      connection.send(
        frame(Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED, (f) => {
          f.match_id = match_id;
          f.ok = false;
        }),
      );
      return null;
    }
    const previous = session.bound[index] ?? null;
    if (previous !== null && previous !== connection) this.#binding.delete(previous);
    session.bound[index] = connection;
    this.#binding.set(connection, { session, index });
    connection.send(
      frame(Kind.MATCHMAKER_FRAME_KIND_MATCH_REJOINED, (f) => {
        f.match_id = match_id;
        f.ok = true;
        f.my_index = index;
        f.players = [...session.players];
        f.transport = session.transport;
        f.left_indices = [...session.left].sort((a, b) => a - b);
      }),
    );
    this.#broadcast(session, index, index_frame(Kind.MATCHMAKER_FRAME_KIND_PEER_REJOINED, index));
    return { match_id, index, kind: 'REJOINED' };
  }

  /** Sends the frame to every bound participant of the session except the index. */
  #broadcast(session: MatchSession, except: number, f: CoreContract.MatchmakerFrame): void {
    session.bound.forEach((connection, index) => {
      if (connection !== null && index !== except) connection.send(f);
    });
  }
}
