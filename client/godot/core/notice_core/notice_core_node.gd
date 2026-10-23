extends Node
## Core node of `NoticeCore`. Runs the frame check of `NoticeCore`, receives `AppForegroundReturnedEvent`, runs
## deferred popup work and runs the `HTTPRequest` of the default `ImageDownloader`.

## Emitted when the `HTTPRequest` of `http_download` ends or is cancelled.
signal http_finished

## Set by `NoticeCore.release` before it removes the node, so `_exit_tree` does not clean up again.
var released: bool = false
var _http: HTTPRequest = null
var _http_result: ImageDownloader.DownloadResult = null


func _process(_delta: float) -> void:
	NoticeCore._on_frame()


func _exit_tree() -> void:
	if not released:
		NoticeCore._on_node_exit(self)


func on_foreground_returned(event: AppForegroundReturnedEvent) -> void:
	NoticeCore._on_foreground_returned(event.background_ms)


## Ends the wait of the maintenance popup of `session` after its hidden callback.
func settle_popup(session: RefCounted) -> void:
	NoticeCore._settle_popup(session)


## Async. One `GET` of `url` with the engine HTTP client that does not follow redirects.
func http_download(url: String, max_bytes: int) -> ImageDownloader.DownloadResult:
	var failed: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	if _http != null:
		return failed
	var request: HTTPRequest = HTTPRequest.new()
	request.max_redirects = 0
	request.body_size_limit = max_bytes
	request.timeout = 0.0
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
	var result: ImageDownloader.DownloadResult = _http_result
	_http_result = null
	return result if result != null else failed


## Ends the running `http_download` with `CANCELLED`.
func http_cancel() -> void:
	if _http == null:
		return
	_http.cancel_request()
	var result: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	result.status = NoticeCore.DownloadStatus.CANCELLED
	_finish_http(result)


func _on_http_completed(status: int, code: int, _headers: PackedStringArray, body: PackedByteArray,
		request: HTTPRequest) -> void:
	if request != _http:
		return
	var result: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	result.http_status = code
	if status == HTTPRequest.RESULT_SUCCESS:
		result.status = NoticeCore.DownloadStatus.DONE
		result.body = body
	elif status == HTTPRequest.RESULT_BODY_SIZE_LIMIT_EXCEEDED:
		result.status = NoticeCore.DownloadStatus.TOO_LARGE
	_finish_http(result)


func _finish_http(result: ImageDownloader.DownloadResult) -> void:
	var request: HTTPRequest = _http
	_http = null
	_free_request(request)
	_http_result = result
	http_finished.emit()


func _free_request(request: HTTPRequest) -> void:
	if request.get_parent() == self:
		remove_child(request)
	request.queue_free()
