class_name FakeSocialAdapter
extends SocialAdapter
## Fake social adapter of every provider and platform. Signs in with no screen and returns `fake:<fake account name>`.
## The name is the one of `set_fake_social_account`, else the `device` value `AuthCore.fake_account`, made as a UUID
## v4 on first use.

const _KEY_FAKE_ACCOUNT: String = "AuthCore.fake_account"


func is_supported(_platform: String) -> bool:
	return true


func sign_in() -> SignInResult:
	var account: String = AuthCore._fake_social_account
	if account.is_empty():
		account = LocalDataCore.get_value_string(LocalDataCore.FileKind.DEVICE, _KEY_FAKE_ACCOUNT, "")
		if account.is_empty():
			account = _uuid_v4()
			LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, _KEY_FAKE_ACCOUNT, account)
	return SignInResult.new(SignInStatus.SUCCESS, "fake:" + account)


static func _uuid_v4() -> String:
	var bytes: PackedByteArray = Crypto.new().generate_random_bytes(16)
	bytes[6] = (bytes[6] & 0x0F) | 0x40
	bytes[8] = (bytes[8] & 0x3F) | 0x80
	var hex: String = bytes.hex_encode()
	return "%s-%s-%s-%s-%s" % [hex.substr(0, 8), hex.substr(8, 4), hex.substr(12, 4), hex.substr(16, 4), hex.substr(20, 12)]
