# Mr. Todo — Snack branch

This branch exists only so the app can be imported into
[Expo Snack](https://snack.expo.dev), which runs it on an iPhone simulator in
the browser. Import it with:

```
https://github.com/akatetron/mrtodo/tree/snack/app
```

It is a copy of the `claude/beautiful-curie-16zpda` branch with the files
Snack's importer rejects taken out: all images (app icon, splash, favicon),
the PDFs and Word document in `docs/`, the lockfile, and `start.bat`.
Those are only needed for real App Store / Play Store builds, not for the
simulator.

This branch is also pinned to **Expo SDK 54**, because that is what the Snack
runtime uses. The real app targets SDK 57 — the current version, and the one
the App Store's Expo Go runs — so keep that difference in mind: this branch is
for previewing screens in a browser simulator, nothing else.

**Do your actual work on `claude/beautiful-curie-16zpda`** — this branch is a
throwaway mirror and does not update on its own.
