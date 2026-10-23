extends RefCounted
## What `RequirementCore.register_judge` registered for one `RequirementType` element.

var judge: Callable = Callable()
## UserState kinds the judge hook reads.
var kinds: Array[GDScript] = []
var guide_key: String = ""
## Guide argument hook. Null when none.
var guide_args: Callable = Callable()
var time_dependent: bool = false
