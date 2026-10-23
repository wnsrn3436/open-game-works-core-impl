extends RefCounted
## One response of the test `UpdateDownloader`.

var status: GameUpdateCore.DownloadStatus = GameUpdateCore.DownloadStatus.DONE
var http_status: int = 200
var body: PackedByteArray = PackedByteArray()
## Waits until the test completes or cancels it.
var pending: bool = false
