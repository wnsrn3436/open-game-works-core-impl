extends RefCounted
## Ed25519 signature check (RFC 8032) and SHA-512 (FIPS 180-4) for the deploy list signature. The engine
## crypto API has neither. Field elements of GF(2^255 - 19) are 16 limbs of 16 bits in a `PackedInt64Array`;
## points are extended coordinates (X, Y, Z, T) in an `Array[PackedInt64Array]`.
## The field, point and mod L code is a line-by-line port of tweetnacl-js 1.0.3
## (https://github.com/dchest/tweetnacl-js, Unlicense).

const _MASK_32: int = 0xFFFFFFFF
const _MASK_16: int = 0xFFFF
## Group order L as little-endian bytes.
const _L: PackedInt64Array = [
	0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
]
const _D: PackedInt64Array = [
	0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
	0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203,
]
const _D2: PackedInt64Array = [
	0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0,
	0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406,
]
const _X: PackedInt64Array = [
	0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c,
	0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169,
]
const _Y: PackedInt64Array = [
	0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
	0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
]
## sqrt(-1) mod p.
const _I: PackedInt64Array = [
	0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
	0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83,
]
## SHA-512 round constants as (high 32 bits, low 32 bits) pairs.
const _K_HALVES: PackedInt64Array = [
	0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
	0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
	0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
	0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
	0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
	0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
	0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
	0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
	0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
	0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
	0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
	0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
	0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
	0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
	0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
	0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
	0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
	0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
	0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
	0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
]
const _H_HALVES: PackedInt64Array = [
	0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
	0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]

## SHA-512 round constants as 64-bit two's complement values. Filled on first use.
static var _k: PackedInt64Array = PackedInt64Array()


## `true` when `signature` (64 bytes) is the Ed25519 signature of `message` by `public_key` (32 bytes).
## Rejects a scalar S that is not below the group order and a public key that is not a curve point.
static func verify(message: PackedByteArray, signature: PackedByteArray, public_key: PackedByteArray) -> bool:
	if signature.size() != 64 or public_key.size() != 32:
		return false
	if not _is_scalar_canonical(signature.slice(32, 64)):
		return false
	var q: Array[PackedInt64Array] = _new_point()
	if not _unpack_neg(q, public_key):
		return false
	var hash_input: PackedByteArray = signature.slice(0, 32)
	hash_input.append_array(public_key)
	hash_input.append_array(message)
	var h: PackedByteArray = reduce_scalar(sha512(hash_input))
	var p: Array[PackedInt64Array] = _new_point()
	_scalar_mult(p, q, h)
	var b: Array[PackedInt64Array] = _new_point()
	scalar_base(b, signature.slice(32, 64))
	_add(p, b)
	return pack_point(p) == signature.slice(0, 32)


## SHA-512 digest (64 bytes) of `data`.
static func sha512(data: PackedByteArray) -> PackedByteArray:
	if _k.is_empty():
		_k = _join_halves(_K_HALVES)
	var h: PackedInt64Array = _join_halves(_H_HALVES)
	var bit_length: int = data.size() * 8
	var padded: PackedByteArray = data.duplicate()
	padded.append(0x80)
	while padded.size() % 128 != 112:
		padded.append(0)
	for _i: int in 8:
		padded.append(0)
	for i: int in 8:
		padded.append((bit_length >> (56 - 8 * i)) & 0xFF)
	var w: PackedInt64Array = PackedInt64Array()
	w.resize(80)
	for block: int in range(0, padded.size(), 128):
		for t: int in 16:
			var word: int = 0
			for j: int in 8:
				word = (word << 8) | padded[block + t * 8 + j]
			w[t] = word
		for t: int in range(16, 80):
			var x15: int = w[t - 15]
			var x2: int = w[t - 2]
			var s0: int = _rotr(x15, 1) ^ _rotr(x15, 8) ^ _shr(x15, 7)
			var s1: int = _rotr(x2, 19) ^ _rotr(x2, 61) ^ _shr(x2, 6)
			w[t] = w[t - 16] + s0 + w[t - 7] + s1
		var a: int = h[0]
		var b: int = h[1]
		var c: int = h[2]
		var d: int = h[3]
		var e: int = h[4]
		var f: int = h[5]
		var g: int = h[6]
		var hh: int = h[7]
		for t: int in 80:
			var big_s1: int = _rotr(e, 14) ^ _rotr(e, 18) ^ _rotr(e, 41)
			var ch: int = (e & f) ^ (~e & g)
			var t1: int = hh + big_s1 + ch + _k[t] + w[t]
			var big_s0: int = _rotr(a, 28) ^ _rotr(a, 34) ^ _rotr(a, 39)
			var maj: int = (a & b) ^ (a & c) ^ (b & c)
			var t2: int = big_s0 + maj
			hh = g
			g = f
			f = e
			e = d + t1
			d = c
			c = b
			b = a
			a = t1 + t2
		h[0] += a
		h[1] += b
		h[2] += c
		h[3] += d
		h[4] += e
		h[5] += f
		h[6] += g
		h[7] += hh
	var out: PackedByteArray = PackedByteArray()
	out.resize(64)
	for i: int in 8:
		for j: int in 8:
			out[i * 8 + j] = (h[i] >> (56 - 8 * j)) & 0xFF
	return out


## `bytes` (64 bytes, little-endian) reduced modulo the group order L: 32 bytes.
static func reduce_scalar(bytes: PackedByteArray) -> PackedByteArray:
	var x: PackedInt64Array = PackedInt64Array()
	x.resize(64)
	for i: int in 64:
		x[i] = bytes[i]
	return mod_l(x)


## `x` (64 little-endian limbs of at most 8 bits each, or a little more) modulo L: 32 bytes.
static func mod_l(x: PackedInt64Array) -> PackedByteArray:
	var carry: int = 0
	for i: int in range(63, 31, -1):
		carry = 0
		var j: int = i - 32
		while j < i - 12:
			x[j] += carry - 16 * x[i] * _L[j - (i - 32)]
			carry = (x[j] + 128) >> 8
			x[j] -= carry << 8
			j += 1
		x[j] += carry
		x[i] = 0
	carry = 0
	for j: int in 32:
		x[j] += carry - (x[31] >> 4) * _L[j]
		carry = x[j] >> 8
		x[j] &= 255
	for j: int in 32:
		x[j] -= carry * _L[j]
	var r: PackedByteArray = PackedByteArray()
	r.resize(32)
	for i: int in 32:
		x[i + 1] += x[i] >> 8
		r[i] = x[i] & 255
	return r


## Puts scalar `s` (32 bytes, little-endian) times the base point into `p`.
static func scalar_base(p: Array[PackedInt64Array], s: PackedByteArray) -> void:
	var q: Array[PackedInt64Array] = _new_point()
	q[0] = _X.duplicate()
	q[1] = _Y.duplicate()
	q[2] = _gf_one()
	q[3] = _mul(_X, _Y)
	_scalar_mult(p, q, s)


## 32-byte encoding of point `p`.
static func pack_point(p: Array[PackedInt64Array]) -> PackedByteArray:
	var zi: PackedInt64Array = _inv(p[2])
	var tx: PackedInt64Array = _mul(p[0], zi)
	var ty: PackedInt64Array = _mul(p[1], zi)
	var r: PackedByteArray = _pack25519(ty)
	r[31] ^= _parity(tx) << 7
	return r


static func _is_scalar_canonical(s: PackedByteArray) -> bool:
	for i: int in range(31, -1, -1):
		if s[i] < _L[i]:
			return true
		if s[i] > _L[i]:
			return false
	return false


static func _join_halves(halves: PackedInt64Array) -> PackedInt64Array:
	var out: PackedInt64Array = PackedInt64Array()
	out.resize(halves.size() / 2)
	for i: int in out.size():
		out[i] = (halves[i * 2] << 32) | halves[i * 2 + 1]
	return out


## Logical shift right of a 64-bit value.
static func _shr(x: int, n: int) -> int:
	return (x >> n) & ((1 << (64 - n)) - 1)


static func _rotr(x: int, n: int) -> int:
	return ((x >> n) & ((1 << (64 - n)) - 1)) | (x << (64 - n))


static func _new_point() -> Array[PackedInt64Array]:
	var p: Array[PackedInt64Array] = [_gf_zero(), _gf_zero(), _gf_zero(), _gf_zero()]
	return p


static func _gf_zero() -> PackedInt64Array:
	var o: PackedInt64Array = PackedInt64Array()
	o.resize(16)
	return o


static func _gf_one() -> PackedInt64Array:
	var o: PackedInt64Array = _gf_zero()
	o[0] = 1
	return o


static func _carry(o: PackedInt64Array) -> void:
	var c: int = 1
	for i: int in 16:
		var v: int = o[i] + c + 65535
		c = v >> 16
		o[i] = v - (c << 16)
	o[0] += c - 1 + 37 * (c - 1)


## Swaps `p` and `q` limb by limb when `b` is 1; leaves them when `b` is 0.
static func _select(p: PackedInt64Array, q: PackedInt64Array, b: int) -> void:
	var c: int = ~(b - 1)
	for i: int in 16:
		var t: int = c & (p[i] ^ q[i])
		p[i] ^= t
		q[i] ^= t


static func _pack25519(n: PackedInt64Array) -> PackedByteArray:
	var t: PackedInt64Array = n.duplicate()
	_carry(t)
	_carry(t)
	_carry(t)
	var m: PackedInt64Array = _gf_zero()
	for _j: int in 2:
		m[0] = t[0] - 0xffed
		for i: int in range(1, 15):
			m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1)
			m[i - 1] &= _MASK_16
		m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1)
		var b: int = (m[15] >> 16) & 1
		m[14] &= _MASK_16
		_select(t, m, 1 - b)
	var o: PackedByteArray = PackedByteArray()
	o.resize(32)
	for i: int in 16:
		o[2 * i] = t[i] & 0xff
		o[2 * i + 1] = (t[i] >> 8) & 0xff
	return o


static func _not_equal(a: PackedInt64Array, b: PackedInt64Array) -> bool:
	return _pack25519(a) != _pack25519(b)


static func _parity(a: PackedInt64Array) -> int:
	return _pack25519(a)[0] & 1


static func _unpack25519(n: PackedByteArray) -> PackedInt64Array:
	var o: PackedInt64Array = _gf_zero()
	for i: int in 16:
		o[i] = n[2 * i] + (n[2 * i + 1] << 8)
	o[15] &= 0x7fff
	return o


static func _add_gf(a: PackedInt64Array, b: PackedInt64Array) -> PackedInt64Array:
	var o: PackedInt64Array = _gf_zero()
	for i: int in 16:
		o[i] = a[i] + b[i]
	return o


static func _sub_gf(a: PackedInt64Array, b: PackedInt64Array) -> PackedInt64Array:
	var o: PackedInt64Array = _gf_zero()
	for i: int in 16:
		o[i] = a[i] - b[i]
	return o


static func _mul(a: PackedInt64Array, b: PackedInt64Array) -> PackedInt64Array:
	var t: PackedInt64Array = PackedInt64Array()
	t.resize(31)
	for i: int in 16:
		var ai: int = a[i]
		for j: int in 16:
			t[i + j] += ai * b[j]
	for i: int in 15:
		t[i] += 38 * t[i + 16]
	t.resize(16)
	_carry(t)
	_carry(t)
	return t


static func _inv(i: PackedInt64Array) -> PackedInt64Array:
	var c: PackedInt64Array = i.duplicate()
	for a: int in range(253, -1, -1):
		c = _mul(c, c)
		if a != 2 and a != 4:
			c = _mul(c, i)
	return c


static func _pow2523(i: PackedInt64Array) -> PackedInt64Array:
	var c: PackedInt64Array = i.duplicate()
	for a: int in range(250, -1, -1):
		c = _mul(c, c)
		if a != 1:
			c = _mul(c, i)
	return c


## p = p + q.
static func _add(p: Array[PackedInt64Array], q: Array[PackedInt64Array]) -> void:
	var a: PackedInt64Array = _mul(_sub_gf(p[1], p[0]), _sub_gf(q[1], q[0]))
	var b: PackedInt64Array = _mul(_add_gf(p[0], p[1]), _add_gf(q[0], q[1]))
	var c: PackedInt64Array = _mul(_mul(p[3], q[3]), _D2)
	var d: PackedInt64Array = _mul(p[2], q[2])
	d = _add_gf(d, d)
	var e: PackedInt64Array = _sub_gf(b, a)
	var f: PackedInt64Array = _sub_gf(d, c)
	var g: PackedInt64Array = _add_gf(d, c)
	var h: PackedInt64Array = _add_gf(b, a)
	p[0] = _mul(e, f)
	p[1] = _mul(h, g)
	p[2] = _mul(g, f)
	p[3] = _mul(e, h)


static func _swap(p: Array[PackedInt64Array], q: Array[PackedInt64Array], b: int) -> void:
	for i: int in 4:
		_select(p[i], q[i], b)


## p = s × q. Changes `q`.
static func _scalar_mult(p: Array[PackedInt64Array], q: Array[PackedInt64Array], s: PackedByteArray) -> void:
	p[0] = _gf_zero()
	p[1] = _gf_one()
	p[2] = _gf_one()
	p[3] = _gf_zero()
	for i: int in range(255, -1, -1):
		var b: int = (s[i >> 3] >> (i & 7)) & 1
		_swap(p, q, b)
		_add(q, p)
		_add(p, p)
		_swap(p, q, b)


## Decodes `bytes` into the negation of its point. `false` when it is not a curve point.
static func _unpack_neg(r: Array[PackedInt64Array], bytes: PackedByteArray) -> bool:
	r[2] = _gf_one()
	r[1] = _unpack25519(bytes)
	var num: PackedInt64Array = _mul(r[1], r[1])
	var den: PackedInt64Array = _mul(num, _D)
	num = _sub_gf(num, r[2])
	den = _add_gf(r[2], den)
	var den2: PackedInt64Array = _mul(den, den)
	var den4: PackedInt64Array = _mul(den2, den2)
	var den6: PackedInt64Array = _mul(den4, den2)
	var t: PackedInt64Array = _mul(_mul(den6, num), den)
	t = _pow2523(t)
	t = _mul(_mul(_mul(t, num), den), den)
	r[0] = _mul(t, den)
	var chk: PackedInt64Array = _mul(_mul(r[0], r[0]), den)
	if _not_equal(chk, num):
		r[0] = _mul(r[0], _I)
	chk = _mul(_mul(r[0], r[0]), den)
	if _not_equal(chk, num):
		return false
	if _parity(r[0]) == ((bytes[31] >> 7) & 1):
		r[0] = _sub_gf(_gf_zero(), r[0])
	r[3] = _mul(r[0], r[1])
	return true
