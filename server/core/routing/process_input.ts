/**
 * What a thread of the server process reads from the game `server/` folder itself (`### server process`): the
 * merged core settings and game settings values core reads, the server module list, the server build data folder,
 * whether DEV code is included, and content `server/main.ts` (and `server/dev/main.ts`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RegisterFunction } from './server.ts';

const core_dir = fileURLToPath(new URL('../', import.meta.url));
const server_dir = fileURLToPath(new URL('../../', import.meta.url));

/** True when the server code holds core `dev/` folders or `server/dev/`. */
export function has_dev_code(): boolean {
  if (existsSync(`${server_dir}dev`)) return true;
  return readdirSync(core_dir, { withFileTypes: true }).some((e) => e.isDirectory() && existsSync(`${core_dir}${e.name}/dev`));
}

function read_json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The settings values and the server module list of the game `server/` folder. */
export interface ProcessFiles {
  readonly settings: Record<string, unknown>;
  readonly server_modules: string[];
  readonly data_folder: string;
  readonly dev: boolean;
}

/** Reads `server/generated/core_settings.json` and `server/generated/server_modules.json`. Throws when it cannot. */
export function read_process_files(): ProcessFiles {
  return {
    settings: read_json(`${server_dir}generated/core_settings.json`) as Record<string, unknown>,
    server_modules: read_json(`${server_dir}generated/server_modules.json`) as string[],
    data_folder: `${server_dir}build/data`,
    dev: has_dev_code(),
  };
}

/** The content registration functions: `register` of `server/main.ts`, and `registerDev` of `server/dev/main.ts` with DEV code. */
export async function read_content(dev: boolean): Promise<{ register: RegisterFunction; register_dev: RegisterFunction | null }> {
  const content = (await import(new URL('../../main.ts', import.meta.url).href)) as { register: RegisterFunction };
  const content_dev = dev && existsSync(`${server_dir}dev/main.ts`) ? ((await import(new URL('../../dev/main.ts', import.meta.url).href)) as { registerDev: RegisterFunction }) : null;
  return { register: content.register, register_dev: content_dev?.registerDev ?? null };
}
