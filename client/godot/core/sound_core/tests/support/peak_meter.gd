extends Node
## Records the highest peak of the `Master` bus output, in dB, over the frames it runs.

var max_peak_db: float = -INF


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(_delta: float) -> void:
	var index: int = AudioServer.get_bus_index(&"Master")
	for channel: int in AudioServer.get_bus_channels(index):
		max_peak_db = maxf(max_peak_db, AudioServer.get_bus_peak_volume_left_db(index, channel))
		max_peak_db = maxf(max_peak_db, AudioServer.get_bus_peak_volume_right_db(index, channel))
