extends RefCounted
## One file of a test deploy list patch entry, with its bytes.

var name: String = ""
var body: PackedByteArray = PackedByteArray()
var size: int = 0
var sha256: String = ""
var language: String = ""
var bundle: String = ""
## Raw JSON text put for `size` instead of the number. Empty: the number.
var size_json: String = ""
