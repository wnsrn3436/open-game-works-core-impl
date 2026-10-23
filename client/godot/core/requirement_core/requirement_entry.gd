extends RefCounted
## One condition: its `requirement` row, its sub-conditions, its last result and the cache state.

var row: GameData.RequirementRow = null
## Entries of the `children` of the row, in order.
var children: Array[RefCounted] = []
## `type` of this condition and of every sub-condition below it, `None` left out, each once.
var types: PackedInt32Array = PackedInt32Array()
## Kinds the condition sees: the kinds the judge hooks of `types` read, each once.
var kinds: Array[GDScript] = []
## `UserStateCore` change number of each of `kinds` at the last judgement.
var change_numbers: PackedInt64Array = PackedInt64Array()
## True when a type of `types` is a time-dependent type.
var time_dependent: bool = false
## The result the module keeps for the condition.
var result: RequirementResult = RequirementResult.new()
## True while `result` is a cache the next `evaluate` may return without calling a judge hook.
var valid: bool = false
