# Service photography

Six photographs are bundled in `app/assets/services/` and used by the home screen, category headers,
the "Not sure where to start?" panel and the "Arrange help for someone you care about" panel.
They are CC0 / public-domain images from Wikimedia Commons; sources are listed in
`app/assets/services/CREDITS.md`. Nothing is loaded from a third-party URL at runtime.

| File | Used for |
|---|---|
| `everyday-tech.jpg` | Everyday Tech Help |
| `assistance.jpg` | Personal Assistance |
| `errands.jpg` | Errands and Practical Tasks |
| `setup-organise.jpg` | Setup and Organisation |
| `concierge.jpg` | "Not sure where to start?" panel |
| `someone-else.jpg` | "Arrange help for someone you care about" panel |

To replace one, overwrite the file (4:3, about 1024x768, under 250 KB), run `cd app && npm run photos`,
and rebuild. The designed artwork remains only as a fallback if an image fails to load.
An admin can still override a family image with a link in the dashboard.
