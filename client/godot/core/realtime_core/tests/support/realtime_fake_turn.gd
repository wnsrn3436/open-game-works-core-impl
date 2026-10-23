class_name RealtimeFakeTurn
extends Node
## Test TURN server (RFC 5766 over UDP) on `127.0.0.1`, read every frame. It answers an `Allocate` without credentials
## with `401` and a nonce, and an `Allocate` with long-term credentials with a relayed address, so the ICE agent of the
## client gathers a relay candidate. It relays no data: `Refresh`, `CreatePermission` and `ChannelBind` get a success
## response and nothing else happens.

const USERNAME: String = "relay-user-secret-name"
const CREDENTIAL: String = "relay-credential-secret"
const REALM: String = "ogw-test"
const NONCE: String = "ogw-test-nonce"

const _MAGIC_COOKIE: int = 0x2112A442
const _HEADER_SIZE: int = 20
const _METHOD_ALLOCATE: int = 0x0003
const _METHOD_REFRESH: int = 0x0004
const _METHOD_CREATE_PERMISSION: int = 0x0008
const _METHOD_CHANNEL_BIND: int = 0x0009
const _CLASS_SUCCESS: int = 0x0100
const _CLASS_ERROR: int = 0x0110
const _ATTR_USERNAME: int = 0x0006
const _ATTR_MESSAGE_INTEGRITY: int = 0x0008
const _ATTR_ERROR_CODE: int = 0x0009
const _ATTR_LIFETIME: int = 0x000D
const _ATTR_REALM: int = 0x0014
const _ATTR_NONCE: int = 0x0015
const _ATTR_XOR_RELAYED_ADDRESS: int = 0x0016
const _ATTR_XOR_MAPPED_ADDRESS: int = 0x0020
const _LIFETIME_S: int = 600

## `Allocate` requests answered with a relayed address.
var allocations: int = 0
var _socket: PacketPeerUDP = PacketPeerUDP.new()
var _port: int = 0


func start() -> bool:
	if _socket.bind(0, "127.0.0.1") != OK:
		return false
	_port = _socket.get_local_port()
	return true


## The TURN URL of this server for a `TransportRelay`.
func url() -> String:
	return "turn:127.0.0.1:%d" % _port


func _process(_delta: float) -> void:
	poll()


func _exit_tree() -> void:
	_socket.close()


func poll() -> void:
	while _socket.get_available_packet_count() > 0:
		var packet: PackedByteArray = _socket.get_packet()
		var ip: String = _socket.get_packet_ip()
		var port: int = _socket.get_packet_port()
		var reply: PackedByteArray = _answer(packet, ip, port)
		if not reply.is_empty() and _socket.set_dest_address(ip, port) == OK:
			_socket.put_packet(reply)


## The response to `packet` from `ip`:`port`, or empty for a packet that is not a STUN request this server answers.
func _answer(packet: PackedByteArray, ip: String, port: int) -> PackedByteArray:
	if packet.size() < _HEADER_SIZE or (packet[0] & 0xC0) != 0 or _read_u32(packet, 4) != _MAGIC_COOKIE:
		return PackedByteArray()
	var message_type: int = _read_u16(packet, 0)
	if (message_type & _CLASS_ERROR) != 0:
		return PackedByteArray()
	var transaction: PackedByteArray = packet.slice(8, _HEADER_SIZE)
	var method: int = message_type & 0x3EEF
	if method == _METHOD_ALLOCATE:
		if not _has_attribute(packet, _ATTR_MESSAGE_INTEGRITY):
			return _unauthorized(transaction)
		allocations += 1
		var attributes: PackedByteArray = PackedByteArray()
		attributes.append_array(_xor_address(_ATTR_XOR_RELAYED_ADDRESS, "127.0.0.1", _port + 1))
		attributes.append_array(_xor_address(_ATTR_XOR_MAPPED_ADDRESS, ip, port))
		attributes.append_array(_attribute(_ATTR_LIFETIME, _u32(_LIFETIME_S)))
		return _signed(method | _CLASS_SUCCESS, transaction, attributes)
	if method == _METHOD_REFRESH or method == _METHOD_CREATE_PERMISSION or method == _METHOD_CHANNEL_BIND:
		var lifetime: PackedByteArray = PackedByteArray()
		if method == _METHOD_REFRESH:
			lifetime = _attribute(_ATTR_LIFETIME, _u32(_LIFETIME_S))
		return _signed(method | _CLASS_SUCCESS, transaction, lifetime)
	return PackedByteArray()


## The `401 Unauthorized` error response of an `Allocate` without credentials, with the realm and the nonce.
func _unauthorized(transaction: PackedByteArray) -> PackedByteArray:
	var code: PackedByteArray = PackedByteArray([0, 0, 4, 1])
	code.append_array("Unauthorized".to_utf8_buffer())
	var attributes: PackedByteArray = _attribute(_ATTR_ERROR_CODE, code)
	attributes.append_array(_attribute(_ATTR_REALM, REALM.to_utf8_buffer()))
	attributes.append_array(_attribute(_ATTR_NONCE, NONCE.to_utf8_buffer()))
	return _message(_METHOD_ALLOCATE | _CLASS_ERROR, transaction, attributes, 0)


## A message of `attributes` and a `MESSAGE-INTEGRITY` of the long-term credential key.
func _signed(message_type: int, transaction: PackedByteArray, attributes: PackedByteArray) -> PackedByteArray:
	var unsigned: PackedByteArray = _message(message_type, transaction, attributes, 24)
	var md5: HashingContext = HashingContext.new()
	md5.start(HashingContext.HASH_MD5)
	md5.update(("%s:%s:%s" % [USERNAME, REALM, CREDENTIAL]).to_utf8_buffer())
	var hmac: HMACContext = HMACContext.new()
	hmac.start(HashingContext.HASH_SHA1, md5.finish())
	hmac.update(unsigned)
	unsigned.append_array(_attribute(_ATTR_MESSAGE_INTEGRITY, hmac.finish()))
	return unsigned


## The header and `attributes`. The header length counts `extra` bytes more, for a `MESSAGE-INTEGRITY` added after.
func _message(message_type: int, transaction: PackedByteArray, attributes: PackedByteArray, extra: int) -> PackedByteArray:
	var bytes: PackedByteArray = _u16(message_type)
	bytes.append_array(_u16(attributes.size() + extra))
	bytes.append_array(_u32(_MAGIC_COOKIE))
	bytes.append_array(transaction)
	bytes.append_array(attributes)
	return bytes


func _attribute(attribute_type: int, value: PackedByteArray) -> PackedByteArray:
	var bytes: PackedByteArray = _u16(attribute_type)
	bytes.append_array(_u16(value.size()))
	bytes.append_array(value)
	while bytes.size() % 4 != 0:
		bytes.append(0)
	return bytes


## An IPv4 XOR address attribute.
func _xor_address(attribute_type: int, ip: String, port: int) -> PackedByteArray:
	var value: PackedByteArray = PackedByteArray([0, 1])
	value.append_array(_u16(port ^ (_MAGIC_COOKIE >> 16)))
	var parts: PackedStringArray = ip.split(".")
	var address: int = 0
	for part: String in parts:
		address = (address << 8) | (part.to_int() & 0xFF)
	value.append_array(_u32(address ^ _MAGIC_COOKIE))
	return _attribute(attribute_type, value)


func _has_attribute(packet: PackedByteArray, attribute_type: int) -> bool:
	var end: int = mini(packet.size(), _HEADER_SIZE + _read_u16(packet, 2))
	var at: int = _HEADER_SIZE
	while at + 4 <= end:
		if _read_u16(packet, at) == attribute_type:
			return true
		at += 4 + ((_read_u16(packet, at + 2) + 3) & ~3)
	return false


static func _read_u16(bytes: PackedByteArray, at: int) -> int:
	return (bytes[at] << 8) | bytes[at + 1]


static func _read_u32(bytes: PackedByteArray, at: int) -> int:
	return (_read_u16(bytes, at) << 16) | _read_u16(bytes, at + 2)


static func _u16(value: int) -> PackedByteArray:
	return PackedByteArray([(value >> 8) & 0xFF, value & 0xFF])


static func _u32(value: int) -> PackedByteArray:
	return PackedByteArray([(value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF])
