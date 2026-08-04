Configure the native iOS and Android project files directly by editing them.

Do not run a native build or launch a device/simulator — in particular `gradle`/`gradlew`,
`xcodebuild`, `pod install`, or `react-native run-ios` / `run-android`. The native toolchain is not
available in this environment, so those commands take many minutes and then fail for reasons
unrelated to your changes.

`npm run typecheck` is the only verification you need.
