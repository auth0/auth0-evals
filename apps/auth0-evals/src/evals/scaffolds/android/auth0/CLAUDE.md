# Android scaffold — agent guidance

## Scope

Edit Kotlin source files, `build.gradle`, `strings.xml`, and `AndroidManifest.xml` as needed. Do not run `./gradlew`, `gradle assembleDebug`, or any build/compile commands.

## No filesystem searches

Do not run `find /` or any other filesystem-wide search. Do not read `.gradle`, `.m2`, or any build cache to look up SDK method names — all Auth0 Android 4.0.1 method signatures are in the skill reference doc (`auth0-android.md`).

## Write files completely

Write each new Kotlin file in a single complete write — do not write partial content and patch it with multiple incremental edits. This keeps context size manageable.
