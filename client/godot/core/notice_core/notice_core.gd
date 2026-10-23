class_name NoticeCore
extends RefCounted
## Server notices, banners and the maintenance notice. Gets them with core rpc `GetNotices`, keeps them in a cache,
## keeps the read state on the device, shows the active unread notices under the `[notice_badge]` badge and keeps the
## boot waiting while the server is in maintenance.

## Result of `ImageDownloader.download`.
enum DownloadStatus { DONE, CONNECTION_FAILED, TOO_LARGE, CANCELLED }

const _TAG: String = "NoticeCore"
const _CORE_NODE = preload("res://core/notice_core/notice_core_node.gd")
const _HTTP_DOWNLOADER = preload("res://core/notice_core/http_image_downloader.gd")
const _WEB_DOWNLOADER = preload("res://core/notice_core/web_image_downloader.gd")
const _WAITER = preload("res://core/notice_core/notice_waiter.gd")

const _SETTING_CACHE_TTL: String = "NoticeCore.cacheTtlMs"
const _SETTING_MAINTENANCE_RETRY: String = "NoticeCore.maintenanceRetryMs"
const _SETTING_IMAGE_MAX_BYTES: String = "NoticeCore.imageMaxBytes"
const _SETTING_IMAGE_TIMEOUT: String = "NoticeCore.imageTimeoutMs"
const _SETTING_REACH_MARGIN: String = "TimeCore.reachMarginMs"
const _READ_IDS_KEY: String = "NoticeCore.read_ids"
const _HTTP_OK: int = 200
const _HTTP_SCHEME: String = "http://"
const _LOOPBACK_HOST: String = "127.0.0.1"
const _PNG_SIGNATURE: PackedByteArray = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

## Reach state bits of a cached notice: whether `TimeCore.is_reached` is `true` for its `start_at` and its `end_at`.
const _REACHED_START: int = 1
const _REACHED_END: int = 2

## Outcomes of a maintenance popup.
const _POPUP_CLOSED: int = 0
const _POPUP_OPEN_FAILED: int = 1
const _POPUP_CANCELLED: int = 2

static var _is_initialized: bool = false
## New object every `init`. An async step that comes back to another session stops.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
static var _downloader: ImageDownloader = null
## Set by `NoticeCoreDev.set_image_downloader` before `init`.
static var _downloader_override: ImageDownloader = null
## `_after_frame` of this session, made in `init` for the frame check.
static var _after_frame_call: Callable = Callable()
static var _after_frame_scheduled: bool = false
static var _cache_ttl_ms: int = 0
static var _maintenance_retry_ms: int = 0
static var _image_max_bytes: int = 0
static var _image_timeout_ms: int = 0

# Cache
static var _maintenance: bool = false
## Notices of the last successful fetch, in response order.
static var _notices: Array[CoreContract.Notice] = []
## Reach state bits of `_notices`, by index.
static var _reach: PackedByteArray = PackedByteArray()
static var _has_success: bool = false
## Real elapsed time of the last successful fetch.
static var _success_real_ms: int = 0
## Background elapsed time of the foreground returns after the last successful fetch.
static var _background_ms: int = 0
## The running fetch. `null` when none runs.
static var _fetch_waiter: _WAITER = null

# Read state and badge
static var _read_ids: Dictionary[int, bool] = {}
## Whether `_read_ids` holds the `NoticeCore.read_ids` of the `device` file.
static var _read_loaded: bool = false
static var _badge_dirty: bool = false
static var _badge_error_logged: bool = false

# Maintenance
static var _popup_waiter: _WAITER = null
static var _retry_waiter: _WAITER = null
static var _retry_deadline_ms: int = 0
static var _retry_due: bool = false

# Image
static var _images: Dictionary[int, ImageTexture] = {}
## `image_url` each image of `_images` came from.
static var _image_urls: Dictionary[int, String] = {}
## The running image load. `null` when none runs.
static var _image_load: _WAITER = null
static var _image_started_ms: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	var cache_ttl: int = _read_setting(_SETTING_CACHE_TTL)
	var retry: int = _read_setting(_SETTING_MAINTENANCE_RETRY)
	var image_max: int = _read_setting(_SETTING_IMAGE_MAX_BYTES)
	var image_timeout: int = _read_setting(_SETTING_IMAGE_TIMEOUT)
	var reach_margin: int = _read_setting(_SETTING_REACH_MARGIN)
	if cache_ttl < 0 or retry < 0 or image_max < 0 or image_timeout < 0 or reach_margin < 0:
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	if not EventCore.subscribe(AppForegroundReturnedEvent, node.on_foreground_returned):
		LogCore.log_error(_TAG, "init could not subscribe to AppForegroundReturnedEvent")
		node.released = true
		node.get_parent().remove_child(node)
		node.queue_free()
		return false
	_cache_ttl_ms = cache_ttl
	_maintenance_retry_ms = retry
	_image_max_bytes = image_max
	_image_timeout_ms = image_timeout
	_node = node
	if _downloader_override != null:
		_downloader = _downloader_override
	elif OS.get_name() == "Web":
		# The engine HTTP client of the web export follows redirects whatever `max_redirects` is.
		_downloader = _WEB_DOWNLOADER.new(node)
	else:
		_downloader = _HTTP_DOWNLOADER.new(node)
	_session = RefCounted.new()
	_after_frame_call = NoticeCore._after_frame.bind(_session)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	node.released = true
	_drop_state(node)
	if node.get_parent() != null:
		node.get_parent().remove_child(node)
	node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Async operation. Fetches with force flag `true` and, while the server is in maintenance, opens the maintenance popup
## and fetches again after it closes. Returns when a fetch fails or says no maintenance.
static func wait_maintenance_clear() -> void:
	if not _check_initialized("wait_maintenance_clear"):
		return
	var session: RefCounted = _session
	while true:
		var ok: bool = await fetch(true)
		if _session != session or not ok or not _maintenance:
			return
		var outcome: int = await _show_maintenance_popup(session)
		if outcome == _POPUP_CANCELLED or _session != session:
			return
		if outcome == _POPUP_OPEN_FAILED:
			LogCore.log_error(_TAG, "could not open the maintenance popup; fetching again after "
					+ str(_maintenance_retry_ms) + " ms")
			if not await _wait_retry(session):
				return


## Async operation. Sends `GetNotices` and replaces the cache with the response. Without `force`, does not send within
## `NoticeCore.cacheTtlMs` of the last successful fetch. Joins the running fetch.
static func fetch(force: bool) -> bool:
	if not _check_initialized("fetch"):
		return false
	if not force and _has_success and _elapsed_since_success() < _cache_ttl_ms:
		return true
	var waiter: _WAITER = _fetch_waiter
	if waiter == null:
		waiter = _WAITER.new()
		_fetch_waiter = waiter
		_send_fetch(_session, waiter)
	if not waiter.done:
		await waiter.finished
	return waiter.ok


## `maintenance` of the last successful fetch.
static func is_maintenance() -> bool:
	if not _check_initialized("is_maintenance"):
		return false
	return _maintenance


## Fills `buffer` from index 0 with the active notices of `kind` in response order. Returns the count filled. Does not
## change the size of `buffer`.
static func list_active(kind: CoreContract.NoticeKind, buffer: Array[CoreContract.Notice]) -> int:
	if not _check_initialized("list_active"):
		return 0
	if kind != CoreContract.NoticeKind.NOTICE_KIND_NOTICE and kind != CoreContract.NoticeKind.NOTICE_KIND_BANNER \
			and kind != CoreContract.NoticeKind.NOTICE_KIND_MAINTENANCE:
		LogCore.log_error(_TAG, "list_active got a kind that is not Notice, Banner or Maintenance")
		return 0
	var count: int = 0
	for notice: CoreContract.Notice in _notices:
		if notice.kind != kind or not _is_active(notice):
			continue
		if count >= buffer.size():
			LogCore.log_error(_TAG, "list_active: the buffer is smaller than the active notices")
			break
		buffer[count] = notice
		count += 1
	return count


## A copy of the cached notice `notice_id`. `null` when the cache has none.
static func get_notice(notice_id: int) -> CoreContract.Notice:
	if not _check_initialized("get_notice"):
		return null
	var notice: CoreContract.Notice = _find(notice_id)
	if notice == null:
		LogCore.log_warn(_TAG, "get_notice: notice " + str(notice_id) + " is not in the cache")
		return null
	var copy: CoreContract.Notice = CoreContract.Notice.new()
	copy.copy_from(notice)
	return copy


static func is_read(notice_id: int) -> bool:
	if not _check_initialized("is_read"):
		return false
	_load_read_ids()
	return _read_ids.has(notice_id)


static func mark_read(notice_id: int) -> void:
	if not _check_initialized("mark_read"):
		return
	if _find(notice_id) == null:
		LogCore.log_warn(_TAG, "mark_read: notice " + str(notice_id) + " is not in the cache; not saved")
		return
	_load_read_ids()
	if _read_ids.has(notice_id):
		return
	_read_ids[notice_id] = true
	_save_read_ids()
	_sync_badge()


## Async operation. Downloads and decodes the image of the cached notice `notice_id`. `null` on failure.
static func load_image(notice_id: int) -> ImageTexture:
	if not _check_initialized("load_image"):
		return null
	var notice: CoreContract.Notice = _find(notice_id)
	if notice == null:
		LogCore.log_warn(_TAG, "load_image: notice " + str(notice_id) + " is not in the cache")
		return null
	var url: String = notice.image_url
	if _images.has(notice_id) and _image_urls[notice_id] == url:
		return _images[notice_id]
	if not _is_accepted_url(url):
		LogCore.log_error(_TAG, "load_image: the image_url of notice " + str(notice_id)
				+ " is empty or not an accepted URL")
		return null
	var session: RefCounted = _session
	while _image_load != null:
		await _image_load.finished
		if _session != session:
			return null
	var job: _WAITER = _WAITER.new()
	job.notice_id = notice_id
	_image_load = job
	_image_started_ms = TimeCore.get_real_time()
	_run_download(session, job, url)
	if not job.done:
		await job.finished
	if _session != session or job.texture == null:
		return null
	var cached: CoreContract.Notice = _find(notice_id)
	if cached != null and cached.image_url == url:
		_images[notice_id] = job.texture
		_image_urls[notice_id] = url
	return job.texture


static func _read_setting(key: String) -> int:
	if not CoreSettings.has_int(key):
		LogCore.log_error(_TAG, "init could not read core settings key " + key)
		return -1
	return CoreSettings.get_int(key)


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + " called before init")
	return false


## Clears the state of the session, cancels the running image download and ends the waits. Removing `node` from the
## tree is the caller's. `NoticeCore.read_ids` of the `device` file stays.
static func _drop_state(node: _CORE_NODE) -> void:
	var downloader: ImageDownloader = _downloader
	var waiters: Array[_WAITER] = [_fetch_waiter, _popup_waiter, _retry_waiter]
	var image_load: _WAITER = _image_load
	_is_initialized = false
	_session = null
	_node = null
	_downloader = null
	_downloader_override = null
	_after_frame_call = Callable()
	_after_frame_scheduled = false
	_cache_ttl_ms = 0
	_maintenance_retry_ms = 0
	_image_max_bytes = 0
	_image_timeout_ms = 0
	_maintenance = false
	_notices = []
	_reach = PackedByteArray()
	_has_success = false
	_success_real_ms = 0
	_background_ms = 0
	_fetch_waiter = null
	_read_ids = {}
	_read_loaded = false
	_badge_dirty = false
	_badge_error_logged = false
	_popup_waiter = null
	_retry_waiter = null
	_retry_deadline_ms = 0
	_retry_due = false
	_images = {}
	_image_urls = {}
	_image_load = null
	_image_started_ms = 0
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	if image_load != null and not image_load.done:
		downloader.cancel()
		_end_wait(image_load)
	for waiter: _WAITER in waiters:
		if waiter != null:
			_end_wait(waiter)


## App exit or tree teardown removed the core node without `release`.
static func _on_node_exit(node: _CORE_NODE) -> void:
	if not _is_initialized or node != _node:
		return
	node.released = true
	_drop_state(node)


static func _end_wait(waiter: _WAITER) -> void:
	if waiter.done:
		return
	waiter.done = true
	waiter.finished.emit()


# Fetch


static func _elapsed_since_success() -> int:
	return TimeCore.get_real_time() - _success_real_ms + _background_ms


## Sends `GetNotices` for the fetch `waiter` and ends it with the result.
static func _send_fetch(session: RefCounted, waiter: _WAITER) -> void:
	var request: CoreContract.GetNoticesRequest = CoreContract.GetNoticesRequest.new()
	request.language = LocalizationCore.get_language_code()
	var result: AuthSendResult = await NetworkCore.send_auth(request, AuthSendOptions.new())
	if _session != session or waiter.done:
		return
	var ok: bool = false
	if result != null and result.ok:
		var response: CoreContract.GetNoticesResponse = result.response as CoreContract.GetNoticesResponse
		if response == null:
			LogCore.log_error(_TAG, "GetNotices succeeded without a GetNoticesResponse")
		else:
			_apply(response)
			ok = _session == session
	if _session != session or waiter.done:
		return
	_fetch_waiter = null
	waiter.ok = ok
	_end_wait(waiter)


## Replaces the cache with `response`, then the images, the read state, the badge and `NoticesChangedEvent` follow it.
static func _apply(response: CoreContract.GetNoticesResponse) -> void:
	var previous: Array[CoreContract.Notice] = _notices
	var changed: bool = _is_list_changed(previous, response.notices)
	_maintenance = response.maintenance
	_notices = response.notices
	_reach = PackedByteArray()
	_reach.resize(_notices.size())
	for i: int in _notices.size():
		_reach[i] = _reach_bits(_notices[i])
	_has_success = true
	_success_real_ms = TimeCore.get_real_time()
	_background_ms = 0
	var ids: Dictionary[int, bool] = {}
	for notice: CoreContract.Notice in _notices:
		ids[notice.id] = true
	_drop_images()
	_prune_read_ids(ids)
	for notice: CoreContract.Notice in previous:
		if not ids.has(notice.id):
			_clear_badge_item(notice.id)
	_sync_badge()
	if changed:
		var event: NoticesChangedEvent = EventCore.acquire(NoticesChangedEvent) as NoticesChangedEvent
		if event == null:
			LogCore.log_error(_TAG, "could not publish NoticesChangedEvent")
			return
		EventCore.publish(event)


## Whether `received` differs from `cached`: in the set of `id`s, or in a field of a notice of the same `id`.
static func _is_list_changed(cached: Array[CoreContract.Notice], received: Array[CoreContract.Notice]) -> bool:
	if cached.size() != received.size():
		return true
	var by_id: Dictionary[int, CoreContract.Notice] = {}
	for notice: CoreContract.Notice in cached:
		by_id[notice.id] = notice
	for notice: CoreContract.Notice in received:
		if not by_id.has(notice.id) or not _is_same(by_id[notice.id], notice):
			return true
		by_id.erase(notice.id)
	return not by_id.is_empty()


static func _is_same(a: CoreContract.Notice, b: CoreContract.Notice) -> bool:
	return a.id == b.id and a.kind == b.kind and a.priority == b.priority and a.start_at == b.start_at \
			and a.end_at == b.end_at and a.title == b.title and a.body == b.body and a.image_url == b.image_url \
			and a.shortcut_id == b.shortcut_id and a.link_url == b.link_url


static func _on_foreground_returned(background_ms: int) -> void:
	if not _is_initialized:
		return
	_background_ms += background_ms
	fetch(false)


# Active notice


static func _find(notice_id: int) -> CoreContract.Notice:
	for notice: CoreContract.Notice in _notices:
		if notice.id == notice_id:
			return notice
	return null


static func _is_active(notice: CoreContract.Notice) -> bool:
	return TimeCore.is_synced() and TimeCore.is_reached(notice.start_at) and not TimeCore.is_reached(notice.end_at)


static func _reach_bits(notice: CoreContract.Notice) -> int:
	if not TimeCore.is_synced():
		return 0
	var bits: int = 0
	if TimeCore.is_reached(notice.start_at):
		bits |= _REACHED_START
	if TimeCore.is_reached(notice.end_at):
		bits |= _REACHED_END
	return bits


## Frame code. Finds the image load past its time limit, the maintenance retry delay that passed and the frame where a
## cached `start_at` or `end_at` was reached, and leaves their work to `_after_frame` at the end of the frame.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	var schedule: bool = false
	var now: int = TimeCore.get_real_time()
	if _image_load != null and not _image_load.timed_out and now - _image_started_ms >= _image_timeout_ms:
		_image_load.timed_out = true
		schedule = true
	if _retry_waiter != null and not _retry_due and now >= _retry_deadline_ms:
		_retry_due = true
		schedule = true
	if TimeCore.is_synced():
		for i: int in _notices.size():
			var bits: int = _reach_bits(_notices[i])
			var previous: int = _reach[i]
			if bits == previous:
				continue
			if (bits & ~previous) != 0:
				_badge_dirty = true
				schedule = true
			_reach[i] = bits
	if schedule and not _after_frame_scheduled:
		_after_frame_scheduled = true
		_after_frame_call.call_deferred()


## End of the frame of a `_on_frame` that found work.
static func _after_frame(session: RefCounted) -> void:
	if _session != session:
		return
	_after_frame_scheduled = false
	var job: _WAITER = _image_load
	if job != null and job.timed_out:
		_downloader.cancel()
		if _session != session:
			return
		if not job.done:
			LogCore.log_error(_TAG, "load_image: the image of notice " + str(job.notice_id) + " passed "
					+ str(_image_timeout_ms) + " ms")
			_finish_image(job, null)
		if _session != session:
			return
	if _retry_due:
		_retry_due = false
		var waiter: _WAITER = _retry_waiter
		_retry_waiter = null
		if waiter != null:
			_end_wait(waiter)
		if _session != session:
			return
	if _badge_dirty:
		_sync_badge()


# Read state and badge


static func _load_read_ids() -> void:
	if _read_loaded:
		return
	_read_loaded = true
	for notice_id: int in LocalDataCore.get_array_int(LocalDataCore.FileKind.DEVICE, _READ_IDS_KEY):
		_read_ids[notice_id] = true


static func _save_read_ids() -> void:
	var ids: PackedInt64Array = PackedInt64Array()
	for notice_id: int in _read_ids:
		ids.append(notice_id)
	LocalDataCore.set_array_int(LocalDataCore.FileKind.DEVICE, _READ_IDS_KEY, ids)


## Removes the read IDs that are not in `received`.
static func _prune_read_ids(received: Dictionary[int, bool]) -> void:
	_load_read_ids()
	var removed: bool = false
	for notice_id: int in _read_ids.keys():
		if not received.has(notice_id):
			_read_ids.erase(notice_id)
			removed = true
	if removed:
		_save_read_ids()


static func _badge_id() -> int:
	var badge: int = ReservedId.notice_badge()
	if GameData.BadgeTable.has_row(badge):
		return badge
	if not _badge_error_logged:
		_badge_error_logged = true
		LogCore.log_error(_TAG, "[notice_badge] is not a row of the badge table; no notice badge")
	return 0


## Puts an item under `[notice_badge]` for each active unread `Notice` kind notice and clears the item of each other
## cached notice.
static func _sync_badge() -> void:
	_badge_dirty = false
	var badge: int = _badge_id()
	if badge == 0:
		return
	_load_read_ids()
	for notice: CoreContract.Notice in _notices:
		if notice.kind == CoreContract.NoticeKind.NOTICE_KIND_NOTICE and _is_active(notice) \
				and not _read_ids.has(notice.id):
			BadgeCore.set_item(badge, notice.id, 1)
		else:
			BadgeCore.clear_item(badge, notice.id)


static func _clear_badge_item(notice_id: int) -> void:
	var badge: int = _badge_id()
	if badge != 0:
		BadgeCore.clear_item(badge, notice_id)


# Maintenance popup


## Async. Opens the maintenance popup and waits until it is hidden.
static func _show_maintenance_popup(session: RefCounted) -> int:
	var param: SystemPopupParam = SystemPopupParam.new()
	var first: CoreContract.Notice = null
	for notice: CoreContract.Notice in _notices:
		if notice.kind == CoreContract.NoticeKind.NOTICE_KIND_MAINTENANCE and _is_active(notice):
			first = notice
			break
	if first != null:
		param.body = ReservedString.notice_maintenance_until()
		param.format_args = FormatArgs.new()
		param.format_args.set_int("end_at", first.end_at)
		param.extra_text = first.title + "\n" + first.body
	else:
		param.body = ReservedString.notice_maintenance()
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = ReservedString.notice_retry()
	param.buttons = [button]
	param.back_button = -1
	var waiter: _WAITER = _WAITER.new()
	_popup_waiter = waiter
	var opened: bool = await UICore.open_system_popup(param, NoticeCore._on_popup_hidden.bind(session))
	if _session != session:
		return _POPUP_CANCELLED
	if not opened:
		if _popup_waiter == waiter:
			_popup_waiter = null
		return _POPUP_OPEN_FAILED
	if not waiter.done:
		await waiter.finished
	if _session != session:
		return _POPUP_CANCELLED
	return _POPUP_CLOSED


static func _on_popup_hidden(session: RefCounted) -> void:
	if not _is_initialized or _session != session or _popup_waiter == null:
		return
	_node.settle_popup.call_deferred(session)


static func _settle_popup(session: RefCounted) -> void:
	if not _is_initialized or _session != session or _popup_waiter == null:
		return
	var waiter: _WAITER = _popup_waiter
	_popup_waiter = null
	_end_wait(waiter)


## Async. Waits `NoticeCore.maintenanceRetryMs` of real elapsed time. `false` when the session ended.
static func _wait_retry(session: RefCounted) -> bool:
	var waiter: _WAITER = _WAITER.new()
	_retry_waiter = waiter
	_retry_deadline_ms = TimeCore.get_real_time() + _maintenance_retry_ms
	_retry_due = false
	await waiter.finished
	return _session == session


# Image


## Whether `load_image` downloads `url`: an `https` URL, or with DEV code a `http` URL of host `127.0.0.1`. The
## authority of that `http` URL is `127.0.0.1` with an optional port and nothing else, so user info is refused. The
## authority ends at the first `/` or `#` only, as the engine `String.parse_url` ends it, so a `?` before it is refused.
static func _is_accepted_url(url: String) -> bool:
	var lower: String = url.to_lower()
	if lower.begins_with("https://") and lower.length() > "https://".length():
		return true
	if not CoreBuildInfo.has_dev_code or not lower.begins_with(_HTTP_SCHEME):
		return false
	var rest: String = lower.substr(_HTTP_SCHEME.length())
	var end: int = rest.length()
	for separator: String in ["/", "#"]:
		var at: int = rest.find(separator)
		if at >= 0 and at < end:
			end = at
	var authority: String = rest.substr(0, end)
	if authority == _LOOPBACK_HOST:
		return true
	if not authority.begins_with(_LOOPBACK_HOST + ":"):
		return false
	var port: String = authority.substr(_LOOPBACK_HOST.length() + 1)
	if port.is_empty():
		return false
	for i: int in port.length():
		if port[i] < "0" or port[i] > "9":
			return false
	return true


## Downloads `url` for the image load `job` and ends it with the decoded image.
static func _run_download(session: RefCounted, job: _WAITER, url: String) -> void:
	var result: ImageDownloader.DownloadResult = await _downloader.download(url, _image_max_bytes)
	if _session != session or job.done:
		return
	if job.timed_out:
		LogCore.log_error(_TAG, "load_image: the image of notice " + str(job.notice_id) + " passed "
				+ str(_image_timeout_ms) + " ms")
		_finish_image(job, null)
		return
	if result == null:
		result = ImageDownloader.DownloadResult.new()
	var problem: String = ""
	var texture: ImageTexture = null
	if result.status == DownloadStatus.TOO_LARGE:
		problem = "is larger than " + str(_image_max_bytes) + " bytes"
	elif result.status != DownloadStatus.DONE:
		problem = "download ended with status " + str(result.status)
	elif result.http_status != _HTTP_OK:
		problem = "got HTTP status " + str(result.http_status)
	else:
		texture = _decode(result.body)
		if texture == null:
			problem = "is not a PNG or JPEG image"
	if not problem.is_empty():
		LogCore.log_error(_TAG, "load_image: the image of notice " + str(job.notice_id) + " " + problem)
	_finish_image(job, texture)


static func _finish_image(job: _WAITER, texture: ImageTexture) -> void:
	if job.done:
		return
	job.texture = texture
	if _image_load == job:
		_image_load = null
	_end_wait(job)


## A PNG or JPEG image as an `ImageTexture`. `null` when it is neither or does not decode.
static func _decode(bytes: PackedByteArray) -> ImageTexture:
	var image: Image = Image.new()
	var error: Error = ERR_FILE_UNRECOGNIZED
	if bytes.size() > _PNG_SIGNATURE.size() and bytes.slice(0, _PNG_SIGNATURE.size()) == _PNG_SIGNATURE:
		error = image.load_png_from_buffer(bytes)
	elif bytes.size() > 3 and bytes[0] == 0xFF and bytes[1] == 0xD8 and bytes[2] == 0xFF:
		error = image.load_jpg_from_buffer(bytes)
	if error != OK or image.is_empty():
		return null
	return ImageTexture.create_from_image(image)


## Drops the images whose notice left the cache or got another `image_url`.
static func _drop_images() -> void:
	for notice_id: int in _images.keys():
		var notice: CoreContract.Notice = _find(notice_id)
		if notice == null or notice.image_url != _image_urls[notice_id]:
			_images.erase(notice_id)
			_image_urls.erase(notice_id)
