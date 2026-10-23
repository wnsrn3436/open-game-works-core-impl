class_name RequirementResult
extends RefCounted
## Result of `RequirementCore.evaluate`. The object is the value the module keeps for the condition and the next
## `evaluate` changes it: a caller does not change it and copies the values it keeps.

## Pass flag.
var passed: bool = false
## ID value of the first failed condition. 0 when passed.
var failed_requirement_id: int = 0
## Guide text translation key of the type of the first failed condition. Empty when passed or when there is none.
var guide_key: String = ""
