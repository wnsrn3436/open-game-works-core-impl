extends RefCounted
## Ed25519 signing (RFC 8032) for test deploy lists, on the field and point arithmetic of the module's checker.

const _ED25519 = preload("res://core/game_update_core/ed25519.gd")


static func public_key(seed: PackedByteArray) -> PackedByteArray:
	var p: Array[PackedInt64Array] = _ED25519._new_point()
	_ED25519.scalar_base(p, _secret_scalar(_ED25519.sha512(seed)))
	return _ED25519.pack_point(p)


static func sign(seed: PackedByteArray, message: PackedByteArray) -> PackedByteArray:
	var digest: PackedByteArray = _ED25519.sha512(seed)
	var a: PackedByteArray = _secret_scalar(digest)
	var point: Array[PackedInt64Array] = _ED25519._new_point()
	_ED25519.scalar_base(point, a)
	var pk: PackedByteArray = _ED25519.pack_point(point)
	var r_input: PackedByteArray = digest.slice(32, 64)
	r_input.append_array(message)
	var r: PackedByteArray = _ED25519.reduce_scalar(_ED25519.sha512(r_input))
	_ED25519.scalar_base(point, r)
	var big_r: PackedByteArray = _ED25519.pack_point(point)
	var h_input: PackedByteArray = big_r.duplicate()
	h_input.append_array(pk)
	h_input.append_array(message)
	var h: PackedByteArray = _ED25519.reduce_scalar(_ED25519.sha512(h_input))
	var x: PackedInt64Array = PackedInt64Array()
	x.resize(64)
	for i: int in 32:
		x[i] = r[i]
	for i: int in 32:
		for j: int in 32:
			x[i + j] += h[i] * a[j]
	var signature: PackedByteArray = big_r
	signature.append_array(_ED25519.mod_l(x))
	return signature


static func _secret_scalar(digest: PackedByteArray) -> PackedByteArray:
	var a: PackedByteArray = digest.slice(0, 32)
	a[0] &= 248
	a[31] &= 127
	a[31] |= 64
	return a
