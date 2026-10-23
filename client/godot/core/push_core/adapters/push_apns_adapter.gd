class_name PushApnsAdapter
extends "res://core/push_core/adapters/native_push_adapter.gd"
## Real push adapter of `ios`, adapter key `push-apns` value `push-apns` or `push-apns-sandbox`: remote notification
## registration and receipt through the `ogw-push-apns` plugin singleton. The `aps-environment` entitlement of the
## build picks the APNs production or sandbox environment.

const _SINGLETON: String = "OgwPushApns"


func _init() -> void:
	super(_SINGLETON)
