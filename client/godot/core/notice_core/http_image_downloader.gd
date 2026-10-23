extends ImageDownloader
## Default `ImageDownloader` outside the browser runtime: the engine HTTP client, run by the `NoticeCore` core node.

const _CORE_NODE = preload("res://core/notice_core/notice_core_node.gd")

var _node: _CORE_NODE = null


func _init(node: _CORE_NODE) -> void:
	_node = node


func download(url: String, max_bytes: int) -> ImageDownloader.DownloadResult:
	if not is_instance_valid(_node):
		return ImageDownloader.DownloadResult.new()
	return await _node.http_download(url, max_bytes)


func cancel() -> void:
	if is_instance_valid(_node):
		_node.http_cancel()
