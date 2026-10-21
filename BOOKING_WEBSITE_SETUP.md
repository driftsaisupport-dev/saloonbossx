# Free booking website with short links (15 minutes, once)

**Before (5.3):** customers opened a long `script.google.com/macros/s/AKfy…/exec?book=…`
link. On iPhones and on phones signed in to Google, that often showed
**"Sorry, unable to open the file at present"**.

**Now (5.4):** customers open a short link with the salon's name:

```
https://saloonbossx.github.io/glow-beauty-vashi
```

That page is a normal website hosted free on GitHub Pages. It talks to your
Cloud Bridge in the background, so customers **never open a Google page**, and
Google's login problems can't reach them.

**How the link works**
1. The salon taps **Start online booking**. The app asks the cloud for the
   name `glow-beauty-vashi`, made from the salon name and area. If that name is
   taken, it gets `glow-beauty-vashi-2`. The owner can change it under
   *Online Booking → Change link name*. Old links keep working.
2. A customer opens the link. The website loads the salon's services, hours and
   free slots from the cloud.
3. The customer books. The request goes to the cloud, and the salon's phone
   shows a notification. The owner taps **Accept**, and the customer gets a
   WhatsApp confirmation.

## Steps

### A. Cloud Bridge first
Do `HOSTED_CLOUD_SETUP.md`. You need its link ending in `/exec`.

If you deployed the 5.3 script, paste the new `BranchSync.gs` and choose
**Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL
stays the same.

### B. Create the website (GitHub, free)
1. Make a free account at **github.com**. Your username becomes the site
   address, e.g. `saloonbossx` gives `saloonbossx.github.io`.
2. Click **+ → New repository** and name it **exactly** `<username>.github.io`
   (e.g. `saloonbossx.github.io`). Choose **Public** → **Create**.
3. On your laptop, in the project folder, run:
   ```
   npm run booking-site
   ```
   This creates `booking-site/dist/` with four files: `index.html`, `404.html`,
   `config.js` and `.nojekyll`.
4. In the new repository, click **Add file → Upload files**, drag in all four
   files and click **Commit changes**.
   - On a Mac, `.nojekyll` is hidden: press Cmd+Shift+. in Finder.
   - Uploading it isn't required, it just helps.
5. Go to **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`
   / `root` → **Save**. Wait 1–2 minutes.
6. Open `https://<username>.github.io/test`. You should see *"Booking not
   available — This booking link is not active."* That means the website and
   the cloud are talking. ✅

### C. Point the app at it
In `.env`:
```
EXPO_PUBLIC_CLOUD_URL=https://script.google.com/macros/s/AKfy…/exec
EXPO_PUBLIC_BOOKING_SITE=https://<username>.github.io
```
Run `npm run preflight`, then rebuild.

**Testing in Expo Go:** stop the dev server and start it again with
`npx expo start -c` so the new `.env` values load.

### D. Test like a customer (2 minutes)
1. In the app, go to **Online Booking → Start online booking — 1 tap**.
2. Tap **Test**. It should say *"Working ✅ … services bookable"*.
3. Tap **Share**, send the link to a second phone on mobile data, and book a
   slot there.
4. On the salon phone, pull down on *Requests*. Accept the request and check
   the WhatsApp confirmation.

## Optional: your own domain (≈ ₹800/year)
Buy e.g. `book.yourbrand.in`, add it under **Settings → Pages → Custom domain**
(GitHub shows the DNS record to add), then set
`EXPO_PUBLIC_BOOKING_SITE=https://book.yourbrand.in`. Links become
`book.yourbrand.in/glow-beauty-vashi`.

## Updating the website later
Run `npm run booking-site` again and upload the new files over the old ones.
Salons' links don't change.

## Troubleshooting
| What you see | Fix |
|---|---|
| "Booking is being set up … no cloud link" | `config.js` is missing or empty. Run `npm run booking-site` and upload `config.js` |
| "Can't load right now" | The Cloud Bridge isn't public. Re-check *Who has access: Anyone* and that the URL ends in /exec |
| "Booking not available" on a real salon link | The salon hasn't turned booking on, or its phone hasn't synced since. Open the app → Online Booking → Save & publish |
| Link still long (script.google.com) | `EXPO_PUBLIC_BOOKING_SITE` isn't set in this build, or the cloud script is older than v5 (update it, step A) |
| 404 GitHub page | Pages isn't switched on yet (step B5), or the repository name is not `<username>.github.io` |
