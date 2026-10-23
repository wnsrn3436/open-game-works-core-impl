extends UnitTestCase
## `DataCore` derived containers: the `build_derived` hook, `make_index`, `make_group` and their lookups.

const Support := preload("res://core/data_core/tests/support/data_core_test_support.gd")
const DataRowList := preload("res://core/data_core/data_row_list.gd")

## Containers the hooks below make.
static var _index: DataIndex = null
static var _index_2: DataIndex = null
static var _group: DataGroup = null


func before_each() -> void:
	super()
	_index = null
	_index_2 = null
	_group = null
	assert_true(Support.init_modules())
	assert_true(await DataCore.load(null))


func after_each() -> void:
	super()
	Support.release_modules()
	_index = null
	_index_2 = null
	_group = null


static func id_of(id_name: String) -> int:
	return GameDataDev.find_id_value(id_name)


static func key(a: int, b: int = 0, c: int = 0, count: int = 1) -> PackedInt64Array:
	return PackedInt64Array([a, b, c]).slice(0, count)


static func _hook_min_rating_index() -> bool:
	_index = DataCore.make_index("rating_tier", PackedStringArray(["min_rating"]))
	return true


static func _hook_two_column_indexes() -> bool:
	_index = DataCore.make_index("attendance_reward", PackedStringArray(["id", "day"]))
	_index_2 = DataCore.make_index("item", PackedStringArray(["id", "type"]))
	_group = DataCore.make_group("attendance_reward", PackedStringArray(["id", "day"]))
	return true


static func _hook_group() -> bool:
	_group = DataCore.make_group("attendance_reward", PackedStringArray(["id"]))
	return true


static func _hook_duplicate_index() -> bool:
	_index = DataCore.make_index("attendance_reward", PackedStringArray(["id"]))
	return true


static func _hook_ref_columns() -> bool:
	_index = DataCore.make_index("iap_product", PackedStringArray(["sku_apple"]))
	_index_2 = DataCore.make_index("rating_tier", PackedStringArray(["rule", "min_rating"]))
	return true


static func _hook_bad_columns() -> bool:
	_index = DataCore.make_index("rating_tier", PackedStringArray([]))
	_index_2 = DataCore.make_index("rating_tier", PackedStringArray(["id", "rule", "min_rating", "id"]))
	_group = DataCore.make_group("no_such_table", PackedStringArray(["id"]))
	var no_column: DataIndex = DataCore.make_index("rating_tier", PackedStringArray(["no_such_column"]))
	return no_column != null


static func _hook_false() -> bool:
	return false


## Stops on a GDScript runtime error, an out-of-bounds read. A `-> bool` function that stops returns `false`.
static func _hook_throwing() -> bool:
	var none: PackedInt32Array = PackedInt32Array()
	return none[1] > 0


static func _hook_second_build() -> bool:
	return DataCore.build_derived_containers()


func test_index_get_row_returns_the_same_row_object_and_logs_missing_data_once() -> void:
	assert_true(DataCore.register_build_derived(_hook_min_rating_index))
	assert_true(DataCore.build_derived_containers())
	var silver: GameData.RatingTierRow = GameData.RatingTierTable.get_row(id_of("[rating_tier_silver]"))
	assert_gt(silver.id, 0)
	var found: GameData.RatingTierRow = DataCore.get_row(_index, key(silver.min_rating)) as GameData.RatingTierRow
	assert_same(found, silver)
	assert_same(DataCore.get_row(_index, key(silver.min_rating)), found)
	assert_true(DataCore.has_row(_index, key(silver.min_rating)))
	var absent: int = 1
	for row: GameData.RatingTierRow in GameData.RatingTierTable.all_rows():
		absent = maxi(absent, row.min_rating + 1)
	assert_same(DataCore.get_row(_index, key(absent)), GameData.RatingTierTable.empty_row())
	assert_eq(Support.errors(), 1)
	assert_same(DataCore.get_row(_index, key(absent)), GameData.RatingTierTable.empty_row())
	assert_false(DataCore.has_row(_index, key(absent)))


func test_group_key_with_an_empty_row_list_is_not_missing_data() -> void:
	assert_true(DataCore.register_build_derived(_hook_group))
	assert_true(DataCore.build_derived_containers())
	var cycle: PackedInt64Array = key(id_of("[attendance_cycle]"))
	var rows: Array[RefCounted] = DataCore.get_rows(_group, cycle)
	assert_eq(rows.size(), 3)
	for i: int in rows.size():
		assert_eq((rows[i] as GameData.AttendanceRewardRow).day, i + 1)
	assert_true(rows.is_read_only())
	assert_same(DataCore.get_rows(_group, cycle), rows)
	# `make_group` gives every key it has at least one row, so the test puts an empty row list in itself.
	var empty_key: PackedInt64Array = key(Support.EXTRA_ID)
	assert_false(DataCore.has_rows(_group, empty_key))
	var empty_list: DataRowList = DataRowList.new()
	empty_list.rows.make_read_only()
	_group._lists[empty_key] = empty_list
	assert_eq(DataCore.get_rows(_group, empty_key).size(), 0)
	assert_true(DataCore.has_rows(_group, empty_key))


func test_two_column_index_finds_by_values_in_column_order_and_enum_value() -> void:
	assert_true(DataCore.register_build_derived(_hook_two_column_indexes))
	assert_true(DataCore.build_derived_containers())
	var cycle: int = id_of("[attendance_cycle]")
	var day_2: GameData.AttendanceRewardRow = DataCore.get_row(_index, key(cycle, 2, 0, 2)) as GameData.AttendanceRewardRow
	assert_eq(day_2.id, cycle)
	assert_eq(day_2.day, 2)
	var swapped: PackedInt64Array = key(2, cycle, 0, 2)
	for row: GameData.AttendanceRewardRow in GameData.AttendanceRewardTable.all_rows():
		assert_false(row.id == 2 and row.day == cycle, "the swapped key is a row of the core test data")
	assert_false(DataCore.has_row(_index, swapped))
	assert_same(DataCore.get_row(_index, swapped), GameData.AttendanceRewardTable.empty_row())
	assert_eq(Support.errors(), 1)
	var gold: int = id_of("[gold]")
	var gold_row: RefCounted = DataCore.get_row(_index_2, key(gold, GameData.ItemType.CURRENCY, 0, 2))
	assert_same(gold_row, GameData.ItemTable.get_row(gold))
	assert_false(DataCore.has_row(_index_2, key(gold, GameData.ItemType.GOODS, 0, 2)))
	assert_eq(DataCore.get_rows(_group, key(cycle, 2, 0, 2)).size(), 1)


func test_key_value_count_other_than_the_key_column_count_logs_on_every_call() -> void:
	assert_true(DataCore.register_build_derived(_hook_two_column_indexes))
	assert_true(DataCore.build_derived_containers())
	var cycle: int = id_of("[attendance_cycle]")
	assert_same(DataCore.get_row(_index, key(cycle)), GameData.AttendanceRewardTable.empty_row())
	assert_same(DataCore.get_row(_index, key(cycle)), GameData.AttendanceRewardTable.empty_row())
	assert_eq(Support.errors(), 2)
	assert_eq(DataCore.get_rows(_group, key(cycle, 1, 1, 3)).size(), 0)
	assert_eq(Support.errors(), 1)
	assert_false(DataCore.has_row(_index, key(cycle, 1, 1, 3)))
	assert_eq(Support.errors(), 1)
	assert_false(DataCore.has_rows(_group, key(cycle)))
	assert_eq(Support.errors(), 1)


func test_index_with_a_duplicate_key_leaves_out_its_rows_and_fails_the_build() -> void:
	var counts: Dictionary[int, int] = {}
	for row: GameData.AttendanceRewardRow in GameData.AttendanceRewardTable.all_rows():
		if counts.has(row.id):
			counts[row.id] += 1
		else:
			counts[row.id] = 1
	var duplicates: int = 0
	for id: int in counts:
		if counts[id] > 1:
			duplicates += 1
	assert_gt(duplicates, 0)
	assert_eq(counts[id_of("[attendance_window]")], 1)
	assert_true(DataCore.register_build_derived(_hook_duplicate_index))
	assert_false(DataCore.build_derived_containers())
	assert_eq(Support.errors(), duplicates)
	assert_false(DataCore.has_row(_index, key(id_of("[attendance_cycle]"))))
	var window: RefCounted = DataCore.get_row(_index, key(id_of("[attendance_window]")))
	assert_same(window, GameData.AttendanceRewardTable.get_rows(id_of("[attendance_window]"))[0])


func test_ref_column_keys() -> void:
	assert_false(GameData.is_key_column("iap_product", "sku_apple"))
	assert_true(DataCore.register_build_derived(_hook_ref_columns))
	assert_true(DataCore.build_derived_containers())
	assert_eq(Support.errors(), 1)
	assert_false(DataCore.has_row(_index, key(0)))
	var silver: GameData.RatingTierRow = GameData.RatingTierTable.get_row(id_of("[rating_tier_silver]"))
	var basic: int = id_of("[rating_rule_basic]")
	assert_eq(silver.rule, basic)
	assert_same(DataCore.get_row(_index_2, key(basic, silver.min_rating, 0, 2)), silver)


func test_bad_key_columns_make_empty_containers() -> void:
	assert_true(DataCore.register_build_derived(_hook_bad_columns))
	assert_true(DataCore.build_derived_containers())
	# No key column, four key columns, no table, no column.
	assert_eq(Support.errors(), 4)
	assert_false(DataCore.has_rows(_group, key(id_of("[gold]"))))
	assert_eq(DataCore.get_rows(_group, key(id_of("[gold]"))).size(), 0)
	assert_eq(Support.errors(), 1)


func test_hook_false_fails_the_build() -> void:
	assert_true(DataCore.register_build_derived(_hook_false))
	assert_false(DataCore.build_derived_containers())


func test_throwing_hook_fails_the_build_with_an_error_log() -> void:
	assert_true(DataCore.register_build_derived(_hook_throwing))
	assert_false(DataCore.build_derived_containers())
	assert_eq(UnitTestCore.check_script_errors(), 1, "the hook threw")
	assert_eq(Support.errors(), 1)


func test_build_without_a_hook_succeeds() -> void:
	assert_true(DataCore.build_derived_containers())


func test_make_outside_the_hook_and_second_build_fail() -> void:
	assert_true(DataCore.build_derived_containers())
	var index: DataIndex = DataCore.make_index("rating_tier", PackedStringArray(["min_rating"]))
	assert_eq(Support.errors(), 1)
	var group: DataGroup = DataCore.make_group("rating_tier", PackedStringArray(["rule"]))
	assert_eq(Support.errors(), 1)
	assert_false(DataCore.build_derived_containers())
	assert_eq(Support.errors(), 1)
	var silver: GameData.RatingTierRow = GameData.RatingTierTable.get_row(id_of("[rating_tier_silver]"))
	assert_false(DataCore.has_row(index, key(silver.min_rating)))
	assert_false(DataCore.has_rows(group, key(silver.rule)))


func test_hook_calling_build_again_fails_it() -> void:
	assert_true(DataCore.register_build_derived(_hook_second_build))
	assert_false(DataCore.build_derived_containers())
	assert_eq(Support.errors(), 1)


func test_build_before_load_fails() -> void:
	DataCore.release()
	assert_true(DataCore.init())
	assert_false(DataCore.build_derived_containers())
	assert_eq(Support.errors(), 1)


func test_lookup_before_build_and_after_release_is_missing_data() -> void:
	var before: DataIndex = DataCore.make_index("rating_tier", PackedStringArray(["min_rating"]))
	assert_eq(Support.errors(), 1)
	var silver: GameData.RatingTierRow = GameData.RatingTierTable.get_row(id_of("[rating_tier_silver]"))
	assert_same(DataCore.get_row(before, key(silver.min_rating)), GameData.RatingTierTable.empty_row())
	assert_eq(Support.errors(), 1)
	assert_true(DataCore.register_build_derived(_hook_min_rating_index))
	assert_true(DataCore.build_derived_containers())
	assert_true(DataCore.has_row(_index, key(silver.min_rating)))
	DataCore.release()
	assert_false(DataCore.has_row(_index, key(silver.min_rating)))
	assert_same(DataCore.get_row(_index, key(silver.min_rating)), GameData.RatingTierTable.empty_row())
	assert_eq(Support.errors(), 1)


func test_second_registration_is_ignored_with_an_error_log() -> void:
	assert_true(DataCore.register_build_derived(_hook_min_rating_index))
	assert_false(DataCore.register_build_derived(_hook_false))
	assert_eq(Support.errors(), 1)
	assert_true(DataCore.build_derived_containers())
	assert_not_null(_index)


## `release` leaves DataCore as before its first `init`, so this is the registration before `init` too.
func test_registration_after_release_is_refused_and_its_hook_is_not_called() -> void:
	DataCore.release()
	assert_false(DataCore.register_build_derived(_hook_false))
	assert_eq(Support.errors(), 1)
	assert_true(DataCore.init())
	assert_true(await DataCore.load(null))
	assert_true(DataCore.build_derived_containers())
	assert_eq(Support.errors(), 0)


func test_hook_that_is_not_a_static_func_is_refused() -> void:
	assert_false(DataCore.register_build_derived(func() -> bool: return true))
	assert_false(DataCore.register_build_derived(_hook_false.bind()))
	assert_false(DataCore.register_build_derived(_instance_hook))
	assert_eq(Support.errors(), 3)
	assert_true(DataCore.build_derived_containers())


func _instance_hook() -> bool:
	return false
