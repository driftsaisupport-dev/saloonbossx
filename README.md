# SaloonBossX 6.0.0 — Global edition

**Selling this app? [LAUNCH_GUIDE.md](LAUNCH_GUIDE.md) to ship it, [SALES_PLAN.md](SALES_PLAN.md) to sell it.**

Offline-first salon management for salons, spas and barbershops in 38 countries
(and US$ everywhere else). All data stays on the device in a SQLCipher-encrypted
database. No server is required to run the app.

**New in 6.0 "Global"** ([CHANGELOG_v6.0.0.md](CHANGELOG_v6.0.0.md)): country picker with local
currency, tax (GST/VAT/Sales tax/IVA…), phone rules and QR wallets; Spanish, Portuguese and
French; premium Monthly / Yearly plans priced in 32 currencies. Country table:
`src/config/regions.ts`. Price table: `MONTHLY_PRICE_BOOK` in `src/services/licensePlans.ts`.

**New in 5.6 "Copper"** ([CHANGELOG_v5.6.0.md](CHANGELOG_v5.6.0.md), market study in [docs/MARKET_REVIEW.md](docs/MARKET_REVIEW.md)):
- New copper logo and theme (WCAG AA contrast in light and dark).
- 10 business types with starter menus; client wallet/prepaid; packages sold and redeemed on bills;
  walk-in token queue with TV display; day close / cash tally; consultation notes, allergy alerts and
  before/after photos; bridal advances and home-service visits; manual opt-in GST (off by default; GSTIN, 5%/18%/other, prices incl. GST).
- Every finding from two full audits fixed (no more database wipe on keystore errors, serialised
  bill writes, stock inside the bill, safe restore, PIN lockouts, permissions on every action).
- 101 automated tests including real-SQLite money-flow tests.

### Device test checklist (do this on a real Android phone before each release)
1. Fresh install with GST off → make a bill → it prints as a plain "Bill" with no GST. Then Settings → GST → turn on, enter a GSTIN, pick 5% → new bill prints "Tax Invoice" with CGST/SGST.
2. Client: add ₹5,000 + ₹500 bonus to wallet, pay a bill from wallet, cancel it, check the balance returns.
3. Sell a 5-session package, use it on a bill, check "4 left".
4. Book a bridal appointment with ₹2,000 advance and a home address; open Maps; bill it; check the advance is deducted.
5. Walk-in queue: add 3 tokens, call next, bill one, open Display mode.
6. Day close: count cash with the note counter, save, check yesterday's close appears in history.
7. Client photo: take a Before photo with the camera and an After from the gallery; view full screen; delete.
8. Switch to Hindi and Marathi; walk through Billing, Clients and Reports on a small (5-inch) phone.
9. Lock the app with a sheet open; wrong PIN 5 times → lockout message.
10. Back up, then restore the file; the app restarts with the same data.

**New in 5.5** ([CHANGELOG_v5.5.md](CHANGELOG_v5.5.md), [LICENSING_AND_PRICING.md](LICENSING_AND_PRICING.md)):
- Monthly and One-time licences (5.5.1). A year of monthly always costs more than one-time.
  Yearly is hidden but still supported for special deals.
- Monthly and yearly keys start on activation and stack when renewed early. There is a
  3-day grace period, renewal reminders, and data is never deleted.
- 1,600 ready-to-sell signed keys (200 Monthly + 200 One-time per plan) in an Excel file for your Google Sheet.

**New in 5.4** ([CHANGELOG_v5.4.md](CHANGELOG_v5.4.md)). Setup steps are in
[SETUP_STEP_BY_STEP.md](SETUP_STEP_BY_STEP.md).
- A free booking website with short links that carry the salon's name, e.g.
  `yourname.github.io/glow-beauty-vashi`. Customers never open Google, which
  fixes "unable to open the file" ([BOOKING_WEBSITE_SETUP.md](BOOKING_WEBSITE_SETUP.md)).
- Google reviews on WhatsApp bills, as a QR on printed and PDF bills, and on the
  booking page, plus review-request campaigns.
- Marketing & Growth: Boss AI campaigns built from the salon's own data, sent as
  personal WhatsApp messages one tap at a time; photo and video posts with
  offline captions.
- Smoother navigation: screens in the background no longer re-render.

**New in 5.3** ([CHANGELOG_v5.3.md](CHANGELOG_v5.3.md)):
- **True one-tap cloud.** You deploy the Cloud Bridge ONCE
  ([HOSTED_CLOUD_SETUP.md](HOSTED_CLOUD_SETUP.md)). After that, owners turn on
  backup, online booking and branches with one button. They do no Google steps,
  so they never see "unable to open the file".
- Everything a salon stores in the shared cloud is encrypted on the phone.
- A recovery key and a "new phone" flow restore a lost phone in 2 minutes.
- A crash in one screen no longer takes down the app: you get a recovery card
  and an error report.

**New in 5.2** ([CHANGELOG_v5.2.md](CHANGELOG_v5.2.md)):
- One-tap cloud setup: a template Sheet copy, then scan a QR to connect
  ([CLOUD_TEMPLATE_SETUP.md](CLOUD_TEMPLATE_SETUP.md)).
- WhatsApp join links for branches.
- A setup checklist on the home screen.
- Import customers from contacts or Excel.
- Logo and footer on bills, and bulk price change.

**New in 5.1** ([CHANGELOG_v5.1.md](CHANGELOG_v5.1.md)):
- Free online booking page with a QR poster and a Google Maps "Book" link.
- Help & FAQ centre.
- New Indian pricing.

**New in 5.0** ([CHANGELOG_v5.md](CHANGELOG_v5.md)):
- Multi-branch HQ through the owner's own Google Drive, with encrypted cloud
  backup ([MULTI_BRANCH_SETUP.md](MULTI_BRANCH_SETUP.md)).
- **Boss AI**, an offline assistant (English/Hinglish/Hindi questions,
  briefing, forecast, due-back clients, upsell, leakage guard).
- Demo salon and setup by business type.
- Udhaar/dues, UPI QR and thermal receipts.
- 15 bug fixes.

Expo SDK 57 · React Native 0.86 · expo-sqlite (SQLCipher) · expo-secure-store

---

## First-time setup

```bash
npm install
cp .env.example .env
npm run keygen          # ONCE EVER: writes license-public.key + keys/private.key
npm run preflight       # run before every build
```

**Back up `keys/private.key` in two places before doing anything else.** Lose it
and you can no longer issue licences for any build already in the field. It is
git-ignored and it is not recoverable.

```bash
npm start               # dev server
npm test                # money, licence, Boss AI and cloud-crypto tests (AI tests need Node 22.18+)
npm run typecheck       # tsc --noEmit
```

## Issuing a licence

```bash
npm run issue -- --plan academy --order INV-2026-0417
npm run issue -- --plan standard --days 14 --order TRIAL-88
npm run batch -- --plan standard --count 100 --prefix LAUNCH   # CSV for the sheet
```

Keys are signed with the private half of the pair. The app ships only the public
half, so it can verify a key but can never produce one. Record each key in your
licence sheet against the order number so you can revoke it later.

## Builds

```bash
eas build -p android --profile production        # AAB for Play
npm run build:apk                                # APK for direct sale (runs preflight)
eas build -p ios --profile production
```

### Android Auto Backup

Applied automatically on every build by `plugins/withAndroidBackupRules.js`
using the rules in `android-config/`.

### Signing

Back up your Android upload keystore. If you lose it you can never publish an
update to that listing again — not with a new key, not with support's help.

## Shipping an update

Over-the-air updates are **off** in 4.1.0 (the old URL was a placeholder). To turn
them on: `eas update:configure`, then `eas update --branch production`.

Native changes need a new binary. Publish a GitHub Release with the APK
attached, and put the hash in the release notes:

```
sha256: <64 hex chars>
min-version: 4.0.0     # optional, forces the upgrade
```

The app refuses to install an APK whose hash does not match. Do not omit it —
downloading and installing an unverified binary is a remote code execution
channel into your own product.

## Repo layout

```
src/
  database/
    Database.ts        queries and schema
    migrations.ts      ordered migrations, keyed off PRAGMA user_version
    schema.ts          the authoritative backup table list
  services/
    LicenseService.ts  activation, status, revalidation
    licenseCrypto.ts   Ed25519 verification (public key only)
    BackupService.ts   local, folder, email, restore
    BranchSyncService.ts  Google Drive sync: summaries, encrypted backups, HQ, price list
    sync/cloudCrypto.ts   AES + HMAC for cloud backups, request signing, join codes
    ai/intent.ts          question understanding (English / Hinglish / Hindi)
    ai/analytics.ts       forecast, upsell, visit rhythm, segments, leakage, messages
    ai/BossAI.ts          answers, briefing, billing helpers
    DemoDataService.ts    demo salon generator / start fresh
    UpdateService.ts   OTA and binary update lanes
  screens/             30 screens
  components/
    IconTile.tsx       dimensional SVG icon system
    SafeScreen.tsx     safe-area and keyboard wrapper
tools/
  keygen.js            one-time keypair generation
  issue-license.js     sign a licence key
android-config/        Auto Backup rules for prebuild
docs/COMPLIANCE.md     GST numbering and identity-document notes
tests/                 the ten money tests
```

## Running cost and maintenance

| What | Who pays | Cost |
|---|---|---|
| App data | Lives on the salon's phone | ₹0 |
| Backup, branch sync, online booking | The owner's own Google account (Apps Script + Drive) | ₹0 within Google's free limits, far above a salon's needs |
| Licence server (optional) | Your Google account (`Code.gs`) | ₹0 |
| Updates | GitHub Releases | ₹0 |

There is no server for you to keep running, and no database to back up. Things look after themselves:
- backups keep the last 14;
- logs and booking requests prune themselves;
- the app tells the owner when their script needs updating.

What still needs you:
- a new APK when Android or Expo require it, roughly once a year;
- answering setup questions. The in-app Help & FAQ covers the common ones.

## Two things to decide before launch

**Play Billing or direct APK.** Google's payments policy requires digital goods
consumed in the app to use Play Billing. Selling licence keys outside for an app
listed on Play breaks that policy and gets apps removed. Either use Play Billing
(they take a cut; one-time purchases are supported) or distribute the APK
directly off-Play and keep everything, at the cost of Play Protect warnings and
no automatic updates. Both work. Picking one after building the licence flow
around the other does not.

**Thermal printing.** 5.0 prints 58/80 mm receipts through the Android print
framework, so it works with any printer that has an Android print service:
RawBT (free) covers most cheap Bluetooth ESC/POS printers. Direct Bluetooth
ESC/POS without a print service would need a native module. Test it on the
customer's printer before you promise it.

**Google Drive sync.** Uses an Apps Script that each owner deploys in their own
account (`google-apps-script/BranchSync.gs`). See MULTI_BRANCH_SETUP.md.
# saloonbossx
# saloonbossx
