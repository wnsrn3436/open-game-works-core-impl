import type { Diagnostics } from '../diagnostics.ts';
import type { MessageDef, Model, ServiceKind, SourceFile, TypeDef } from '../model.ts';

/** Input of the rule checks. */
export interface CheckContext {
  readonly model: Model;
  readonly diagnostics: Diagnostics;
  /** Tables of the server build target: field names of `TableNames` in the server data proto. */
  readonly tableNames: ReadonlySet<string>;
  /** Message and enum names of the data proto. */
  readonly dataNames: ReadonlySet<string>;
  /** Modules the game uses (`--modules`), or null. */
  readonly modules: readonly string[] | null;
}

/** Game contract files and what each may hold. */
export const GAME_FILES = ['service.proto', 'user_state.proto', 'server_state.proto', 'game_state.proto', 'error.proto', 'realtime.proto', 'cheat.proto'] as const;

/** Services and the file each may be in. */
export const SERVICE_FILES: Readonly<Record<ServiceKind, string>> = { Game: 'service.proto', Cheat: 'cheat.proto', Core: 'core.proto', CoreCheat: 'core.proto' };

/** Module messages: core modules handle them as bytes, the game defines them in `service.proto`. */
export const MODULE_MESSAGES = [
  'MatchResult', 'MatchInputLog', 'PlaySessionResult', 'PlaySessionLoadout', 'PlaySessionStartOptions', 'PlaySessionContinueOptions', 'PublicProfile',
] as const;

/** Module messages that a module makes the game define. */
export const REQUIRED_MODULE_MESSAGES: Readonly<Record<string, readonly string[]>> = {
  matchmaker: ['MatchResult'],
  'play-session': ['PlaySessionResult'],
};

/** Module messages that core modules decode from client bytes: the tool makes their validators. */
export const VALIDATED_MODULE_MESSAGES: ReadonlySet<string> = new Set([
  'MatchResult', 'MatchInputLog', 'PlaySessionResult', 'PlaySessionStartOptions', 'PlaySessionContinueOptions',
]);

/** Core `rpc`s sent by `NetworkCore.send_auth`: they change state without `(ogw.retry)`. */
export const AUTH_RPCS: ReadonlySet<string> = new Set(['Login', 'AutoLogin', 'RefreshToken']);

export const KIND_SUFFIXES = [
  { suffix: 'UserState', file: 'user_state.proto', store: 'user_state' },
  { suffix: 'ServerState', file: 'server_state.proto', store: 'server_state' },
  { suffix: 'GameState', file: 'game_state.proto', store: 'game_state' },
] as const;

export type Store = (typeof KIND_SUFFIXES)[number]['store'];

/** Store of a kind message, or null when the message is not a kind. A game kind sits in its store's file. */
export function kindStore(def: MessageDef): Store | null {
  if (def.file === null) return null;
  for (const { suffix, file, store } of KIND_SUFFIXES) {
    if (def.name.endsWith(suffix) && def.name !== suffix && (def.pkg === 'ogw.core' || def.file.name === file)) return store;
  }
  return null;
}

/** Whether `def` has field `int64 <name> = 1`: the key field of a list kind (`id`) or a game state kind (`key`). */
export function hasKeyField(def: MessageDef, name: 'id' | 'key'): boolean {
  const field = def.fields.find((f) => f.name === name);
  return field !== undefined && field.number === 1 && !field.repeated && field.type.kind === 'scalar' && field.type.scalar === 'int64';
}

/** Kind messages of `defs` in store order (`KIND_SUFFIXES`), then in the order of `defs`: the order of `KINDS`. */
export function orderedKinds(defs: Iterable<TypeDef>): MessageDef[] {
  const order: readonly Store[] = KIND_SUFFIXES.map((k) => k.store);
  const kinds = [...defs].filter((d): d is MessageDef => d.kind === 'message' && kindStore(d) !== null);
  return kinds.sort((a, b) => order.indexOf(kindStore(a) ?? 'user_state') - order.indexOf(kindStore(b) ?? 'user_state'));
}

export function gameFiles(model: Model): SourceFile[] {
  return model.files.filter((f) => f.pkg === 'game');
}
