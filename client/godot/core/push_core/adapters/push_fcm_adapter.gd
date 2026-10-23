class_name PushFcmAdapter
extends "res://core/push_core/adapters/native_push_adapter.gd"
## Real push adapter of `android`, adapter key `push-fcm` value `push-fcm`: Firebase Cloud Messaging through the
## `ogw-push-fcm` plugin singleton.

const _SINGLETON: String = "OgwPushFcm"


func _init() -> void:
	super(_SINGLETON)
