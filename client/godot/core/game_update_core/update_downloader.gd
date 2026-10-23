class_name UpdateDownloader
extends RefCounted
## Gets the deploy list, its signature file and the update files for `GameUpdateCore`. Without
## `GameUpdateCoreDev.set_downloader`, `GameUpdateCore` uses one made with the engine HTTP client.


## What `download` got.
class DownloadResult:
	extends RefCounted
	var status: GameUpdateCore.DownloadStatus = GameUpdateCore.DownloadStatus.CONNECTION_FAILED
	## HTTP status of the response. 0 when there was no response.
	var http_status: int = 0
	var body: PackedByteArray = PackedByteArray()


## Async operation. Sends a `GET` to `url` without added request headers and waits for the response. Does not follow
## an HTTP redirect and gives the redirect response's HTTP status (0 in the browser runtime, which hides it). Stops
## with `TOO_LARGE` past `max_bytes` bytes.
func download(_url: String, _max_bytes: int) -> DownloadResult:
	return DownloadResult.new()


## Bytes the `download` running now has received so far.
func received_bytes() -> int:
	return 0


## Ends the `download` running now with `CANCELLED`.
func cancel() -> void:
	pass
