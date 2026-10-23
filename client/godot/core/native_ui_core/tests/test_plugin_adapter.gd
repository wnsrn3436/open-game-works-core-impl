extends "res://core/native_ui_core/tests/support/native_ui_test_case.gd"
## The native adapter over a `ogw-native-ui` plugin singleton whose share window never closes: the share has no time
## limit, and `release` ends it with `Failed`, stops the adapter reading the plugin and tells the plugin with
## `cancel_share`. On a macOS host the plugin build in `addons/` gives the real singleton.

const SilentPlugin := preload("res://core/native_ui_core/tests/support/silent_native_ui_plugin.gd")
const _SINGLETON: String = "OgwNativeUi"

var _plugin: SilentPlugin = null
## Singleton of the plugin build of this host, set aside while a test registers `_plugin`. `null` when there is none.
var _host_plugin: Object = null


func before_each() -> void:
	super()
	_host_plugin = Engine.get_singleton(_SINGLETON) if Engine.has_singleton(_SINGLETON) else null


func after_each() -> void:
	super()
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()
	if _plugin != null:
		if Engine.has_singleton(_SINGLETON) and Engine.get_singleton(_SINGLETON) == _plugin:
			Engine.unregister_singleton(_SINGLETON)
		_plugin.free()
		_plugin = null
	if _host_plugin != null and not Engine.has_singleton(_SINGLETON):
		Engine.register_singleton(_SINGLETON, _host_plugin)
	_host_plugin = null


func test_a_share_window_that_never_closes_waits_until_release() -> void:
	CoreBuildInfo.platform = "android"
	_plugin = SilentPlugin.new()
	if Engine.has_singleton(_SINGLETON):
		Engine.unregister_singleton(_SINGLETON)
	Engine.register_singleton(_SINGLETON, _plugin)
	assert_true(await start_modules(NativeUiPluginAdapter.new()))
	start_share(content("hi"))
	await UnitTestCore.wait_frames(3)
	assert_eq(_plugin.shares, PackedInt64Array([1]))
	UnitTestCore.advance_clock(REVIEW_INTERVAL_MS, false)
	await UnitTestCore.wait_frames(3)
	assert_eq(share_results.size(), 0, "the share waits for the window with no time limit")
	assert_eq(_plugin.cancelled.size(), 0)
	NativeUiCore.release()
	await UnitTestCore.wait_frames(2)
	assert_eq(share_results.size(), 1, "release ends the share")
	if share_results.size() == 1:
		assert_eq(share_results[0], SHARE_FAILED)
	assert_eq(_plugin.cancelled, PackedInt64Array([1]), "the plugin is told once")
	var polls: int = _plugin.poll_count(1)
	assert_gt(polls, 0)
	await UnitTestCore.wait_frames(4)
	assert_eq(_plugin.poll_count(1), polls, "the adapter stops reading the plugin")
	assert_eq(errors(), 0)


func test_the_macos_plugin_build_gives_the_share_window() -> void:
	if CoreBuildInfo.os_platform() != "macos":
		pass_test("the ogw-native-ui plugin has a host build only on macOS")
		return
	assert_not_null(_host_plugin, "the plugin singleton of the macOS plugin build")
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules(NativeUiPluginAdapter.new()))
	assert_true(NativeUiCore.can_share())
	if DisplayServer.get_name() == "headless":
		assert_eq(await NativeUiCore.share(content("hi", 4)), SHARE_FAILED, "no window to show the share window on")
		assert_eq(errors(), 1, "the adapter reported a failure")
