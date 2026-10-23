extends "res://core/qa_core/tests/support/qa_test_case.gd"
## Base of the QACore core tests with `RealtimeCore` in the module list: a dev login through the fake network and the
## `UnitTestCore` fake realtime transport.

const OTHER_IDS: PackedInt64Array = [1002, 1003, 1004]
const MATCH_ID: String = "qa-match-1"
const ROOM_CODE: String = "QAROOM"

var fake: UnitTestRealtimeTransport = null
var mode_id: int = 0


## A join or room operation of `RealtimeCore` started without waiting.
class Call:
	extends RefCounted
	signal finished
	var done: bool = false
	var join: MatchJoinResult = null
	var room: RoomResult = null

	func join_match(mode: int) -> void:
		join = await RealtimeCore.join_match(mode)
		done = true
		finished.emit()

	func create_room(mode: int) -> void:
		room = await RealtimeCore.create_room(mode)
		done = true
		finished.emit()


func after_each() -> void:
	QACore.release()
	RealtimeCore.release()
	AuthCore.release()
	super()


## `start` with `AuthCore`, a dev login and `RealtimeCore` on the fake realtime transport before QACore. With
## `lockstep`, the DEV lockstep transport wraps the fake one.
func start_realtime(lockstep: bool = false) -> bool:
	var ok: bool = await start(false)
	mode_id = GameDataDev.find_id_value("[testing_duel]")
	assert_true(mode_id != 0, "[testing_duel] is in the core test data")
	# A core test that inits AuthCore with no boot gives it the DEV token storage, as the DEV boot does.
	AuthCoreDev.use_dev_token_storage()
	assert_true(AuthCore.init(), "AuthCore.init")
	await dev_login()
	fake = UnitTestCore.create_fake_realtime()
	if lockstep:
		RealtimeCore.set_transport(LockstepRealtimeTransport.new(fake))
	else:
		RealtimeCore.set_transport(fake)
	assert_true(RealtimeCore.init(), "RealtimeCore.init")
	assert_true(QACore.init(), "QACore.init")
	return ok


func notice(kind: RealtimeNotice.Kind) -> RealtimeNotice:
	var item: RealtimeNotice = RealtimeNotice.new()
	item.reset(kind)
	return item


func match_info(count: int, my_index: int, lockstep: bool) -> MatchInfo:
	var info: MatchInfo = MatchInfo.new()
	info.match_id = MATCH_ID
	info.mode_id = mode_id
	info.my_index = my_index
	var next_other: int = 0
	for i: int in count:
		if i == my_index:
			info.user_ids.append(USER_ID)
		else:
			info.user_ids.append(OTHER_IDS[next_other])
			next_other += 1
		info.teams.append(i % 2)
		info.parties.append(0)
	info.match_seed = 7
	info.start_at = SERVER_TIME + 3000
	info.lockstep = lockstep
	return info


## Joins a match of `count` participants as `my_index` and connects every other participant.
func reach_playing(count: int, my_index: int, lockstep: bool = false) -> void:
	var call: Call = Call.new()
	call.join_match(mode_id)
	await UnitTestCore.wait_frames(2)
	var found: RealtimeNotice = notice(RealtimeNotice.Kind.MATCH_FOUND)
	found.match_info = match_info(count, my_index, lockstep)
	UnitTestCore.add_realtime_notice(fake, found)
	await UnitTestCore.wait_frames(2)
	for i: int in count:
		if i != my_index:
			var connected: RealtimeNotice = notice(RealtimeNotice.Kind.PEER_CONNECTED)
			connected.participant = i
			UnitTestCore.add_realtime_notice(fake, connected)
	await UnitTestCore.wait_frames(2)
	if not call.done:
		await call.finished
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING, "reach_playing")


## Transport calls of `operation` with their inputs joined by spaces.
func calls_of(operation: String) -> PackedStringArray:
	var found: PackedStringArray = PackedStringArray()
	for call: UnitTestRealtimeCall in UnitTestCore.realtime_calls(fake):
		if call.name == operation:
			found.append(" ".join(call.inputs))
	return found
