class_name GetLiveEventRoundResult
extends RefCounted
## Output of `UserStateCore.get_live_event_round`, the same values as server `live-event` `get_round`: the active
## round, or `round` 0 with the times of the next round, or all 0 when there is no next round.

var round: int = 0
## Start time of the round, Unix ms.
var start_at: int = 0
## End time of the round, Unix ms.
var end_at: int = 0
