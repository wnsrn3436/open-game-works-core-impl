extends GutHookScript
## GUT post-run hook: ends the run, sends the result to the test host, `release`s `UnitTestCore`, tells the test host
## that the release ended and sets the exit code: 0 when every test passed or skipped, there is a test and no run
## failure, 1 otherwise.


func run() -> void:
	var code: int = await UnitTestCore._end_run()
	set_exit_code(code)
