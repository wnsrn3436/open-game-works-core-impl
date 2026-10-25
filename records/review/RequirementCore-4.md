# review: RequirementCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `_remove_watch_at` (client/godot/core/requirement_core/requirement_core.gd:602-618) now only writes into existing entries: `_watches[slot] = null` (:606), `_free_slots[_free_count] = slot` with a count (:607-608), `_remove_link` (:670-678, int writes into the link pool and the free chain), `_remove_owner_at` (:622-626, move of the last used entry), `_dequeue` (:780-795, move of the last used entry of `_pending` or `_round`, then `null` into the freed index). `_slots_by_id` is gone; the per-ID list is a ring in the link pool under `_id_heads`, whose key stays until `release` (:535-537 add the key only in `_store_watch`). `_unsubscribe_watch` (:721) writes `_kind_counts` by index and `_content_counts` on an existing key (:726, :734), and `EventCore.unsubscribe` → `_clear_slot` (client/godot/core/event_core/event_core.gd:290-304) writes only existing slots and an existing `_heads` key. All growth (`append`, new keys, `_new_link` pool growth) is in `_store_watch` (:523-557), `_link_state` (:562-577) and `_new_link` (:634-646), reached only from `watch`, `register_judge` and `init`. Frame code paths checked: `requirement_core_node.gd:23` `_process` → `_on_frame` :810 → `_remove_watch_at`, `_run_batch` :850 and :859 → `_remove_watch_at`. `test_the_frame_code_removes_watches_without_changing_a_collection_size` (tests/test_watch.gd:386) compares the sizes of `_watches`, `_free_slots`, `_pending`, `_round`, `_owner_slots`, the link pool and every head dictionary before and after both frame code removal paths, so a restored `_free_slots.append` in `_remove_watch_at` makes it fail |
| R3-2 | fixed | `_run_batch` (:823-863) swaps `_pending` with the empty `_round` (:836-840) and goes over only the first `_round_count` entries (:841-842, :843-863); the round limit drops only the first `_pending_count` entries (:830-834). `_on_user_state_changed` (:866), `_on_named_trigger` (:872), `_on_content_event` (:878) and `_mark_time_watches` (:884) look up one head and walk only that ring through `_mark_list` (:682-688). No frame code path goes over all `_watches` slots or over each watch's trigger list; the only full scan left is `_relink_watches` (:590), called only from `register_judge` (:177). The round semantics equal the previous code: a watch marked while it waits in the running round stays in that round (`_mark` :771 skips `queue != _QUEUE_NONE`, as the old `record.pending` check did), and a watch judged in this round and marked again goes to the next round. `test_a_trigger_marks_and_a_round_judges_only_the_watches_of_that_trigger` (tests/test_watch.gd:436) shows that one `UIOpenedEvent` among 31 time-dependent watches calls the judge hook once, not 31 times |

## out of scope

- client/godot/core/requirement_core/requirement_core.gd:829: medium Frame code creates `String` values with `%` on its error paths, which `engines/godot.md` `## frame code` forbids: `_run_batch` :829 (round limit) and :858 (invalid callback), and `_self_judge` :384 and :388, which frame code reaches through `_run_batch` :852 → `_evaluate_entry` → `_judge` → `_self_judge`. `_self_judge` :383 also adds a `Dictionary` key (`_logged_types[type] = true`) there. Run path: a watched condition whose type has no judge hook, or whose judge hook throws, is raised by a trigger; the next `_process` runs these lines. The same lines (as `%` logs and the `_logged_types` key add) existed before the range; the range only moved them

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | `_free_slots.append` and `slots.remove_at` / `_slots_by_id.erase` are gone from `_remove_watch_at` (:602-618). The freed slot goes into the preallocated `_free_slots` at `_free_count` (:607-608), and the per-ID ring link is unlinked by `_remove_link` (:609, :670-678) without a size change. See R3-1 |
| D3 | fixed | none | The three full `_watches` scans of `_run_batch` are replaced by the `_round_count` / `_pending_count` buffers (:830-863), and the trigger handlers walk only the ring of the raised key (:866-885, `_mark_list` :682). See R3-2 |

## must fix

none

## unknown

- The core tests were not run in this review. The results rest on reading the code and the added tests; the core agent report states 743/743 passing (native run with QACore render pass skipped, `--web` run exit 0)
- The frame cost was not measured. R3-2 and D3 are judged `fixed` from the code paths: the per-frame and per-event loops now walk only pending entries or the ring of one key
- `EventCore.unsubscribe` (client/godot/core/event_core/event_core.gd:115-128), which `_remove_watch_at` reaches from frame code when the last watch of a trigger goes, loops over the subscription slots of the event type. That cost and its `Callable()` write in `_clear_slot` (:303) belong to EventCore and were not judged here
- The client change in the range to `client/godot/core/qa_core/tests/test_state.gd` (commit f45be1d) belongs to QACore and was not reviewed
- Whether a content `watch` or `register_judge` call made from inside a watch callback counts as core frame code (both grow buffers and the link pool) is not settled by `engines/godot.md` `## frame code`; it was not written as a finding
