extends "res://core/auth_core/adapters/tracking_adapter.gd"
## Tracking state of the core tests.

var status: CoreContract.TrackingStatus = CoreContract.TrackingStatus.TRACKING_STATUS_NOT_DETERMINED
var answer: CoreContract.TrackingStatus = CoreContract.TrackingStatus.TRACKING_STATUS_AUTHORIZED
var request_count: int = 0


func get_status() -> CoreContract.TrackingStatus:
	return status


func request() -> CoreContract.TrackingStatus:
	request_count += 1
	await (Engine.get_main_loop() as SceneTree).process_frame
	status = answer
	return status
