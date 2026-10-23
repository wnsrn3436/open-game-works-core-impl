extends RefCounted
## One file of a deploy list patch entry: a `data_files`, `translation_files` or `bundle_files` item.

var name: String = ""
var size: int = 0
var sha256: String = ""
## `translation_files` only: the language `code`.
var language: String = ""
## `bundle_files` only: the bundle name.
var bundle: String = ""
