Do not run a native build or launch a device/simulator — in particular `expo prebuild`,
`expo run:ios` / `run:android`, `gradle`/`gradlew`, `xcodebuild`, or `pod install`. The native
toolchain is not available in this environment, so those commands take many minutes and then fail for
reasons unrelated to your changes.

`npm run typecheck` is the only verification you need.
