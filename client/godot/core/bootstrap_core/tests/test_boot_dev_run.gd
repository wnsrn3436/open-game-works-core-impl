extends UnitTestCase
## BootstrapCore dev run: launch values, build info, app storage root, test replacements, adapters and transports.

const _SUPPORT := preload("res://core/bootstrap_core/tests/support/boot_test_support.gd")
const _NETWORK := preload("res://core/bootstrap_core/tests/support/boot_test_network.gd")
const _ENTRY := preload("res://core/bootstrap_core/tests/support/boot_test_entry.gd")

const AUTH: PackedStringArray = ["AuthCore"]
## The store adapter kinds `_check_store_adapter` expects.
const _NONE := 0
const _PLUGIN := 1
const _FAKE := 2


func _boot(extra: PackedStringArray = PackedStringArray(), realtime: RefCounted = null) -> void:
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(extra), realtime)
	await UnitTestCore.wait_latch(latch)


## Boot of a build with a build info file of `environment` and `platform`, holding `adapters` and `ad_units`.
func _boot_build_info(
		environment: String,
		platform: String,
		extra: PackedStringArray,
		adapters: Dictionary[String, String] = {},
		ad_units: Dictionary[int, String] = {}
) -> void:
	var info := BuildInfo.new()
	info.app_version = "1.0.0"
	info.environment = environment
	info.platform = platform
	info.server_url = "http://127.0.0.1"
	info.adapters = adapters.duplicate()
	info.ad_units = ad_units.duplicate()
	BootstrapCore._build_info = info
	await _boot(extra)


## Starts the boot of a build with a build info file without waiting: `InitModules` ends inside the start, so the
## adapters are passed and the modules are initialized when it returns.
func _start_build_info(platform: String, extra: PackedStringArray, adapters: Dictionary[String, String]) -> void:
	var info := BuildInfo.new()
	info.app_version = "1.0.0"
	info.environment = "DEV"
	info.platform = platform
	info.server_url = "http://127.0.0.1"
	info.adapters = adapters.duplicate()
	BootstrapCore._build_info = info
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules(extra))


func _boot_until_halted() -> void:
	_SUPPORT.start(_ENTRY.new(), _SUPPORT.modules())
	assert_true(await _SUPPORT.wait_stage(BootstrapCore.BootStage.HALTED), "boot stage HALTED")


func test_dev_run_build_info_has_launch_values_local_and_fake_adapters() -> void:
	_SUPPORT.prepare({"OGW_INSTANCE_ID": "i1"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", {"iap-google": "iap-google"})
	UnitTestCore.set_test_settings("environments.STG.adapters", {"ads": "ads-admob"})
	await _boot()
	var info := BootstrapCore.get_build_info()
	assert_eq(info.environment, "LOCAL")
	assert_eq(info.server_url, "http://127.0.0.1")
	assert_eq(info.instance_id, "i1")
	var iap_adapter: String = info.adapters.get("iap-google", "")
	var ads_adapter: String = info.adapters.get("ads", "")
	assert_eq(iap_adapter, "fake")
	assert_eq(ads_adapter, "fake")
	assert_true(BootstrapCore._storage_scope().ends_with(".i1"))


func test_instance_id_decides_app_storage_root() -> void:
	_SUPPORT.prepare({"OGW_INSTANCE_ID": "i1"})
	await _boot()
	assert_eq(CoreBuildInfo.storage_root, "user://instances/i1/")
	_assert_files_under("user://instances/i1/")


func test_instance_id_with_dev_account_decides_app_storage_root() -> void:
	_SUPPORT.prepare({"OGW_INSTANCE_ID": "i1", "OGW_DEV_ACCOUNT": "opponent_1"})
	_NETWORK.add_dev_login_success()
	await _boot(AUTH)
	assert_eq(BootstrapCore.get_build_info().instance_id, "i1.opponent_1")
	assert_eq(CoreBuildInfo.storage_root, "user://instances/i1.opponent_1/")
	_assert_files_under("user://instances/i1.opponent_1/")


func test_empty_instance_id_uses_app_storage() -> void:
	_SUPPORT.prepare()
	await _boot()
	assert_eq(CoreBuildInfo.storage_root, "user://")
	_assert_files_under("user://")
	assert_false(FileAccess.file_exists("user://instances/i1/local_data/device.dat"))


## The `LogCore` log files and, after a device value is written, `local_data/device.dat` are under `root`.
func _assert_files_under(root: String) -> void:
	var log_files := LogCoreDev.list_log_files()
	assert_gt(log_files.size(), 0)
	for path: String in log_files:
		assert_true(FileAccess.file_exists(root + path), root + path)
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, "BootstrapCore.test_marker", 1)
	LocalDataCore.flush()
	assert_true(FileAccess.file_exists(root + "local_data/device.dat"))


func test_upper_case_instance_id_is_fatal() -> void:
	_SUPPORT.prepare({"OGW_INSTANCE_ID": "I1"})
	var instance_files := _files_under(CoreBuildInfo.DEFAULT_STORAGE_ROOT + "instances/")
	await _boot_until_halted()
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_false("stage:LoadData" in BootstrapCore._trace)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)
	assert_eq(CoreBuildInfo.storage_root, CoreBuildInfo.DEFAULT_STORAGE_ROOT)
	var logged := false
	for path: String in LogCoreDev.list_log_files():
		var full := CoreBuildInfo.DEFAULT_STORAGE_ROOT + path
		if FileAccess.file_exists(full) and FileAccess.get_file_as_string(full).contains("OGW_INSTANCE_ID"):
			logged = true
	assert_true(logged, "the error log is in a log file right under app storage")
	assert_eq(_files_under(CoreBuildInfo.DEFAULT_STORAGE_ROOT + "instances/"), instance_files)


## Files and folders under `dir`, at every depth.
static func _files_under(dir: String) -> PackedStringArray:
	var paths := PackedStringArray()
	var access := DirAccess.open(dir)
	if access == null:
		return paths
	access.include_hidden = true
	for file: String in access.get_files():
		paths.append(dir.path_join(file))
	for sub: String in access.get_directories():
		paths.append(dir.path_join(sub) + "/")
		paths.append_array(_files_under(dir.path_join(sub)))
	return paths


func test_dev_token_storage_is_passed_right_after_the_storage_scope() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	await _boot(AUTH)
	var trace := BootstrapCore._trace
	assert_eq(_SUPPORT.count("AuthCore.use_dev_token_storage"), 1)
	assert_eq(trace.find("AuthCore.use_dev_token_storage"), trace.find("AuthCore.set_storage_scope") + 1)

	BootstrapCoreDev.shutdown()
	_SUPPORT.prepare()
	await _boot()
	assert_eq(_SUPPORT.count("AuthCore.use_dev_token_storage"), 0, "AuthCore is not in the module list")


func test_replacement_server_url_without_launch_value_reaches_done() -> void:
	_SUPPORT.prepare()
	await _boot()
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_eq(BootstrapCore.get_build_info().server_url, "http://127.0.0.1")


func test_no_server_url_is_fatal() -> void:
	_SUPPORT.prepare()
	BootstrapCore.start_boot(_ENTRY.new(), _SUPPORT.modules(), BootTestReplacements.new())
	await UnitTestCore.wait_frames(3)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)


func test_replacements_are_passed_before_init_in_every_boot() -> void:
	_SUPPORT.prepare()
	BootstrapCore._test_downloads = _SUPPORT.bundle_downloads()
	await _boot()
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.request_restart()
	await UnitTestCore.wait_latch(latch)
	assert_eq(_SUPPORT.count("stage:InitModules"), 3)
	for operation: String in ["TimeCore.set_test_clock", "LogCore.set_test_clock", "NetworkCore.set_transport", "LogCore.set_log_listener"]:
		assert_eq(_SUPPORT.count(operation), 3, operation)
	var boots := ",".join(BootstrapCore._trace).split("stage:InitModules")
	for i: int in range(1, boots.size()):
		assert_true(boots[i].find("TimeCore.set_test_clock") < boots[i].find("LogCore.init"))
		assert_true(boots[i].find("LogCore.set_log_listener") < boots[i].find("LogCore.init"))

	BootstrapCoreDev.shutdown()
	_SUPPORT.prepare({"OGW_SERVER_URL": "http://127.0.0.1"})
	var plain := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.start_boot(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(plain)
	for operation: String in ["TimeCore.set_test_clock", "LogCore.set_test_clock", "NetworkCore.set_transport", "LogCore.set_log_listener"]:
		assert_eq(_SUPPORT.count(operation), 0, operation)


func test_test_realtime_transport_is_passed_as_it_is() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	var fake := UnitTestCore.create_fake_realtime()
	await _boot(PackedStringArray(["AuthCore", "RealtimeCore"]), fake)
	assert_eq(_SUPPORT.count("RealtimeCore.set_transport"), 1)
	assert_true(_SUPPORT.trace_between("stage:InitModules", "RealtimeCore.init").has("RealtimeCore.set_transport"))


func test_dev_run_realtime_transport_without_test_transport_is_lockstep_over_network_simulation() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	await _boot(PackedStringArray(["AuthCore", "RealtimeCore"]))
	assert_eq(_SUPPORT.count("RealtimeCore.set_transport"), 1)
	assert_true(_SUPPORT.trace_between("stage:InitModules", "RealtimeCore.init").has("RealtimeCore.set_transport"))
	assert_eq(BootstrapCore._realtime_transport_kind, "lockstep(sim(p2p relay_only=false))")


func test_dev_build_realtime_transport_is_lockstep_over_p2p() -> void:
	_SUPPORT.prepare()
	await _boot_build_info("DEV", CoreBuildInfo.os_platform(), PackedStringArray(["RealtimeCore"]))
	assert_eq(_SUPPORT.count("RealtimeCore.set_transport"), 1)
	assert_eq(BootstrapCore._realtime_transport_kind, "lockstep(p2p relay_only=false)")


func test_relay_only_setting_reaches_the_p2p_transport_of_a_build_info_build() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.set_test_settings("BootstrapCore.realtimeRelayOnly", true)
	_NETWORK.add_dev_login_success()
	await _boot(PackedStringArray(["AuthCore", "RealtimeCore"]))
	assert_true(BootstrapCore._relay_only)
	assert_eq(_SUPPORT.count("RealtimeCore.set_transport"), 1)
	assert_eq(BootstrapCore._realtime_transport_kind, "lockstep(sim(p2p relay_only=false))")

	BootstrapCoreDev.shutdown()
	_SUPPORT.prepare()
	UnitTestCore.set_test_settings("BootstrapCore.realtimeRelayOnly", true)
	await _boot_build_info("DEV", CoreBuildInfo.os_platform(), PackedStringArray(["RealtimeCore"]))
	assert_eq(BootstrapCore._realtime_transport_kind, "lockstep(p2p relay_only=true)")


func test_ios_platform_launch_value_sets_platform_and_touch_emulation() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "ios"})
	await _boot(PackedStringArray(["VirtualPadCore"]))
	assert_eq(BootstrapCore.get_build_info().platform, "ios")
	assert_eq(CoreBuildInfo.platform, "ios")
	assert_eq(_SUPPORT.count("VirtualPadCore.set_test_touch_support"), 1)


func test_upper_case_platform_launch_value_is_fatal() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "IOS"})
	await _boot_until_halted()
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.HALTED)
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 2)


func test_android_platform_launch_value_makes_touch_device_and_android_fill_mode() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "android"})
	await _boot()
	assert_eq(InputCore.get_device(), InputCore.InputDevice.TOUCH)
	assert_eq(ResolutionCore.get_fill_mode(), ResolutionCore.FillMode.LETTERBOX)


func test_web_platform_outside_browser_logs_in_as_new_account() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "web"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", {})
	# The guest login asks for no consent popup.
	for key: String in PackedStringArray(
		["consent.ageConfirmation", "consent.privacyChoices", "consent.trackingRequest", "pushConsent.adPush"]
	):
		UnitTestCore.set_test_settings(key, false)
	await _boot_web()
	assert_eq(BootstrapCore.get_build_info().platform, "web")
	assert_eq(_SUPPORT.count("AuthCore.boot_login"), 1)
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)


## Boot with `AuthCore` and the server results of a first `boot_login`: terms, guest login.
func _boot_web() -> void:
	# Version 0 of both documents is the agreed version of a new install.
	var terms := CoreContract.GetTermsResponse.new()
	var items: Array[CoreContract.TermsItem] = [
		CoreContract.TermsItem.TERMS_ITEM_TERMS, CoreContract.TermsItem.TERMS_ITEM_PRIVACY
	]
	for item: CoreContract.TermsItem in items:
		var document := CoreContract.TermsDocument.new()
		document.item = item
		document.url = "https://example.com/terms"
		terms.documents.append(document)
	_NETWORK.add_body("core/GetTerms", terms.encode())
	var auth := CoreContract.AuthResult.new()
	auth.user_id = _NETWORK.USER_ID
	auth.login_token = "login-token"
	auth.access_token = "access-token"
	auth.access_token_expires_at = _NETWORK.SERVER_TIME_AT + 3600000
	auth.session_signing_key = "signing-key"
	auth.consent = CoreContract.ConsentUserState.new()
	auth.consent.tracking = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_APPLICABLE
	var login := CoreContract.LoginResponse.new()
	login.result = auth
	_NETWORK.add_body("core/Login", login.encode())
	await _boot(AUTH)


## Value of header `header_name` of the last received `request_name` request. Empty when there is none.
func _header(request_name: String, header_name: String) -> String:
	var value := ""
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name != request_name:
			continue
		value = ""
		for line: String in received.headers:
			if line.begins_with(header_name + ": "):
				value = line.substr(header_name.length() + 2)
	return value


func test_dev_access_launch_value_reaches_cheat_request_header() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester", "OGW_DEV_ACCESS": "dev-access-value"})
	_NETWORK.add_dev_login_success()
	await _boot(AUTH)
	assert_eq(_SUPPORT.count("NetworkCore.set_dev_access"), 1)
	assert_true(_SUPPORT.trace_between("NetworkCore.set_server_info", "stage:LoadData").has("NetworkCore.set_dev_access"))
	assert_eq(_header(_NETWORK.DEV_LOGIN, "X-Ogw-Dev-Access"), "dev-access-value", "the dev login of the boot")
	_NETWORK.add_body("core/cheat/SetTimeOffset", CoreCheatContract.SetTimeOffsetResponse.new().encode())
	assert_true(await NetworkCoreDev.send_cheat(CoreCheatContract.SetTimeOffsetRequest.new()))
	assert_eq(_header("core/cheat/SetTimeOffset", "X-Ogw-Dev-Access"), "dev-access-value")


func test_dev_access_of_a_dev_build_info_file_reaches_cheat_request_header() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCESS": "launch-value-is-not-read"})
	var file := {
		"app_id": "boot.test", "app_version": "1.0.0", "environment": "DEV", "platform": CoreBuildInfo.os_platform(),
		"server_url": "http://127.0.0.1", "game_update_url": "", "instance_id": "", "update_trust_keys": [],
		"adapters": {}, "ad_units": {}, "dev_access": "build-dev-access",
	}
	var info := BootstrapCore._parse_build_info(JSON.stringify(file))
	assert_not_null(info)
	BootstrapCore._build_info = info
	await _boot()
	assert_eq(_SUPPORT.count("NetworkCore.set_dev_access"), 1)
	_NETWORK.add_dev_login_success()
	var result: AuthSendResult = await NetworkCoreDev.send_auth_cheat(CoreCheatContract.DevLoginRequest.new(), AuthSendOptions.new())
	assert_true(result.ok)
	assert_eq(_header(_NETWORK.DEV_LOGIN, "X-Ogw-Dev-Access"), "build-dev-access")


## The adapter of the last call `BootstrapCore` traced as `entry`, or null when it made none.
func _traced(entry: String) -> RefCounted:
	return BootstrapCore._traced_adapters[entry] if BootstrapCore._traced_adapters.has(entry) else null


func test_push_notification_adapter_of_dev_run_is_the_fake_adapter() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	await _boot(PackedStringArray(["AuthCore", "PushCore"]))
	assert_eq(_SUPPORT.count("PushCore.set_notification_adapter"), 1)
	assert_true(_SUPPORT.trace_between("stage:InitModules", "PushCore.init").has("PushCore.set_notification_adapter"))


func test_push_notification_adapter_of_a_build_is_the_platform_adapter_on_android_and_ios_only() -> void:
	for platform: String in ["android", "linux"]:
		_SUPPORT.prepare()
		await _boot_build_info("DEV", platform, PackedStringArray(["PushCore"]))
		var expected := 1 if platform == "android" else 0
		assert_eq(_SUPPORT.count("PushCore.set_notification_adapter"), expected, platform)
		BootstrapCoreDev.shutdown()


func test_push_adapter_is_apns_on_ios_and_fcm_on_android_by_build_info_adapters() -> void:
	_check_push_adapter("ios", {"push-apns": "push-apns"}, true, false)
	_check_push_adapter("ios", {"push-apns": "push-apns-sandbox"}, true, false)
	_check_push_adapter("android", {"push-fcm": "push-fcm"}, false, true)
	_check_push_adapter("ios", {"push-fcm": "push-fcm"}, false, false)
	_check_push_adapter("android", {"push-apns": "push-apns"}, false, false)
	_check_push_adapter("linux", {"push-apns": "push-apns", "push-fcm": "push-fcm"}, false, false)


func _check_push_adapter(platform: String, adapters: Dictionary[String, String], apns: bool, fcm: bool) -> void:
	var label := "%s %s" % [platform, adapters]
	_SUPPORT.prepare()
	_start_build_info(platform, PackedStringArray(["PushCore"]), adapters)
	assert_true(PushCore.is_initialized(), label)
	var push: RefCounted = _traced("PushCore.set_push_adapter")
	assert_eq(push is PushApnsAdapter, apns, label)
	assert_eq(push is PushFcmAdapter, fcm, label)
	var passed := 1 if apns or fcm else 0
	assert_eq(_SUPPORT.count("PushCore.set_push_adapter"), passed, label)
	if passed == 1:
		assert_true(_SUPPORT.trace_between("stage:InitModules", "PushCore.init").has("PushCore.set_push_adapter"), label)
	BootstrapCoreDev.shutdown()
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 0, label)
	assert_eq(UnitTestCore.check_logs("error", "PushCore"), 0, label)


func test_store_adapter_is_the_plugin_adapter_of_the_platform_store_and_fake_from_dev_code() -> void:
	var apple := CoreContract.IapStore.IAP_STORE_APPLE
	var google := CoreContract.IapStore.IAP_STORE_GOOGLE
	var none := CoreContract.IapStore.IAP_STORE_UNSPECIFIED
	# The key of the platform store: `fake` is the fake adapter, any other value the plugin adapter of that store.
	for platform: String in ["ios", "macos"]:
		_check_store_adapter(platform, {"iap-apple": "iap-apple"}, _PLUGIN, apple)
		_check_store_adapter(platform, {"iap-apple": "iap-apple-sandbox"}, _PLUGIN, apple)
		_check_store_adapter(platform, {"iap-apple": "fake"}, _FAKE, apple)
		_check_store_adapter(platform, {"iap-google": "iap-google"}, _NONE, none)
		_check_store_adapter(platform, {"iap-google": "fake"}, _NONE, none)
		_check_store_adapter(platform, {}, _NONE, none)
	_check_store_adapter("android", {"iap-google": "iap-google"}, _PLUGIN, google)
	_check_store_adapter("android", {"iap-google": "iap-google-sandbox"}, _PLUGIN, google)
	_check_store_adapter("android", {"iap-google": "fake"}, _FAKE, google)
	_check_store_adapter("android", {"iap-apple": "iap-apple"}, _NONE, none)
	_check_store_adapter("android", {"iap-apple": "fake"}, _NONE, none)
	_check_store_adapter("android", {}, _NONE, none)
	# A platform without a store has no store adapter for any value.
	for platform: String in ["windows", "linux", "web"]:
		_check_store_adapter(platform, {"iap-apple": "iap-apple", "iap-google": "iap-google"}, _NONE, none)
		_check_store_adapter(platform, {"iap-apple": "fake", "iap-google": "fake"}, _NONE, none)

	# A dev run: `fake` is the fake adapter of the platform store.
	await _check_dev_run_store_adapter("macos", {"iap-apple": "iap-apple"}, apple)
	await _check_dev_run_store_adapter("android", {"iap-google": "iap-google"}, google)


## Boot of a build with `adapters` on `platform`: the store adapter `PaymentCore` got is of `kind` and store `store`.
func _check_store_adapter(
		platform: String,
		adapters: Dictionary[String, String],
		kind: int,
		store: CoreContract.IapStore
) -> void:
	var label := "%s %s" % [platform, adapters]
	_SUPPORT.prepare()
	_start_build_info(platform, PackedStringArray(["PaymentCore"]), adapters)
	assert_true(PaymentCore.is_initialized(), label)
	var adapter := _traced("PaymentCore.set_store_adapter") as StoreAdapter
	assert_eq(adapter is PluginStoreAdapter, kind == _PLUGIN, label + " plugin adapter")
	assert_eq(adapter is FakeStoreAdapter, kind == _FAKE, label + " fake adapter")
	assert_eq(adapter == null, kind == _NONE, label + " no adapter")
	if adapter != null:
		assert_eq(adapter.get_store(), store, label + " store")
	assert_eq(_SUPPORT.count("PaymentCore.set_store_adapter"), 0 if kind == _NONE else 1, label)
	BootstrapCoreDev.shutdown()
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 0, label)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0, label)


## Dev run boot on launch value `OGW_PLATFORM` `platform` with DEV `adapters`: the fake adapter of store `store`.
func _check_dev_run_store_adapter(platform: String, adapters: Dictionary[String, String], store: CoreContract.IapStore) -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": platform, "OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", adapters)
	_NETWORK.add_dev_login_success()
	await _boot(PackedStringArray(["AuthCore", "PaymentCore"]))
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE, platform)
	var adapter := _traced("PaymentCore.set_store_adapter") as StoreAdapter
	assert_true(adapter is FakeStoreAdapter, platform)
	if adapter != null:
		assert_eq(adapter.get_store(), store, platform)
	BootstrapCoreDev.shutdown()
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 0, platform)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0, platform)


func test_payment_without_store_adapter_has_no_payment_error_log() -> void:
	_SUPPORT.prepare({"OGW_PLATFORM": "linux", "OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	await _boot(PackedStringArray(["AuthCore", "PaymentCore"]))
	assert_eq(BootstrapCore.boot_stage(), BootstrapCore.BootStage.DONE)
	assert_eq(UnitTestCore.check_logs("error", "PaymentCore"), 0)


func test_ads_adapter_receives_build_info_ad_units() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	UnitTestCore.set_test_settings("environments.DEV.adapters", {"ads": "fake"})
	_NETWORK.add_dev_login_success()
	await _boot(PackedStringArray(["AuthCore", "AdCore"]))
	assert_eq(_SUPPORT.count("AdCore.set_ads_adapter"), 1)
	assert_true(_traced("AdCore.set_ads_adapter") is FakeAdsAdapter)
	assert_eq(BootstrapCore._traced_ad_units, BootstrapCore.get_build_info().ad_units)

	# A dev run whose build info holds ad units.
	BootstrapCoreDev.shutdown()
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester"})
	_NETWORK.add_dev_login_success()
	var info := BuildInfo.new()
	info.environment = "LOCAL"
	info.platform = CoreBuildInfo.os_platform()
	info.server_url = "http://127.0.0.1"
	info.adapters["ads"] = "fake"
	info.ad_units = {7: "unit-7", 9: "unit-9"}
	BootstrapCore._build_info = info
	BootstrapCore._is_dev_run = true
	await _boot(PackedStringArray(["AuthCore", "AdCore"]))
	assert_eq(_SUPPORT.count("AdCore.set_ads_adapter"), 1)
	assert_eq(BootstrapCore._traced_ad_units.size(), 2)
	assert_eq(BootstrapCore._traced_ad_units, info.ad_units)


func test_build_without_dev_entry_has_no_launch_values_fake_adapters_or_dev_calls() -> void:
	_SUPPORT.prepare({"OGW_DEV_ACCOUNT": "tester", "OGW_DEV_ACCESS": "dev-access-value"})
	var info := BuildInfo.new()
	info.environment = "STG"
	info.platform = CoreBuildInfo.os_platform()
	info.server_url = "http://127.0.0.1"
	info.adapters["login-google"] = "fake"
	BootstrapCore._build_info = info
	var dev := BootstrapCore._dev
	BootstrapCore._dev = null
	var latch := UnitTestCore.latch_event(BootCompletedEvent)
	BootstrapCore.start_boot(_ENTRY.new(), _SUPPORT.modules())
	await UnitTestCore.wait_latch(latch)
	BootstrapCore._dev = dev
	assert_eq(BootstrapCore.get_build_info().instance_id, "")
	for operation: String in [
		"TimeCore.set_test_clock", "NetworkCore.set_transport", "LogCore.set_log_listener",
		"NetworkCore.set_dev_access", "AuthCore.dev_login",
	]:
		assert_eq(_SUPPORT.count(operation), 0, operation)




func test_fake_social_adapter_without_dev_code_is_a_value_that_could_not_be_passed() -> void:
	_SUPPORT.prepare()
	var info := BuildInfo.new()
	info.app_version = "1.0.0"
	info.environment = "STG"
	info.platform = CoreBuildInfo.os_platform()
	info.server_url = "http://127.0.0.1"
	info.adapters["login-google"] = "fake"
	BootstrapCore._build_info = info
	# The test keeps the OS secure storage out of the run.
	AuthCoreDev.use_dev_token_storage()
	var dev := BootstrapCore._dev
	BootstrapCore._dev = null
	# `InitModules` ends inside the start: the adapters are passed and the modules are initialized when it returns.
	BootstrapCore.start_boot(_ENTRY.new(), _SUPPORT.modules(AUTH))
	BootstrapCore._dev = dev
	assert_true(AuthCore.is_initialized())
	assert_eq(_SUPPORT.count("AuthCore.set_social_adapter"), 0)
	assert_eq(BootstrapCore._traced_adapters.size(), 0)
	BootstrapCoreDev.shutdown()
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 1, "adapter login-google=fake could not be passed")
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0)


func test_social_adapters_are_the_real_adapters_on_their_platforms_only() -> void:
	for platform: String in ["ios", "macos", "android", "linux", "windows"]:
		_check_social_adapters(platform, platform == "ios" or platform == "macos")


func _check_social_adapters(platform: String, apple: bool) -> void:
	_SUPPORT.prepare()
	_start_build_info(platform, AUTH, {"login-apple": "login-apple", "login-google": "login-google"})
	assert_true(AuthCore.is_initialized(), platform)
	var apple_adapter := _traced("AuthCore.set_social_adapter:%d" % CoreContract.LoginProvider.LOGIN_PROVIDER_APPLE) as SocialAdapter
	var google_adapter := _traced("AuthCore.set_social_adapter:%d" % CoreContract.LoginProvider.LOGIN_PROVIDER_GOOGLE) as SocialAdapter
	assert_eq(apple_adapter is LoginAppleAdapter, apple, platform)
	assert_true(google_adapter is LoginGoogleAdapter, platform)
	assert_eq(_SUPPORT.count("AuthCore.set_social_adapter"), 2 if apple else 1, platform)
	BootstrapCoreDev.shutdown()
	assert_eq(UnitTestCore.check_logs("error", "BootstrapCore"), 0, platform)
	assert_eq(UnitTestCore.check_logs("error", "AuthCore"), 0, platform)
