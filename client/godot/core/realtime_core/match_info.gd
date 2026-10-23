class_name MatchInfo
extends RefCounted
## One match: the values of the server `MATCH_FOUND`. The empty `MatchInfo` has an empty match ID and no participants.
## A caller does not change a `MatchInfo` it got from `RealtimeCore`.

## Match ID.
var match_id: String = ""
## Match mode ID value.
var mode_id: int = 0
## Own participant index.
var my_index: int = 0
## User ID of each participant, in index order.
var user_ids: PackedInt64Array = PackedInt64Array()
## Team of each participant, in index order.
var teams: PackedInt64Array = PackedInt64Array()
## Party of each participant, in index order.
var parties: PackedInt64Array = PackedInt64Array()
## Match seed. Content code makes its random seeds from it with `UtilCore.make_purpose_seed`.
var match_seed: int = 0
## Match start time. Unix ms.
var start_at: int = 0
## Whether the match is a DEV lockstep match.
var lockstep: bool = false


## Whether this is the empty `MatchInfo`.
func _is_empty() -> bool:
	return match_id.is_empty() and user_ids.is_empty()


## A new `MatchInfo` with the same values.
func _copy() -> MatchInfo:
	var info: MatchInfo = MatchInfo.new()
	info.match_id = match_id
	info.mode_id = mode_id
	info.my_index = my_index
	info.user_ids = user_ids.duplicate()
	info.teams = teams.duplicate()
	info.parties = parties.duplicate()
	info.match_seed = match_seed
	info.start_at = start_at
	info.lockstep = lockstep
	return info
