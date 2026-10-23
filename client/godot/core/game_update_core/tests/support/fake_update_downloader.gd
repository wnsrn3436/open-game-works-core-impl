extends UpdateDownloader
## Test `UpdateDownloader`. Answers each URL with the responses the test added, in order; the last one of a URL
## answers again. A pending response waits until `complete_pending` or `cancel`. Records the requested URLs.

const _RESPONSE = preload("res://core/game_update_core/tests/support/fake_update_response.gd")

## Emitted when a pending response starts waiting.
signal pending_started
signal resumed

## Requested URLs in order.
var calls: PackedStringArray = PackedStringArray()
var cancel_count: int = 0
## Received bytes that `received_bytes` reports for the pending response.
var received: int = 0
## Whether `cancel` ends the pending response with `CANCELLED`. When `false`, `cancel` only counts and the pending
## response still ends with `complete_pending`, as a result that comes after the cancel.
var cancel_ends_pending: bool = true
var _urls: PackedStringArray = PackedStringArray()
var _responses: Array[_RESPONSE] = []
var _pending: bool = false
var _pending_result: UpdateDownloader.DownloadResult = null


func add(url: String, response: _RESPONSE) -> void:
	_urls.append(url)
	_responses.append(response)


## A `DONE` response with `http_status` and `body`.
func add_body(url: String, body: PackedByteArray, http_status: int = 200) -> void:
	var response: _RESPONSE = _RESPONSE.new()
	response.http_status = http_status
	response.body = body
	add(url, response)


func add_pending(url: String) -> void:
	var response: _RESPONSE = _RESPONSE.new()
	response.pending = true
	add(url, response)


## Removes the responses of `url`.
func clear(url: String) -> void:
	var i: int = 0
	while i < _urls.size():
		if _urls[i] == url:
			_urls.remove_at(i)
			_responses.remove_at(i)
		else:
			i += 1


func count_calls(url: String) -> int:
	return calls.count(url)


func is_pending() -> bool:
	return _pending


## Ends the pending response with `DONE`, `http_status` and `body`. `false` when none is pending.
func complete_pending(body: PackedByteArray, http_status: int = 200) -> bool:
	if not _pending:
		return false
	var result: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
	result.status = GameUpdateCore.DownloadStatus.DONE
	result.http_status = http_status
	result.body = body
	_end_pending(result)
	return true


func download(url: String, max_bytes: int) -> UpdateDownloader.DownloadResult:
	calls.append(url)
	var result: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
	var index: int = _urls.find(url)
	if index < 0:
		return result
	var response: _RESPONSE = _responses[index]
	if _urls.count(url) > 1:
		_urls.remove_at(index)
		_responses.remove_at(index)
	if response.pending:
		_pending = true
		received = 0
		pending_started.emit()
		await resumed
		return _pending_result
	if response.body.size() > max_bytes:
		result.status = GameUpdateCore.DownloadStatus.TOO_LARGE
		result.http_status = response.http_status
		return result
	result.status = response.status
	result.http_status = response.http_status
	result.body = response.body
	return result


func received_bytes() -> int:
	return received if _pending else 0


func cancel() -> void:
	cancel_count += 1
	if not _pending or not cancel_ends_pending:
		return
	var result: UpdateDownloader.DownloadResult = UpdateDownloader.DownloadResult.new()
	result.status = GameUpdateCore.DownloadStatus.CANCELLED
	_end_pending(result)


func _end_pending(result: UpdateDownloader.DownloadResult) -> void:
	_pending = false
	_pending_result = result
	resumed.emit()
