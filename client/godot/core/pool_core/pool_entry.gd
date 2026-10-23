extends RefCounted
## `PoolCore` record of one pool object.

enum State { IDLE, BORROWED, RETURNING }
## Where an owner-bound instance was when it last left the scene tree during this borrow.
enum Exit { NONE, UNDER_OWNER, OUTSIDE_OWNER }

## The pool that made the instance.
var pool: RefCounted = null
var state: State = State.IDLE
## Generation number. Goes up by 1 when the instance is taken back.
var generation: int = 0
## Auto-return or manual-return, read once when the instance was made.
var auto_return: bool = false
## Index in the idle list or the borrowed list of the pool, by `state`.
var index: int = -1
## The owner binding while the instance is an owner-bound borrow, or null.
var owner: RefCounted = null
## Index in the item list of `owner`.
var owner_index: int = -1
## Whether the instance was under its owner object when it last left the scene tree during this owner-bound borrow.
var exit: Exit = Exit.NONE
## Constituent objects: the instance and the objects under it when it was made. The instance is first.
var parts: Array[Node] = []
## Visibility and position of the instance when it was made.
var visible: bool = true
var position_2d: Vector2 = Vector2.ZERO
var position_3d: Vector3 = Vector3.ZERO
