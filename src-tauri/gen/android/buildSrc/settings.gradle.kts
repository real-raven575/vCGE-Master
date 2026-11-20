// Where buildSrc finds its own plugins (kotlin-dsl and the Kotlin Gradle plugin it pulls in). The Gradle Plugin
// Portal alone sometimes answers "not found" for Kotlin 2.3.21 artifacts (CI runs 11-19), so Maven Central and
// Google are searched next. Same versions, only more places to look.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}
