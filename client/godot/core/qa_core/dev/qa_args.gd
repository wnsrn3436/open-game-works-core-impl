extends RefCounted
## Argument grammar of the `QACore` commands. Arguments are external input: every check reads the whole string.

const _DIGITS: String = "0123456789"
const _MAX_INT_DIGITS: int = 18
## Characters of the name between the brackets of an ID name.
const _ID_NAME_CHARS: String = "abcdefghijklmnopqrstuvwxyz0123456789_"
## Largest integer a double holds exactly: 2^53 − 1.
const MAX_SAFE_INTEGER: int = 9007199254740991


## Integer: `-?[0-9]{1,18}`.
static func is_int(text: String) -> bool:
	var start: int = 1 if text.begins_with("-") else 0
	var digits: int = text.length() - start
	if digits < 1 or digits > _MAX_INT_DIGITS:
		return false
	return _only_digits(text, start, text.length())


static func to_int(text: String) -> int:
	return text.to_int()


## Real: `-?[0-9]+(\.[0-9]+)?`.
static func is_real(text: String) -> bool:
	var start: int = 1 if text.begins_with("-") else 0
	var dot: int = text.find(".", start)
	if dot < 0:
		return text.length() > start and _only_digits(text, start, text.length())
	return dot > start and dot < text.length() - 1 and _only_digits(text, start, dot) \
		and _only_digits(text, dot + 1, text.length())


static func to_real(text: String) -> float:
	return text.to_float()


## A non-negative integer of at most 18 digits.
static func is_count(text: String) -> bool:
	return is_int(text) and not text.begins_with("-")


## An integer of at least `min_value`.
static func is_int_at_least(text: String, min_value: int) -> bool:
	return is_int(text) and to_int(text) >= min_value


## An ID name: `[` + snake_case characters + `]`.
static func is_id_name(text: String) -> bool:
	if text.length() < 3 or not text.begins_with("[") or not text.ends_with("]"):
		return false
	for i: int in range(1, text.length() - 1):
		if _ID_NAME_CHARS.find(text[i]) < 0:
			return false
	return true


## A non-negative big integer in canonical decimal form: `0` or `[1-9][0-9]*`.
static func is_big_count(text: String) -> bool:
	if text.is_empty() or not _only_digits(text, 0, text.length()):
		return false
	return text == "0" or not text.begins_with("0")


## Whether the canonical non-negative decimal `text` is at most 2^53 − 1.
static func is_safe_integer(text: String) -> bool:
	var limit: String = str(MAX_SAFE_INTEGER)
	if text.length() != limit.length():
		return text.length() < limit.length()
	return text <= limit


static func _only_digits(text: String, from: int, to: int) -> bool:
	for i: int in range(from, to):
		if _DIGITS.find(text[i]) < 0:
			return false
	return true
