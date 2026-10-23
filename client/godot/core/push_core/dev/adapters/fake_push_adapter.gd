class_name FakePushAdapter
extends PushAdapter
## Fake push adapter. The device token is `fake:<install ID>` on `android` and `ios` and empty elsewhere, since server
## `push` takes no registration of another platform. The install ID is a UUID v4 made on first use and kept in the
## `device` value `PushCore.install_id`. The launch push is the one `PushCoreDev.set_fake_launch_push` put in.

const _KEY_INSTALL_ID: String = "PushCore.install_id"
const _FAKE_PREFIX: String = "fake:"

## Launch push the next `take_launch_push` gives, 0 for none. Process state: it outlives `PushCore.release` and the
## adapter object, as the launch push of a real adapter does.
static var _launch_push: int = 0


func get_device_token() -> String:
	var platform: String = CoreBuildInfo.platform
	if platform != "android" and platform != "ios":
		return ""
	var install_id: String = LocalDataCore.get_value_string(LocalDataCore.FileKind.DEVICE, _KEY_INSTALL_ID, "")
	if install_id.is_empty():
		install_id = _uuid_v4()
		LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, _KEY_INSTALL_ID, install_id)
	return _FAKE_PREFIX + install_id


func take_launch_push() -> int:
	var message_id: int = _launch_push
	_launch_push = 0
	return message_id


static func _uuid_v4() -> String:
	var bytes: PackedByteArray = Crypto.new().generate_random_bytes(16)
	bytes[6] = (bytes[6] & 0x0F) | 0x40
	bytes[8] = (bytes[8] & 0x3F) | 0x80
	var hex: String = bytes.hex_encode()
	return "%s-%s-%s-%s-%s" % [hex.substr(0, 8), hex.substr(8, 4), hex.substr(12, 4), hex.substr(16, 4), hex.substr(20, 12)]
