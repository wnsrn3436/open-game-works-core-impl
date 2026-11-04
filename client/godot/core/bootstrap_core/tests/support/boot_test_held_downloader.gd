extends UpdateDownloader
## `UpdateDownloader` of the BootstrapCore core tests whose `download` waits until `cancel`.

signal cancelled


func download(_url: String, _max_bytes: int) -> UpdateDownloader.DownloadResult:
	await cancelled
	var result := UpdateDownloader.DownloadResult.new()
	result.status = GameUpdateCore.DownloadStatus.CANCELLED
	return result


func cancel() -> void:
	cancelled.emit()
