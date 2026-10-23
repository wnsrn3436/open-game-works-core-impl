class_name ImageDownloader
extends RefCounted
## Gets notice images for `NoticeCore.load_image`. Without `NoticeCoreDev.set_image_downloader`, `NoticeCore` uses one
## made with the engine HTTP client.


## What `download` got.
class DownloadResult:
	extends RefCounted
	var status: NoticeCore.DownloadStatus = NoticeCore.DownloadStatus.CONNECTION_FAILED
	## HTTP status of the response. 0 when there was no response.
	var http_status: int = 0
	var body: PackedByteArray = PackedByteArray()


## Async operation. Sends a `GET` to `url` that does not follow redirects and waits for the response. Stops with
## `TOO_LARGE` past `max_bytes` bytes.
func download(_url: String, _max_bytes: int) -> DownloadResult:
	return DownloadResult.new()


## Ends the `download` running now with `CANCELLED`.
func cancel() -> void:
	pass
