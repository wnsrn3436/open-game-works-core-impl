class_name UtilRandom
extends RefCounted
## Random instance: one PCG32 sequence made from one seed (`UtilCore` `### PCG32 algorithm`). Make it with
## `UtilCore.create_random` and draw from it with the `UtilCore` random operations.
##
## The unsigned 64-bit values of the algorithm are kept as two 32-bit halves so that every intermediate value fits in
## a non-negative int64 and no operation relies on signed overflow.

const _MASK32: int = 0xFFFFFFFF
const _MASK16: int = 0xFFFF
const _TWO_32: int = 0x100000000
const _SIGN_32: int = 0x80000000
const _MULTIPLIER_HI: int = 0x5851F42D
const _MULTIPLIER_LO: int = 0x4C957F2D
const _FNV_OFFSET_HI: int = 0xCBF29CE4
const _FNV_OFFSET_LO: int = 0x84222325
const _FNV_PRIME_HI: int = 0x100
const _FNV_PRIME_LO: int = 0x1B3

## High 32 bits of the state.
var _state_hi: int = 0
## Low 32 bits of the state.
var _state_lo: int = 0


## `create_random(seed)`: state = 0; step(); state = state + seed_value; step().
func _init(seed_value: int) -> void:
	_step()
	var lo: int = _state_lo + (seed_value & _MASK32)
	_state_hi = (_state_hi + ((seed_value >> 32) & _MASK32) + (lo >> 32)) & _MASK32
	_state_lo = lo & _MASK32
	_step()


## PCG32 `step()`. Returns 0 or more and less than 2^32.
func _step() -> int:
	var old_hi: int = _state_hi
	var old_lo: int = _state_lo
	var lo: int = _mul_lo32(old_lo, _MULTIPLIER_LO) + 1
	var hi: int = _mul_hi32(old_lo, _MULTIPLIER_LO) + _mul_lo32(old_hi, _MULTIPLIER_LO) + _mul_lo32(old_lo, _MULTIPLIER_HI)
	_state_hi = (hi + (lo >> 32)) & _MASK32
	_state_lo = lo & _MASK32
	# x = (((old >> 18) xor old) >> 27) mod 2^32
	var shifted_hi: int = (old_hi >> 18) ^ old_hi
	var shifted_lo: int = (((old_lo >> 18) | (old_hi << 14)) & _MASK32) ^ old_lo
	var x: int = ((shifted_lo >> 27) | (shifted_hi << 5)) & _MASK32
	var r: int = old_hi >> 27
	return ((x >> r) | (x << ((32 - r) & 31))) & _MASK32


## PCG32 `bounded(b)` for 1 <= b <= 2^32: 0 or more and less than b.
func _bounded(b: int) -> int:
	var t: int = (_TWO_32 - b) % b
	while true:
		var v: int = _step()
		if v >= t:
			return v % b
	return 0


## `make_purpose_seed(name, base)`: FNV-1a 64 of the UTF-8 bytes of name, xor base, read as a two's complement int64.
static func _purpose_seed(purpose_name: String, base: int) -> int:
	var hi: int = _FNV_OFFSET_HI
	var lo: int = _FNV_OFFSET_LO
	for c: int in purpose_name.to_utf8_buffer():
		lo = lo ^ c
		var next_hi: int = _mul_hi32(lo, _FNV_PRIME_LO) + _mul_lo32(hi, _FNV_PRIME_LO) + _mul_lo32(lo, _FNV_PRIME_HI)
		lo = _mul_lo32(lo, _FNV_PRIME_LO)
		hi = next_hi & _MASK32
	hi = hi ^ ((base >> 32) & _MASK32)
	lo = lo ^ (base & _MASK32)
	if hi >= _SIGN_32:
		return (hi - _TWO_32) * _TWO_32 + lo
	return hi * _TWO_32 + lo


## (x × y) mod 2^32 for 0 <= x, y < 2^32.
static func _mul_lo32(x: int, y: int) -> int:
	var x0: int = x & _MASK16
	var x1: int = x >> 16
	var y0: int = y & _MASK16
	var y1: int = y >> 16
	return (x0 * y0 + (((x1 * y0 + x0 * y1) & _MASK16) << 16)) & _MASK32


## floor(x × y ÷ 2^32) for 0 <= x, y < 2^32.
static func _mul_hi32(x: int, y: int) -> int:
	var x0: int = x & _MASK16
	var x1: int = x >> 16
	var y0: int = y & _MASK16
	var y1: int = y >> 16
	var middle: int = x1 * y0 + x0 * y1
	var low: int = x0 * y0 + ((middle & _MASK16) << 16)
	return x1 * y1 + (middle >> 16) + (low >> 32)
