class_name RecoverySummary
extends RefCounted
## Transactions a recovery or `restore_purchases` processed, counted by verify result. Skipped transactions are not
## counted.

var granted: int = 0
var already_granted: int = 0
var invalid: int = 0
var other_user: int = 0
var pending: int = 0
var failed: int = 0
