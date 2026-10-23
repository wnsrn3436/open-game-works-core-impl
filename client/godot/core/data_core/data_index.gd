class_name DataIndex
extends RefCounted
## Derived container with one row for each key. `DataCore.make_index` makes it; `DataCore.get_row` and
## `DataCore.has_row` read it.

## Table name.
var _table: String = ""
## Number of key columns.
var _key_count: int = 0
## Empty row of the table. `null` when there is no such table.
var _empty_row: RefCounted = null
## The `DataCore` session that made it. `null` for an empty container.
var _session: RefCounted = null
## Row by key value.
var _rows: Dictionary[PackedInt64Array, RefCounted] = {}
