extends UnitTestCase
## Base of the `NoticeCore` core tests. Initializes the modules `NoticeCore` depends on in module list order without
## `BootstrapCore`, then `NoticeCore`. Answers `GetNotices` on the fake network, reads the maintenance popup and the
## `[notice_badge]` items.

const _HANGING = preload("res://core/notice_core/tests/support/hanging_image_downloader.gd")

const TAG: String = "NoticeCore"
## The resource key of `[ui_button_click]` in the core test data. `UICore.prepare` loads it.
const CLICK: String = "sfx/ui_button_click"
const GET_NOTICES: String = "core/GetNotices"
const BASE_URL: String = "http://127.0.0.1"
const APP_VERSION: String = "1.0.0"
## Server time of the responses of the tests that do not choose one.
const SERVER_TIME: int = 1700000500000
const CACHE_TTL_MS: int = 60000
const MAINTENANCE_RETRY_MS: int = 5000
const IMAGE_MAX_BYTES: int = 1024
const IMAGE_TIMEOUT_MS: int = 10000
const REACH_MARGIN_MS: int = 1000
const PUMP_FRAMES: int = 6
## `UICore.buttonClickIntervalMs`. A second popup button tap waits it out with `advance`.
const CLICK_INTERVAL_MS: int = 200

const NOTICE: CoreContract.NoticeKind = CoreContract.NoticeKind.NOTICE_KIND_NOTICE
const BANNER: CoreContract.NoticeKind = CoreContract.NoticeKind.NOTICE_KIND_BANNER
const MAINTENANCE: CoreContract.NoticeKind = CoreContract.NoticeKind.NOTICE_KIND_MAINTENANCE

## An async `NoticeCore` operation running in the background: `done` and its result after it ends.
class Running:
	extends RefCounted
	var done: bool = false
	var ok: bool = false
	var texture: ImageTexture = null


## `NoticesChangedEvent` count.
var changed_events: int = 0


func after_each() -> void:
	await super()
	NoticeCore.release()
	_release_modules()


## Initializes the modules and `NoticeCore`, with `downloader` as its image downloader when given. `replaced_tables`
## replaces table binaries of the core test data by file name, loaded as downloaded data.
func start(downloader: ImageDownloader = null,
		replaced_tables: Dictionary[String, PackedByteArray] = {}) -> bool:
	changed_events = 0
	var settings: Dictionary[String, int] = {
		"NoticeCore.cacheTtlMs": CACHE_TTL_MS,
		"NoticeCore.maintenanceRetryMs": MAINTENANCE_RETRY_MS,
		"NoticeCore.imageMaxBytes": IMAGE_MAX_BYTES,
		"NoticeCore.imageTimeoutMs": IMAGE_TIMEOUT_MS,
		"TimeCore.reachMarginMs": REACH_MARGIN_MS,
		"UICore.buttonClickIntervalMs": CLICK_INTERVAL_MS,
		# The clock moves past the interval; without it, `BadgeCore` judges the core test data badge requirements.
		"BadgeCore.refreshIntervalMs": 0,
	}
	for key: String in settings:
		if not UnitTestCore.set_test_settings(key, settings[key]):
			return false
	if not await _init_modules(replaced_tables):
		return false
	if downloader != null:
		NoticeCoreDev.set_image_downloader(downloader)
	if not NoticeCore.init():
		return false
	return EventCore.subscribe(NoticesChangedEvent, _on_notices_changed)


## A notice of `kind` shown from `start_at` to `end_at`.
static func make_notice(id: int, kind: CoreContract.NoticeKind, start_at: int, end_at: int) -> CoreContract.Notice:
	var notice: CoreContract.Notice = CoreContract.Notice.new()
	notice.id = id
	notice.kind = kind
	notice.start_at = start_at
	notice.end_at = end_at
	notice.title = "title %d" % id
	notice.body = "body %d" % id
	return notice


## A notice of `kind` active at `SERVER_TIME` for an hour.
static func active_notice(id: int, kind: CoreContract.NoticeKind = NOTICE) -> CoreContract.Notice:
	return make_notice(id, kind, SERVER_TIME - 3600000, SERVER_TIME + 3600000)


## Adds the next `GetNotices` response: `notices` and `maintenance`, sent at `server_time`.
func respond(notices: Array[CoreContract.Notice], maintenance: bool = false, server_time: int = SERVER_TIME) -> void:
	UnitTestCore.add_result(GET_NOTICES, NetworkCore.TransferResult.DONE, 200,
			response_bytes(notices, maintenance, server_time))


static func response_bytes(notices: Array[CoreContract.Notice], maintenance: bool = false,
		server_time: int = SERVER_TIME) -> PackedByteArray:
	var response: CoreContract.GetNoticesResponse = CoreContract.GetNoticesResponse.new()
	response.maintenance = maintenance
	for notice: CoreContract.Notice in notices:
		var copy: CoreContract.Notice = CoreContract.Notice.new()
		copy.copy_from(notice)
		response.notices.append(copy)
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = server_time
	envelope.body = response.encode()
	return UnitTestCore.make_response(envelope)


## Adds a failed `GetNotices` result.
func respond_failure() -> void:
	UnitTestCore.add_result(GET_NOTICES, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())


## `respond` and a fetch with force flag `true`.
func fetch_with(notices: Array[CoreContract.Notice], maintenance: bool = false,
		server_time: int = SERVER_TIME) -> bool:
	respond(notices, maintenance, server_time)
	return await NoticeCore.fetch(true)


## Starts `NoticeCore.fetch` without waiting.
func start_fetch(force: bool) -> Running:
	var running: Running = Running.new()
	_fetch_into(running, force)
	return running


## Starts `NoticeCore.load_image` without waiting.
func start_load(notice_id: int) -> Running:
	var running: Running = Running.new()
	_load_into(running, notice_id)
	return running


## Starts `NoticeCore.wait_maintenance_clear` without waiting.
func start_wait() -> Running:
	var running: Running = Running.new()
	_wait_into(running)
	return running


func request_count() -> int:
	var count: int = 0
	for received: UnitTestRequest in UnitTestCore.received_requests():
		if received.name == GET_NOTICES:
			count += 1
	return count


## IDs of the active notices of `kind`, in `list_active` order.
func active_ids(kind: CoreContract.NoticeKind) -> PackedInt64Array:
	var buffer: Array[CoreContract.Notice] = []
	buffer.resize(16)
	var count: int = NoticeCore.list_active(kind, buffer)
	var ids: PackedInt64Array = PackedInt64Array()
	for i: int in count:
		ids.append(buffer[i].id)
	return ids


## Item count of notice `notice_id` under `[notice_badge]`.
func badge_item(notice_id: int) -> int:
	return BadgeCore.get_item_count(ReservedId.notice_badge(), notice_id)


## Moves the test clock `ms` ahead and lets the frame checks and deferred calls run.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(PUMP_FRAMES)


func pump() -> void:
	await UnitTestCore.wait_frames(PUMP_FRAMES)


## Texts of the visible labels and buttons of the popup layer.
func popup_texts() -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for node: Node in UICore.get_layer(UICore.UILayer.POPUP).find_children("*", "Control", true, false):
		var control: Control = node as Control
		if not control.is_visible_in_tree():
			continue
		if control is Label:
			out.append((control as Label).text)
		elif control is RichTextLabel:
			out.append((control as RichTextLabel).get_parsed_text())
		elif control is Button:
			out.append((control as Button).text)
	return out


## Taps the visible popup button labeled with the translation of `key`. `false` when there is none.
func press(key: String) -> bool:
	var text: String = LocalizationCore.get_text(key)
	for node: Node in UICore.get_layer(UICore.UILayer.POPUP).find_children("*", "Button", true, false):
		var button: Button = node as Button
		if button.is_visible_in_tree() and button.text == text:
			UnitTestCore.tap(button.get_global_transform_with_canvas() * (button.size / 2.0))
			await pump()
			return true
	return false


func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


func warns() -> int:
	return UnitTestCore.check_logs("warn", TAG)


## Marks the logs `NetworkCore` left for a failed request as checked.
func check_network_logs() -> void:
	UnitTestCore.check_logs("error", "NetworkCore")
	UnitTestCore.check_logs("warn", "NetworkCore")


func _on_notices_changed(_event: NoticesChangedEvent) -> void:
	changed_events += 1


func _fetch_into(running: Running, force: bool) -> void:
	running.ok = await NoticeCore.fetch(force)
	running.done = true


func _load_into(running: Running, notice_id: int) -> void:
	running.texture = await NoticeCore.load_image(notice_id)
	running.done = true


func _wait_into(running: Running) -> void:
	await NoticeCore.wait_maintenance_clear()
	running.done = true


## Initializes the modules `NoticeCore` depends on, in module list order, and does the boot steps they need.
func _init_modules(replaced_tables: Dictionary[String, PackedByteArray]) -> bool:
	ResourceCoreDev.set_test_key_list({CLICK: "res://core/notice_core/tests/resources/test_click.tres"})
	var ok: bool = LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() \
			and ResourceCore.init() and PoolCore.init() and DataCore.init() and ResolutionCore.init() \
			and InputBlockCore.init() and InputCore.init() and SoundCore.init() and LocalizationCore.init() \
			and SafeAreaCore.init() and TweenCore.init() and UICore.init() and MessageCore.init() \
			and UserStateCore.init() and NetworkCore.init() and RequirementCore.init() and BadgeCore.init()
	if not ok:
		return false
	LocalDataCore.load_device_file()
	var downloaded: DownloadedData = null
	if not replaced_tables.is_empty():
		downloaded = DataCoreTestSupport.write_downloaded("notice_core_test/data",
				DataCoreTestSupport.other_version(str(replaced_tables.keys())), replaced_tables)
	if not await DataCore.load(downloaded):
		return false
	if LocalizationCore.resolve_language() == 0:
		return false
	var translations: Array[DownloadedTranslation] = []
	if not await LocalizationCore.load_translation(translations):
		return false
	if not await UICore.prepare() or not await MessageCore.prepare() or not await BadgeCore.prepare():
		return false
	LogCore.clear_sender()
	return NetworkCore.set_server_info(BASE_URL, APP_VERSION, CoreBuildInfo.platform)


func _release_modules() -> void:
	BadgeCore.release()
	RequirementCore.release()
	NetworkCore.release()
	UserStateCore.release()
	MessageCore.release()
	UICore.release()
	TweenCore.release()
	SafeAreaCore.release()
	LocalizationCore.release()
	SoundCore.release()
	InputCore.release()
	InputBlockCore.release()
	ResolutionCore.release()
	DataCore.release()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
