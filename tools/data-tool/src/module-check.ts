/**
 * Data checks of core modules (`core` command.md `### create server core` 5): each module's rules of its spec
 * `## data` are in `src/checks/<module name>.ts`, which exports `check: ModuleCheck`. The build puts every file of
 * `src/checks/` into the module `virtual:module-checks`. The data tool runs the check of each module of `--modules`.
 */
import checks from 'virtual:module-checks';
import type { RunContext } from './context.ts';
import type { DataFolder } from './data.ts';
import type { CheckCode, Place } from './diag.ts';
import type { ReqRow } from './requirement.ts';

/** What a module check reads, and where it reports. */
export interface ModuleCheckInput {
  /** The data folder with every built row's values (`Row.values`). */
  data: DataFolder;
  /** Game settings with the schema defaults. */
  settings: Record<string, unknown>;
  /** The `requirement` rows made from requirement cells. */
  requirementRows: readonly ReqRow[];
  /** The PROD data tag data of `--previous`, or null. Its rows have no values. */
  previous: DataFolder | null;
  /** Names of the tables core defines (every table of `--core-spec`). */
  coreTables: ReadonlySet<string>;
  /** Adds a data check line; the code decides ERROR or WARN. A rule without its own code is `out_of_range`. */
  report: (code: CheckCode, place: Place, message: string) => void;
}

export type ModuleCheck = (input: ModuleCheckInput) => void;

/** Runs the check of every module of `modules` that has one. */
export function runModuleChecks(ctx: RunContext, modules: ReadonlySet<string>, previous: DataFolder | null, all: ReadonlyMap<string, ModuleCheck> = checks): void {
  const input: ModuleCheckInput = {
    data: ctx.data, settings: ctx.settings, requirementRows: ctx.requirementRows, previous, coreTables: new Set(ctx.core.allTables.keys()),
    report: (code, place, message) => { ctx.diags.add(code, place, message); },
  };
  for (const [name, check] of [...all].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (modules.has(name)) check(input);
  }
}
