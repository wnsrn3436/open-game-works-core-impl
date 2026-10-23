extends RefCounted
## A cached resource and the scopes with a reference to it.

var resource: Resource = null
var reference_count: int = 0
## Instance IDs of the scopes with a reference to it, for the membership check of `ResourceCore._take`.
var scope_ids: Dictionary[int, bool] = {}
## Engine paths the resource file references. Read once when it enters the cache, in a build with DEV code only.
var dependencies: PackedStringArray = PackedStringArray()
