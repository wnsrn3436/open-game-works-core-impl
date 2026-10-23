/** Syntax tree of a proto file, as the parser reads it. Rules are checked on this tree and on the model. */

export interface Pos {
  /** File as printed in violation lines. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export type OptionValue =
  | { readonly kind: 'ident'; readonly text: string }
  | { readonly kind: 'int'; readonly value: bigint }
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'message'; readonly fields: readonly OptionField[] };

export interface OptionField {
  readonly name: string;
  readonly value: OptionValue;
  readonly pos: Pos;
}

export interface OptionNode {
  /** Option name as written without spaces, e.g. `deprecated`, `(ogw.v)`, `(ogw.v).max`. */
  readonly name: string;
  readonly value: OptionValue;
  readonly pos: Pos;
}

export type Label = 'none' | 'repeated' | 'optional' | 'required';

export interface FieldNode {
  readonly name: string;
  readonly number: number;
  readonly label: Label;
  /** Type as written: a scalar keyword or a type name. `map<K, V>` for a map field. */
  readonly type: string;
  readonly isMap: boolean;
  readonly isGroup: boolean;
  /** Name of the `oneof` that holds the field, or null. */
  readonly oneof: string | null;
  readonly options: readonly OptionNode[];
  readonly comment: readonly string[];
  readonly pos: Pos;
  readonly typePos: Pos;
}

export interface EnumValueNode {
  readonly name: string;
  readonly number: number;
  readonly options: readonly OptionNode[];
  readonly pos: Pos;
}

export interface EnumNode {
  readonly name: string;
  readonly values: readonly EnumValueNode[];
  readonly options: readonly OptionNode[];
  readonly comment: readonly string[];
  readonly pos: Pos;
}

export interface MessageNode {
  readonly name: string;
  readonly fields: readonly FieldNode[];
  readonly options: readonly OptionNode[];
  readonly comment: readonly string[];
  readonly pos: Pos;
  /** Nested messages and enums: not allowed by the writing rules. */
  readonly nested: readonly { readonly name: string; readonly pos: Pos; readonly what: 'message' | 'enum' }[];
  /** Positions of `oneof`, `extensions`, `extend` written in the message. */
  readonly oneofs: readonly Pos[];
  readonly extensions: readonly Pos[];
  readonly reservedNumbers: readonly (readonly [number, number])[];
  readonly reservedNames: readonly string[];
}

export interface RpcNode {
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly inputStream: boolean;
  readonly outputStream: boolean;
  readonly options: readonly OptionNode[];
  readonly comment: readonly string[];
  readonly pos: Pos;
}

export interface ServiceNode {
  readonly name: string;
  readonly rpcs: readonly RpcNode[];
  readonly options: readonly OptionNode[];
  readonly pos: Pos;
}

export interface ImportNode {
  readonly path: string;
  readonly modifier: 'none' | 'public' | 'weak';
  readonly pos: Pos;
}

export interface FileNode {
  /** File as printed in violation lines. */
  readonly display: string;
  /** Path of the file under its import root, e.g. `service.proto`, `ogw/core.proto`. */
  readonly importPath: string;
  readonly syntax: string | null;
  readonly syntaxPos: Pos;
  readonly pkg: string | null;
  readonly pkgPos: Pos;
  readonly imports: readonly ImportNode[];
  readonly options: readonly OptionNode[];
  readonly messages: readonly MessageNode[];
  readonly enums: readonly EnumNode[];
  readonly services: readonly ServiceNode[];
  /** Positions of top-level `extend` blocks. */
  readonly extends: readonly Pos[];
}
