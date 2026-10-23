extends UnitTestCase
## The Ed25519 checker and SHA-512 the deploy list signature check uses, against RFC 8032 and FIPS 180-4 vectors.

const _ED25519 = preload("res://core/game_update_core/ed25519.gd")
const _SIGNER = preload("res://core/game_update_core/tests/support/ed25519_signer.gd")

## RFC 8032 section 7.1 tests 1 to 3: secret key, public key, message, signature.
const _VECTORS: PackedStringArray = [
	"9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
	"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
	"",
	"e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
	"4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
	"3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
	"72",
	"92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
	"c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
	"fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
	"af82",
	"6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
]


func test_rfc_8032_vectors_verify_and_sign() -> void:
	for i: int in range(0, _VECTORS.size(), 4):
		var secret: PackedByteArray = _VECTORS[i].hex_decode()
		var public: PackedByteArray = _VECTORS[i + 1].hex_decode()
		var message: PackedByteArray = _VECTORS[i + 2].hex_decode()
		var signature: PackedByteArray = _VECTORS[i + 3].hex_decode()
		assert_true(_ED25519.verify(message, signature, public), "vector %d verifies" % (i / 4 + 1))
		assert_eq(_SIGNER.public_key(secret), public)
		assert_eq(_SIGNER.sign(secret, message), signature)


func test_changed_message_signature_or_key_fails() -> void:
	var public: PackedByteArray = _VECTORS[5].hex_decode()
	var message: PackedByteArray = _VECTORS[6].hex_decode()
	var signature: PackedByteArray = _VECTORS[7].hex_decode()
	var changed_signature: PackedByteArray = signature.duplicate()
	changed_signature[10] ^= 1
	var changed_key: PackedByteArray = public.duplicate()
	changed_key[3] ^= 1
	assert_false(_ED25519.verify("s".to_utf8_buffer(), signature, public))
	assert_false(_ED25519.verify(message, changed_signature, public))
	assert_false(_ED25519.verify(message, signature, changed_key))
	assert_false(_ED25519.verify(message, signature.slice(0, 63), public))


func test_scalar_not_below_group_order_fails() -> void:
	var public: PackedByteArray = _VECTORS[1].hex_decode()
	var signature: PackedByteArray = _VECTORS[3].hex_decode()
	var order: PackedByteArray = "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010".hex_decode()
	var s_plus_l: PackedByteArray = signature.slice(0, 32)
	var carry: int = 0
	for i: int in 32:
		var sum: int = signature[32 + i] + order[i] + carry
		s_plus_l.append(sum & 0xFF)
		carry = sum >> 8
	assert_false(_ED25519.verify(PackedByteArray(), s_plus_l, public))


func test_sha512_vectors() -> void:
	assert_eq(_ED25519.sha512("abc".to_utf8_buffer()).hex_encode(),
			"ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f")
	assert_eq(_ED25519.sha512(PackedByteArray()).hex_encode(),
			"cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e")
	var two_blocks: String = "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"
	assert_eq(_ED25519.sha512(two_blocks.to_utf8_buffer()).hex_encode(),
			"8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909")
