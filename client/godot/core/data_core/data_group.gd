class_name DataGroup
extends RefCounted
## Derived container with a row list for each key. `DataCore.make_group` makes it; `DataCore.get_rows` and
## `DataCore.has_rows` read it.

const DataRowList := preload("res://core/data_core/data_row_list.gd")

## Table name.
var _table: String = ""
## Number of key columns.
var _key_count: int = 0
## The `DataCore` session that made it. `null` for an empty container.
var _session: RefCounted = null
## Row list by key value.
var _lists: Dictionary[PackedInt64Array, DataRowList] = {}
