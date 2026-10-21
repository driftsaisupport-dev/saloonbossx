# SaloonBossX 5.4: your setup, step by step

Do sections 1–3 **once**, on a laptop. After that, every salon owner sets up
everything from the app with one tap per feature.

## 1. Cloud Bridge (10 min): `HOSTED_CLOUD_SETUP.md`
1. Make a new Gmail just for this.
2. Go to script.google.com → New project → paste `google-apps-script/BranchSync.gs` → Save.
3. Deploy → New deployment → Web app. Set *Execute as: Me* and *Who has access:
   **Anyone***. Deploy, then Authorise (Advanced → Go to project → Allow).
4. Copy the URL ending in **/exec**. Open it in an incognito window: you should
   see `{"ok":true,…"version":5}`.

## 2. Booking website (15 min): `BOOKING_WEBSITE_SETUP.md`
1. Make a GitHub account and a repository named `<username>.github.io`.
2. Run `npm run booking-site` and upload the 4 files from `booking-site/dist/`.
3. Go to Settings → Pages → main / root → Save.

## 3. Build the app
`.env`:
```
EXPO_PUBLIC_CLOUD_URL=https://script.google.com/macros/s/…/exec
EXPO_PUBLIC_BOOKING_SITE=https://<username>.github.io
EXPO_PUBLIC_SUPPORT_WHATSAPP=91XXXXXXXXXX
EXPO_PUBLIC_SELLER_UPI=you@upi
```
Then:
```
npm run preflight      # must pass
npx expo start -c      # testing in Expo Go (-c reloads .env)
eas build -p android   # the APK you sell
```

## 4. What the salon owner does (show this in your demo)
| Feature | Owner's taps |
|---|---|
| Cloud backup | Nothing: it's on from first setup (or **Turn on** on the home checklist) |
| Online booking | Online Booking → **Start online booking — 1 tap** → **Share** |
| Google reviews | Settings → Google reviews → **Paste** their "Ask for reviews" link |
| Campaigns | Marketing → pick a Boss AI idea → **Send to Priya (1/23)** … |
| Photo/video post | Marketing → Photo & video → pick → **Post with caption** |
| A branch | Branches & Cloud → **Add a branch phone** → WhatsApp |
| Lost phone | New phone → Join / new phone → paste recovery key → restore |

## 5. Test before every sale (10 min, two phones)
- [ ] Fresh install → finish setup → the checklist shows cloud ✓ within a minute.
- [ ] Start online booking → **Test** says Working ✅ → the link looks like `…github.io/salon-name`.
- [ ] Open the link on another phone using mobile data → book → notification arrives → Accept → WhatsApp confirmation.
- [ ] Make a bill → send on WhatsApp → the message ends with the Google review link. The PDF bill has the review QR.
- [ ] Marketing → a campaign → send to 1 customer → WhatsApp opens with their name filled in.
- [ ] Save recovery key → second phone → Join / new phone → restore.

## Why you saw "Sorry, unable to open the file at present"
That page comes from Google, not the app. The 5.3 link pointed straight at
`script.google.com`. Google shows this error when:
- the phone's browser is signed in to Google (very common on iPhones with
  Gmail / YouTube), or
- the deployment link is wrong or deleted, or
- access isn't set to *Anyone*.

From 5.4, customers open your GitHub Pages website instead, and only the
website talks to Google, in the background, with no login. The in-app **Test**
button checks the link exactly the way a customer's phone would.
