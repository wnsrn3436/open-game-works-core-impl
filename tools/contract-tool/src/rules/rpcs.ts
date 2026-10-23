/** `rpc` rules: request and response messages, the `changes:` line, `rpc` options, `(ogw.core_errors)`, `GameError`. */
import type { Pos } from '../ast.ts';
import type { EnumDef, RpcDef } from '../model.ts';
import { AUTH_RPCS, SERVICE_FILES, type CheckContext } from './context.ts';

function gameError(ctx: CheckContext): EnumDef | null {
  const def = ctx.model.types.game.get('GameError');
  return def?.kind === 'enum' ? def : null;
}

/** Checks a list of `GameError` value names: known, not twice, not `GAME_ERROR_UNSPECIFIED`. */
function checkErrorNames(ctx: CheckContext, names: readonly string[], pos: Pos, option: string): void {
  const known = new Set(gameError(ctx)?.values.map((v) => v.name) ?? []);
  const seen = new Set<string>();
  for (const name of names) {
    if (name === 'GAME_ERROR_UNSPECIFIED') ctx.diagnostics.error(pos, `${option} does not list GAME_ERROR_UNSPECIFIED`);
    else if (!known.has(name)) ctx.diagnostics.error(pos, `${option} lists ${name === '' ? 'an empty name' : name}, which is not a GameError value`);
    if (seen.has(name)) ctx.diagnostics.error(pos, `${option} lists ${name} twice`);
    seen.add(name);
  }
}

function checkMessages(ctx: CheckContext, rpc: RpcDef): void {
  const ownPkg = rpc.file.pkg;
  for (const [def, suffix] of [[rpc.input, 'Request'], [rpc.output, 'Response']] as const) {
    if (def === null) continue;
    const expected = `${rpc.name}${suffix}`;
    if (def.pkg !== ownPkg || def.name !== expected) ctx.diagnostics.error(rpc.node.pos, `${suffix.toLowerCase()} message of rpc ${rpc.name} is ${expected}`);
    else if (def.file !== null && def.file.name !== SERVICE_FILES[rpc.service]) ctx.diagnostics.error(def.node?.pos ?? rpc.node.pos, `${expected} is in ${SERVICE_FILES[rpc.service]}`);
  }
}

function checkComment(ctx: CheckContext, rpc: RpcDef): void {
  if (rpc.changes === null) ctx.diagnostics.error(rpc.node.pos, `last comment line of rpc ${rpc.name} is "changes: <saved state>"`);
  else if (rpc.changes === '') ctx.diagnostics.error(rpc.node.pos, `changes: of rpc ${rpc.name} is empty`);
}

function checkOptions(ctx: CheckContext, rpc: RpcDef): void {
  const changes = rpc.changes !== null && rpc.changes !== '' && rpc.changes !== 'none';
  const exempt = rpc.service === 'Core' && AUTH_RPCS.has(rpc.name);
  if ((rpc.service === 'Game' || rpc.service === 'Core') && changes && !exempt && !rpc.retry) {
    ctx.diagnostics.error(rpc.node.pos, `rpc ${rpc.name} changes saved state and needs option (ogw.retry) = true`);
  }
  if (rpc.errors === null || rpc.errorsPos === null) return;
  if (rpc.service === 'Core' || rpc.service === 'CoreCheat') ctx.diagnostics.error(rpc.errorsPos, 'core rpc does not list (ogw.errors)');
  else checkErrorNames(ctx, rpc.errors, rpc.errorsPos, '(ogw.errors)');
}

function checkCoreErrors(ctx: CheckContext): void {
  const coreRpcs = new Set(ctx.model.rpcs.filter((r) => r.service === 'Core').map((r) => r.name));
  const seen = new Set<string>();
  for (const option of ctx.model.coreErrors) {
    const file = ctx.model.files.find((f) => f.node.options.some((o) => o.pos === option.pos));
    if (file?.name !== 'service.proto' || file.pkg !== 'game') {
      ctx.diagnostics.error(option.pos, '(ogw.core_errors) is a file option of service.proto');
      continue;
    }
    if (!coreRpcs.has(option.rpc)) ctx.diagnostics.error(option.pos, `(ogw.core_errors) names ${option.rpc}, which is not an rpc of service Core`);
    if (seen.has(option.rpc)) ctx.diagnostics.error(option.pos, `(ogw.core_errors) for ${option.rpc} is written twice`);
    seen.add(option.rpc);
    if (option.names.length > 0) checkErrorNames(ctx, option.names, option.pos, '(ogw.core_errors)');
  }
}

function checkGameErrorValues(ctx: CheckContext): void {
  for (const value of gameError(ctx)?.values ?? []) {
    if (value.number !== 0 && value.number < 1000) ctx.diagnostics.error(value.pos, `GameError value ${value.name} is 1000 or more`);
  }
}

/** Messages named `...Request` or `...Response` are the request and response of an `rpc`. */
function checkRequestNames(ctx: CheckContext): void {
  const used = new Set(ctx.model.rpcs.flatMap((r) => [r.input, r.output]));
  for (const pkg of ['ogw.core', 'game'] as const) {
    for (const def of ctx.model.types[pkg].values()) {
      if (def.kind !== 'message' || def.node === null || used.has(def)) continue;
      if (def.name.endsWith('Request') || def.name.endsWith('Response')) {
        ctx.diagnostics.error(def.node.pos, `message ${def.name} ends with Request or Response but is not the request or response of an rpc`);
      }
    }
  }
}

export function checkRpcs(ctx: CheckContext): void {
  const names = new Set<string>();
  for (const rpc of ctx.model.rpcs) {
    const key = `${rpc.service}.${rpc.name}`;
    if (names.has(key)) ctx.diagnostics.error(rpc.node.pos, `rpc ${rpc.name} is declared twice in service ${rpc.service}`);
    names.add(key);
    checkMessages(ctx, rpc);
    checkComment(ctx, rpc);
    checkOptions(ctx, rpc);
  }
  checkCoreErrors(ctx);
  checkGameErrorValues(ctx);
  checkRequestNames(ctx);
}
