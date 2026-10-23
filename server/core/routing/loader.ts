/**
 * Loads the entry files of the server module list: `<module>/index.ts` (`create_<module>`), and in a DEV code
 * server instance `<module>/dev/index.ts` (`create_<module>_dev`, or `create_<module>` for a module that is all
 * DEV code). Module folders are found next to routing's folder, so a build without `dev/` has no DEV entry.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DevObject, ModuleObject } from './module_api.ts';
import { DEV_ONLY_MODULES } from './spec_tables.ts';

export type ModuleFactory = (input: { settings: Readonly<Record<string, unknown>>; modules: Readonly<Record<string, ModuleObject>>; server: unknown }) => ModuleObject;
export type DevFactory = (module: ModuleObject) => DevObject;

export interface LoadedModule {
  create: ModuleFactory | null;
  create_dev: DevFactory | null;
}

/** `item-ledger` → `item_ledger`. */
export function snake(name: string): string {
  return name.replace(/-/g, '_');
}

function entry(module: string, file: string): URL | null {
  const url = new URL(`../${module}/${file}`, import.meta.url);
  return existsSync(fileURLToPath(url)) ? url : null;
}

/** True when the module has a DEV entry file next to routing. */
export function has_dev_entry(module: string): boolean {
  return entry(module, 'dev/index.ts') !== null;
}

/** Loads one module's entry files; a string is the start failure. */
export async function load_module(module: string, dev: boolean): Promise<LoadedModule | string> {
  const factory = `create_${snake(module)}`;
  const dev_url = dev ? entry(module, 'dev/index.ts') : null;
  if (DEV_ONLY_MODULES.has(module)) {
    if (dev_url === null) return `module ${module} has no dev/index.ts`;
    const exports = (await import(dev_url.href)) as Record<string, unknown>;
    const create = exports[factory];
    if (typeof create !== 'function') return `${module}/dev/index.ts does not export ${factory}`;
    return { create: create as ModuleFactory, create_dev: null };
  }
  const url = entry(module, 'index.ts');
  if (url === null) return `module ${module} has no index.ts`;
  const exports = (await import(url.href)) as Record<string, unknown>;
  const create = exports[factory];
  if (typeof create !== 'function') return `${module}/index.ts does not export ${factory}`;
  let create_dev: DevFactory | null = null;
  if (dev_url !== null) {
    const dev_exports = (await import(dev_url.href)) as Record<string, unknown>;
    const dev_factory = dev_exports[`${factory}_dev`];
    if (typeof dev_factory !== 'function') return `${module}/dev/index.ts does not export ${factory}_dev`;
    create_dev = dev_factory as DevFactory;
  }
  return { create: create as ModuleFactory, create_dev };
}
