class_name RealtimeTransportDriver
extends Node
## Test node that polls a transport every frame the way RealtimeCore does and keeps its notifications.

var transport: RealtimeTransport = null
## While `true`, the transport is not polled.
var paused: bool = false
var kinds: PackedInt32Array = PackedInt32Array()
var participants: PackedInt32Array = PackedInt32Array()
var error_codes: PackedInt32Array = PackedInt32Array()
var oks: Array[bool] = []
var left_lists: Array[PackedInt32Array] = []
var match_infos: Array[MatchInfo] = []
var fail_reasons: PackedInt32Array = PackedInt32Array()


func _process(_delta: float) -> void:
	if transport == null or paused:
		return
	transport.poll()
	var notice: RealtimeNotice = transport.take_notice()
	while notice != null:
		kinds.append(notice.kind)
		participants.append(notice.participant)
		error_codes.append(notice.error_code)
		oks.append(notice.ok)
		left_lists.append(notice.left_indices.duplicate())
		match_infos.append(notice.match_info)
		fail_reasons.append(notice.fail_reason)
		notice = transport.take_notice()


func count(kind: RealtimeNotice.Kind) -> int:
	return kinds.count(kind)


## Number of notifications of `kind` about `participant`.
func count_for(kind: RealtimeNotice.Kind, participant: int) -> int:
	var found: int = 0
	for i: int in kinds.size():
		if kinds[i] == kind and participants[i] == participant:
			found += 1
	return found


## Index in the notification lists of the last notification of `kind`; -1 when none.
func last(kind: RealtimeNotice.Kind) -> int:
	for i: int in range(kinds.size() - 1, -1, -1):
		if kinds[i] == kind:
			return i
	return -1


## Waits until `n` notifications of `kind` came. Waits on the frames of the scene tree, not on a signal of this
## node, so the test that resumes can free this node. A release of the modules, as at the test time limit, ends the
## wait too.
func wait_count(kind: RealtimeNotice.Kind, n: int) -> void:
	while count(kind) < n and EventCore.is_initialized():
		await (Engine.get_main_loop() as SceneTree).process_frame
