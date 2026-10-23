class_name ShareContent
extends RefCounted
## Content of `NativeUiCore.share`.

## Sentence shown to people, already translated by the caller. Empty for none.
var text: String = ""
## PNG bytes. Empty for no image.
var image: PackedByteArray = PackedByteArray()
