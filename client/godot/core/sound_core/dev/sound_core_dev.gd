class_name SoundCoreDev
extends RefCounted
## DEV operations of `SoundCore`.

const _TAG: String = "SoundCore"


## Fills `buffer` from index 0 with the playing `play` requests and returns the count. A request whose loading has
## not ended is not playing. More requests than `buffer` holds fill the buffer and log an error.
static func get_playing(buffer: Array[SoundPlayingRecord]) -> int:
	if not SoundCore.is_initialized():
		LogCore.log_error(_TAG, "get_playing before init or after release")
		return 0
	var count: int = 0
	var overflow: bool = false
	SoundCore._update_game_pause(TimeCore.get_real_time())
	for slot: int in SoundCore._players.size():
		if SoundCore._slot_handles[slot] == SoundCore.INVALID_HANDLE or SoundCore._has_ended(slot):
			continue
		if count >= buffer.size():
			overflow = true
			break
		if buffer[count] == null:
			buffer[count] = SoundPlayingRecord.new()
		var record: SoundPlayingRecord = buffer[count]
		record.key = SoundCore._slot_keys[slot]
		record.bus = SoundCore._slot_buses[slot] as SoundCore.SoundBus
		record.priority = SoundCore._slot_priorities[slot]
		count += 1
	if overflow:
		LogCore.log_error(_TAG, "get_playing has more playing requests than the buffer holds")
	return count


## Fills `buffer` from index 0 with the latest `play_haptic` requests, oldest first, and returns the count. More
## requests than `buffer` holds fill the buffer with the latest ones and log an error.
static func get_haptic_log(buffer: Array[HapticLogRecord]) -> int:
	if not SoundCore.is_initialized():
		LogCore.log_error(_TAG, "get_haptic_log before init or after release")
		return 0
	var size: int = SoundCore._haptic_log_size
	var capacity: int = SoundCore._haptic_log_keys.size()
	var count: int = mini(size, buffer.size())
	if size > buffer.size():
		LogCore.log_error(_TAG, "get_haptic_log has more requests than the buffer holds")
	for index: int in count:
		var position: int = (SoundCore._haptic_log_next - count + index + capacity) % capacity
		if buffer[index] == null:
			buffer[index] = HapticLogRecord.new()
		var record: HapticLogRecord = buffer[index]
		record.key = SoundCore._haptic_log_keys[position]
		record.played = SoundCore._haptic_log_played[position]
		record.target = SoundCore._haptic_log_targets[position] as SoundCore.HapticTarget
	return count


## The same processing as the engine's app focus out (`has_focus` false) or focus in (`has_focus` true).
static func inject_focus_change(has_focus: bool) -> void:
	if not SoundCore.is_initialized():
		LogCore.log_error(_TAG, "inject_focus_change before init or after release")
		return
	SoundCore._on_focus_changed(has_focus)
