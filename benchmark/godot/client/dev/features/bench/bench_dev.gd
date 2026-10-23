class_name BenchDev
extends RefCounted
## DEV registration of the bench feature: the automation commands, the invariant, the content state and the
## `Goal` mark. The lambdas hold the one `BenchBot` of this boot until QACore releases them.


static func register() -> void:
	var bot: BenchBot = BenchBot.new()
	QACore.register_command("bench.bot_next_input", "Returns the next input of the benchmark cycle.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return bot.next_input(args))
	QACore.register_command("bench.open_title", "Opens the title scene.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return await bot.open_title(args))
	QACore.register_command("bench.open_lobby", "Opens the lobby scene with its root panel on top.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return await bot.open_lobby(args))
	QACore.register_command("bench.open_info", "Opens the tick panel over the lobby.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return await bot.open_info(args))
	QACore.register_command("bench.open_option", "Opens the option panel over the lobby.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return await bot.open_option(args))
	QACore.register_command("bench.open_arena", "Opens the arena scene.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return await bot.open_arena(args))
	QACore.register_command("bench.open_notice", "Opens the notice popup over the arena.", PackedStringArray(),
		func(args: PackedStringArray) -> RunCommandResult: return await bot.open_notice(args))
	QACore.register_invariant("bench.tick_count_in_range", func() -> bool: return bot.tick_count_in_range())
	QACore.set_content_state(func() -> String: return bot.content_state())
	EventCore.subscribe(BenchCycleCompletedEvent, bot.on_cycle_completed)
