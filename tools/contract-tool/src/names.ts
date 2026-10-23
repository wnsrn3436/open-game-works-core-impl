/** Name forms of the writing rules and the names the generated TypeScript cannot use. */

/** PascalCase: starts with a capital, letters and digits, no two capitals in a row. */
export const PASCAL_CASE = /^(?!.*[A-Z]{2})[A-Z][A-Za-z0-9]*$/;
export const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export const UPPER_SNAKE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/** Words of a PascalCase name: `QuestUserState` → `Quest`, `User`, `State`. */
function pascalWords(name: string): string[] {
  return name.match(/[A-Z][a-z0-9]*/g) ?? [name];
}

/** `LoginProvider` → `LOGIN_PROVIDER`. */
export function upperSnake(name: string): string {
  return pascalWords(name).map((w) => w.toUpperCase()).join('_');
}

/** `QuestUserState` → `quest_user_state`. */
export function snakeCase(name: string): string {
  return pascalWords(name).map((w) => w.toLowerCase()).join('_');
}

/** `quest_reward` → `QuestReward`. */
export function pascalCase(name: string): string {
  return name.split('_').filter((w) => w !== '').map((w) => (w[0] ?? '').toUpperCase() + w.slice(1)).join('');
}

/** proto3 JSON name of a field: `quest_id` → `questId`. */
export function jsonName(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());
}

/** ECMAScript reserved words and literals: no name of the contract may be one of these. */
export const TS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
  'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield',
]);

/**
 * Type names a generated module cannot declare: built-in values and types of TypeScript and the server runtime, and
 * the names the generated modules use for their own exports and imports.
 */
export const TS_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  'Array', 'ArrayBuffer', 'AsyncFunction', 'Atomics', 'BigInt', 'BigInt64Array', 'BigUint64Array', 'Boolean', 'Buffer', 'DataView', 'Date',
  'Error', 'EvalError', 'FinalizationRegistry', 'Float32Array', 'Float64Array', 'Function', 'Generator', 'Infinity', 'Int16Array',
  'Int32Array', 'Int8Array', 'Intl', 'Iterator', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'RangeError',
  'ReferenceError', 'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'SyntaxError', 'TextDecoder', 'TextEncoder',
  'TypeError', 'URIError', 'Uint16Array', 'Uint32Array', 'Uint8Array', 'Uint8ClampedArray', 'WeakMap', 'WeakRef', 'WeakSet',
  'Awaited', 'Capitalize', 'ConstructorParameters', 'Exclude', 'Extract', 'InstanceType', 'Lowercase', 'NoInfer', 'NonNullable', 'Omit',
  'OmitThisParameter', 'Parameters', 'Partial', 'Pick', 'Readonly', 'ReadonlyArray', 'ReadonlyMap', 'ReadonlySet', 'Record', 'Required',
  'ReturnType', 'ThisParameterType', 'ThisType', 'Uncapitalize', 'Uppercase', 'PropertyKey', 'ArrayLike', 'Iterable', 'IterableIterator',
  'CoreContract', 'GameContract', 'CoreCheatContract', 'GameCheatContract', 'GameData', 'Wire', 'RequestCtx',
  'RpcInfo', 'ValidationFailure', 'KindInfo', 'ContractMessage', 'ContractMessageClass',
]);

/** Field names the generated message class uses for its own members. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(['constructor', 'encode', 'to_json']);
