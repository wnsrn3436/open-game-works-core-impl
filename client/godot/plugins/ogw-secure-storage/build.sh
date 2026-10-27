#!/bin/sh
# Builds `dist/<platform>/` of the `ogw-secure-storage` plugin for android, ios, macos, windows and linux on a Mac host.
#   ./build.sh <work folder>
# The work folder gets the Godot source and godot-cpp checkouts below once. Needs Xcode, SCons, JDK 17 (`JAVA_HOME`),
# the Android SDK (`ANDROID_HOME`), MinGW-w64 (`x86_64-w64-mingw32-g++`) for windows, and Docker for linux: the linux
# libraries are built in a Debian 11 container (glibc 2.31) of each architecture.
set -eu

GODOT_TAG="4.7.2-stable"
GODOT_CPP_COMMIT="2bb1acf6f8ae1ce96ac7b9ba3a10b499c59c49ec"
# Defines of the official iOS export templates that the engine headers this plugin includes depend on.
IOS_DEFINES="IOS_ENABLED APPLE_EMBEDDED_ENABLED UNIX_ENABLED COREAUDIO_ENABLED THREADS_ENABLED MINIZIP_ENABLED BROTLI_ENABLED"
LINUX_IMAGE="debian:bullseye"
# Debian 11 packages moved to the Debian archive.
LINUX_SOURCES="deb http://archive.debian.org/debian bullseye main\ndeb http://archive.debian.org/debian-security bullseye-security main"

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <work folder>" >&2
	exit 2
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$1"
WORK="$(cd "$1" && pwd)"
GODOT="$WORK/godot"
GODOT_CPP="$WORK/godot-cpp"
# Source paths compiled into the libraries (`__FILE__`) start with `.` instead of the folders of this host.
PREFIX_MAPS="$WORK=.;$HERE=."

if [ ! -d "$GODOT" ]; then
	git clone --quiet --depth 1 --branch "$GODOT_TAG" https://github.com/godotengine/godot "$GODOT"
fi
if [ ! -d "$GODOT_CPP" ]; then
	git clone --quiet https://github.com/godotengine/godot-cpp "$GODOT_CPP"
fi
git -C "$GODOT_CPP" checkout --quiet "$GODOT_CPP_COMMIT"
# Generated engine headers that the iOS plugin includes.
(cd "$GODOT" && scons platform=ios target=template_release arch=arm64 \
	core/extension/gdextension_interface.gen.h core/version_generated.gen.h core/disabled_classes.gen.h \
	core/object/gdvirtual.gen.h > /dev/null)

DIST="$HERE/dist"
rm -rf "$DIST"
ADDON="addons/ogw-secure-storage"

# android: Godot Android plugin v2 AAR and its export plugin.
(cd "$HERE/android" && ./gradlew --quiet assembleRelease)
ANDROID_OUT="$DIST/android/$ADDON"
mkdir -p "$ANDROID_OUT/android"
cp "$HERE/android/addon/plugin.cfg" "$HERE/android/addon/ogw_secure_storage_export.gd" "$ANDROID_OUT/"
cp "$HERE/android/plugin/build/outputs/aar/plugin-release.aar" "$ANDROID_OUT/android/ogw-secure-storage-release.aar"

# macos: GDExtension library.
(cd "$HERE/macos" && scons --quiet platform=macos target=template_release arch=universal godot_cpp="$GODOT_CPP" file_prefix_maps="$PREFIX_MAPS")
MACOS_OUT="$DIST/macos/$ADDON"
mkdir -p "$MACOS_OUT/macos"
cp "$HERE/ogw-secure-storage.gdextension" "$MACOS_OUT/"
cp "$HERE/macos/bin/libogw-secure-storage.macos.dylib" "$MACOS_OUT/macos/"

# windows and linux: GDExtension libraries of `desktop/`. Each build works on its own copy of the sources and godot-cpp,
# whose object files have the same paths for every platform and architecture.
desktop_copy() {
	rm -rf "$WORK/$1"
	mkdir -p "$WORK/$1"
	cp -R "$GODOT_CPP" "$WORK/$1/godot-cpp"
	mkdir -p "$WORK/$1/desktop"
	cp -R "$HERE/desktop/SConstruct" "$HERE/desktop/src" "$WORK/$1/desktop/"
}

desktop_copy windows-x86_64
(cd "$WORK/windows-x86_64/desktop" && scons --quiet platform=windows arch=x86_64 use_mingw=yes target=template_release \
	godot_cpp="$WORK/windows-x86_64/godot-cpp" file_prefix_maps="$WORK/windows-x86_64=.")
WINDOWS_OUT="$DIST/windows/$ADDON"
mkdir -p "$WINDOWS_OUT/windows"
cp "$HERE/ogw-secure-storage.gdextension" "$WINDOWS_OUT/"
cp "$WORK/windows-x86_64/desktop/bin/libogw-secure-storage.windows.x86_64.dll" "$WINDOWS_OUT/windows/"

LINUX_OUT="$DIST/linux/$ADDON"
mkdir -p "$LINUX_OUT/linux"
cp "$HERE/ogw-secure-storage.gdextension" "$LINUX_OUT/"
for arch in x86_64 arm64; do
	if [ "$arch" = "x86_64" ]; then docker_platform="linux/amd64"; else docker_platform="linux/arm64"; fi
	desktop_copy "linux-$arch"
	docker run --rm --platform "$docker_platform" -v "$WORK/linux-$arch:/work" "$LINUX_IMAGE" sh -c "
		printf '$LINUX_SOURCES\n' > /etc/apt/sources.list &&
		apt-get update -qq > /dev/null &&
		DEBIAN_FRONTEND=noninteractive apt-get install -y -qq g++ python3-pip pkg-config libsecret-1-dev > /dev/null 2>&1 &&
		pip3 install --quiet scons==4.8.1 &&
		cd /work/desktop &&
		scons --quiet -j\$(nproc) platform=linux arch=$arch target=template_release godot_cpp=/work/godot-cpp file_prefix_maps=/work=."
	cp "$WORK/linux-$arch/desktop/bin/libogw-secure-storage.linux.$arch.so" "$LINUX_OUT/linux/"
done

# ios: static library per engine build type (`debug` has `DEBUG_ENABLED`), each an xcframework of device and simulator.
IOS_WORK="$WORK/ios-build"
rm -rf "$IOS_WORK"
IOS_OUT="$DIST/ios/ios/plugins/ogw-secure-storage"
mkdir -p "$IOS_OUT"
cp "$HERE/ios/ogw-secure-storage.gdip" "$IOS_OUT/"
for build in debug release; do
	if [ "$build" = "debug" ]; then configuration="Debug"; else configuration="Release"; fi
	for sdk in ios simulator; do
		if [ "$sdk" = "ios" ]; then
			destination="generic/platform=iOS"
			defines="$IOS_DEFINES"
		else
			destination="generic/platform=iOS Simulator"
			defines="$IOS_DEFINES IOS_SIMULATOR"
		fi
		xcodebuild archive -quiet -project "$HERE/ios/ogw-secure-storage.xcodeproj" -scheme ogw-secure-storage \
			-configuration "$configuration" -destination "$destination" \
			-archivePath "$IOS_WORK/$build-$sdk.xcarchive" -derivedDataPath "$IOS_WORK/derived" \
			GODOT_SOURCE_DIR="$GODOT" GODOT_DEFINES="$defines" OTHER_CFLAGS="-ffile-prefix-map=$WORK=. -ffile-prefix-map=$HERE=."
	done
	xcodebuild -create-xcframework \
		-library "$IOS_WORK/$build-ios.xcarchive/Products/Library/libogw-secure-storage.a" \
		-library "$IOS_WORK/$build-simulator.xcarchive/Products/Library/libogw-secure-storage.a" \
		-output "$IOS_OUT/ogw-secure-storage.$build.xcframework" > /dev/null
done
