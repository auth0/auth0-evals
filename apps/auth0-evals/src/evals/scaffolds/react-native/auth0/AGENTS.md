Auth0 login already works in this app: `App.tsx` wraps the UI in `Auth0Provider` and the home
screen logs in through the `useAuth0()` hook. The native iOS and Android projects are already
configured for the Auth0 callback (manifest placeholders and the iOS URL scheme). Edit TypeScript —
you should not need to touch the native projects for this task.

Do not run a native build or launch a device/simulator — `gradle`/`gradlew`, `xcodebuild`,
`pod install`, `react-native run-ios` / `run-android`. The native toolchain is not available here, so
those take many minutes and then fail for reasons unrelated to your changes.

`npm run typecheck` is the only verification you need.
