class_name MatchJoinResult
extends RefCounted
## Result of `RealtimeCore.join_match`, `rejoin_match`, `start_room` and `wait_match`.

var status: RealtimeCore.MatchJoinStatus = RealtimeCore.MatchJoinStatus.FAILED
## Reason of the server `MATCH_FAILED`; `MATCH_FAIL_REASON_UNSPECIFIED` otherwise.
var fail_reason: CoreContract.MatchFailReason = CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED
## Error code of `REJECTED`, of a room failed, or of a matchmaker lost in `Matching` or `Connecting`; 0 otherwise.
var error_code: int = 0
