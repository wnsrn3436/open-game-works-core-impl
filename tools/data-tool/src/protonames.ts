/** Message and enum names of proto files, and the fields of `ItemAmount` in the base proto. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ItemAmountFields } from './binary.ts';

/** Proto text without comments and string literals. */
function bare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/** `.proto` files under a folder, recursively; empty when the folder is not there. */
export function protoFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...protoFiles(path));
    else if (name.endsWith('.proto')) out.push(path);
  }
  return out;
}

/** Every `message` and `enum` name declared in a proto text. */
export function declaredNames(text: string): string[] {
  return [...bare(text).matchAll(/\b(?:message|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] as string);
}

/** Message and enum names of every proto file under the folders. */
export function namesOf(dirs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const dir of dirs) for (const file of protoFiles(dir)) for (const n of declaredNames(readFileSync(file, 'utf8'))) out.add(n);
  return out;
}

/** The field numbers of `message ItemAmount` of the base proto; null when it is not there. */
export function itemAmountFields(baseProto: string): ItemAmountFields | null {
  for (const file of protoFiles(baseProto)) {
    const text = bare(readFileSync(file, 'utf8'));
    const m = /\bmessage\s+ItemAmount\s*\{([^}]*)\}/.exec(text);
    if (!m) continue;
    const fields = new Map([...(m[1] as string).matchAll(/\b(\w+)\s+(\w+)\s*=\s*(\d+)/g)].map((f) => [f[2] as string, Number(f[3])]));
    const itemId = fields.get('item_id');
    const amount = fields.get('amount');
    const big = fields.get('big_amount');
    if (itemId === undefined || amount === undefined || big === undefined) return null;
    return { item_id: itemId, amount, big_amount: big };
  }
  return null;
}
