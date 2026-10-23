extends UnitTestCase
## DEV token storage: one file per scope text in `user://ogw_dev_tokens/`, and when `init` uses it.

const Env := preload("res://core/auth_core/tests/support/auth_test_env.gd")
const Storage := preload("res://core/auth_core/adapters/token_storage.gd")
const SecureStorage := preload("res://core/auth_core/adapters/secure_storage_adapter.gd")
const DevStorage := preload("res://core/auth_core/dev/adapters/dev_token_storage.gd")
const WebStorage := preload("res://core/auth_core/adapters/web_storage_adapter.gd")

const NAMES: PackedStringArray = ["scope.a", "scope.b", "scope.c", Env.SCOPE]
## Platforms of a run outside the browser runtime. The browser run's platform is `web`.
const NATIVE: PackedStringArray = ["android", "ios", "windows", "macos", "linux"]

var env: Env = null


func before_each() -> void:
	super()
	env = Env.new()
	_remove_files()


func after_each() -> void:
	env.finish()
	CoreBuildInfo.has_dev_code = true
	_remove_files()
	super()


static func _remove_files() -> void:
	for name: String in NAMES:
		for path: String in PackedStringArray([DevStorage.item_path(name), DevStorage.item_path(name) + ".tmp"]):
			if FileAccess.file_exists(path) and DirAccess.remove_absolute(path) != OK:
				push_warning("DEV token file was not removed: " + path)


static func _file_text(name: String) -> String:
	var path: String = DevStorage.item_path(name)
	if not FileAccess.file_exists(path):
		return ""
	return FileAccess.get_file_as_string(path)


## Skips the test when this run's platform is not in `platforms`, and tells whether it runs.
static func _run_on(platforms: PackedStringArray) -> bool:
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()
	UnitTestCore.require_platform(platforms)
	return CoreBuildInfo.platform in platforms


## Inits AuthCore again with no test storage, so that it chooses the platform storage.
func _restart_with_platform_storage(give_dev_storage: bool) -> void:
	AuthCore.release()
	AuthCore.set_storage_scope(Env.SCOPE)
	if give_dev_storage:
		AuthCoreDev.use_dev_token_storage()
	assert_true(AuthCore.init())


func test_each_scope_text_has_its_own_dev_token_file() -> void:
	var storage: DevStorage = DevStorage.new()
	assert_eq(storage.read_item("scope.a").status, Storage.Status.NOT_FOUND)
	assert_eq(storage.write_item("scope.a", "text-a").status, Storage.Status.OK)
	assert_eq(storage.write_item("scope.b", "text-b").status, Storage.Status.OK)
	assert_eq(storage.write_item("scope.a", "text-a2").status, Storage.Status.OK)
	var other: DevStorage = DevStorage.new()
	var read_a: Storage.Outcome = other.read_item("scope.a")
	assert_eq(read_a.status, Storage.Status.OK)
	assert_eq(read_a.text, "text-a2")
	assert_eq(other.read_item("scope.b").text, "text-b")
	assert_eq(other.read_item("scope.c").status, Storage.Status.NOT_FOUND)
	assert_eq(DevStorage.item_path("scope.a"), "user://ogw_dev_tokens/scope.a.json")
	assert_eq(_file_text("scope.a"), "text-a2")
	assert_eq(_file_text("scope.b"), "text-b")
	assert_false(FileAccess.file_exists(DevStorage.item_path("scope.c")))
	assert_false(FileAccess.file_exists(DevStorage.item_path("scope.a") + ".tmp"))


func test_remove_takes_out_only_the_file_of_that_scope_text() -> void:
	var storage: DevStorage = DevStorage.new()
	assert_eq(storage.remove_item("scope.a").status, Storage.Status.NOT_FOUND)
	assert_eq(storage.write_item("scope.a", "text-a").status, Storage.Status.OK)
	assert_eq(storage.write_item("scope.b", "text-b").status, Storage.Status.OK)
	assert_eq(storage.remove_item("scope.a").status, Storage.Status.OK)
	assert_false(FileAccess.file_exists(DevStorage.item_path("scope.a")))
	assert_eq(storage.read_item("scope.a").status, Storage.Status.NOT_FOUND)
	assert_eq(storage.remove_item("scope.a").status, Storage.Status.NOT_FOUND)
	assert_eq(storage.read_item("scope.b").text, "text-b")


func test_scope_text_that_is_not_a_file_name_fails_and_writes_no_file() -> void:
	var storage: DevStorage = DevStorage.new()
	for name: String in PackedStringArray(["", "../scope.a", "scope/a", "scope:a"]):
		assert_eq(storage.write_item(name, "text").status, Storage.Status.FAILED)
		assert_eq(storage.read_item(name).status, Storage.Status.FAILED)
		assert_eq(storage.remove_item(name).status, Storage.Status.FAILED)
	assert_false(FileAccess.file_exists("user://scope.a.json"))
	assert_false(FileAccess.file_exists(DevStorage.DIR + "/scope/a.json"))


func test_init_without_secure_storage_singleton_keeps_the_login_token_in_the_dev_token_file() -> void:
	if not _run_on(NATIVE):
		return
	assert_true(await env.boot())
	_restart_with_platform_storage(true)
	if SecureStorage.is_available():
		# A host with the plugin build uses OS secure storage.
		assert_true(AuthCore._storage is SecureStorage)
		return
	assert_true(AuthCore._storage is DevStorage)
	var result: LoginResult = await env.boot_guest(901, "token-a")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	var stored: Storage.Outcome = DevStorage.new().read_item(Env.SCOPE)
	assert_eq(stored.status, Storage.Status.OK)
	assert_string_contains(stored.text, "\"token-a\"")
	assert_string_contains(_file_text(Env.SCOPE), "\"token-a\"")
	_restart_with_platform_storage(true)
	Env.respond_terms()
	Env.respond_auto_login(901, "token-b")
	result = await AuthCore.boot_login()
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	assert_eq(Env.request_header("core/AutoLogin", "Authorization"), "Bearer token-a")
	assert_string_contains(DevStorage.new().read_item(Env.SCOPE).text, "\"token-b\"")


func test_init_uses_os_secure_storage_without_the_dev_token_storage_or_dev_code() -> void:
	if not _run_on(NATIVE):
		return
	assert_true(await env.boot())
	_restart_with_platform_storage(false)
	assert_true(AuthCore._storage is SecureStorage)
	CoreBuildInfo.has_dev_code = false
	_restart_with_platform_storage(true)
	assert_true(AuthCore._storage is SecureStorage)


func test_browser_runtime_keeps_the_login_token_in_the_browser_storage_even_with_the_dev_token_storage() -> void:
	if not _run_on(PackedStringArray(["web"])):
		return
	assert_true(await env.boot())
	_restart_with_platform_storage(false)
	assert_true(AuthCore._storage is WebStorage)
	_restart_with_platform_storage(true)
	assert_true(AuthCore._storage is WebStorage)
	var result: LoginResult = await env.boot_guest(902, "token-c")
	assert_eq(result.status, AuthCore.LoginStatus.SUCCESS)
	var stored: Storage.Outcome = WebStorage.new().read_item(Env.SCOPE)
	assert_eq(stored.status, Storage.Status.OK)
	assert_string_contains(stored.text, "\"token-c\"")
	assert_false(FileAccess.file_exists(DevStorage.item_path(Env.SCOPE)))
	assert_eq(WebStorage.new().remove_item(Env.SCOPE).status, Storage.Status.OK)


func test_release_drops_the_dev_token_storage() -> void:
	assert_true(await env.boot())
	_restart_with_platform_storage(true)
	AuthCore.release()
	assert_null(AuthCore._dev_storage)
