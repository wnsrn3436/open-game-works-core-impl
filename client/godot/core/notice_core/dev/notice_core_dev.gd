class_name NoticeCoreDev
extends RefCounted
## DEV operations of `NoticeCore`.


## Called before `NoticeCore.init`: `NoticeCore` uses `downloader` instead of the engine HTTP client for notice images.
## `NoticeCore.release` drops it.
static func set_image_downloader(downloader: ImageDownloader) -> void:
	if NoticeCore.is_initialized():
		LogCore.log_error(NoticeCore._TAG, "set_image_downloader called after init; ignored")
		return
	NoticeCore._downloader_override = downloader
