extends UnitTestCase
## The `ogw-secure-storage` plugin: its `engine.json` item and builds, and the build of this host. On macOS the data
## protection keychain needs a keychain access group, so the plugin singleton exists only in an app signed with one.
## The Godot editor that runs the core tests has none: the plugin build is loaded, there is no singleton, and AuthCore
## keeps the DEV token storage.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const SecureStorage := preload("res://core/auth_core/adapters/secure_storage_adapter.gd")
const DevStorage := preload("res://core/auth_core/dev/adapters/dev_token_storage.gd")

const PLUGIN: String = "ogw-secure-storage"
const DIST: String = "res://plugins/ogw-secure-storage/dist/"
## Target platforms of `ogw-secure-storage` in the native plugin table of the Godot implementation rules.
const PLATFORMS: PackedStringArray = ["android", "ios", "macos", "windows", "linux"]
const DESKTOP_PLATFORMS: Array[String] = ["macos", "windows", "linux"]

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func test_a_run_without_a_keychain_access_group_has_no_plugin_singleton_and_keeps_the_dev_token_storage() -> void:
	if CoreBuildInfo.os_platform() != "macos":
		pass_test("the keychain access group condition of the singleton is macOS only")
		return
	assert_true(ClassDB.class_exists("OgwSecureStorage"), "the macOS plugin build is loaded")
	assert_false(SecureStorage.is_available(), "the Godot editor has no keychain access group")
	assert_true(await env.boot())
	AuthCore.release()
	AuthCore.set_storage_scope(Env.SCOPE)
	AuthCoreDev.use_dev_token_storage()
	assert_true(AuthCore.init())
	assert_true(AuthCore._storage is DevStorage)


func test_the_engine_json_item_targets_every_platform_of_the_native_plugin_table() -> void:
	if _in_browser():
		return
	assert_eq(_engine_json_platforms(), PLATFORMS)


func test_the_android_build_has_the_aar_and_its_export_plugin() -> void:
	if _in_browser():
		return
	var root: String = DIST + "android/addons/ogw-secure-storage/"
	for file: String in ["plugin.cfg", "ogw_secure_storage_export.gd", "android/ogw-secure-storage-release.aar"]:
		assert_true(FileAccess.file_exists(root + file), file)
	var config: ConfigFile = ConfigFile.new()
	assert_eq(config.load(root + "plugin.cfg"), OK)
	assert_eq(str(config.get_value("plugin", "script", "")), "ogw_secure_storage_export.gd")


func test_the_ios_build_has_the_gdip_and_a_device_and_simulator_library_per_build_type() -> void:
	if _in_browser():
		return
	var root: String = DIST + "ios/ios/plugins/ogw-secure-storage/"
	var gdip: ConfigFile = ConfigFile.new()
	assert_eq(gdip.load(root + "ogw-secure-storage.gdip"), OK)
	assert_eq(str(gdip.get_value("config", "name", "")), "OgwSecureStorage")
	assert_eq(str(gdip.get_value("config", "binary", "")), "ogw-secure-storage.xcframework")
	for build: String in ["debug", "release"]:
		var framework: String = root + "ogw-secure-storage.%s.xcframework/" % build
		assert_true(FileAccess.file_exists(framework + "Info.plist"), build)
		for slice: String in ["ios-arm64", "ios-arm64_x86_64-simulator"]:
			assert_true(FileAccess.file_exists(framework + slice + "/libogw-secure-storage.a"), build + " " + slice)


func test_each_desktop_build_has_every_library_its_gdextension_names_for_that_platform() -> void:
	if _in_browser():
		return
	for platform: String in DESKTOP_PLATFORMS:
		var root: String = DIST + platform + "/"
		var config: ConfigFile = ConfigFile.new()
		assert_eq(config.load(root + "addons/ogw-secure-storage/ogw-secure-storage.gdextension"), OK, platform)
		assert_eq(str(config.get_value("configuration", "entry_symbol", "")), "ogw_secure_storage_init", platform)
		var named: int = 0
		for key: String in config.get_section_keys("libraries"):
			if key != platform and not key.begins_with(platform + "."):
				continue
			named += 1
			var path: String = str(config.get_value("libraries", key, ""))
			assert_true(path.begins_with("res://addons/ogw-secure-storage/"), key)
			assert_true(FileAccess.file_exists(root + path.trim_prefix("res://")), key)
		assert_gt(named, 0, platform)


## True in the browser run, whose exported pack has neither `engine.json` nor `plugins/` (a `.gdignore` folder).
func _in_browser() -> bool:
	if OS.get_name() != "Web":
		return false
	pass_test("the browser run has no project files outside the exported pack")
	return true


## `platforms` of the `ogw-secure-storage` item of `engine.json`; empty when there is no such item.
# ogw:input_boundary
static func _engine_json_platforms() -> PackedStringArray:
	var platforms: PackedStringArray = PackedStringArray()
	var json: JSON = JSON.new()
	if json.parse(FileAccess.get_file_as_string("res://engine.json")) != OK or not json.data is Dictionary:
		return platforms
	var engine: Dictionary = json.data
	var plugins: Variant = engine.get("plugins", [])
	if not plugins is Array:
		return platforms
	var items: Array = plugins
	for plugin: Variant in items:
		if not plugin is Dictionary:
			continue
		var item: Dictionary = plugin
		var found: Variant = item.get("platforms", [])
		if item.get("name", "") != PLUGIN or not found is Array:
			continue
		var values: Array = found
		for platform: Variant in values:
			platforms.push_back(str(platform))
	return platforms
