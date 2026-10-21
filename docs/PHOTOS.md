# Photography for the customer app

The app is built to be photography-led, but **no photographs are included yet**: I could not
download or create licensed photographs from the build environment. Until photos are added, every
service family shows a designed fallback artwork (a brand-colour panel with a large icon), never a
broken image.

## What to add
One image per service family, named after the family key, in `app/assets/services/`:

| File | Used for |
|---|---|
| `everyday-tech.jpg` | Everyday Tech Help |
| `assistance.jpg` | Personal Assistance |
| `errands.jpg` | Errands and Practical Tasks |
| `setup-organise.jpg` | Setup and Organisation |
| `concierge.jpg` | "Not sure where to start?" panel |
| `someone-else.jpg` | "Arrange help for someone you care about" |

Then run `cd app && npm run photos`. That writes `src/assets/servicePhotos.js`; rebuild the app.

## Guidance
- 4:3 landscape, at least 960 x 720 px, under 250 KB each (JPEG quality ~75). The tile crops to 4:3.
- Natural light, real homes, warm and calm, one consistent look. Show practical help, not medical care.
- Do not use an image that implies a service we do not offer (no plumbers, electricians, technicians).
- Only use images you are licensed to ship. Keep the licence for each.
- Add a short description of each picture for screen readers in the Service catalogue admin (below).

## Alternative: a link per family
A super admin can set an https image link and a description per family (migration 0011,
`set_family_image`). If the link fails to load, the app shows the fallback artwork. Links you do not
control can disappear; bundled images are the reliable choice.

## Snack
The Snack branch carries no binary files, so it always shows the fallback artwork.
