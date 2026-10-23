extends "res://core/ui_core/tests/support/ui_test_case.gd"
## The license screen.

const MANIFEST_PATH: String = "user://ui_core_test_licenses.json"


func after_each() -> void:
	if FileAccess.file_exists(MANIFEST_PATH):
		DirAccess.remove_absolute(MANIFEST_PATH)
	await super()


func _write_manifest() -> void:
	var platform: String = CoreBuildInfo.platform
	var other: String = "ios" if platform != "ios" else "android"
	var components: PackedStringArray = PackedStringArray([
		_component("Engine", "4.7", "MIT", "https://engine.example", "Copyright E", "\"%s\", \"%s\"" % [platform, other]),
		_component("OtherOnly", "", "Apache-2.0", "https://other.example", "", "\"%s\"" % other),
		_component("Lib", "", "(MIT OR Apache-2.0)", "https://lib.example", "", "\"%s\"" % platform),
	])
	var text: String = "{\"components\": [%s], \"texts\": {\"MIT\": \"MIT TEXT\", \"Apache-2.0\": \"APACHE TEXT\"}}" \
			% ", ".join(components)
	var file: FileAccess = FileAccess.open(MANIFEST_PATH, FileAccess.WRITE)
	file.store_string(text)
	file.close()


func _component(component_name: String, version: String, license: String, url: String, notice: String,
		platforms: String) -> String:
	return ("{\"name\": \"%s\", \"version\": \"%s\", \"license\": \"%s\", \"url\": \"%s\", \"notice\": \"%s\", "
			+ "\"platforms\": [%s], \"modules\": []}") % [component_name, version, license, url, notice, platforms]


func test_license_screen_text_and_close() -> void:
	assert_true(await start())
	_write_manifest()
	UICore._licenses_path = MANIFEST_PATH
	var call: CALL = CALL.new()
	call.open_licenses()
	await UnitTestCore.wait_frames(1)
	var record: UICore._POPUP = UICore._shown_system[0]
	assert_eq(record.system_param.body, ReservedString.ui_licenses_title())
	assert_eq(record.system_param.buttons[0].label, ReservedString.ui_licenses_close())
	var expected: String = "\n".join(PackedStringArray([
		"Engine 4.7", "MIT", "https://engine.example", "Copyright E", "",
		"Lib", "(MIT OR Apache-2.0)", "https://lib.example", "",
		"MIT", "MIT TEXT", "",
		"Apache-2.0", "APACHE TEXT", "",
	]))
	assert_eq(record.system_param.extra_text, expected)
	assert_false(await UICore.open_licenses(), "already open")
	assert_eq(warns(), 1)
	await tap_control(system_buttons(system_popup())[0])
	await UnitTestCore.wait_frames(1)
	assert_true(call.done and call.ok)
	var again: CALL = CALL.new()
	again.open_licenses()
	await UnitTestCore.wait_frames(1)
	await advance(CLICK_INTERVAL_MS)
	await press_back()
	await UnitTestCore.wait_frames(1)
	assert_true(again.done and again.ok, "back input closes it")


func test_no_manifest() -> void:
	assert_true(await start())
	UICore._licenses_path = MANIFEST_PATH
	assert_false(await UICore.open_licenses())
	assert_eq(errors(), 1)
	assert_false(UICore.is_system_popup_visible())


func test_malformed_manifest() -> void:
	assert_true(await start())
	var file: FileAccess = FileAccess.open(MANIFEST_PATH, FileAccess.WRITE)
	file.store_string("{\"components\": [{\"name\": 3}], \"texts\": {}}")
	file.close()
	UICore._licenses_path = MANIFEST_PATH
	assert_false(await UICore.open_licenses())
	assert_eq(errors(), 1)
