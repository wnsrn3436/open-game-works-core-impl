extends "res://core/message_core/tests/support/message_test_case.gd"
## `prepare`, its error rows and the requests that are not shown.

var _prepare_done: bool = false
var _prepare_result: bool = false

signal prepare_finished


func before_each() -> void:
	super()
	_prepare_done = false
	_prepare_result = false


func test_prepare_loads_resources_into_global_scope_and_fills_toast_pool() -> void:
	use_prefabs_with_tweens()
	set_int("PoolCore.defaultPrefillCount", 2)
	assert_true(await start_prepared())
	var kind: int = ResourceCore.BaseKind.PACKED_SCENE
	assert_true(ResourceCore.is_loaded(TOAST, kind))
	assert_true(ResourceCore.is_loaded(BLACK_BOX, kind))
	assert_true(ResourceCore.get_global_scope().keys.has(TOAST))
	assert_true(ResourceCore.get_global_scope().keys.has(BLACK_BOX))
	assert_true(ResourceCore.get_global_scope().keys.has(FADE_IN))
	assert_true(ResourceCore.get_global_scope().keys.has(FADE_OUT))
	var pool: Vector2i = PoolCore.get_pool_state(TOAST, ResourceCore.get_global_scope())
	assert_eq(pool.x, 2)
	assert_eq(pool.y, 0)
	assert_not_null(MessageCore._black_box_object)
	assert_false(MessageCore._black_box_object.visible)


func test_prepare_with_empty_toast_resource_has_no_toast_pool() -> void:
	assert_true(await start_modules())
	assert_true(await MessageCore.prepare())
	assert_null(MessageCore._toast_prefab)
	assert_not_null(MessageCore._code_toast_object)
	assert_false(MessageCore._code_toast_object.visible)
	assert_eq(MessageCore._toast_holder.get_child_count(), 1, "only the hidden code made toast is in the toast holder")


func test_prepare_fails_when_toast_prefab_has_no_message_view() -> void:
	set_string("MessageCore.toastResource", TOAST_NO_VIEW)
	assert_true(await start_modules())
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)


func test_prepare_fails_when_black_box_prefab_has_no_text_element() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX_NO_LABEL)
	assert_true(await start_modules())
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)


func test_prepare_fails_when_tween_preset_does_not_load() -> void:
	set_tweens("", "", "", MISSING_TWEEN)
	assert_true(await start_modules())
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)
	assert_gt(errors("ResourceCore"), 0)


func test_prepare_fails_when_tween_preset_repeats_forever() -> void:
	set_tweens(FADE_FOREVER, "", "", "")
	assert_true(await start_modules())
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)


func test_prepare_fails_when_toast_pool_prefill_fails() -> void:
	set_string("MessageCore.toastResource", TOAST_NOT_POOLED)
	assert_true(await start_modules())
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)
	assert_gt(errors("PoolCore"), 0)


func test_prepare_fails_and_gives_back_the_toast_object_when_the_toast_prefab_root_is_not_a_control() -> void:
	set_string("MessageCore.toastResource", TOAST_NODE2D_ROOT)
	assert_true(await start_modules())
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)
	var pool: Vector2i = PoolCore.get_pool_state(TOAST_NODE2D_ROOT, ResourceCore.get_global_scope())
	assert_gt(pool.x, 0, "the toast pool was filled")
	assert_eq(pool.y, 0, "no toast object stays borrowed")
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)
	pool = PoolCore.get_pool_state(TOAST_NODE2D_ROOT, ResourceCore.get_global_scope())
	assert_eq(pool.y, 0, "no toast object stays borrowed after a second prepare")


func test_prepare_again_closes_messages_destroys_objects_and_reads_settings_again() -> void:
	set_string("MessageCore.blackBoxResource", BLACK_BOX)
	set_tweens(FADE_IN, FADE_OUT, FADE_IN, FADE_OUT)
	assert_true(await start_prepared())
	var old_black_box: Control = MessageCore._black_box_object
	var old_code_toast: Control = MessageCore._code_toast_object
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_black_box(key_a())
	MessageCore.show_black_box(key_b())
	var token: int = black_box().block_token
	assert_true(InputBlockCore.is_active(token))
	set_string("MessageCore.toastResource", TOAST)
	set_string("MessageCore.blackBoxResource", "")
	set_tweens("", "", "", "")
	set_int("MessageCore.toastDurationMs", TOAST_MS * 2)
	_run_prepare()
	assert_false(_prepare_done, "the second prepare waits for the toast prefab")
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())
	assert_false(InputBlockCore.is_active(token))
	assert_eq(InputBlockCoreDev.count_active(), 0)
	assert_false(is_instance_valid(old_black_box), "the black box object of the first prepare is destroyed")
	assert_false(is_instance_valid(old_code_toast), "the code made toast object of the first prepare is destroyed")
	MessageCore.show_toast(key_c())
	MessageCore.show_black_box(key_c())
	assert_eq(errors(MessageCore._TAG), 2, "requests before the second prepare ends are ignored")
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())
	if not _prepare_done:
		await prepare_finished
	assert_true(_prepare_result)
	assert_eq(errors(MessageCore._TAG), 0)
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	assert_true(toast().pooled, "the toast is the prefab of the new settings")
	assert_null(MessageCore._find_view(black_box().object), "the black box is the code made one of the new settings")
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD, "no enter tween in the new settings")
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.HOLD)
	await advance(TOAST_MS)
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD, "the toast display time of the new settings")
	await advance(TOAST_MS)
	assert_nothing_shown(toast())

func test_prepare_during_prepare_fails_and_first_prepare_goes_on() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_modules())
	_run_prepare()
	assert_false(_prepare_done, "the first prepare waits for its resources")
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)
	if not _prepare_done:
		await prepare_finished
	assert_true(_prepare_result)
	MessageCore.show_toast(key_a())
	assert_eq(toast().text, LocalizationCore.get_text(key_a()))


func test_black_box_time_not_less_than_block_max_duration_logs_one_error() -> void:
	set_tweens("", "", FADE_IN, FADE_OUT)
	set_int("InputBlockCore.maxDurationMs", TWEEN_MS + BLACK_BOX_MS + TWEEN_MS)
	assert_true(await start_modules())
	assert_true(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)


func test_black_box_time_one_less_than_block_max_duration_logs_nothing() -> void:
	set_tweens("", "", FADE_IN, FADE_OUT)
	set_int("InputBlockCore.maxDurationMs", TWEEN_MS + BLACK_BOX_MS + TWEEN_MS + 1)
	assert_true(await start_modules())
	assert_true(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 0)


func test_requests_before_prepare_succeeds_are_ignored_and_not_queued() -> void:
	set_string("MessageCore.toastResource", TOAST_NO_VIEW)
	assert_true(await start_modules())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	assert_eq(errors(MessageCore._TAG), 2)
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 1)
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	assert_eq(errors(MessageCore._TAG), 2)
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())


func test_requests_without_translation_key_or_with_empty_text_are_ignored() -> void:
	assert_true(await start_prepared())
	MessageCore.show_toast("")
	MessageCore.show_black_box("")
	var args: FormatArgs = FormatArgs.new()
	args.set_string("text", "")
	MessageCore.show_toast(text_key(), args)
	MessageCore.show_black_box(text_key(), args)
	assert_eq(errors(MessageCore._TAG), 4)
	assert_nothing_shown(toast())
	assert_nothing_shown(black_box())
	assert_false(InputBlockCore.is_blocked())


func _run_prepare() -> void:
	_prepare_result = await MessageCore.prepare()
	_prepare_done = true
	prepare_finished.emit()
