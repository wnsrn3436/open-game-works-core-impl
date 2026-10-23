class_name TweenOptions
extends RefCounted
## Options of a `TweenCore.play` or `TweenCore.play_preset` call. The caller may reuse one object for many calls;
## TweenCore reads it when the call is made.

var time_basis: TweenCore.TimeBasis = TweenCore.TimeBasis.REAL_TIME
## Tween tag. An empty string is none.
var tag: String = ""
## Puts an `InputBlockCore` block of reason tag `tween` from the call until the tween ends.
var input_block: bool = false
## Pass list of the input block. `null` is a block without a pass list.
var block_pass_list: BlockPassList = null
## Completion callback. Called once with the `TweenCore.TweenEndReason` when the tween ends. `Callable()` is none.
var callback: Callable = Callable()
