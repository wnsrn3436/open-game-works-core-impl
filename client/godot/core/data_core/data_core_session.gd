extends RefCounted
## One `init` of `DataCore`. An async operation keeps the session it started in and stops when it resumes in another.

## Resumes the operation that waits on this session.
signal resumed


func resume() -> void:
	resumed.emit()
