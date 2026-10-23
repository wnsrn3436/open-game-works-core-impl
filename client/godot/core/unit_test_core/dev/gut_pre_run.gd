extends GutHookScript
## GUT pre-run hook: reads the test run config, `init`s `UnitTestCore`, starts the run and its time limit timer, and
## hides the GUT runner GUI for the run. When
## `init` fails, sends a result with that run failure and ends the GUT run with exit code 1 before any test.


# ogw:input_boundary
func run() -> void:
	var main: Variant = gut
	if not main is GutMain:
		return
	var gut_main: GutMain = main
	var config := UnitTestCore._read_run_config()
	if UnitTestCore.init():
		UnitTestCore._begin_run(gut_main, config)
		return
	await UnitTestCore._send_init_failure(config)
	# GUT takes the exit code of an aborted run from the post-run hook, which it does not run.
	var post: Variant = gut_main.get_post_run_script_instance()
	if post is GutHookScript:
		var post_hook: GutHookScript = post
		post_hook.set_exit_code(1)
	abort()
