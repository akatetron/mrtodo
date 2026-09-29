# Mr. Todo — Native App (React Native / Expo)

A working Expo/React Native codebase for Mr. Todo, mirroring the web prototype: customers post tasks, get matched with a Personal Manager, track progress, log multi-day visits, and confirm completion with an OTP code. Includes both the Customer and Personal Manager (worker) experiences, switchable with the tab at the bottom of the screen. The Admin console stays web-only (it's a back-office tool, not something an admin needs on a phone) — use the existing HTML prototype for that.

## What's inside

```
App.js                      entry point
src/theme.js                 colors (Option B: teal + brass), spacing, radius, type
src/data/store.js             in-memory data store + actions (createTask, assignWorker, logVisit, completeWithOtp, ...)
src/components/UI.js          shared Card / Badge / Button / StatusTracker components
src/screens/HomeScreen.js       customer: post a task (templates, category, one-time/ongoing, location, who-for)
src/screens/TrackTaskScreen.js  customer: status tracker, visit log, completion code, assigned PM
src/screens/WorkerHomeScreen.js worker: persona picker, new assignments, in-progress/completed lists
src/screens/WorkerJobScreen.js  worker: task detail, accept/decline, log visit, OTP-gated completion
src/navigation/RootNavigator.js stack navigators for both roles + the role switcher
```

## Running it

You'll need Node.js installed. This project was scaffolded for Expo SDK 51.

1. Copy this folder to your computer (already done if you're reading this from your connected folder).
2. Open a terminal in the `mr-todo-app` folder and install dependencies:
   ```
   npm install
   ```
3. Start the Expo dev server:
   ```
   npm start
   ```
   This opens Expo's dev tools in your terminal/browser with a QR code.
4. To preview:
   - **On your phone**: install the free "Expo Go" app (iOS App Store / Google Play), then scan the QR code. The app loads live on your phone — no build needed.
   - **iOS Simulator** (Mac only, needs Xcode): press `i` in the terminal.
   - **Android Emulator** (needs Android Studio): press `a` in the terminal.
   - **Web preview**: press `w` (uses react-native-web; handy for a quick look, not a substitute for testing on a real device).

## Publishing to the App Store / Play Store

This sandbox can't compile native binaries or submit to app stores directly, but the path from here is straightforward with Expo's own build service (EAS Build):

1. Create a free Expo account at expo.dev.
2. `npm install -g eas-cli`, then `eas login`.
3. `eas build:configure` in this folder.
4. `eas build --platform ios` and/or `eas build --platform android` — Expo builds the actual app binary in the cloud and gives you a download link (or auto-submits with `eas submit`).
5. iOS submission needs an active Apple Developer account (~$99/year); Android needs a one-time Google Play Console fee (~$25).

You mentioned you can help on the app-store side (developer accounts, store listings, screenshots) when we get there — that's exactly the part EAS still needs a human for, so that offer lines up well with steps 5 above.

## Current state / what's simulated

- All data (tasks, workers, ratings) lives in memory (`src/data/store.js`) and resets when the app restarts — there's no backend yet. Wiring this to a real API (task creation, matching, notifications, payments) is the next real engineering milestone once you're ready to move past the clickable/native prototype stage.
- The "Use current location" button fills in a placeholder string rather than calling the device GPS — swapping in `expo-location` is a small follow-up once you want that live.
- OTP codes are generated locally and shown directly on the customer's tracking screen (so you can test the flow yourself); in production this would be sent via SMS and never shown to the Personal Manager's app.
