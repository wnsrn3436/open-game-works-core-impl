extends RefCounted
## Cutscene rows of the core tests that the core test data cannot hold: the data check of the data build rejects them.
## They are added to the built-in `cutscene_step.bin` and `cutscene_choice.bin`, and `CutsceneTestCase.start` loads
## the result as downloaded data. The field numbers are of `CutsceneStepRow` and `CutsceneChoiceRow` in the generated
## data proto.

## The first cutscene ID value of these rows. No core test data cutscene has it or the ones after it.
const FIRST_ID: int = 2000000100

const _STEP_FILE: String = "cutscene_step.bin"
const _CHOICE_FILE: String = "cutscene_choice.bin"
const _VARINT: int = 0
const _BYTES: int = 2

var _steps: PackedByteArray = PackedByteArray()
var _choices: PackedByteArray = PackedByteArray()
var _next_id: int = FIRST_ID


## A new cutscene ID value.
func new_id() -> int:
	var value: int = _next_id
	_next_id += 1
	return value


## A `cutscene_step` row. Empty strings and 0 are the empty values of the columns.
func step(
	id: int,
	number: int,
	command: GameData.CutsceneCommand,
	wait: bool = false,
	actor: String = "",
	target: String = "",
	resource: String = "",
	next_step: int = 0,
	cue: GameData.CutsceneCue = GameData.CutsceneCue.NONE,
	text: String = "",
	voice: String = "",
	animation: String = "",
) -> void:
	var row: PackedByteArray = PackedByteArray()
	_put_int(row, 1, id)
	_put_int(row, 2, number)
	_put_int(row, 3, command)
	_put_int(row, 4, 1 if wait else 0)
	_put_text(row, 5, actor)
	_put_text(row, 6, target)
	_put_text(row, 8, text)
	_put_text(row, 9, resource)
	_put_text(row, 10, animation)
	_put_int(row, 12, cue)
	_put_int(row, 13, next_step)
	_put_text(row, 14, voice)
	_put_row(_steps, row)


## A `cutscene_choice` row. `text` is a translation key of the core test data.
func choice(
	id: int, number: int, choice_number: int, next_step: int, requirement: int = 0, text: String = ""
) -> void:
	var row: PackedByteArray = PackedByteArray()
	_put_int(row, 1, id)
	_put_int(row, 2, number)
	_put_int(row, 3, choice_number)
	_put_text(row, 4, text)
	_put_int(row, 5, next_step)
	_put_int(row, 6, requirement)
	_put_row(_choices, row)


## The replaced table binaries for `CutsceneTestCase.start`: the built-in ones with the rows added.
func tables() -> Dictionary[String, PackedByteArray]:
	var step_bytes: PackedByteArray = DataCoreTestSupport.table_bytes(_STEP_FILE)
	step_bytes.append_array(_steps)
	var choice_bytes: PackedByteArray = DataCoreTestSupport.table_bytes(_CHOICE_FILE)
	choice_bytes.append_array(_choices)
	return {_STEP_FILE: step_bytes, _CHOICE_FILE: choice_bytes}


static func _put_row(table: PackedByteArray, row: PackedByteArray) -> void:
	table.append(_tag(1, _BYTES))
	table.append_array(DataCoreTestSupport.varint(row.size()))
	table.append_array(row)


static func _put_int(row: PackedByteArray, field: int, value: int) -> void:
	if value == 0:
		return
	row.append(_tag(field, _VARINT))
	row.append_array(DataCoreTestSupport.varint(value))


static func _put_text(row: PackedByteArray, field: int, value: String) -> void:
	if value.is_empty():
		return
	var bytes: PackedByteArray = value.to_utf8_buffer()
	row.append(_tag(field, _BYTES))
	row.append_array(DataCoreTestSupport.varint(bytes.size()))
	row.append_array(bytes)


static func _tag(field: int, wire_type: int) -> int:
	return (field << 3) | wire_type
