#!/bin/sh
# Builds `dist/macos/` of the `ogw-secure-storage` plugin on a Mac host.
#   ./build.sh <work folder>
# The work folder gets the godot-cpp checkout below once. Needs Xcode and SCons.
set -eu

GODOT_CPP_COMMIT="2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec"

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <work folder>" >&2
	exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$1"
WORK="$(cd "$1" && pwd)"
GODOT_CPP="$WORK/godot-cpp"
# Source paths compiled into the library (`__FILE__`) start with `.` instead of the folders of this host.
PREFIX_MAPS="$WORK=.;$HERE=."

if [ ! -d "$GODOT_CPP" ]; then
	git clone --quiet https://github.com/godotengine/godot-cpp "$GODOT_CPP"
fi
git -C "$GODOT_CPP" checkout --quiet "$GODOT_CPP_COMMIT"

DIST="$HERE/dist"
rm -rf "$DIST"

# macos: GDExtension library.
(cd "$HERE/macos" && scons --quiet platform=macos target=template_release arch=universal godot_cpp="$GODOT_CPP" file_prefix_maps="$PREFIX_MAPS")
MACOS_OUT="$DIST/macos/addons/ogw-secure-storage"
mkdir -p "$MACOS_OUT/macos"
cp "$HERE/macos/ogw-secure-storage.gdextension" "$MACOS_OUT/"
cp "$HERE/macos/bin/libogw-secure-storage.macos.dylib" "$MACOS_OUT/macos/"
