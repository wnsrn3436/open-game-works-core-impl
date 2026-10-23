class_name RealtimeDevTransport
extends RealtimeTransport
## Base of the DEV transports: the transports that take the transport DEV operations `force_close_peer` and
## `force_close_matchmaker`. STG and PROD builds have no DEV transport.


## Closes the connection with a participant without a leave notice. The next `poll` adds its peer lost.
func force_close_peer(_index: int) -> void:
	pass


## Closes the matchmaker connection without `MATCH_LEAVE`. The next `poll` adds a matchmaker lost.
func force_close_matchmaker() -> void:
	pass
