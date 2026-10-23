class_name MatchEndedEvent
extends EventBase
## `RealtimeCore` ended the match. `RealtimeCore.match_state` is already `None`.

## Match ID of the ended match.
var match_id: String = ""
var reason: RealtimeCore.MatchEndReason = RealtimeCore.MatchEndReason.ENDED
