# review: RequirementCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/requirement_core/requirement_core.gd:518 | Debt D2 is still present. `_remove_watch_at` runs `_free_slots.append(slot)` (:518), `slots.remove_at(slots.find(slot))` (:520) and `_slots_by_id.erase(record.requirement_id)` (:522). `slots` is a `PackedInt32Array` read out of `_slots_by_id` (:519), so `remove_at` also copies it (copy on write, which is why :524 writes it back). Frame code calls `_remove_watch_at`: `requirement_core_node.gd:23` `_process` → `RequirementCore._on_frame` → `_remove_watch_at(slot)` (:647) when an owner is destroyed, and `_run_batch` (:654) → `_remove_watch_at(i)` (:684 destroyed owner, :693 invalid callback). `engines/godot.md` `## frame code` says core frame code does not change a collection size (`append()`, `remove_at()`, `erase()` are named) and does not create a Packed array. Run path: `watch(id, triggers, cb, node)`, free `node`, next `_process` runs all three changes inside frame code | Keep the frame code removal to fixed-size buffers with `int` counts, as `_owner_slots` already does (:505-510, :533-537): e.g. a `_free_slots` buffer sized outside frame code plus a count, and per requirement ID a slot buffer plus count (or a linked slot list in `_WATCH`), removed by moving the last used entry into the freed index. Or let frame code only mark the watch dead and do the collection changes in a deferred call made with a `Callable` from `init` | no | 90 |
| R3-2 | efficiency | medium | client/godot/core/requirement_core/requirement_core.gd:671 | Debt D3 is still present. `_run_batch` (frame code via `_on_frame` :654) goes over every slot of `_watches`, `null` slots included, in each round: once to set `batch_round` on the pending watches (:671) and once to evaluate them (:674), plus once more when the round limit is passed (:665). `_mark_time_watches` (:735, frame code via `_on_frame` :652) does the same at each time recheck. `_on_user_state_changed` (:701), `_on_named_trigger` (:714) and `_on_content_event` (:724) go over every slot, and over each slot's trigger list, per raised event. `_watches` never shrinks (`_remove_watch_at` :517 only sets `null`). Growing amount: one frame with a single pending watch, or one `UserStateChangedEvent` / `UIOpenedEvent` that matches one watch, costs O(total watch slots × triggers) | Keep the pending watches in a fixed-size buffer with a count, filled by `_mark`, so a round goes over only the pending ones; index the watches by trigger key (UserState kind, target name, content event type) and the time-dependent watches in their own list, so an event or recheck goes over only the watches it can mark | no | 90 |

## previous

none

## out of scope

- client/godot/core/requirement_core/requirement_core.gd:664: medium Frame code creates `String` values with `%` on its error paths, which `engines/godot.md` `## frame code` forbids: `_run_batch` :664 (round limit) and :692 (invalid callback), and `_self_judge` :358 and :362, which frame code reaches through `_run_batch` :686 → `_evaluate_entry` → `_judge` → `_self_judge`. `_self_judge` :357 also adds a `Dictionary` key (`_logged_types[type] = true`) there. Run path: a watched condition whose type has no judge hook, or whose judge hook throws, is raised by a trigger; the next `_process` runs these lines. These lines existed before the range

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `_on_frame` no longer loops over `_watches`. It loops backward over the used part of `_owner_slots`, up to `_owner_count` (client/godot/core/requirement_core/requirement_core.gd:644-647). `_owner_slots` holds only the slots of watches with an owner (`_store_watch` :504-510), and a removal takes the entry out by its `owner_index` and lowers the count (`_remove_owner_at` :533-537), so `null` slots and watches without an owner are not visited. The per-frame owner check now grows only with the live owner watches, which the debt's direction (a separate list of owner watches) names as the fix |
| D2 | open | R3-1 | `_free_slots.append` (:518), `slots.remove_at` (:520) and `_slots_by_id.erase` (:522) are unchanged and are still reached from frame code at :647, :684 and :693 |
| D3 | open | R3-2 | The full `_watches` scans of `_run_batch` (:665, :671, :674) and of the trigger handlers (:701, :714, :724) are unchanged |

## must fix

none

## unknown

- The commit range is empty (6c62379..6c62379), so no changed code was reviewed. This round judged only the input `## debt` items and the round-2 results; the round-2 review had no findings and no `open` rows, so `## previous` is `none`
- The core tests were not run in this review. No test in `client/godot/core/requirement_core/tests/` checks the frame-code collection rule of R3-1 for `_free_slots` and `_slots_by_id`, or the scan cost of R3-2; this was checked by reading the code only
- The frame cost of R3-2 was not measured. The evidence is the code path only
- Whether LogCore offers a way to log from frame code without creating a `String` was not checked against other modules' frame code; the out-of-scope item rests on the `## frame code` rule text alone
