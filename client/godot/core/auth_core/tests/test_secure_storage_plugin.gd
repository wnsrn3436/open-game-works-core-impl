extends UnitTestCase
## The `ogw-secure-storage` plugin build of this host, which only macOS has. The data protection keychain needs a
## keychain access group, so the plugin singleton exists only in an app signed with one. The Godot editor that runs the
## core tests has none: the plugin build is loaded, there is no singleton, and AuthCore keeps the DEV token storage.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const SecureStorage := preload("res://core/auth_core/adapters/secure_storage_adapter.gd")
const DevStorage := preload("res://core/auth_core/dev/adapters/dev_token_storage.gd")

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()


func after_each() -> void:
	env.finish()
	super()


func test_a_run_without_a_keychain_access_group_has_no_plugin_singleton_and_keeps_the_dev_token_storage() -> void:
	if CoreBuildInfo.os_platform() != "macos":
		pass_test("the ogw-secure-storage plugin has a host build only on macOS")
		return
	assert_true(ClassDB.class_exists("OgwSecureStorage"), "the macOS plugin build is loaded")
	assert_false(SecureStorage.is_available(), "the Godot editor has no keychain access group")
	assert_true(await env.boot())
	AuthCore.release()
	AuthCore.set_storage_scope(Env.SCOPE)
	AuthCoreDev.use_dev_token_storage()
	assert_true(AuthCore.init())
	assert_true(AuthCore._storage is DevStorage)
