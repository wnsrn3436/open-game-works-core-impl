extends RefCounted
## A BGM SoundCore records: the current BGM, the previous BGM or the BGM of a pending `play_bgm` or `return_bgm`.

var key: String = ""
var scope: Scope = null
## Owner object of the BGM scope when the request omitted the scope. `null` when the caller gave the scope or the
## BGM scope has ended.
var owner: Node = null
