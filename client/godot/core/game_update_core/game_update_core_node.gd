extends Node
## Core node of `GameUpdateCore`. Watches the running download for a stall every frame, receives
## `UpdateRequiredEvent`, runs deferred popup work and runs the `HTTPRequest` of the default `UpdateDownloader` outside
## the browser runtime.

## Emitted when the `HTTPRequest` of `http_download` ends or is cancelled.
signal http_finished

## Set by `GameUpdateCore.release` before it removes the node, so `_exit_tree` does not clean up again.
var released: bool = false
var _http: HTTPRequest = null
var _http_result: UpdateDownloader.DownloadResult = null


func _process(_delta: float) -> void:
	GameUpdateCore._watch_stall()


func _exit_tree() -> void:
	if not released:
		GameUpdateCore._on_node_exit(self)


func on_update_required(event: UpdateRequiredEvent) -> void:
	GameUpdateCore._on_update_required(event.error_code)


## Decides the outcome of popup `serial` of `session` after its hidden and button callbacks.
func settle_popup(session: RefCounted, serial: int) -> void:
	GameUpdateCore._settle_popup(session, serial)


## Async. One `GET` of `url` with the engine HTTP client, without added request headers and without following
## redirects. Not used in the browser runtime, where the web export `HTTPRequest` follows redirects.
func http_download(url: String, max_bytes: int) -> UpdateDownloader.DownloadResult:
	var failed: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
	if _http != null:
		return failed
	var request: HTTPRequest = HTTPRequest.new()
	request.max_redirects = 0
	request.body_size_limit = max_bytes
	request.timeout = 0.0
	request.accept_gzip = false
	add_child(request)
	if request.request_completed.connect(_on_http_completed.bind(request)) != OK:
		_free_request(request)
		return failed
	_http = request
	if request.request(url) != OK:
		_http = null
		_free_request(request)
		return failed
	await http_finished
	var result: UpdateDownloader.DownloadResult = _http_result
	_http_result = null
	return result if result != null else failed


## Bytes the running `http_download` has received.
func http_received_bytes() -> int:
	return _http.get_downloaded_bytes() if _http != null else 0


## Ends the running `http_download` with `CANCELLED`.
func http_cancel() -> void:
	if _http == null:
		return
	_http.cancel_request()
	var result: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
	result.status = GameUpdateCore.DownloadStatus.CANCELLED
	_finish_http(result)


func _on_http_completed(status: int, code: int, _headers: PackedStringArray, body: PackedByteArray,
		request: HTTPRequest) -> void:
	if request != _http:
		return
	var result: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
	if status == HTTPRequest.RESULT_SUCCESS:
		result.status = GameUpdateCore.DownloadStatus.DONE
		result.http_status = code
		result.body = body
	elif status == HTTPRequest.RESULT_REDIRECT_LIMIT_REACHED:
		result.status = GameUpdateCore.DownloadStatus.DONE
		result.http_status = code
	elif status == HTTPRequest.RESULT_BODY_SIZE_LIMIT_EXCEEDED:
		result.status = GameUpdateCore.DownloadStatus.TOO_LARGE
		result.http_status = code
	_finish_http(result)


func _finish_http(result: UpdateDownloader.DownloadResult) -> void:
	var request: HTTPRequest = _http
	_http = null
	_free_request(request)
	_http_result = result
	http_finished.emit()


func _free_request(request: HTTPRequest) -> void:
	if request.get_parent() == self:
		remove_child(request)
	request.queue_free()
