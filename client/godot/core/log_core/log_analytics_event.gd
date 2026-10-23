class_name LogAnalyticsEvent
extends RefCounted
## One analytics event `LogCore.track_event` put in the event queue (the spec's `AnalyticsEvent`).

var name: String = ""
## Device time of the `track_event` call. Unix ms.
var time: int = 0
var params: Array[LogEventParam] = []
