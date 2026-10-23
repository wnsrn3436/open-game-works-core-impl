extends RefCounted
## Static `after_update` hooks for the core tests, and what they saw.

## `<id>:<step>:<change number>:<tutorial count>` of each `after_tutorial` call, and `other` of each `other` call.
static var calls: PackedStringArray = PackedStringArray()


static func after_tutorial(state: ContractMessage) -> void:
	var tutorial_state := state as CoreContract.TutorialProgressUserState
	calls.append("%d:%d:%d:%d" % [tutorial_state.id, tutorial_state.step, UserStateCore.get_change_number(CoreContract.TutorialProgressUserState), UserStateCore.count(CoreContract.TutorialProgressUserState)])


## Records `throw:<id>` and stops on a GDScript runtime error, an out-of-bounds read, for the object of ID 1; records
## `<id>` for the others.
static func throwing_for_one(state: ContractMessage) -> void:
	var tutorial_state := state as CoreContract.TutorialProgressUserState
	if tutorial_state.id != 1:
		calls.append("%d" % tutorial_state.id)
		return
	calls.append("throw:%d" % tutorial_state.id)
	var none: PackedStringArray = PackedStringArray()
	calls.append(none[0])


static func other(_state: ContractMessage) -> void:
	calls.append("other")
