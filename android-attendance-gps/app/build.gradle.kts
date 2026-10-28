plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "bd.flamio.attendancegpstest"
    compileSdk = 35
    defaultConfig { applicationId = "bd.flamio.attendancegpstest"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0-test" }
}
