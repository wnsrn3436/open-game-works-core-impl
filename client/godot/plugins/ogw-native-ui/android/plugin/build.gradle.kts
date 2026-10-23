// Godot Android plugin v2 `OgwNativeUi`. `./gradlew assembleRelease` writes `build/outputs/aar/plugin-release.aar`.
// The `implementation` libraries are not inside the AAR: the export plugin lists them for the Godot Gradle build.
plugins {
    id("com.android.library")
}

android {
    namespace = "io.github.wnsrn3436.ogw.nativeui"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    compileOnly("org.godotengine:godot:4.7.2.stable")
    implementation("com.google.android.play:review:2.0.2")
    implementation("androidx.core:core:1.13.1")
}
