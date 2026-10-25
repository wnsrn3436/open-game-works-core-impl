extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## Watch: the base result, triggers, pending evaluations, the batch evaluation and its rounds, `unwatch` and the owner
## object.

const Watch := preload("res://core/requirement_core/requirement_watch.gd")


func test_watch_does_not_call_the_callback_and_a_changed_result_waits_for_a_trigger() -> void:
	await start()
	register_flags()
	answer(false)
	var recorder: Recorder = Recorder.new()
	var single: int = id_of(SINGLE)
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result))
	assert_eq(recorder.count(), 0)
	answer(true)
	put_tutorial()
	await frame()
	await frame()
	assert_eq(recorder.count(), 0, "no trigger, no callback")
	assert_true(RequirementCore.evaluate(single).passed, "the result changed")


func test_user_state_changed_trigger_calls_back_once_before_the_next_content_update() -> void:
	await start()
	register_flags()
	var raise: Callable = func() -> void: pass
	await _check_trigger(user_state_trigger(CoreContract.TutorialProgressUserState), raise)


func test_request_completed_trigger_calls_back_once_before_the_next_content_update() -> void:
	await start()
	register_flags()
	var raise: Callable = func() -> void: publish_request_completed("core/Test", true)
	await _check_trigger(named_trigger(RequirementCore.TriggerKind.REQUEST_COMPLETED, "core/Test"), raise)


func test_request_completed_trigger_of_a_failed_request_also_calls_back() -> void:
	await start()
	register_flags()
	var raise: Callable = func() -> void: publish_request_completed("core/Test", false)
	await _check_trigger(named_trigger(RequirementCore.TriggerKind.REQUEST_COMPLETED, "core/Test"), raise)


func test_ui_opened_trigger_calls_back_once_before_the_next_content_update() -> void:
	await start()
	register_flags()
	var raise: Callable = func() -> void: publish_ui_opened("prefab/panel/shop")
	await _check_trigger(named_trigger(RequirementCore.TriggerKind.UI_OPENED, "prefab/panel/shop"), raise)


func test_ui_closed_trigger_calls_back_once_before_the_next_content_update() -> void:
	await start()
	register_flags()
	var raise: Callable = func() -> void: publish_ui_closed("prefab/panel/shop")
	await _check_trigger(named_trigger(RequirementCore.TriggerKind.UI_CLOSED, "prefab/panel/shop"), raise)


func test_content_event_trigger_calls_back_once_before_the_next_content_update() -> void:
	await start()
	register_flags()
	await _check_trigger(content_trigger(), publish_content)


## Watches `SINGLE` with `trigger`, changes the result through a `TutorialProgressUserState` delta, then raises the
## trigger with `raise` (the delta itself raises a `UserStateChanged` trigger). No callback until the raising call
## returns; one callback with the ID and the new result in the next frame, before a node of the default process
## priority runs.
func _check_trigger(trigger: RequirementTrigger, raise: Callable) -> void:
	answer(false)
	var recorder: Recorder = Recorder.new()
	var single: int = id_of(SINGLE)
	assert_true(RequirementCore.watch(single, triggers(trigger), recorder.on_result))
	answer(true)
	put_tutorial()
	raise.call()
	assert_eq(recorder.count(), 0, "no callback inside the raising call")
	var node: Probe = probe(recorder)
	await frame()
	assert_eq(recorder.calls, PackedStringArray(["%d:true:0" % single]))
	assert_eq(node.seen, 1, "the callback comes before the content update")
	assert_true(recorder.last == RequirementCore.evaluate(single), "the result the module keeps for the condition")
	await frame()
	assert_eq(recorder.count(), 1, "once")


func test_a_trigger_that_finds_the_base_result_unchanged_calls_nothing() -> void:
	await start()
	register_flags()
	answer(false)
	var recorder: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(id_of(SINGLE), triggers(content_trigger()), recorder.on_result))
	put_tutorial()
	publish_content()
	await frame()
	assert_eq(recorder.count(), 0)
	assert_eq(Hooks.count(FLAG_A), 2, "judged again, same result")


func test_a_trigger_that_finds_only_the_first_failed_condition_changed_calls_back_once_with_it() -> void:
	await start()
	register_flags()
	answer(false, true, true)
	var recorder: Recorder = Recorder.new()
	var all: int = id_of(ALL_1)
	assert_true(RequirementCore.watch(all, triggers(content_trigger()), recorder.on_result))
	assert_result(RequirementCore.evaluate(all), false, id_of(ALL_2), GUIDE_A, "FlagA fails first")
	answer(true, false, true)
	put_tutorial()
	put_balance(id_of("[gold]"), 10)
	publish_content()
	await frame()
	assert_eq(recorder.calls, PackedStringArray(["%d:false:%d" % [all, id_of(ALL_3)]]), "passed stays false")
	assert_eq(recorder.last.guide_key, GUIDE_B)
	publish_content()
	await frame()
	assert_eq(recorder.count(), 1, "the same failed condition again calls nothing")


func test_several_triggers_before_the_batch_evaluation_call_back_once_and_judge_the_condition_once() -> void:
	await start()
	register_flags()
	answer(false)
	var first: Recorder = Recorder.new()
	var second: Recorder = Recorder.new()
	var single: int = id_of(SINGLE)
	var both: Array[RequirementTrigger] = [content_trigger(), named_trigger(RequirementCore.TriggerKind.UI_OPENED, "prefab/panel/shop")]
	assert_true(RequirementCore.watch(single, both, first.on_result))
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), second.on_result))
	assert_eq(Hooks.count(FLAG_A), 1, "the second watch uses the cache")
	answer(true)
	put_tutorial()
	publish_content()
	publish_content()
	publish_ui_opened("prefab/panel/shop")
	publish_content()
	await frame()
	assert_eq(first.count(), 1)
	assert_eq(second.count(), 1)
	assert_eq(Hooks.count(FLAG_A), 2, "one judgement for both pending watches")


func test_no_callback_or_log_after_unwatch_or_after_the_owner_object_is_destroyed() -> void:
	await start()
	register_flags()
	answer(false)
	var single: int = id_of(SINGLE)
	var removed: Recorder = Recorder.new()
	var owned: Recorder = Recorder.new()
	var kept: Recorder = Recorder.new()
	var owner: Node = Node.new()
	add_child(owner)
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), removed.on_result))
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), owned.on_result, owner))
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), kept.on_result))
	RequirementCore.unwatch(single, removed.on_result)
	RequirementCore.unwatch(single, removed.on_result)
	owner.free()
	answer(true)
	put_tutorial()
	publish_content()
	await frame()
	assert_eq(removed.count(), 0, "unwatched")
	assert_eq(owned.count(), 0, "owner object destroyed")
	assert_eq(kept.count(), 1)
	assert_eq(errors(), 0)
	RequirementCore.unwatch(single, kept.on_result)
	assert_eq(EventCore.count_subscriptions(RequirementCore._node), 1, "only DayChangedEvent is subscribed after the last watch")


func test_a_watch_whose_owner_object_is_destroyed_is_removed_without_a_trigger() -> void:
	await start()
	register_flags()
	var recorder: Recorder = Recorder.new()
	var owner: Node = Node.new()
	add_child(owner)
	assert_true(RequirementCore.watch(id_of(SINGLE), triggers(content_trigger()), recorder.on_result, owner))
	assert_eq(EventCore.count_subscriptions(RequirementCore._node), 2)
	owner.free()
	await frame()
	assert_eq(EventCore.count_subscriptions(RequirementCore._node), 1, "the subscription of the removed watch ends")
	assert_eq(errors(), 0)


func test_the_owner_list_holds_only_the_owner_watch_slots_and_a_destroyed_owner_removes_exactly_its_watches() -> void:
	await start()
	register_flags()
	answer(false)
	var single: int = id_of(SINGLE)
	var plain: Array[Recorder] = []
	for i: int in 20:
		var recorder: Recorder = Recorder.new()
		plain.append(recorder)
		assert_true(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result))
	for i: int in range(0, 20, 2):
		RequirementCore.unwatch(single, plain[i].on_result)
	assert_eq(RequirementCore._owner_count, 0, "no owner watch, nothing for the frame code to check")
	var gone: Node = Node.new()
	var alive: Node = Node.new()
	add_child(gone)
	add_child_autofree(alive)
	var gone_recorders: Array[Recorder] = []
	var alive_recorders: Array[Recorder] = []
	for i: int in 3:
		var kept: Recorder = Recorder.new()
		alive_recorders.append(kept)
		assert_true(RequirementCore.watch(single, triggers(content_trigger()), kept.on_result, alive))
		var lost: Recorder = Recorder.new()
		gone_recorders.append(lost)
		assert_true(RequirementCore.watch(single, triggers(content_trigger()), lost.on_result, gone))
	assert_eq(RequirementCore._watches.size(), 20, "the owner watches reuse the slots of the removed watches")
	assert_eq(_sorted_owner_slots(), _owner_watch_slots())
	assert_eq(RequirementCore._owner_count, 6)
	RequirementCore.unwatch(single, alive_recorders[2].on_result)
	assert_eq(_sorted_owner_slots(), _owner_watch_slots(), "unwatch takes the slot out of the owner list")
	assert_eq(RequirementCore._owner_count, 5)
	_assert_owner_indexes()
	gone.free()
	await frame()
	assert_eq(RequirementCore._owner_count, 2, "the frame code removed the 3 watches of the destroyed owner")
	assert_eq(_sorted_owner_slots(), _owner_watch_slots())
	_assert_owner_indexes()
	for recorder: Recorder in gone_recorders:
		assert_eq(RequirementCore._find_watch(single, recorder.on_result), -1)
	for i: int in 2:
		assert_true(RequirementCore._find_watch(single, alive_recorders[i].on_result) >= 0)
	for i: int in range(1, 20, 2):
		assert_true(RequirementCore._find_watch(single, plain[i].on_result) >= 0)
	answer(true)
	put_tutorial()
	publish_content()
	await frame()
	for recorder: Recorder in gone_recorders:
		assert_eq(recorder.count(), 0)
	assert_eq(alive_recorders[0].count(), 1)
	assert_eq(alive_recorders[1].count(), 1)
	assert_eq(alive_recorders[2].count(), 0, "unwatched")
	for i: int in 20:
		assert_eq(plain[i].count(), i % 2, "only the watches that were not unwatched call back")
	assert_eq(errors(), 0)


func test_the_frame_code_removes_the_watches_of_destroyed_owners_without_changing_the_owner_list_size() -> void:
	await start()
	register_flags()
	answer(false)
	var single: int = id_of(SINGLE)
	var screen: Node = Node.new()
	var alive: Node = Node.new()
	add_child(screen)
	add_child_autofree(alive)
	var lost: Array[Recorder] = []
	var kept: Array[Recorder] = []
	for i: int in 30:
		var recorder: Recorder = Recorder.new()
		var owner: Node = alive if i % 5 == 0 else screen
		if owner == alive:
			kept.append(recorder)
		else:
			lost.append(recorder)
		assert_true(RequirementCore.watch(single, triggers(content_trigger()), recorder.on_result, owner))
	assert_eq(RequirementCore._owner_count, 30)
	_assert_owner_indexes()
	var buffer_size: int = RequirementCore._owner_slots.size()
	screen.free()
	await frame()
	assert_eq(RequirementCore._owner_slots.size(), buffer_size, "frame code changes only the count")
	assert_eq(RequirementCore._owner_count, kept.size())
	assert_eq(_sorted_owner_slots(), _owner_watch_slots())
	_assert_owner_indexes()
	for recorder: Recorder in lost:
		assert_eq(RequirementCore._find_watch(single, recorder.on_result), -1)
	var again: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), again.on_result, alive))
	kept.append(again)
	assert_eq(RequirementCore._owner_slots.size(), buffer_size, "a later watch reuses the buffer")
	assert_eq(_sorted_owner_slots(), _owner_watch_slots())
	_assert_owner_indexes()
	answer(true)
	put_tutorial()
	publish_content()
	await frame()
	for recorder: Recorder in kept:
		assert_eq(recorder.count(), 1)
	for recorder: Recorder in lost:
		assert_eq(recorder.count(), 0)
	assert_eq(errors(), 0)


## The used part of `RequirementCore._owner_slots`, in ascending order.
func _sorted_owner_slots() -> PackedInt32Array:
	var slots: PackedInt32Array = RequirementCore._owner_slots.slice(0, RequirementCore._owner_count)
	slots.sort()
	return slots


## Each owner watch knows the index of its slot in the owner list, so a removal needs no search.
func _assert_owner_indexes() -> void:
	for i: int in RequirementCore._owner_count:
		var record: Watch = RequirementCore._watches[RequirementCore._owner_slots[i]]
		assert_eq(record.owner_index, i)


## The slots of `RequirementCore._watches` that hold a watch with an owner object, in ascending order.
func _owner_watch_slots() -> PackedInt32Array:
	var slots: PackedInt32Array = PackedInt32Array()
	for i: int in RequirementCore._watches.size():
		var record: Watch = RequirementCore._watches[i]
		if record != null and record.owner_id != 0:
			slots.append(i)
	return slots


func test_a_trigger_raised_in_a_callback_is_judged_in_the_next_round_of_the_same_batch_evaluation() -> void:
	await start()
	register_flags()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.flag, no_kinds, GUIDE_LEVEL, Callable(), true))
	answer(false)
	Hooks.answers[TYPE_LEVEL] = false
	var first: Recorder = Recorder.new()
	var second: Recorder = Recorder.new()
	first.inside = func(_id: int) -> void:
		publish_request_completed("core/Second", true)
	assert_true(RequirementCore.watch(id_of(SINGLE), triggers(content_trigger()), first.on_result))
	assert_true(RequirementCore.watch(id_of(LEVEL), triggers(named_trigger(RequirementCore.TriggerKind.REQUEST_COMPLETED, "core/Second")), second.on_result))
	answer(true)
	Hooks.answers[TYPE_LEVEL] = true
	put_tutorial()
	publish_content()
	var node: Probe = probe(second)
	await frame()
	assert_eq(first.count(), 1)
	assert_eq(second.count(), 1, "judged in the same frame")
	assert_eq(node.seen, 1, "before the content update")


func test_a_callback_that_stops_on_a_runtime_error_does_not_stop_the_other_callbacks() -> void:
	await start()
	register_flags()
	answer(false)
	var single: int = id_of(SINGLE)
	var first: Recorder = Recorder.new()
	var failing: Recorder = Recorder.new()
	var last: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), first.on_result))
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), failing.on_result_failing))
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), last.on_result))
	answer(true)
	put_tutorial()
	publish_content()
	await frame()
	assert_eq(UnitTestCore.check_script_errors(), 1, "the callback stopped on a runtime error")
	assert_eq(failing.failing_calls, 1)
	assert_eq(failing.failing_finished, 0, "the callback stopped on its runtime error")
	assert_eq(first.calls, PackedStringArray(["%d:true:0" % single]))
	assert_eq(last.calls, PackedStringArray(["%d:true:0" % single]))


func test_an_empty_user_state_changed_target_follows_the_kinds_the_condition_sees() -> void:
	await start()
	register_flags()
	var recorder: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(id_of(NESTED_1), triggers(user_state_trigger()), recorder.on_result))
	put_shop(id_of("[shop_basic]"), 1, 0)
	assert_eq(RequirementCore._pending_count, 0, "ShopPurchaseUserState is not seen")
	put_balance(id_of("[gold]"), 10)
	assert_eq(RequirementCore._pending_count, 1, "ItemBalanceUserState is seen through FlagB")
	await frame()
	assert_eq(RequirementCore._pending_count, 0)
	put_tutorial()
	assert_eq(RequirementCore._pending_count, 1, "TutorialProgressUserState is seen through FlagA")


func test_a_user_state_changed_target_kind_marks_only_for_that_kind() -> void:
	await start()
	register_flags()
	var recorder: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(id_of(NESTED_1), triggers(user_state_trigger(CoreContract.ShopPurchaseUserState)), recorder.on_result))
	put_balance(id_of("[gold]"), 10)
	assert_eq(RequirementCore._pending_count, 0)
	put_shop(id_of("[shop_basic]"), 1, 0)
	assert_eq(RequirementCore._pending_count, 1)


func test_the_frame_code_removes_watches_without_changing_a_collection_size() -> void:
	await start()
	register_flags()
	answer(false)
	var single: int = id_of(SINGLE)
	var other: int = id_of(OTHER_A)
	var screen: Node = Node.new()
	var holder: Node = Node.new()
	add_child(screen)
	var kept: Array[Recorder] = []
	var both: Array[RequirementTrigger] = [content_trigger(), named_trigger(RequirementCore.TriggerKind.UI_OPENED, "prefab/panel/shop"), user_state_trigger()]
	for i: int in 10:
		var recorder: Recorder = Recorder.new()
		assert_true(RequirementCore.watch(single if i % 2 == 0 else other, both, recorder.on_result, screen))
	# Callbacks that cannot be called once `holder` is freed: the batch evaluation removes their watches.
	assert_true(RequirementCore.watch(single, both, holder.get_index))
	assert_true(RequirementCore.watch(other, both, holder.get_index))
	for i: int in 3:
		var recorder: Recorder = Recorder.new()
		kept.append(recorder)
		assert_true(RequirementCore.watch(single, both, recorder.on_result))
	var sizes: PackedInt64Array = _collection_sizes()
	screen.free()
	holder.free()
	answer(true)
	put_tutorial()
	publish_content()
	await frame()
	assert_eq(_collection_sizes(), sizes, "frame code changes only counts and links")
	assert_eq(errors(), 2, "one log per watch whose callback cannot be called")
	assert_eq(RequirementCore._free_count, 12)
	assert_eq(RequirementCore._owner_count, 0)
	for recorder: Recorder in kept:
		assert_eq(recorder.count(), 1)
	var live: PackedInt32Array = _live_slots()
	assert_eq(live.size(), 3)
	assert_eq(_list_slots(RequirementCore._id_heads[single]), live)
	assert_eq(_list_slots(RequirementCore._id_heads[other]), PackedInt32Array())
	assert_eq(_list_slots(_content_head()), live)
	assert_eq(_list_slots(RequirementCore._opened_heads["prefab/panel/shop"]), live)
	assert_eq(_list_slots(_state_head(CoreContract.TutorialProgressUserState)), live)
	# Watches of the same shape reuse the freed slots and links.
	for i: int in 12:
		var recorder: Recorder = Recorder.new()
		assert_true(RequirementCore.watch(other, both, recorder.on_result))
	assert_eq(_collection_sizes(), sizes, "the later watches reuse the buffers and the link pool")
	assert_eq(RequirementCore._free_count, 0)
	assert_eq(_list_slots(_content_head()).size(), 15)


func test_a_trigger_marks_and_a_round_judges_only_the_watches_of_that_trigger() -> void:
	await start()
	register_flags()
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.flag, no_kinds, GUIDE_LEVEL, Callable(), true))
	answer(false)
	Hooks.answers[TYPE_LEVEL] = false
	# Level is time-dependent, so each judgement of a Level watch calls its judge hook.
	var level: int = id_of(LEVEL)
	var content_slots: PackedInt32Array = PackedInt32Array()
	for i: int in 30:
		var recorder: Recorder = Recorder.new()
		assert_true(RequirementCore.watch(level, triggers(content_trigger()), recorder.on_result))
		content_slots.append(RequirementCore._find_watch(level, recorder.on_result))
	content_slots.sort()
	var opened: Recorder = Recorder.new()
	assert_true(RequirementCore.watch(level, triggers(named_trigger(RequirementCore.TriggerKind.UI_OPENED, "prefab/panel/shop")), opened.on_result))
	var opened_slot: int = RequirementCore._find_watch(level, opened.on_result)
	var tutorial: Recorder = Recorder.new()
	var all: int = id_of(ALL_1)
	assert_true(RequirementCore.watch(all, triggers(user_state_trigger(CoreContract.TutorialProgressUserState)), tutorial.on_result))
	var tutorial_slot: int = RequirementCore._find_watch(all, tutorial.on_result)
	var time_slots: PackedInt32Array = content_slots.duplicate()
	time_slots.append(opened_slot)
	time_slots.sort()
	assert_eq(_list_slots(_content_head()), content_slots)
	assert_eq(_list_slots(RequirementCore._opened_heads["prefab/panel/shop"]), PackedInt32Array([opened_slot]))
	assert_eq(_list_slots(_state_head(CoreContract.TutorialProgressUserState)), PackedInt32Array([tutorial_slot]))
	assert_eq(_list_slots(RequirementCore._time_head), time_slots)
	publish_ui_opened("prefab/panel/shop")
	assert_eq(RequirementCore._pending_count, 1)
	assert_true(RequirementCore._pending[0] == RequirementCore._watches[opened_slot])
	var judged: int = Hooks.count(TYPE_LEVEL)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), judged + 1, "only the watch of the raised trigger is judged")
	put_balance(id_of("[gold]"), 10)
	assert_eq(RequirementCore._pending_count, 0, "no watch has an ItemBalanceUserState trigger")
	put_tutorial()
	assert_eq(RequirementCore._pending_count, 1)
	assert_true(RequirementCore._pending[0] == RequirementCore._watches[tutorial_slot])
	await frame()
	RequirementCore._mark_time_watches()
	assert_eq(RequirementCore._pending_count, 31, "the time-dependent watches")
	judged = Hooks.count(TYPE_LEVEL)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), judged + 31)
	RequirementCore.unwatch(level, opened.on_result)
	assert_eq(_list_slots(RequirementCore._opened_heads["prefab/panel/shop"]), PackedInt32Array(), "unwatch takes it out of its lists")
	assert_eq(_list_slots(RequirementCore._time_head), content_slots)
	publish_ui_opened("prefab/panel/shop")
	assert_eq(RequirementCore._pending_count, 0)
	assert_eq(errors(), 0)


func test_register_judge_puts_a_watch_with_an_empty_user_state_target_into_the_lists_of_the_new_kinds() -> void:
	await start()
	var recorder: Recorder = Recorder.new()
	var nested: int = id_of(NESTED_1)
	assert_true(RequirementCore.watch(nested, triggers(user_state_trigger()), recorder.on_result))
	assert_eq(errors(), 1, "the type without a hook")
	assert_eq(RequirementCore._state_heads.size(), 0, "no judge hook, no kind the condition sees")
	put_tutorial()
	assert_eq(RequirementCore._pending_count, 0)
	register_flags()
	var slot: PackedInt32Array = PackedInt32Array([RequirementCore._find_watch(nested, recorder.on_result)])
	assert_eq(_list_slots(_state_head(CoreContract.TutorialProgressUserState)), slot)
	assert_eq(_list_slots(_state_head(CoreContract.ItemBalanceUserState)), slot)
	assert_false(RequirementCore._state_heads.has(CoreContract.ShopPurchaseUserState))
	put_tutorial()
	assert_eq(RequirementCore._pending_count, 1)
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.flag, no_kinds, GUIDE_LEVEL))
	assert_eq(RequirementCore._watches[slot[0]].state_links.size(), 2, "another register_judge links each kind once again")
	assert_eq(_list_slots(_state_head(CoreContract.TutorialProgressUserState)), slot)


func test_a_watch_removed_by_a_callback_before_its_turn_in_the_round_is_not_judged() -> void:
	await start()
	register_flags()
	answer(false)
	var single: int = id_of(SINGLE)
	var first: Recorder = Recorder.new()
	var second: Recorder = Recorder.new()
	first.inside = func(_id: int) -> void:
		RequirementCore.unwatch(single, second.on_result)
	second.inside = func(_id: int) -> void:
		RequirementCore.unwatch(single, first.on_result)
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), first.on_result))
	assert_true(RequirementCore.watch(single, triggers(content_trigger()), second.on_result))
	answer(true)
	put_tutorial()
	publish_content()
	await frame()
	assert_eq(first.count() + second.count(), 1, "the first callback removes the other watch from the round")
	assert_eq(RequirementCore._round_count, 0)
	assert_eq(RequirementCore._pending_count, 0)
	assert_eq(RequirementCore._free_count, 1)
	assert_eq(errors(), 0)
	# The two callbacks hold each other's recorder.
	first.inside = Callable()
	second.inside = Callable()


## The sizes of the collections of `RequirementCore` that hold watches, slots, links and list heads.
func _collection_sizes() -> PackedInt64Array:
	return PackedInt64Array([
		RequirementCore._watches.size(), RequirementCore._free_slots.size(), RequirementCore._pending.size(),
		RequirementCore._round.size(), RequirementCore._owner_slots.size(), RequirementCore._link_next.size(),
		RequirementCore._link_prev.size(), RequirementCore._link_slot.size(), RequirementCore._id_heads.size(),
		RequirementCore._state_heads.size(), RequirementCore._request_heads.size(), RequirementCore._opened_heads.size(),
		RequirementCore._closed_heads.size(), RequirementCore._content_heads.size(),
	])


func _state_head(kind: GDScript) -> int:
	return RequirementCore._state_heads[kind]


func _content_head() -> int:
	var type: Script = TestEvent
	return RequirementCore._content_heads[type]


## The slots of the list of head link `head`, in ascending order.
func _list_slots(head: int) -> PackedInt32Array:
	var slots: PackedInt32Array = PackedInt32Array()
	var link: int = RequirementCore._link_next[head]
	while link != head:
		slots.append(RequirementCore._link_slot[link])
		link = RequirementCore._link_next[link]
	slots.sort()
	return slots


## The slots of `RequirementCore._watches` that hold a watch, in ascending order.
func _live_slots() -> PackedInt32Array:
	var slots: PackedInt32Array = PackedInt32Array()
	for i: int in RequirementCore._watches.size():
		if RequirementCore._watches[i] != null:
			slots.append(i)
	return slots
