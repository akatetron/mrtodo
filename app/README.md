# Mr. Todo — Native App (React Native / Expo)

A working Expo/React Native codebase for Mr. Todo, for iOS, Android and the web: customers post tasks, an admin matches them with a verified Personal Manager, customers track progress live, and completion is confirmed with a code only the customer has. People sign up either as customers or as Personal Managers (who apply with ID and get approved before they receive work). The admin console is a separate website in `../admin`.

## What's inside

```
App.js                              entry point
src/theme.js                        brand colours (docs/Brand_Colors.pdf), spacing, type
src/lib/supabase.js                 Supabase client (project URL + publishable key)
src/lib/AuthContext.js              session + live profile for every screen
src/data/store.js                   tasks store (realtime) + every action the app can take
src/components/UI.js                Card / Badge / Button / Input / Stars / StatusTracker
src/screens/auth/                   log in (password or email code), sign up (customer or PM)
src/screens/HomeScreen.js           customer: post a task, see recent tasks
src/screens/TrackTaskScreen.js      customer: live status, completion code, PM, cancel, rate
src/screens/PmApplicationScreen.js  PM: application form + ID upload, pending/approved states
src/screens/WorkerHomeScreen.js     PM: new offers, availability toggle, earnings, task lists
src/screens/WorkerJobScreen.js      PM: accept/decline → start → log visits → enter code → rate
src/screens/AccountScreen.js        both: edit name/phone, sign out
src/navigation/RootNavigator.js     picks the right screens for the signed-in role
```

The database (`../supabase/schema.sql`) and the admin dashboard (`../admin`) live next to this folder.

## Running it

You'll need Node.js installed. This project targets Expo SDK 57.

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
   - **Web**: press `w`. The same app runs as a website — `npm run build:web` produces a static site in `dist/` you can host anywhere (Netlify, Vercel, Cloudflare Pages…).

## Publishing to the App Store / Play Store

This sandbox can't compile native binaries or submit to app stores directly, but the path from here is straightforward with Expo's own build service (EAS Build):

1. Create a free Expo account at expo.dev.
2. `npm install -g eas-cli`, then `eas login`.
3. `eas build:configure` in this folder.
4. `eas build --platform ios` and/or `eas build --platform android` — Expo builds the actual app binary in the cloud and gives you a download link (or auto-submits with `eas submit`).
5. iOS submission needs an active Apple Developer account (~$99/year); Android needs a one-time Google Play Console fee (~$25).

## Current state

Everything is live against Supabase — see `SETUP_BACKEND.md` for setup and the list of what's still to build (notifications, payments, GPS).
