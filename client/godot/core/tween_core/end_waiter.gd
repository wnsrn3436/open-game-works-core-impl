extends RefCounted
## What `TweenCore.wait_end` waits for: the end of one tween.

signal done

var reason: TweenCore.TweenEndReason = TweenCore.TweenEndReason.NONE
