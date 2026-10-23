extends "res://core/ui_core/tests/support/ui_test_case.gd"
## Popup suppression.

const KEY: String = "ui_test.popup_a"


func _suppress(mode: UICore.PopupSuppressMode, key: String = KEY) -> PopupSuppress:
	var suppress: PopupSuppress = PopupSuppress.new()
	suppress.key = key
	suppress.mode = mode
	return suppress


func test_forever_suppresses_and_survives_release() -> void:
	assert_true(await start())
	load_user_file()
	sync_time(SERVER_TIME)
	UICore.suppress_popup(KEY, UICore.PopupSuppressMode.FOREVER)
	var result: UICore.PopupOpenResult = await UICore.open_popup(
			POPUP_A, null, hidden_of("a"), _suppress(UICore.PopupSuppressMode.FOREVER))
	assert_eq(result, UICore.PopupOpenResult.SUPPRESSED)
	assert_null(popup_of(POPUP_A))
	assert_eq(LOG.count(POPUP_A), 0, "no instance")
	assert_eq(opened_events.size(), 0)
	assert_eq(hidden_calls.size(), 0)
	UICore.release()
	assert_true(UICore.init())
	assert_true(await UICore.prepare())
	result = await UICore.open_popup(POPUP_A, null, Callable(), _suppress(UICore.PopupSuppressMode.FOREVER))
	assert_eq(result, UICore.PopupOpenResult.SUPPRESSED, "after release and init")
	LocalDataCore.flush()
	LocalDataCore.release()
	assert_true(LocalDataCore.init())
	assert_true(LocalDataCore.load_user_file(1))
	result = await UICore.open_popup(POPUP_A, null, Callable(), _suppress(UICore.PopupSuppressMode.FOREVER))
	assert_eq(result, UICore.PopupOpenResult.SUPPRESSED, "after a user file load")
	result = await UICore.open_popup(
			POPUP_B, null, Callable(), _suppress(UICore.PopupSuppressMode.FOREVER, "ui_test.popup_b"))
	assert_eq(result, UICore.PopupOpenResult.OPENED, "another key")
	result = await UICore.open_popup(POPUP_A, null, Callable())
	assert_eq(result, UICore.PopupOpenResult.OPENED, "the same popup key without PopupSuppress")


func _today_at_offset(offset_ms: int) -> void:
	set_int("dailyResetOffsetMs", offset_ms)
	assert_true(await start())
	load_user_file()
	var day_boundary: int = boundary(offset_ms)
	sync_time(day_boundary - 10 * 60000)
	UICore.suppress_popup(KEY, UICore.PopupSuppressMode.TODAY)
	assert_true(UICore.is_popup_suppressed(KEY))
	sync_time(day_boundary + MARGIN_MS - 1)
	var result: UICore.PopupOpenResult = await UICore.open_popup(
			POPUP_A, null, Callable(), _suppress(UICore.PopupSuppressMode.TODAY))
	assert_eq(result, UICore.PopupOpenResult.SUPPRESSED, "right before the boundary plus the margin")
	sync_time(day_boundary + MARGIN_MS)
	result = await UICore.open_popup(POPUP_A, null, Callable(), _suppress(UICore.PopupSuppressMode.TODAY))
	assert_eq(result, UICore.PopupOpenResult.OPENED, "at the boundary plus the margin")


func test_today_until_the_next_day_boundary() -> void:
	await _today_at_offset(0)


func test_today_with_a_boundary_before_utc_midnight() -> void:
	await _today_at_offset(-3 * 3600000)


func test_today_with_a_boundary_after_utc_midnight() -> void:
	await _today_at_offset(5 * 3600000)


func test_today_set_right_before_the_reach() -> void:
	assert_true(await start())
	load_user_file()
	var day_boundary: int = boundary(0)
	sync_time(day_boundary + MARGIN_MS - 1)
	UICore.suppress_popup(KEY, UICore.PopupSuppressMode.TODAY)
	sync_time(day_boundary + MARGIN_MS)
	var result: UICore.PopupOpenResult = await UICore.open_popup(
			POPUP_A, null, Callable(), _suppress(UICore.PopupSuppressMode.TODAY))
	assert_eq(result, UICore.PopupOpenResult.OPENED)


func test_before_the_user_file_load() -> void:
	assert_true(await start())
	sync_time(SERVER_TIME)
	var result: UICore.PopupOpenResult = await UICore.open_popup(
			POPUP_A, null, Callable(), _suppress(UICore.PopupSuppressMode.FOREVER))
	assert_eq(result, UICore.PopupOpenResult.OPENED)
	UICore.suppress_popup(KEY, UICore.PopupSuppressMode.FOREVER)
	assert_false(UICore.is_popup_suppressed(KEY))
	assert_eq(UnitTestCore.check_logs(ERROR, "LocalDataCore"), 0)
	load_user_file()
	assert_false(UICore.is_popup_suppressed(KEY), "nothing was saved")


func test_today_before_the_first_sync_is_not_saved() -> void:
	assert_true(await start())
	load_user_file()
	UICore.suppress_popup(KEY, UICore.PopupSuppressMode.TODAY)
	assert_eq(warns(), 1)
	assert_false(UICore.is_popup_suppressed(KEY))


func test_malformed_elements_are_dropped_by_the_next_save() -> void:
	assert_true(await start())
	load_user_file()
	sync_time(SERVER_TIME)
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, UICore._SUPPRESS_KEY,
			PackedStringArray(["bad", "ui_test.popup_c=x", "ui_test.popup_d=1"]))
	assert_false(UICore.is_popup_suppressed("ui_test.popup_c"))
	UICore.suppress_popup(KEY, UICore.PopupSuppressMode.FOREVER)
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, UICore._SUPPRESS_KEY),
			PackedStringArray([KEY + "=-1"]), "malformed and reached elements are gone")
