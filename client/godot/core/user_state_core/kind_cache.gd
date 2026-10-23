extends RefCounted
## The cache of one UserState kind: its objects, change number, `after_update` hook, and what the running
## `apply_delta` applied to it.

## Kind message name, the `kind` of a delta entry.
var name: String = ""
var kind_class: GDScript = null
var is_list: bool = false
## Objects of a list kind by `id`.
var objects: Dictionary[int, ContractMessage] = {}
## The object of a single kind; null when there is none.
var single: ContractMessage = null
var change_number: int = 0
## The `after_update` hook; empty when none is registered.
var after_update: Callable = Callable()

# What the running `apply_delta` applied to this kind.
var applied: bool = false
var upserted_ids: PackedInt64Array = PackedInt64Array()
var deleted_ids: PackedInt64Array = PackedInt64Array()


func _init(kind_name: String, script: GDScript, list: bool) -> void:
	name = kind_name
	kind_class = script
	is_list = list


## Clears what an earlier `apply_delta` applied.
func begin_apply() -> void:
	applied = false
	upserted_ids = PackedInt64Array()
	deleted_ids = PackedInt64Array()


## The cached object of `id`; null when there is none. A single kind has only `id` 0.
func find(id: int) -> ContractMessage:
	if not is_list:
		return single if id == 0 else null
	if objects.has(id):
		return objects[id]
	return null


## The number of cached objects.
func size() -> int:
	if is_list:
		return objects.size()
	return 0 if single == null else 1
