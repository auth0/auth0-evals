Auth0 login already works in this app: `App.tsx` wraps the UI in `Auth0Provider` and the home
screen logs in through the `useAuth0()` hook. The native iOS and Android projects are already
configured for the Auth0 callback (manifest placeholders and the iOS URL scheme). Edit TypeScript —
you should not need to touch the native projects for this task.

Do not run a native build or launch a device/simulator — `gradle`/`gradlew`, `xcodebuild`,
`pod install`, `react-native run-ios` / `run-android`. The native toolchain is not available here, so
those take many minutes and then fail for reasons unrelated to your changes.

`npm run typecheck` is the only verification you need.

## No spelunking

Do not read `node_modules` or crawl the `react-native-auth0` source to discover the API. The method
names, their parameter objects, which parameters are required, where they live on both the hook and
the class, and the minimum version are documented in the react-native-auth0 skill reference. Trust it
and build from it.
