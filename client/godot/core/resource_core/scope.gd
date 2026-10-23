class_name Scope
extends RefCounted
## A `ResourceCore` scope: the resource keys it holds a reference to. Only `ResourceCore` changes it.

## Scope kind.
var kind: ResourceCore.ScopeKind = ResourceCore.ScopeKind.GLOBAL
## `global`, the resource key of a scene, panel or popup scope, or the owner object's name.
var name: String = ""
## True from the start of the release on. A released scope does not come back.
var released: bool = false
## Resource keys of this scope's references, in reference order.
var keys: PackedStringArray = PackedStringArray()
