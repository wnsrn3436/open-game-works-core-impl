extends "res://core/input_block_core/tests/support/input_block_case.gd"
## Block elapsed time, forced release, timer hold and `restart_timer`.

const EXEMPT_TAGS: PackedStringArray = ["scene", "cutscene", "tutorial", "ad", "boot"]
const LIMITED_TAGS: PackedStringArray = ["network", "ui", "tween", "message", "content"]


func test_forced_release_at_max_duration() -> void:
	init_modules()
	var token: int = InputBlockCore.block("content")
	await advance(MAX_MS - 1)
	assert_true(InputBlockCore.is_active(token))
	await advance(1)
	assert_false(InputBlockCore.is_active(token))
	assert_false(InputBlockCore.is_blocked())
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_background_time_is_not_block_elapsed_time() -> void:
	init_modules()
	var token: int = InputBlockCore.block("content")
	UnitTestCore.advance_clock(MAX_MS * 2, true)
	await next_frame()
	assert_true(InputBlockCore.is_active(token))
	UnitTestCore.advance_clock(MAX_MS * 2, false, true)
	await next_frame()
	assert_true(InputBlockCore.is_active(token))
	await advance(MAX_MS)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_forced_release_while_paused() -> void:
	init_modules()
	TimeCore.set_paused(true)
	var token: int = InputBlockCore.block("content")
	await advance(MAX_MS)
	TimeCore.set_paused(false)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_forced_release_at_slow_time_scale() -> void:
	init_modules()
	TimeCore.set_time_scale(100)
	var token: int = InputBlockCore.block("content")
	await advance(MAX_MS - 1)
	assert_true(InputBlockCore.is_active(token))
	await advance(1)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_exempt_reason_tags_stay_active() -> void:
	init_modules()
	var exempt: PackedInt64Array = PackedInt64Array()
	for reason: String in EXEMPT_TAGS:
		exempt.append(InputBlockCore.block(reason))
	var limited: PackedInt64Array = PackedInt64Array()
	for reason: String in LIMITED_TAGS:
		limited.append(InputBlockCore.block(reason))
	await advance(MAX_MS * 3)
	for token: int in exempt:
		assert_true(InputBlockCore.is_active(token))
	for token: int in limited:
		assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 5)


func test_timer_hold_stops_block_elapsed_time() -> void:
	init_modules()
	var token: int = InputBlockCore.block("content")
	await advance(300)
	InputBlockCore.set_timer_hold("ui", true)
	await advance(MAX_MS * 2)
	assert_true(InputBlockCore.is_active(token))
	InputBlockCore.set_timer_hold("ui", false)
	await advance(MAX_MS - 300 - 1)
	assert_true(InputBlockCore.is_active(token))
	await advance(1)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_timer_hold_lasts_while_any_tag_holds() -> void:
	init_modules()
	var token: int = InputBlockCore.block("content")
	InputBlockCore.set_timer_hold("ui", true)
	InputBlockCore.set_timer_hold("network", true)
	InputBlockCore.set_timer_hold("ui", false)
	await advance(MAX_MS * 2)
	assert_true(InputBlockCore.is_active(token))
	InputBlockCore.set_timer_hold("step", true)
	InputBlockCore.set_timer_hold("network", false)
	await advance(MAX_MS * 2)
	assert_true(InputBlockCore.is_active(token))
	# a tag follows the last value it got
	InputBlockCore.set_timer_hold("step", true)
	InputBlockCore.set_timer_hold("step", false)
	await advance(MAX_MS - 1)
	assert_true(InputBlockCore.is_active(token))
	await advance(1)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_restart_timer_starts_block_elapsed_time_again() -> void:
	init_modules()
	var token: int = InputBlockCore.block("network")
	await advance(MAX_MS - 1)
	assert_true(InputBlockCore.restart_timer(token))
	await advance(MAX_MS - 1)
	assert_true(InputBlockCore.is_active(token))
	await advance(1)
	assert_false(InputBlockCore.is_active(token))
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)


func test_restart_timer_of_bad_token_is_false_without_log() -> void:
	init_modules()
	var token: int = InputBlockCore.block("network")
	assert_true(InputBlockCore.unblock(token))
	assert_false(InputBlockCore.restart_timer(token))
	assert_false(InputBlockCore.restart_timer(0))
	assert_eq(UnitTestCore.check_logs("warn", TAG), 0)
