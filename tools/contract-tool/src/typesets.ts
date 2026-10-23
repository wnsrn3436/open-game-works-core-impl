/** Type sets of the generation targets and the name space of each type. */
import { declaredTypes, reach, type MessageDef, type Model, type TypeDef } from './model.ts';
import { kindStore } from './rules/context.ts';

export type Namespace = 'CoreContract' | 'GameContract' | 'CoreCheatContract' | 'GameCheatContract';

export interface TypeSets {
  /** Types of each name space in declaration order. */
  readonly byNamespace: Record<Namespace, TypeDef[]>;
  readonly namespaceOf: Map<TypeDef, Namespace>;
  /**
   * Messages that need proto3 JSON: UserState and server state kinds, `ItemChange`, `ItemMail`, the request of each
   * `service Cheat` and `service CoreCheat` `rpc`, and what they reach.
   */
  readonly json: Set<MessageDef>;
}

/** Base proto types of the DEV type set: those only `service CoreCheat` messages reach. Nothing outside this set reaches into it. */
export function coreCheatTypes(model: Model): Set<TypeDef> {
  const base = declaredTypes(model, 'ogw.core');
  const cheatRoots = model.rpcs.filter((r) => r.service === 'CoreCheat').flatMap((r) => [r.input, r.output]).filter((d): d is MessageDef => d !== null);
  const cheatReach = new Set(reach(cheatRoots));
  const baseSet = new Set(reach(base.filter((d) => !cheatReach.has(d))));
  return new Set(base.filter((d) => !baseSet.has(d)));
}

export function typeSets(model: Model): TypeSets {
  const base = declaredTypes(model, 'ogw.core');
  const coreCheat = coreCheatTypes(model);
  const byNamespace: Record<Namespace, TypeDef[]> = { CoreContract: [], GameContract: [], CoreCheatContract: [], GameCheatContract: [] };
  const namespaceOf = new Map<TypeDef, Namespace>();
  const put = (def: TypeDef, ns: Namespace): void => {
    byNamespace[ns].push(def);
    namespaceOf.set(def, ns);
  };
  for (const def of base) put(def, coreCheat.has(def) ? 'CoreCheatContract' : 'CoreContract');
  for (const def of declaredTypes(model, 'game')) put(def, def.file?.name === 'cheat.proto' ? 'GameCheatContract' : 'GameContract');
  const json = new Set(reach(jsonRoots(model)).filter((d): d is MessageDef => d.kind === 'message'));
  return { byNamespace, namespaceOf, json };
}

/** Messages that need proto3 JSON by themselves, before adding what they reach. */
function jsonRoots(model: Model): TypeDef[] {
  const roots: TypeDef[] = [];
  for (const pkg of ['ogw.core', 'game'] as const) {
    for (const def of model.types[pkg].values()) {
      if (def.kind !== 'message') continue;
      const store = kindStore(def);
      const isItemRecord = pkg === 'ogw.core' && (def.name === 'ItemChange' || def.name === 'ItemMail');
      if (store === 'user_state' || store === 'server_state' || isItemRecord) roots.push(def);
    }
  }
  for (const rpc of model.rpcs) {
    if ((rpc.service === 'Cheat' || rpc.service === 'CoreCheat') && rpc.input !== null) roots.push(rpc.input);
  }
  return roots;
}
