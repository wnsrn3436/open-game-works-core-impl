extends UpdateDownloader
## Default `UpdateDownloader` outside the browser runtime: the engine HTTP client, run by the `GameUpdateCore` core
## node.

const _CORE_NODE = preload("res://core/game_update_core/game_update_core_node.gd")

var _node: _CORE_NODE = null


func _init(node: _CORE_NODE) -> void:
	_node = node


func download(url: String, max_bytes: int) -> UpdateDownloader.DownloadResult:
	if not is_instance_valid(_node):
		return UpdateDownloader.DownloadResult.new()
	return await _node.http_download(url, max_bytes)


func received_bytes() -> int:
	return _node.http_received_bytes() if is_instance_valid(_node) else 0


func cancel() -> void:
	if is_instance_valid(_node):
		_node.http_cancel()
