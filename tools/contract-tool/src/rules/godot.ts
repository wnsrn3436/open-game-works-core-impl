/** Names the Godot generated code cannot use (`client-core` Godot `### generated code`, `contract` `## writing rules`). */
import { GDSCRIPT_KEYWORDS, GODOT_REFCOUNTED_MEMBERS, isGodotTypeName } from '../godot-names.ts';
import type { CheckContext } from './context.ts';

/** Class names of the Godot generated code and the client core classes it extends or uses. */
const GENERATED_CLASSES: ReadonlySet<string> = new Set([
  'CoreContract', 'GameContract', 'CoreCheatContract', 'GameCheatContract', 'ContractJsonDev', 'GameData', 'GameSetting', 'ReservedId',
  'ReservedString', 'ReservedSound', 'GameDataDev', 'ContractMessage', 'ContractRequest', 'ContractKind',
]);

/** Members of the generated message classes. */
const MESSAGE_MEMBERS: ReadonlySet<string> = new Set(['encode', 'decode', 'copy_from', 'request_name', 'is_silent', 'is_retry', 'is_sensitive', 'new_response']);

/**
 * Message and enum names that are GDScript keywords, Variant built-in type names, engine class or global enum names
 * or generated class names; game contract and base proto names that are client core type names (a GDScript inner
 * class named like a global class does not compile); field names that are GDScript
 * keywords or members every generated message class has.
 */
export function checkGodotNames(ctx: CheckContext, coreTypeNames: ReadonlySet<string>): void {
  for (const pkg of ['ogw.core', 'game'] as const) {
    for (const def of ctx.model.types[pkg].values()) {
      const pos = def.node?.pos;
      if (pos === undefined) continue;
      const what = def.kind === 'message' ? 'message' : 'enum';
      if (isGodotTypeName(def.name) || GENERATED_CLASSES.has(def.name)) ctx.diagnostics.error(pos, `${what} name ${def.name} is a name the generated GDScript uses`);
      else if (coreTypeNames.has(def.name)) ctx.diagnostics.error(pos, `${what} name ${def.name} is a client core type name`);
      if (def.kind !== 'message') continue;
      for (const field of def.fields) {
        if (GDSCRIPT_KEYWORDS.has(field.name) || GODOT_REFCOUNTED_MEMBERS.has(field.name) || MESSAGE_MEMBERS.has(field.name)) {
          ctx.diagnostics.error(field.node.pos, `field name ${field.name} is a name the generated GDScript uses`);
        }
      }
    }
  }
}
