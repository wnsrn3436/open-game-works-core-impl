extends RefCounted
## One engine load of a resource key. Every request of the key while it runs waits for `finished`.

signal finished

var key: String = ""
## Engine paths of the key's variants, from variant 1. One path for a key with one variant.
var paths: PackedStringArray = PackedStringArray()
## True once the load ended. A request that comes after does not wait.
var done: bool = false
## Loaded resource: the resource of the one path, or a `ResourceVariants` of every path. `null` until the load ends
## and when it failed.
var resource: Resource = null
## Path whose engine load failed. Empty while the load runs and when it succeeded.
var failed_path: String = ""
