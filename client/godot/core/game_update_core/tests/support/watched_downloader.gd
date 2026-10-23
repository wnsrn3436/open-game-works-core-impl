extends UpdateDownloader
## Wraps the default downloader of this runtime and also tells the test when a download ends.

signal finished

var _inner: UpdateDownloader = null


func _init(inner: UpdateDownloader) -> void:
	_inner = inner


func download(url: String, max_bytes: int) -> UpdateDownloader.DownloadResult:
	var result: UpdateDownloader.DownloadResult = await _inner.download(url, max_bytes)
	finished.emit()
	return result


func received_bytes() -> int:
	return _inner.received_bytes()


func cancel() -> void:
	_inner.cancel()
