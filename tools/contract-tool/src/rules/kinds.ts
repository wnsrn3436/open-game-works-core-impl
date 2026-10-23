/** Kind rules (UserState, server state, game state), `(ogw.public)`, `(ogw.converters)`, and module messages. */
import type { MessageDef } from '../model.ts';
import { hasKeyField, kindStore, REQUIRED_MODULE_MESSAGES, type CheckContext } from './context.ts';

function checkKeyField(ctx: CheckContext, def: MessageDef, name: 'id' | 'key', required: boolean): void {
  const field = def.fields.find((f) => f.name === name);
  const pos = field?.node.pos ?? def.node?.pos;
  if (pos === undefined) return;
  if (field === undefined) {
    if (required) ctx.diagnostics.error(pos, `game state kind ${def.name} has field int64 ${name} = 1`);
    return;
  }
  if (!hasKeyField(def, name)) ctx.diagnostics.error(pos, `field ${name} of kind ${def.name} is int64 ${name} = 1`);
}

function checkKind(ctx: CheckContext, def: MessageDef, baseKinds: ReadonlySet<string>, contractVersion: number): void {
  const store = kindStore(def);
  const pos = def.node?.pos;
  if (pos === undefined) return;
  if (store === 'game_state') checkKeyField(ctx, def, 'key', true);
  else if (store !== null) checkKeyField(ctx, def, 'id', false);
  if (def.pkg === 'game' && store !== null && baseKinds.has(def.name)) ctx.diagnostics.error(pos, `kind ${def.name} has the name of a base proto kind`);
  if (def.isPublic && store !== 'user_state') ctx.diagnostics.error(pos, '(ogw.public) is only on UserState kinds');
  checkConverters(ctx, def, store !== null, contractVersion);
}

function checkConverters(ctx: CheckContext, def: MessageDef, isKind: boolean, contractVersion: number): void {
  const seen = new Set<bigint>();
  for (const converter of def.converters) {
    if (def.pkg !== 'game' || !isKind) {
      ctx.diagnostics.error(converter.pos, '(ogw.converters) is only on game UserState, server state and game state kinds');
      continue;
    }
    if (converter.value < 1n || converter.value >= BigInt(contractVersion)) {
      ctx.diagnostics.error(converter.pos, `(ogw.converters) ${String(converter.value)} is not 1 or more and less than contract version ${String(contractVersion)}`);
    }
    if (seen.has(converter.value)) ctx.diagnostics.error(converter.pos, `(ogw.converters) ${String(converter.value)} is written twice`);
    seen.add(converter.value);
  }
}

export function checkKinds(ctx: CheckContext, contractVersion: number): void {
  const baseKinds = new Set<string>();
  for (const def of ctx.model.types['ogw.core'].values()) {
    if (def.kind === 'message' && kindStore(def) !== null) baseKinds.add(def.name);
  }
  for (const pkg of ['ogw.core', 'game'] as const) {
    for (const def of ctx.model.types[pkg].values()) {
      if (def.kind === 'message') checkKind(ctx, def, baseKinds, contractVersion);
    }
  }
}

/** Module messages that the modules of `--modules` make the game define. */
export function checkModuleMessages(ctx: CheckContext): void {
  if (ctx.modules === null) return;
  const service = ctx.model.files.find((f) => f.pkg === 'game' && f.name === 'service.proto');
  for (const module of ctx.modules) {
    for (const name of REQUIRED_MODULE_MESSAGES[module] ?? []) {
      const def = ctx.model.types.game.get(name);
      if (def?.kind === 'message' && def.file?.name === 'service.proto') continue;
      const pos = service?.node.syntaxPos ?? { file: 'contract/service.proto', line: 1, column: 1 };
      ctx.diagnostics.error(pos, `module ${module} needs module message ${name} in service.proto`);
    }
  }
}
