extends UnitTestCase
## Base of the `GameUpdateCore` core tests. Initializes the modules `GameUpdateCore` depends on in module list order
## without `BootstrapCore`, so `RestartRequestedEvent` reaches only the test, then `GameUpdateCore` with a test
## downloader. Builds and signs test deploy lists, presses system popup buttons and counts restarts.

const _SIGNER = preload("res://core/game_update_core/tests/support/ed25519_signer.gd")
const _DOWNLOADER = preload("res://core/game_update_core/tests/support/fake_update_downloader.gd")
const _BUILDER = preload("res://core/game_update_core/tests/support/deploy_list_builder.gd")
const _FILE = preload("res://core/game_update_core/tests/support/deploy_list_file.gd")
const _RESTART_COUNTER = preload("res://core/game_update_core/tests/support/restart_counter.gd")
const _HTTP_DOWNLOADER = preload("res://core/game_update_core/http_update_downloader.gd")
const _WEB_DOWNLOADER = preload("res://core/game_update_core/web_update_downloader.gd")

const TAG: String = "GameUpdateCore"
const RESOURCES: String = "res://core/game_update_core/tests/resources/"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const LIST_URL: String = "https://update.example.com/update/deploy_list.json"
const SIGNATURE_URL: String = "https://update.example.com/update/deploy_list.json.sig"
const FILE_BASE: String = "https://update.example.com/update/files/"
const APP_VERSION: String = "1.2.0"
const PLATFORM: String = "android"
## RFC 8032 test key 1: the trusted signing key.
const TRUSTED_SEED_HEX: String = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
## RFC 8032 test key 2: a key outside the trust keys.
const OTHER_SEED_HEX: String = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"
## Stall timeout of the tests that do not test it: longer than any clock advance of a test.
const LONG_STALL_MS: int = 3600000
const PUMP_MS: int = 1000
const PUMP_FRAMES: int = 10

static var _public_keys: Dictionary[String, PackedByteArray] = {}

var downloader: _DOWNLOADER = null
var restarts: _RESTART_COUNTER = null
var store_urls: PackedStringArray = PackedStringArray()
var check_finished: bool = false
var check_result: bool = false


func after_each() -> void:
	await super()
	if is_instance_valid(restarts):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(restarts)
		restarts.get_parent().remove_child(restarts)
		restarts.free()
	GameUpdateCore.release()
	_release_modules()
	# GUT runs every test of a file on one instance: the next test starts with no store redirects.
	store_urls = PackedStringArray()
	check_finished = false
	check_result = false


## Initializes the modules and `GameUpdateCore` with a new test downloader. `false` when one failed.
func start(stall_ms: int = LONG_STALL_MS) -> bool:
	if not UnitTestCore.set_test_settings("GameUpdateCore.stallTimeoutMs", stall_ms):
		return false
	if not await _init_modules():
		return false
	downloader = _DOWNLOADER.new()
	GameUpdateCoreDev.set_downloader(downloader)
	if not GameUpdateCore.init():
		return false
	GameUpdateCore._store_opener = _on_store_redirect
	restarts = _RESTART_COUNTER.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(restarts)
	return EventCore.subscribe(RestartRequestedEvent, restarts.on_restart_requested)


## A new default downloader of this runtime on the `GameUpdateCore` core node: the page `fetch` one in the browser
## runtime and the `HTTPRequest` one elsewhere. Call after `start`.
func default_downloader() -> UpdateDownloader:
	if OS.get_name() == "Web":
		return _WEB_DOWNLOADER.new(GameUpdateCore._node)
	return _HTTP_DOWNLOADER.new(GameUpdateCore._node)


## Releases `GameUpdateCore` and initializes it again with a new test downloader, for one more `check_update`.
func restart_module() -> bool:
	GameUpdateCore.release()
	await close_popups()
	downloader = _DOWNLOADER.new()
	GameUpdateCoreDev.set_downloader(downloader)
	if not GameUpdateCore.init():
		return false
	GameUpdateCore._store_opener = _on_store_redirect
	return true


## Waits for the fetch failure popup and checks it shows `body_key` and that its one error log was left.
func expect_fetch_failure(body_key: String) -> void:
	await pump()
	assert_true(popup_shows(body_key), "fetch failure popup shows " + body_key)
	assert_false(check_finished, "check_update waits for retry")
	assert_eq(errors(), 1, "one error log for the fetch failure")


## Signature file bytes with the given fields.
static func signature_json(id: String, sequence: int, signature: PackedByteArray) -> PackedByteArray:
	return ("{\"key_id\":%s,\"sequence\":%d,\"signature\":%s}" % [JSON.stringify(id), sequence,
			JSON.stringify(Marshalls.raw_to_base64(signature))]).to_utf8_buffer()


## Writes `content` to `game_update/<name>` as if an earlier `check_update` saved it.
static func put_saved(name: String, content: String) -> bool:
	return LocalDataCore.write_file("game_update/" + name, content.to_utf8_buffer()).ok


func make_source() -> UpdateSource:
	var source: UpdateSource = UpdateSource.new()
	source.app_version = APP_VERSION
	source.environment = "DEV"
	source.platform = PLATFORM
	source.game_update_url = LIST_URL
	source.update_trust_keys = {key_id(TRUSTED_SEED_HEX): Marshalls.raw_to_base64(public_key(TRUSTED_SEED_HEX))}
	return source


## A deploy list for this app with a patch entry of the built-in data version and no files. Tests make it before
## `start` too, so the built-in data version comes from the file and not from `DataCore`.
func make_list() -> _BUILDER:
	var list: _BUILDER = _BUILDER.new()
	list.platform = PLATFORM
	list.app_version = APP_VERSION
	list.data_version = DataCoreTestSupport.builtin_version()
	return list


## A data version with the built-in protocol hash and another data hash.
func other_data_version() -> String:
	var builtin: String = DataCoreTestSupport.builtin_version()
	var other: String = builtin.substr(0, 65) + "a".repeat(64)
	return other if other != builtin else builtin.substr(0, 65) + "b".repeat(64)


## A data version with another protocol hash.
func other_protocol_version() -> String:
	var builtin: String = DataCoreTestSupport.builtin_version()
	var other: String = "c".repeat(64) + builtin.substr(64)
	return other if other != builtin else "d".repeat(64) + builtin.substr(64)


static func make_file(name: String, content: String) -> _FILE:
	return _BUILDER.make_file(name, content)


static func make_bundle_file(name: String, content: String) -> _FILE:
	return _BUILDER.make_bundle_file(name, content)


static func public_key(seed_hex: String) -> PackedByteArray:
	if not _public_keys.has(seed_hex):
		_public_keys[seed_hex] = _SIGNER.public_key(seed_hex.hex_decode())
	return _public_keys[seed_hex]


static func key_id(seed_hex: String) -> String:
	return UtilCore.sha256_hex(public_key(seed_hex)).substr(0, 16)


## Signature file bytes of `list_bytes`.
static func signature_bytes(list_bytes: PackedByteArray, sequence: int, seed_hex: String = TRUSTED_SEED_HEX) -> PackedByteArray:
	var signature: PackedByteArray = _SIGNER.sign(seed_hex.hex_decode(), list_bytes)
	var text: String = "{\"key_id\":%s,\"sequence\":%d,\"signature\":%s}" % [
		JSON.stringify(key_id(seed_hex)), sequence, JSON.stringify(Marshalls.raw_to_base64(signature))]
	return text.to_utf8_buffer()


## Adds `list` and its signature as the next responses of the deploy list URL and the signature URL, and its files.
func serve(list: _BUILDER) -> void:
	var bytes: PackedByteArray = list.to_bytes()
	downloader.add_body(LIST_URL, bytes)
	downloader.add_body(SIGNATURE_URL, signature_bytes(bytes, list.sequence))
	serve_files(list.data_files)
	serve_files(list.translation_files)
	serve_files(list.bundle_files)


## Adds the bytes of `files` as the next responses of their file URLs.
func serve_files(files: Array[_FILE]) -> void:
	for file: _FILE in files:
		downloader.add_body(FILE_BASE + file.sha256, file.body)


## Starts `check_update` without waiting. `check_finished` and `check_result` show its end.
func start_check(source: UpdateSource) -> void:
	check_finished = false
	check_result = false
	_run_check(source)


## Lets popup flows, tweens and deferred calls run.
func pump() -> void:
	UnitTestCore.advance_clock(PUMP_MS, false)
	await UnitTestCore.wait_frames(PUMP_FRAMES)
	UnitTestCore.advance_clock(PUMP_MS, false)
	await UnitTestCore.wait_frames(PUMP_FRAMES)


## Whether a visible system popup shows the translation of `key`.
func popup_shows(key: String) -> bool:
	var text: String = LocalizationCore.get_text(key)
	for node: Node in UICore.get_layer(UICore.UILayer.POPUP).find_children("*", "Control", true, false):
		var control: Control = node as Control
		if not control.is_visible_in_tree():
			continue
		if control is Label and (control as Label).text == text:
			return true
		if control is RichTextLabel and (control as RichTextLabel).text == text:
			return true
		if control is Button and (control as Button).text == text:
			return true
	return false


## Taps the visible system popup button labeled with the translation of `key`. `false` when there is none.
func press(key: String) -> bool:
	var text: String = LocalizationCore.get_text(key)
	for node: Node in UICore.get_layer(UICore.UILayer.POPUP).find_children("*", "Button", true, false):
		var button: Button = node as Button
		if button.is_visible_in_tree() and button.text == text:
			UnitTestCore.tap(button.get_global_transform_with_canvas() * (button.size / 2.0))
			await pump()
			return true
	return false


## Closes the popups without a button.
func close_popups() -> void:
	UICore.close_all_popups()
	await pump()


func popup_count() -> int:
	return UICore.get_open_popup_count()


func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


func publish_update_required(code: int) -> void:
	var event: UpdateRequiredEvent = EventCore.acquire(UpdateRequiredEvent) as UpdateRequiredEvent
	event.error_code = code
	EventCore.publish(event)


func _run_check(source: UpdateSource) -> void:
	var ok: bool = await GameUpdateCore.check_update(source)
	check_result = ok
	check_finished = true


func _on_store_redirect(url: String) -> void:
	store_urls.append(url)


## Initializes the modules `GameUpdateCore` depends on, in module list order, and does the boot steps they need.
func _init_modules() -> bool:
	var keys: Dictionary[String, String] = {CLICK: RESOURCES + "test_click.tres"}
	ResourceCoreDev.set_test_key_list(keys)
	var ok: bool = LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() \
			and ResourceCore.init() and PoolCore.init() and DataCore.init() and UserStateCore.init() \
			and ResolutionCore.init() and SafeAreaCore.init() and InputBlockCore.init() and InputCore.init() \
			and LocalizationCore.init() and SoundCore.init() and TweenCore.init() and UICore.init() \
			and MessageCore.init() and NetworkCore.init()
	if not ok:
		return false
	LocalDataCore.load_device_file()
	if not await DataCore.load(null):
		return false
	if LocalizationCore.resolve_language() == 0:
		return false
	var translations: Array[DownloadedTranslation] = []
	if not await LocalizationCore.load_translation(translations):
		return false
	return await UICore.prepare()


func _release_modules() -> void:
	NetworkCore.release()
	MessageCore.release()
	UICore.release()
	TweenCore.release()
	SoundCore.release()
	LocalizationCore.release()
	InputCore.release()
	InputBlockCore.release()
	SafeAreaCore.release()
	ResolutionCore.release()
	UserStateCore.release()
	DataCore.release()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
