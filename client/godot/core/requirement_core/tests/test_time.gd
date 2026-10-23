extends "res://core/requirement_core/tests/support/requirement_test_case.gd"
## Time-dependent watches: judged again at each `RequirementCore.timeRecheckMs` of real elapsed time and at
## `DayChangedEvent`, without a delta or a trigger.

## A server time 9.7 hours after a game day start, far from the boundaries.
const T0: int = 1720000000000
const MINUTE: int = 60000
## Half of `RECHECK_MS`.
const HALF_RECHECK_MS: int = 500


## Registers `Level` as a time-dependent type that reads the recovery item balance, `FlagA` as a type that is not, and
## watches one condition of each with a trigger that is never raised.
func _start_recovery(recorder: Recorder, other: Recorder) -> void:
	await start(T0)
	register_flags()
	answer(false)
	Hooks.recovery_item = id_of("[user_state_recovery]")
	Hooks.recovery_least = 3
	var kinds: Array[GDScript] = [CoreContract.ItemBalanceUserState]
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.recovery_at_least, kinds, GUIDE_LEVEL, Callable(), true))
	# 2 at T0, recovering 1 a minute up to 5.
	put_balance(Hooks.recovery_item, 2, T0)
	assert_true(RequirementCore.watch(id_of(LEVEL), triggers(content_trigger()), recorder.on_result))
	assert_true(RequirementCore.watch(id_of(SINGLE), triggers(content_trigger()), other.on_result))
	assert_eq(Hooks.count(TYPE_LEVEL), 1)
	assert_eq(Hooks.count(FLAG_A), 1)


func test_a_recovery_condition_watch_calls_back_once_at_the_time_recheck_after_the_recovery() -> void:
	var recorder: Recorder = Recorder.new()
	var other: Recorder = Recorder.new()
	await _start_recovery(recorder, other)
	# The time recheck before the recovery: judged, same result.
	sync_to(T0 + MINUTE - 1 - RECHECK_MS)
	UnitTestCore.advance_clock(RECHECK_MS, false)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), 2, "judged at the time recheck")
	assert_eq(recorder.count(), 0, "2 recovered nothing yet")
	# The recovery to 3 changes the result without a delta; no callback before the next time recheck.
	sync_to(T0 + MINUTE)
	await frame()
	assert_eq(recorder.count(), 0, "no time recheck yet")
	UnitTestCore.advance_clock(RECHECK_MS - 1, false)
	await frame()
	assert_eq(recorder.count(), 0, "the interval has not passed")
	UnitTestCore.advance_clock(1, false)
	await frame()
	assert_eq(recorder.calls, PackedStringArray(["%d:true:0" % id_of(LEVEL)]))
	await frame()
	assert_eq(recorder.count(), 1, "once")
	assert_eq(Hooks.count(FLAG_A), 1, "the watch of a condition that is not time-dependent is not judged")
	assert_eq(other.count(), 0)


func test_a_time_dependent_watch_is_judged_at_day_changed_event() -> void:
	var recorder: Recorder = Recorder.new()
	var other: Recorder = Recorder.new()
	await _start_recovery(recorder, other)
	var judged: int = Hooks.count(TYPE_LEVEL)
	# The sync reaches the next game day: TimeCore publishes DayChangedEvent. No time recheck has passed.
	sync_to(TimeCore.get_next_day_boundary(T0) + MARGIN_MS)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), judged + 1, "judged after DayChangedEvent")
	assert_eq(recorder.count(), 1, "the balance recovered to the cap in the meantime")
	assert_eq(Hooks.count(FLAG_A), 1, "the watch of a condition that is not time-dependent is not judged")


func test_a_shop_purchase_count_condition_watch_calls_back_once_after_the_reset_time_is_reached() -> void:
	var reset_at: int = T0
	await start(reset_at - 10 * MINUTE)
	Hooks.shop_product = id_of("[shop_daily]")
	var kinds: Array[GDScript] = [CoreContract.ShopPurchaseUserState]
	assert_true(RequirementCore.register_judge(TYPE_SHOP_RANK, Hooks.shop_unbought, kinds, GUIDE_LEVEL, Callable(), true))
	put_shop(Hooks.shop_product, 1, reset_at)
	var recorder: Recorder = Recorder.new()
	var shop_rank: int = id_of(SHOP_RANK)
	assert_true(RequirementCore.watch(shop_rank, triggers(content_trigger()), recorder.on_result))
	assert_false(RequirementCore.evaluate(shop_rank).passed, "bought in this period")
	# The time recheck that ends 1 ms before the reset time plus the reach margin: still bought.
	sync_to(reset_at + MARGIN_MS - 1 - RECHECK_MS)
	UnitTestCore.advance_clock(RECHECK_MS, false)
	await frame()
	assert_eq(recorder.count(), 0, "1 ms before the reach")
	# The reach changes the result without a delta; the callback comes at the next time recheck.
	sync_to(reset_at + MARGIN_MS)
	await frame()
	assert_eq(recorder.count(), 0, "no time recheck yet")
	UnitTestCore.advance_clock(RECHECK_MS, false)
	await frame()
	assert_eq(recorder.calls, PackedStringArray(["%d:true:0" % shop_rank]))
	await frame()
	assert_eq(recorder.count(), 1, "once")


func test_the_time_recheck_follows_the_time_dependent_watches_as_they_come_and_go() -> void:
	await start(T0)
	register_flags()
	answer(false)
	var level: int = id_of(LEVEL)
	var first: Recorder = Recorder.new()
	var second: Recorder = Recorder.new()
	# No hook for Level yet: the watch is not of a time-dependent condition until register_judge says so.
	assert_true(RequirementCore.watch(level, triggers(content_trigger()), first.on_result))
	assert_eq(errors(), 1, "the type without a hook")
	UnitTestCore.advance_clock(HALF_RECHECK_MS, false)
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(TYPE_LEVEL, Hooks.flag, no_kinds, GUIDE_LEVEL, Callable(), true))
	UnitTestCore.advance_clock(RECHECK_MS - 1, false)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), 0, "the time recheck starts at register_judge")
	UnitTestCore.advance_clock(1, false)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), 1, "judged at the time recheck")
	# The last time-dependent watch goes, then another comes: the time recheck starts again from the new one.
	RequirementCore.unwatch(level, first.on_result)
	UnitTestCore.advance_clock(HALF_RECHECK_MS, false)
	assert_true(RequirementCore.watch(level, triggers(content_trigger()), first.on_result), "the same callback after unwatch")
	assert_false(RequirementCore.watch(level, triggers(content_trigger()), first.on_result), "the same callback twice")
	assert_eq(errors(), 1)
	assert_true(RequirementCore.watch(level, triggers(content_trigger()), second.on_result))
	var judged: int = Hooks.count(TYPE_LEVEL)
	UnitTestCore.advance_clock(HALF_RECHECK_MS, false)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), judged, "not at the time recheck of the removed watch")
	UnitTestCore.advance_clock(HALF_RECHECK_MS, false)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), judged + 2, "both watches at the time recheck of the new watch")
	RequirementCore.unwatch(level, first.on_result)
	RequirementCore.unwatch(level, second.on_result)
	UnitTestCore.advance_clock(RECHECK_MS, false)
	await frame()
	assert_eq(Hooks.count(TYPE_LEVEL), judged + 2, "no time-dependent watch, no judgement")
	assert_eq(first.count() + second.count(), 0, "the result never changed")
