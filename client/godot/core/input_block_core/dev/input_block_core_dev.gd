class_name InputBlockCoreDev
extends RefCounted
## DEV operations of `InputBlockCore`.

const _TAG: String = "InputBlockCore"


## Fills `buffer` from index 0 with the active blocks and returns the number filled. A null entry gets a new
## `ActiveBlockInfo`; the buffer size does not change.
static func list_active(buffer: Array[ActiveBlockInfo]) -> int:
	if not InputBlockCore._is_initialized:
		LogCore.log_error(_TAG, "list_active: not initialized")
		return 0
	var now: int = InputBlockCore._unheld_now()
	var count: int = 0
	for slot: int in InputBlockCore._slot_count:
		if InputBlockCore._active[slot] == 0:
			continue
		if count >= buffer.size():
			LogCore.log_error(_TAG, "list_active: buffer is smaller than the active block count")
			return count
		var info: ActiveBlockInfo = buffer[count]
		if info == null:
			info = ActiveBlockInfo.new()
			buffer[count] = info
		info.reason = InputBlockCore._reason[slot]
		info.caller_location = InputBlockCore._caller[slot]
		info.elapsed_ms = now - InputBlockCore._start[slot]
		count += 1
	return count


static func count_active() -> int:
	if not InputBlockCore._is_initialized:
		LogCore.log_error(_TAG, "count_active: not initialized")
		return 0
	return InputBlockCore._active_count
