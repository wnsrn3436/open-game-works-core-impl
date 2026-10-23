extends ImageDownloader
## Test image downloader whose `download` does not end by itself, and not by `cancel` either. `finish` ends it, so the
## test leaves no waiting call behind.

signal released

## URLs `download` got, in order.
var urls: PackedStringArray = PackedStringArray()
var cancel_count: int = 0
var _waiting: int = 0


func download(url: String, _max_bytes: int) -> ImageDownloader.DownloadResult:
	urls.append(url)
	_waiting += 1
	await released
	var result: ImageDownloader.DownloadResult = ImageDownloader.DownloadResult.new()
	result.status = NoticeCore.DownloadStatus.CANCELLED
	return result


func cancel() -> void:
	cancel_count += 1


func is_waiting() -> bool:
	return _waiting > 0


## Ends every waiting `download` with `CANCELLED`.
func finish() -> void:
	_waiting = 0
	released.emit()
