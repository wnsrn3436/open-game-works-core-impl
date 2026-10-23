extends RefCounted
## A resource kind: its engine type and its fallback resource.

## Native class or script the kind check tests with `is_instance_of`.
var type: Object = null
var fallback: Resource = null
