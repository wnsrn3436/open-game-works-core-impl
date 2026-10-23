/** State that the steps of one run share. */
import type { CoreData } from './corespec.ts';
import type { DataFolder } from './data.ts';
import type { Diagnostics } from './diag.ts';
import type { RequirementTypeForm, ReqRow } from './requirement.ts';
import type { ColumnType } from './types.ts';

export interface EnumElement {
  element: string;
  value: number;
}

export interface RunContext {
  data: DataFolder;
  core: CoreData;
  diags: Diagnostics;
  /** Game settings with the schema defaults. */
  settings: Record<string, unknown>;
  sourceLanguage: string;
  languages: string[];
  /** Data enums of `data/enums.csv` by type, elements in `value` order. */
  enums: Map<string, EnumElement[]>;
  requirementForms: Map<string, RequirementTypeForm>;
  requirementRows: ReqRow[];
  /** `data_type` of each `game_setting` row by ID name. */
  settingTypes: Map<string, ColumnType>;
  /** Tables whose `id` column holds each ID name. */
  ids: Map<string, Set<string>>;
  /** Message and enum names of the game contract and the base proto. */
  protoNames: Set<string>;
  /** Resource keys of `resource/resources.csv`. */
  resources: Set<string>;
  strict: boolean;
  /** With `--engine godot`: the client core type names. Null without an engine. */
  godot: { coreTypes: Set<string> } | null;
}

export function enumSet(ctx: RunContext, type: string): ReadonlySet<string> | undefined {
  const list = ctx.enums.get(type);
  return list ? new Set(list.map((e) => e.element)) : undefined;
}

/** A game settings value by a dotted path; undefined when it is not there. */
export function settingAt(settings: Record<string, unknown>, path: string): unknown {
  let v: unknown = settings;
  for (const part of path.split('.')) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

/** JSON equality of two values. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
