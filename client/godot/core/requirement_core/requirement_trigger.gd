class_name RequirementTrigger
extends RefCounted
## One trigger of `RequirementCore.watch`: when it is raised, the watch becomes a pending evaluation. `watch` copies the
## values, so a caller may reuse the object.

var kind: RequirementCore.TriggerKind = RequirementCore.TriggerKind.USER_STATE_CHANGED
## Target of `USER_STATE_CHANGED`: a UserState kind class. `null` targets every kind the condition sees.
var user_state_kind: GDScript = null
## Target of `REQUEST_COMPLETED` (request name), `UI_OPENED` and `UI_CLOSED` (panel key or popup key).
var target_name: String = ""
## Target of `CONTENT_EVENT`: the content event type.
var event_type: Script = null
