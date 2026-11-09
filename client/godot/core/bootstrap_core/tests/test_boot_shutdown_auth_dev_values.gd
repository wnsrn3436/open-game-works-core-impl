extends UnitTestCase
## DEV `shutdown` and the DEV values of AuthCore: `shutdown` calls `AuthCore.clear_dev_values` while the scope text of
## AuthCore is still set, also when AuthCore is not in the module list, so the next boot finds no fake social account,
## no fake tracking state and no storage item of the scope.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")

const AUTH: PackedStringArray = ["AuthCore"]
const _FAKE_ACCOUNT: String = "shutdown_frank"
const _ITEM_TEXT: String = "{\"login_token\":\"shutdown-token\",\"linked_providers\":[]}"
## Login token storage locations of the engine-specific implementation rules: the browser runtime keeps the item in
## `window.localStorage` key `ogw.<scope text>`; a run with DEV code outside it and without the `ogw-secure-storage`
## singleton (a core test process) keeps it in the DEV token storage file `user://ogw_dev_tokens/<scope text>.json`.
const _WEB_KEY_PREFIX: String = "ogw."
const _DEV_TOKEN_DIR: String = "user://ogw_dev_tokens"
const _SECURE_STORAGE_SINGLETON: String = "OgwSecureStorage"

## Scope text of the boot with AuthCore, whose storage item `after_each` removes.
var _scope: String = ""


func after_each() -> void:
	_remove_item(_scope)
	super()


func test_shutdown_clears_the_dev_values_and_deletes_the_storage_item_of_the_scope() -> void:
	assert_false(Engine.has_singleton(_SECURE_STORAGE_SINGLETON), "a core test run uses no OS secure storage")
	await _boot_with_auth()
	_scope = BootstrapCore._storage_scope()
	assert_false(_scope.is_empty())
	assert_true(_write_item(_scope, _ITEM_TEXT), "the storage item of the scope is written")
	assert_true(_has_item(_scope))
	_set_fake_values()
	BootstrapCoreDev.shutdown()
	assert_false(AuthCore.is_initialized())
	await UnitTestCore.wait_frames(3)
	assert_false(_has_item(_scope), "the next test finds no storage item")
	await _boot_with_auth()
	_assert_no_fake_values()


func test_shutdown_clears_the_dev_values_when_auth_core_is_not_in_the_module_list() -> void:
	await _boot(PackedStringArray(), {})
	assert_false(AuthCore.is_initialized())
	_set_fake_values()
	BootstrapCoreDev.shutdown()
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.NONE)
	await _boot_with_auth()
	_scope = BootstrapCore._storage_scope()
	_assert_no_fake_values()


func _boot(extra: PackedStringArray, launch_values: Dictionary[String, String]) -> void:
	_SUPPORT.prepare(launch_values)
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(extra))
	await UnitTestCore.wait_latch(latch)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)


## A dev login boot with AuthCore in the module list, to `Done`.
func _boot_with_auth() -> void:
	_NETWORK.add_dev_login_success()
	await _boot(AUTH, {"OGW_DEV_ACCOUNT": "tester"})
	assert_true(AuthCore.is_logged_in())


func _set_fake_values() -> void:
	AuthCoreDev.set_fake_social_account(_FAKE_ACCOUNT)
	AuthCoreDev.set_fake_tracking_status(CoreContract.TrackingStatus.TRACKING_STATUS_DENIED)


## In a boot with AuthCore logged in: the fake social adapter and the device tracking state do not use the values
## set before the `shutdown`.
func _assert_no_fake_values() -> void:
	var signed: SocialAdapter.SignInResult = FakeSocialAdapter.new().sign_in()
	assert_eq(signed.status, SocialAdapter.SignInStatus.SUCCESS)
	assert_ne(signed.credential, "fake:" + _FAKE_ACCOUNT, "fake social account")
	assert_ne(AuthCore.get_consent().tracking, CoreContract.TrackingStatus.TRACKING_STATUS_DENIED, "fake tracking state")


static func _uses_web_storage() -> bool:
	return OS.get_name() == "Web"


static func _dev_token_path(scope: String) -> String:
	return "%s/%s.json" % [_DEV_TOKEN_DIR, scope]


static func _web_key(scope: String) -> String:
	return JSON.stringify(_WEB_KEY_PREFIX + scope)


## Writes the storage item of `scope` where the storage AuthCore uses keeps it.
static func _write_item(scope: String, text: String) -> bool:
	if _uses_web_storage():
		var reply: String = str(JavaScriptBridge.eval(
			"(function(){try{window.localStorage.setItem(%s,%s);return \"ok\";}catch(e){return \"\";}})()"
			% [_web_key(scope), JSON.stringify(text)]
		))
		return reply == "ok"
	if DirAccess.make_dir_recursive_absolute(_DEV_TOKEN_DIR) != OK:
		return false
	var file := FileAccess.open(_dev_token_path(scope), FileAccess.WRITE)
	if file == null:
		return false
	var stored := file.store_string(text)
	file.close()
	return stored


static func _has_item(scope: String) -> bool:
	if _uses_web_storage():
		var reply: String = str(JavaScriptBridge.eval(
			"(function(){try{return window.localStorage.getItem(%s)===null?\"no\":\"yes\";}catch(e){return \"\";}})()"
			% _web_key(scope)
		))
		return reply == "yes"
	return FileAccess.file_exists(_dev_token_path(scope))


static func _remove_item(scope: String) -> void:
	if scope.is_empty():
		return
	if _uses_web_storage():
		JavaScriptBridge.eval(
			"(function(){try{window.localStorage.removeItem(%s);}catch(e){}})()" % _web_key(scope)
		)
	elif FileAccess.file_exists(_dev_token_path(scope)):
		DirAccess.remove_absolute(_dev_token_path(scope))
