class_name GameUpdateCoreDev
extends RefCounted
## DEV operations of `GameUpdateCore`.


## Called before `GameUpdateCore.init`: `GameUpdateCore` uses `downloader` instead of the engine HTTP client.
## `GameUpdateCore.release` drops it.
static func set_downloader(downloader: UpdateDownloader) -> void:
	if GameUpdateCore.is_initialized():
		LogCore.log_error(GameUpdateCore._TAG, "set_downloader called after init")
		return
	GameUpdateCore._downloader_override = downloader
