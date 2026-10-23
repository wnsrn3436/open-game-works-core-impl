class_name GameUpdateCore
extends RefCounted
## App, data, translation and bundle update. Checks the app version against the signed deploy list of the server
## `game-update` module, downloads the data, translation and bundle files for this app version and the built-in
## data, and opens the update popup when the server requires an app or data update while running.

## Result of `UpdateDownloader.download`.
enum DownloadStatus { DONE, CONNECTION_FAILED, TOO_LARGE, CANCELLED }

const _TAG: String = "GameUpdateCore"
const _CORE_NODE = preload("res://core/game_update_core/game_update_core_node.gd")
const _HTTP_DOWNLOADER = preload("res://core/game_update_core/http_update_downloader.gd")
const _WEB_DOWNLOADER = preload("res://core/game_update_core/web_update_downloader.gd")
const _DEPLOY_LIST = preload("res://core/game_update_core/deploy_list.gd")
const _FILE_ENTRY = preload("res://core/game_update_core/update_file_entry.gd")
const _ED25519 = preload("res://core/game_update_core/ed25519.gd")
const _WAITER = preload("res://core/game_update_core/popup_waiter.gd")

const _SETTING_STALL_TIMEOUT: String = "GameUpdateCore.stallTimeoutMs"
const _SETTING_DEPLOY_LIST_MAX: String = "GameUpdateCore.deployListMaxBytes"
const _SETTING_SIGNATURE_MAX: String = "GameUpdateCore.signatureMaxBytes"
const _SETTING_FILE_MAX: String = "GameUpdateCore.fileMaxBytes"
const _SEQUENCE_KEY_PREFIX: String = "GameUpdateCore.sequence_"
const _DOWNLOAD_FOLDER: String = "game_update"
const _SIGNATURE_SUFFIX: String = ".sig"
const _HTTP_OK: int = 200

## Popup outcomes other than a pressed button's index.
const _CHOICE_CLOSED: int = -1
const _CHOICE_OPEN_FAILED: int = -2
const _CHOICE_CANCELLED: int = -3

## Fetch failures, by the reserved string of their popup.
const _FAILURE_DOWNLOAD: int = 1
const _FAILURE_INVALID: int = 2
const _FAILURE_NO_SPACE: int = 3
const _FAILURE_SAVE: int = 4

static var _is_initialized: bool = false
## New object every `init`. An async step that comes back to another session stops.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
static var _downloader: UpdateDownloader = null
## Set by `GameUpdateCoreDev.set_downloader` before `init`.
static var _downloader_override: UpdateDownloader = null
## Core test replacement of the store redirect: receives the store URL instead of the OS.
static var _store_opener: Callable = Callable()
## Core test replacements of `LocalDataCore.hash_file` and `LocalDataCore.write_file`: called with the same input
## instead of `LocalDataCore`.
static var _file_hasher: Callable = Callable()
static var _file_writer: Callable = Callable()
static var _stall_timeout_ms: int = 0
static var _deploy_list_max_bytes: int = 0
static var _signature_max_bytes: int = 0
static var _file_max_bytes: int = 0
static var _check_called: bool = false
## Whether `check_update` ended with `true`. The queries answer only then.
static var _check_succeeded: bool = false
static var _source: UpdateSource = null
## `store_url` of this platform's `app` entry of the received deploy list. Empty when there is none.
static var _store_url: String = ""
static var _bytes_total: int = 0
static var _bytes_saved: int = 0
## Download watch: whether a download runs, its last received bytes, when they last grew and whether it stalled.
static var _downloading: bool = false
## Whether the running download is a file to download, so `bytes_done` counts its received bytes.
static var _downloading_file: bool = false
static var _watch_bytes: int = 0
static var _watch_time_ms: int = 0
static var _stalled: bool = false
static var _downloaded_data: DownloadedData = null
static var _downloaded_translations: Array[DownloadedTranslation] = []
static var _downloaded_bundles: Array[DownloadedBundle] = []
static var _in_play: bool = false
## A `DATA_UPDATE_REQUIRED` received in play, kept for `set_in_play(false)`.
static var _data_update_pending: bool = false
## Whether a forced update popup or new data popup that this module opened is open.
static var _update_popup_open: bool = false
static var _popup_serial: int = 0
static var _waiters: Dictionary[int, _WAITER] = {}


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	var stall: int = _read_setting(_SETTING_STALL_TIMEOUT)
	var deploy_max: int = _read_setting(_SETTING_DEPLOY_LIST_MAX)
	var signature_max: int = _read_setting(_SETTING_SIGNATURE_MAX)
	var file_max: int = _read_setting(_SETTING_FILE_MAX)
	if stall < 0 or deploy_max < 0 or signature_max < 0 or file_max < 0:
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	if not EventCore.subscribe(UpdateRequiredEvent, node.on_update_required):
		LogCore.log_error(_TAG, "init could not subscribe to UpdateRequiredEvent")
		node.released = true
		node.get_parent().remove_child(node)
		node.queue_free()
		return false
	_stall_timeout_ms = stall
	_deploy_list_max_bytes = deploy_max
	_signature_max_bytes = signature_max
	_file_max_bytes = file_max
	_node = node
	if _downloader_override != null:
		_downloader = _downloader_override
	elif OS.get_name() == "Web":
		# The engine HTTP client of the web export follows redirects whatever `max_redirects` is.
		_downloader = _WEB_DOWNLOADER.new(node)
	else:
		_downloader = _HTTP_DOWNLOADER.new(node)
	_session = RefCounted.new()
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


## Async operation. Checks the app version against the deploy list and downloads the files of this app version.
## `true` when the files are ready; `false` on failure or `release`. Waits without end on a forced update.
static func check_update(source: UpdateSource) -> bool:
	if not _check_initialized("check_update"):
		return false
	if _check_called:
		LogCore.log_error(_TAG, "check_update called twice")
		return false
	_check_called = true
	if source == null:
		LogCore.log_error(_TAG, "check_update got no UpdateSource")
		return false
	_source = source
	if source.app_version.is_empty() or source.game_update_url.is_empty():
		LogCore.log_info(_TAG, "check_update skipped: no app version or deploy list URL")
		_check_succeeded = true
		return true
	var session: RefCounted = _session
	var list: _DEPLOY_LIST = await _fetch_deploy_list(session)
	if list == null or _session != session:
		return false
	if not await _check_app_version(session, list):
		return false
	if not await _update_files(session, list):
		return false
	_check_succeeded = true
	return true


## Sum of the bytes to download: the `size` of the files to download, without the files resume skips.
static func bytes_total() -> int:
	if not _check_initialized("bytes_total"):
		return 0
	return _bytes_total


## Bytes downloaded in this `check_update`: the saved files' `size` plus the received bytes of the running download.
static func bytes_done() -> int:
	if not _check_initialized("bytes_done"):
		return 0
	var running: int = _downloader.received_bytes() if _downloading and _downloading_file and not _stalled else 0
	return _bytes_saved + running


## The downloaded data for `DataCore.load`. `null` when there is none.
static func downloaded_data() -> DownloadedData:
	if not _check_query("downloaded_data"):
		return null
	return _downloaded_data


static func downloaded_translations() -> Array[DownloadedTranslation]:
	if not _check_query("downloaded_translations"):
		return []
	return _downloaded_translations.duplicate()


static func downloaded_bundles() -> Array[DownloadedBundle]:
	if not _check_query("downloaded_bundles"):
		return []
	return _downloaded_bundles.duplicate()


## Whether a round of play runs. A `DATA_UPDATE_REQUIRED` in play opens the new data popup when play ends.
static func set_in_play(in_play: bool) -> void:
	if not _check_initialized("set_in_play"):
		return
	_in_play = in_play
	if in_play or not _data_update_pending:
		return
	_data_update_pending = false
	if not _update_popup_open:
		_run_new_data_popup()


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


static func _check_query(operation: String) -> bool:
	if not _check_initialized(operation):
		return false
	if _check_succeeded:
		return true
	LogCore.log_error(_TAG, operation + " called before check_update succeeded")
	return false


## Clears the state of the session, cancels the running download and ends the waiting popups. Removing `node` from
## the tree is the caller's.
static func _drop_state(node: _CORE_NODE) -> void:
	var downloading: bool = _downloading
	var downloader: UpdateDownloader = _downloader
	var waiters: Array[_WAITER] = []
	for serial: int in _waiters:
		waiters.append(_waiters[serial])
	_is_initialized = false
	_session = null
	_node = null
	_downloader = null
	_downloader_override = null
	_store_opener = Callable()
	_file_hasher = Callable()
	_file_writer = Callable()
	_stall_timeout_ms = 0
	_deploy_list_max_bytes = 0
	_signature_max_bytes = 0
	_file_max_bytes = 0
	_check_called = false
	_check_succeeded = false
	_source = null
	_store_url = ""
	_bytes_total = 0
	_bytes_saved = 0
	_downloading = false
	_downloading_file = false
	_watch_bytes = 0
	_watch_time_ms = 0
	_stalled = false
	_downloaded_data = null
	_downloaded_translations = []
	_downloaded_bundles = []
	_in_play = false
	_data_update_pending = false
	_update_popup_open = false
	_popup_serial = 0
	_waiters = {}
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	if downloading:
		downloader.cancel()
	for waiter: _WAITER in waiters:
		if not waiter.done:
			waiter.done = true
			waiter.choice = _CHOICE_CANCELLED
			waiter.resolved.emit()


## App exit or tree teardown removed the core node without `release`.
static func _on_node_exit(node: _CORE_NODE) -> void:
	if not _is_initialized or node != _node:
		return
	node.released = true
	_drop_state(node)


# Deploy list


## Downloads the deploy list and its signature file and checks them. `null` when `check_update` ends with `false`.
static func _fetch_deploy_list(session: RefCounted) -> _DEPLOY_LIST:
	var list_url: String = _source.game_update_url
	var signature_url: String = list_url + _SIGNATURE_SUFFIX
	var min_sequence: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _sequence_key(), 0)
	var list_bytes: PackedByteArray = PackedByteArray()
	var need_list: bool = true
	var refetched: bool = false
	while true:
		if need_list:
			var list_result: UpdateDownloader.DownloadResult = await _download(session, list_url,
					_deploy_list_max_bytes)
			if list_result == null:
				return null
			var list_failure: int = _download_failure(list_result)
			if list_failure != 0:
				if not await _fail(session, list_failure, list_url, list_result.http_status, "deploy list"):
					return null
				continue
			list_bytes = list_result.body
			need_list = false
		var signature_result: UpdateDownloader.DownloadResult = await _download(session, signature_url,
				_signature_max_bytes)
		if signature_result == null:
			return null
		var signature_failure: int = _download_failure(signature_result)
		if signature_failure != 0:
			if not await _fail(session, signature_failure, signature_url, signature_result.http_status,
					"signature file"):
				return null
			continue
		var problem: String = ""
		var signature: _DEPLOY_LIST = _DEPLOY_LIST.read_signature(signature_result.body)
		if not signature.error.is_empty():
			problem = "signature file: " + signature.error
		elif signature.sequence != _DEPLOY_LIST.read_sequence(list_bytes):
			if not refetched:
				refetched = true
				need_list = true
				continue
			problem = "signature sequence differs from the deploy list sequence"
		elif not _verify_signature(list_bytes, signature):
			problem = "signature check failed"
		var list: _DEPLOY_LIST = null
		if problem.is_empty():
			list = _DEPLOY_LIST.check(list_bytes, _source.environment, min_sequence, _source.platform,
					_source.app_version, _file_max_bytes)
			if not list.error.is_empty():
				problem = "format check failed: " + list.error
		if problem.is_empty():
			LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _sequence_key(), list.sequence)
			return list
		if not await _fail(session, _FAILURE_INVALID, list_url, signature_result.http_status, problem):
			return null
		need_list = true
		refetched = false
	return null


static func _sequence_key() -> String:
	return _SEQUENCE_KEY_PREFIX + _source.environment.to_lower()


static func _verify_signature(list_bytes: PackedByteArray, signature: _DEPLOY_LIST) -> bool:
	if not _source.update_trust_keys.has(signature.key_id):
		return false
	var public_key: PackedByteArray = _DEPLOY_LIST._decode_base64(_source.update_trust_keys[signature.key_id], 32)
	if public_key.is_empty():
		LogCore.log_error(_TAG, "trust key " + signature.key_id + " is not 32 bytes of standard base64")
		return false
	return _ED25519.verify(list_bytes, signature.signature, public_key)


# App version


## Compares the app version with this platform's `app` entry. `false` when `check_update` ends with `false`.
static func _check_app_version(session: RefCounted, list: _DEPLOY_LIST) -> bool:
	if not list.has_platform_entry:
		LogCore.log_warn(_TAG, "deploy list has no app entry for platform " + _source.platform)
		return true
	_store_url = list.store_url
	if _DEPLOY_LIST.compare_versions(_source.app_version, list.min_version) < 0:
		await _run_forced_update_popup()
		return false
	if _DEPLOY_LIST.compare_versions(_source.app_version, list.recommended_version) >= 0:
		return true
	while true:
		var choice: int = await _show_popup(ReservedString.game_update_recommended(),
				[ReservedString.game_update_go_to_store(), ReservedString.game_update_later()])
		if choice == _CHOICE_CANCELLED or _session != session:
			return false
		if choice == _CHOICE_OPEN_FAILED:
			LogCore.log_error(_TAG, "could not open the optional update popup")
			return true
		if choice != 0:
			return true
		_redirect_to_store()
	return false


## Opens the forced update popup and opens it again after a store redirect or a close, until `release`.
static func _run_forced_update_popup() -> void:
	var session: RefCounted = _session
	_update_popup_open = true
	while true:
		var choice: int = await _show_popup(ReservedString.game_update_app_update_required(),
				[ReservedString.game_update_go_to_store()])
		if choice == _CHOICE_CANCELLED or _session != session:
			return
		if choice == _CHOICE_OPEN_FAILED:
			LogCore.log_error(_TAG, "could not open the forced update popup")
			_update_popup_open = false
			return
		if choice == 0:
			_redirect_to_store()


static func _run_new_data_popup() -> void:
	var session: RefCounted = _session
	_update_popup_open = true
	var choice: int = await _show_popup(ReservedString.game_update_data_update_required(),
			[ReservedString.game_update_restart()])
	if choice == _CHOICE_CANCELLED or _session != session:
		return
	_update_popup_open = false
	if choice == _CHOICE_OPEN_FAILED:
		LogCore.log_error(_TAG, "could not open the new data popup")
		return
	_request_restart()


static func _redirect_to_store() -> void:
	if _store_url.is_empty():
		LogCore.log_error(_TAG, "store redirect has no store_url")
		return
	if _store_opener.is_valid():
		_store_opener.call(_store_url)
		return
	if OS.get_name() == "Web":
		JavaScriptBridge.eval("window.location.assign(" + JSON.stringify(_store_url) + ")")
		return
	if OS.shell_open(_store_url) != OK:
		LogCore.log_error(_TAG, "could not open the store URL")


static func _on_update_required(error_code: int) -> void:
	if not _is_initialized:
		return
	if error_code == CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED:
		if not _update_popup_open:
			_run_forced_update_popup()
	elif error_code == CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED:
		if _in_play:
			_data_update_pending = true
		elif not _update_popup_open:
			_run_new_data_popup()


static func _request_restart() -> void:
	var event: RestartRequestedEvent = EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	if event == null:
		LogCore.log_error(_TAG, "could not publish RestartRequestedEvent")
		return
	event.module = _TAG
	EventCore.publish(event)


# File update


## Downloads the files of this app version's patch entry, then clears the download folder. `false` when
## `check_update` ends with `false`.
static func _update_files(session: RefCounted, list: _DEPLOY_LIST) -> bool:
	var files: Array[_FILE_ENTRY] = []
	var with_data: bool = false
	if not list.has_patch:
		LogCore.log_info(_TAG, "deploy list has no patch entry for app version " + _source.app_version)
	else:
		var builtin: String = DataCore.get_builtin_data_version()
		if list.data_version == builtin:
			with_data = false
		elif _DEPLOY_LIST.protocol_hash(list.data_version) != _DEPLOY_LIST.protocol_hash(builtin):
			LogCore.log_error(_TAG, "patch data_version protocol hash differs from the built-in data")
		else:
			with_data = true
		if with_data:
			files.append_array(list.data_files)
			files.append_array(list.translation_files)
		files.append_array(list.bundle_files)
	var to_download: Array[_FILE_ENTRY] = []
	for file: _FILE_ENTRY in files:
		if not _is_saved(file):
			to_download.append(file)
			_bytes_total += file.size
	var base_url: String = _DEPLOY_LIST.resolve_url(_source.game_update_url, list.file_base_url)
	var index: int = 0
	while index < to_download.size():
		var file: _FILE_ENTRY = to_download[index]
		var url: String = base_url + file.sha256
		var result: UpdateDownloader.DownloadResult = await _download(session, url, file.size, true)
		if result == null:
			return false
		var failure: int = _download_failure(result)
		var detail: String = "file " + file.name
		if failure == 0 and (result.body.size() != file.size or UtilCore.sha256_hex(result.body) != file.sha256):
			failure = _FAILURE_INVALID
			detail += ": size or SHA-256 differs"
		if failure == 0:
			var written: FileResult = _file_writer.call(_path_of(file), result.body) if _file_writer.is_valid() \
					else LocalDataCore.write_file(_path_of(file), result.body)
			if not written.ok:
				failure = _FAILURE_NO_SPACE if written.error == LocalDataCore.FileError.NO_SPACE else _FAILURE_SAVE
				detail += ": save failed"
		if failure != 0:
			if not await _fail(session, failure, url, result.http_status, detail):
				return false
			continue
		_bytes_saved += file.size
		index += 1
	_clear_download_folder(files)
	_set_results(list, with_data)
	return true


## Whether `file` is already in the download folder: same size, then same SHA-256.
static func _is_saved(file: _FILE_ENTRY) -> bool:
	var path: String = _path_of(file)
	if LocalDataCore.get_file_size(path) != file.size:
		return false
	var hashed: FileResult = _file_hasher.call(path) if _file_hasher.is_valid() else LocalDataCore.hash_file(path)
	return hashed.ok and hashed.text == file.sha256


static func _path_of(file: _FILE_ENTRY) -> String:
	return _DOWNLOAD_FOLDER + "/" + file.name


## Deletes the files of the download folder that are not in `keep`.
static func _clear_download_folder(keep: Array[_FILE_ENTRY]) -> void:
	var names: Dictionary[String, bool] = {}
	for file: _FILE_ENTRY in keep:
		names[file.name] = true
	for name: String in LocalDataCore.list_files(_DOWNLOAD_FOLDER):
		if names.has(name):
			continue
		var deleted: FileResult = LocalDataCore.delete_file(_DOWNLOAD_FOLDER + "/" + name)
		if not deleted.ok:
			LogCore.log_error(_TAG, "could not delete " + _DOWNLOAD_FOLDER + "/" + name)


static func _set_results(list: _DEPLOY_LIST, with_data: bool) -> void:
	_downloaded_data = null
	_downloaded_translations = []
	_downloaded_bundles = []
	if not list.has_patch:
		return
	if with_data and not list.data_files.is_empty():
		var data: DownloadedData = DownloadedData.new()
		data.data_version = list.data_version
		for file: _FILE_ENTRY in list.data_files:
			data.files[_path_of(file)] = file.sha256
		_downloaded_data = data
	if with_data:
		for file: _FILE_ENTRY in list.translation_files:
			var translation: DownloadedTranslation = DownloadedTranslation.new()
			translation.code = file.language
			translation.path = _path_of(file)
			translation.sha256 = file.sha256
			translation.data_version = list.data_version
			_downloaded_translations.append(translation)
	for file: _FILE_ENTRY in list.bundle_files:
		var bundle: DownloadedBundle = DownloadedBundle.new()
		bundle.name = file.bundle
		bundle.path = _path_of(file)
		bundle.sha256 = file.sha256
		_downloaded_bundles.append(bundle)


# Download and fetch failure


## Async. One download with the stall watch. `is_file` when it is a file to download, which `bytes_done` counts; the
## deploy list and the signature file are not. `null` when the session changed.
static func _download(session: RefCounted, url: String, max_bytes: int,
		is_file: bool = false) -> UpdateDownloader.DownloadResult:
	_downloading = true
	_downloading_file = is_file
	_stalled = false
	_watch_bytes = 0
	_watch_time_ms = TimeCore.get_real_time()
	var result: UpdateDownloader.DownloadResult = await _downloader.download(url, max_bytes)
	if _session != session:
		return null
	_downloading = false
	_downloading_file = false
	if _stalled:
		var stalled: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
		stalled.status = DownloadStatus.CANCELLED
		return stalled
	return result if result != null else UpdateDownloader.DownloadResult.new()


## Frame code. Cancels the running download when its received bytes did not grow for the stall timeout.
static func _watch_stall() -> void:
	if not _downloading or _stalled:
		return
	var received: int = _downloader.received_bytes()
	var now: int = TimeCore.get_real_time()
	if received > _watch_bytes:
		_watch_bytes = received
		_watch_time_ms = now
	elif now - _watch_time_ms >= _stall_timeout_ms:
		_stalled = true
		_downloader.cancel()


## The fetch failure of a download result. 0 when it is a 200 response.
static func _download_failure(result: UpdateDownloader.DownloadResult) -> int:
	if result.status == DownloadStatus.TOO_LARGE:
		return _FAILURE_INVALID
	if result.status != DownloadStatus.DONE or result.http_status != _HTTP_OK:
		return _FAILURE_DOWNLOAD
	return 0


## Logs a fetch failure and opens the fetch failure popup. `true` to retry the failed download; `false` when
## `check_update` ends with `false`.
static func _fail(session: RefCounted, failure: int, url: String, http_status: int, detail: String) -> bool:
	var body: String = _failure_body(failure)
	LogCore.log_error(_TAG, _failure_name(failure) + " " + url + " http_status=" + str(http_status) + " " + detail)
	var choice: int = await _show_popup(body, [ReservedString.game_update_retry()])
	if choice == _CHOICE_CANCELLED or _session != session:
		return false
	if choice == _CHOICE_OPEN_FAILED:
		LogCore.log_error(_TAG, "could not open the fetch failure popup")
		return false
	if choice == _CHOICE_CLOSED:
		_request_restart()
		return false
	return true


static func _failure_body(failure: int) -> String:
	match failure:
		_FAILURE_INVALID:
			return ReservedString.game_update_invalid_file()
		_FAILURE_NO_SPACE:
			return ReservedString.game_update_no_space()
		_FAILURE_SAVE:
			return ReservedString.game_update_save_failed()
	return ReservedString.game_update_download_failed()


static func _failure_name(failure: int) -> String:
	match failure:
		_FAILURE_INVALID:
			return "[game_update_invalid_file]"
		_FAILURE_NO_SPACE:
			return "[game_update_no_space]"
		_FAILURE_SAVE:
			return "[game_update_save_failed]"
	return "[game_update_download_failed]"


# Popup


## Async. Opens a system popup and waits for its outcome: the pressed button's index or a choice constant.
static func _show_popup(body_key: String, labels: PackedStringArray) -> int:
	var session: RefCounted = _session
	_popup_serial += 1
	var serial: int = _popup_serial
	var waiter: _WAITER = _WAITER.new()
	_waiters[serial] = waiter
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = body_key
	for i: int in labels.size():
		var button: SystemPopupButton = SystemPopupButton.new()
		button.label = labels[i]
		button.callback = GameUpdateCore._on_popup_button.bind(session, serial, i)
		param.buttons.append(button)
	var opened: bool = await UICore.open_system_popup(param, GameUpdateCore._on_popup_hidden.bind(session, serial))
	if _session != session:
		return _CHOICE_CANCELLED
	if not opened:
		_waiters.erase(serial)
		return _CHOICE_OPEN_FAILED
	if not waiter.done:
		await waiter.resolved
	if _session != session:
		return _CHOICE_CANCELLED
	_waiters.erase(serial)
	return waiter.choice


static func _on_popup_hidden(session: RefCounted, serial: int) -> void:
	var waiter: _WAITER = _waiter_of(session, serial)
	if waiter == null or waiter.hidden:
		return
	waiter.hidden = true
	_node.settle_popup.call_deferred(session, serial)


static func _on_popup_button(session: RefCounted, serial: int, index: int) -> void:
	var waiter: _WAITER = _waiter_of(session, serial)
	if waiter == null or waiter.button >= 0:
		return
	waiter.button = index
	_node.settle_popup.call_deferred(session, serial)


## Decides a popup's outcome once: its pressed button, or a close without a button.
static func _settle_popup(session: RefCounted, serial: int) -> void:
	var waiter: _WAITER = _waiter_of(session, serial)
	if waiter == null or waiter.done:
		return
	waiter.done = true
	waiter.choice = waiter.button if waiter.button >= 0 else _CHOICE_CLOSED
	waiter.resolved.emit()


static func _waiter_of(session: RefCounted, serial: int) -> _WAITER:
	if not _is_initialized or session != _session or not _waiters.has(serial):
		return null
	return _waiters[serial]
