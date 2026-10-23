/** File rules: syntax, package, imports, what each file may hold, and constructs the writing rules leave out. */
import type { MessageNode } from '../ast.ts';
import type { SourceFile } from '../model.ts';
import { coreCheatTypes } from '../typesets.ts';
import { KIND_SUFFIXES, MODULE_MESSAGES, SERVICE_FILES, type CheckContext } from './context.ts';

const BASE_IMPORTS: ReadonlySet<string> = new Set(['ogw/options.proto', 'ogw/core.proto']);

function checkSyntax(ctx: CheckContext, file: SourceFile): void {
  const { node } = file;
  if (node.syntax !== 'proto3') ctx.diagnostics.error(node.syntaxPos, 'file starts with syntax = "proto3";');
  if (node.pkg !== file.pkg) ctx.diagnostics.error(node.pkgPos, `package is ${file.pkg}`);
  for (const at of node.extends) ctx.diagnostics.error(at, 'extend is not allowed');
}

function checkImports(ctx: CheckContext, file: SourceFile): void {
  const known = new Set(ctx.model.files.map((f) => f.node.importPath));
  for (const imp of file.node.imports) {
    if (imp.modifier !== 'none') ctx.diagnostics.error(imp.pos, `import ${imp.modifier} is not allowed`);
    if (imp.path.endsWith('game_data.proto') || imp.path.includes('generated/data/')) {
      ctx.diagnostics.error(imp.pos, 'game contract does not import the data proto');
    } else if (file.pkg === 'game' && imp.path === 'cheat.proto' && file.name !== 'cheat.proto') {
      ctx.diagnostics.error(imp.pos, 'only cheat.proto imports cheat.proto');
    } else if (imp.path === file.node.importPath) {
      ctx.diagnostics.error(imp.pos, 'file imports itself');
    } else if (!known.has(imp.path) && !BASE_IMPORTS.has(imp.path)) {
      ctx.diagnostics.error(imp.pos, `import "${imp.path}" is not a game contract file or base proto file`);
    }
  }
}

function checkMessageConstructs(ctx: CheckContext, message: MessageNode): void {
  for (const nested of message.nested) ctx.diagnostics.error(nested.pos, `nested ${nested.what} ${nested.name} is not allowed; declare it at top level`);
  for (const at of message.oneofs) ctx.diagnostics.error(at, 'oneof is not allowed; use a kind enum and a field per kind');
  for (const at of message.extensions) ctx.diagnostics.error(at, 'extensions and extend are not allowed');
  for (const field of message.fields) {
    if (field.isMap) ctx.diagnostics.error(field.typePos, 'map is not allowed; use repeated of a top-level item message');
    if (field.isGroup) ctx.diagnostics.error(field.typePos, 'group is not allowed');
    if (field.label === 'optional' || field.label === 'required') ctx.diagnostics.error(field.pos, `${field.label} is not allowed`);
  }
}

function checkConstructs(ctx: CheckContext, file: SourceFile): void {
  for (const message of file.node.messages) checkMessageConstructs(ctx, message);
  for (const service of file.node.services) {
    for (const rpc of service.rpcs) {
      if (rpc.inputStream || rpc.outputStream) ctx.diagnostics.error(rpc.pos, 'streaming rpc is not allowed');
    }
  }
}

function checkServices(ctx: CheckContext, file: SourceFile): void {
  for (const service of file.node.services) {
    const home = (SERVICE_FILES as Readonly<Record<string, string>>)[service.name];
    const ownPkg = file.pkg === 'game' ? home !== 'core.proto' : home === 'core.proto';
    if (home === undefined || !ownPkg) ctx.diagnostics.error(service.pos, `service ${service.name} is not allowed here`);
    else if (home !== file.name) ctx.diagnostics.error(service.pos, `service ${service.name} is in ${home}`);
  }
}

/** Kinds and module messages are in their game contract files. */
function checkPlacement(ctx: CheckContext, file: SourceFile): void {
  for (const message of file.node.messages) {
    for (const { suffix, file: home } of KIND_SUFFIXES) {
      if (message.name.endsWith(suffix) && file.name !== home) ctx.diagnostics.error(message.pos, `${suffix} kind ${message.name} is in ${home}`);
    }
    if ((MODULE_MESSAGES as readonly string[]).includes(message.name) && file.name !== 'service.proto') {
      ctx.diagnostics.error(message.pos, `module message ${message.name} is in service.proto`);
    }
  }
  checkSingletons(ctx, file);
}

/**
 * `GameError` is an enum in error.proto and `RealtimeMessage` a message in realtime.proto, and each file declares its own.
 * Module message names are messages.
 */
function checkSingletons(ctx: CheckContext, file: SourceFile): void {
  for (const message of file.node.messages) {
    if (message.name === 'RealtimeMessage' && file.name !== 'realtime.proto') ctx.diagnostics.error(message.pos, 'RealtimeMessage is in realtime.proto');
    if (message.name === 'GameError') ctx.diagnostics.error(message.pos, 'GameError is an enum in error.proto');
  }
  for (const en of file.node.enums) {
    if (en.name === 'GameError' && file.name !== 'error.proto') ctx.diagnostics.error(en.pos, 'GameError is in error.proto');
    if (en.name === 'RealtimeMessage') ctx.diagnostics.error(en.pos, 'RealtimeMessage is a message in realtime.proto');
    if ((MODULE_MESSAGES as readonly string[]).includes(en.name)) ctx.diagnostics.error(en.pos, `module message ${en.name} is a message in service.proto`);
  }
  if (file.name === 'error.proto' && !file.node.enums.some((e) => e.name === 'GameError')) {
    ctx.diagnostics.error(file.node.syntaxPos, 'error.proto declares enum GameError');
  }
  if (file.name === 'realtime.proto' && !file.node.messages.some((m) => m.name === 'RealtimeMessage')) {
    ctx.diagnostics.error(file.node.syntaxPos, 'realtime.proto declares message RealtimeMessage');
  }
}

/** Cheat messages do not use types of server_state.proto and game_state.proto as field types. */
function checkCheatFieldTypes(ctx: CheckContext): void {
  for (const def of ctx.model.types.game.values()) {
    if (def.kind !== 'message' || def.file?.name !== 'cheat.proto') continue;
    for (const field of def.fields) {
      if (field.type.kind !== 'message' && field.type.kind !== 'enum') continue;
      const home = field.type.def.file?.name;
      if (field.type.def.pkg === 'game' && (home === 'server_state.proto' || home === 'game_state.proto')) {
        ctx.diagnostics.error(field.node.typePos, `cheat.proto does not use ${field.type.def.name} of ${home} as a field type`);
      }
    }
  }
}

/**
 * Types of game files other than cheat.proto do not reach base proto types of the DEV type set.
 * The base set is closed under reach, so a game type reaches the DEV type set only through a field whose type is in it.
 */
function checkCoreCheatReach(ctx: CheckContext): void {
  const coreCheat = coreCheatTypes(ctx.model);
  for (const def of ctx.model.types.game.values()) {
    if (def.kind !== 'message' || def.file === null || def.file.name === 'cheat.proto') continue;
    for (const field of def.fields) {
      if ((field.type.kind === 'message' || field.type.kind === 'enum') && coreCheat.has(field.type.def)) {
        ctx.diagnostics.error(field.node.typePos, `${def.file.name} does not use ${field.type.def.name}, which only service CoreCheat reaches, as a field type`);
      }
    }
  }
}

export function checkFiles(ctx: CheckContext): void {
  for (const file of ctx.model.files) {
    checkSyntax(ctx, file);
    checkImports(ctx, file);
    checkConstructs(ctx, file);
    checkServices(ctx, file);
    if (file.pkg === 'game') checkPlacement(ctx, file);
  }
  checkCheatFieldTypes(ctx);
  checkCoreCheatReach(ctx);
}
