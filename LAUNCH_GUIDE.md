# SaloonBossX — Launch Guide (direct APK sale)

Follow this top to bottom. Every step is needed. Budget about 3 hours for
Part A–C, then test on real phones before you announce anything.

---

## Part A — One-time setup (on your laptop)

```bash
npm install
cp .env.example .env
npm run keygen
```

`npm run keygen` creates two files:

| File | What it is | What to do |
|---|---|---|
| `license-public.key` | Public key, goes inside the app | Keep in the project. Commit it. |
| `keys/private.key` | Signs every licence you sell | **Back up now to 2 places (pen drive + Google Drive in a zip with password). If you lose it, you can never issue a key that works in already-sold apps.** |

Run `npm run keygen` **only once, ever.** Running it again with a new key
breaks every key you already sold.

Open `.env` and fill in:

```
EXPO_PUBLIC_BUY_URL=https://your-website.com/buy
EXPO_PUBLIC_SUPPORT_WHATSAPP=91XXXXXXXXXX
EXPO_PUBLIC_SUPPORT_EMAIL=support@your-website.com
EXPO_PUBLIC_TRIAL_DAYS=0
EXPO_PUBLIC_SELLER_UPI=yourname@okaxis
EXPO_PUBLIC_SELLER_NAME=SaloonBossX
EXPO_PUBLIC_REFUND_DAYS=7
```

- "Buy now" in the app opens your website with `?plan=standard&email=…&device=…`
  added. No website yet? Leave `BUY_URL` blank — the button opens WhatsApp to
  you with the plan and device ID already typed.
- "Need help?" opens WhatsApp to your number.
- `SELLER_UPI` adds a **Pay by UPI now** button inside the app. The payment
  reference carries the buyer's device ID, so you know which key to send.
- `TRIAL_DAYS=0` means no free trial: the app cannot be used until a key is
  activated. Selling day-to-day plan is in [SALES_PLAN.md](SALES_PLAN.md).

## Part A2 — If you already have a sheet of old keys

Keys that look like `SBX-ACADEMY-2099-04-20-31AE611A` are the old v3 format.
They **work** — the app accepts both formats — so you can sell straight from the
sheet you already have. Plan names map across automatically: `STARTER` → Solo,
`PRO` → Standard, `BUSINESS` → Multi, `ACADEMY` → Salon + Academy.

Two things to know:

- v3 keys can be created by anyone who has a copy of the old
  `generate-license-key.js`, because the secret sits inside the app. New keys
  from `npm run issue` / `npm run batch` cannot be forged. Use up the old sheet
  during the launch if you want, but issue new-format keys for later sales.
- If you set up the licence server (Part B) it looks up keys in a tab called
  **Keys Master** with the 15 columns listed there. Your older sheet has
  different columns, so either move your keys into a Keys Master tab (paste them
  into column B, plan in C, expiry in E, `AVAILABLE` in G) or leave
  `EXPO_PUBLIC_LICENSE_URL` blank and run fully offline.

Tell customers to **copy-paste** the key. Typing `0` for `O` is the most common
support call.

## Part B — Licence server (recommended, free, 20 minutes)

Without it keys still work offline, but one key can be shared on many phones and
you can't revoke a refunded key.

1. Google Drive → New → Google Sheets → name it exactly **SaloonBossX Licenses**.
2. Extensions → Apps Script. Delete everything, paste `google-apps-script/Code.gs`, Save.
3. Project Settings (gear) → Script Properties → Add: `RESPONSE_SECRET` = any long
   random text (e.g. 40 random letters/numbers).
4. Select function `setup` in the toolbar → Run → allow permissions. It creates the
   **Keys Master** tab.
5. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access
   **Anyone** → Deploy. Copy the `/exec` URL.
6. In `.env`:
   ```
   EXPO_PUBLIC_LICENSE_URL=<the /exec URL>
   SBX_RESPONSE_SECRET=<same text as step 3>
   ```

Keys register themselves on first activation — you do not need to paste keys
into the sheet. After editing `Code.gs` later: Deploy → Manage deployments →
Edit → **New version** (keeps the same URL, no app rebuild).

## Part B2 — One-tap cloud for all customers (10 minutes, once)

Do **`HOSTED_CLOUD_SETUP.md`** and put the /exec URL in `.env` as
`EXPO_PUBLIC_CLOUD_URL`. Without it, every owner has to deploy their own Google
script for backup, online booking and branches. That is the hard setup that
caused "unable to open the file". With it, each of those is one tap.

## Part C — Build the APK

```bash
npm install -g eas-cli
eas login
eas init                 # first time only
npm run preflight        # must say "Preflight passed"
npm run build:apk
```

`build:apk` refuses to start if the licence key or support contact is missing —
that is the check that stops you shipping an APK nobody can activate.

When the build finishes, download the `.apk`. **Before every new APK, raise
`android.versionCode` in `app.json` by 1**, or phones will refuse to update.

EAS keeps your Android signing keystore. Download a copy once:
`eas credentials -p android` → Download. Store with your private key. Losing it
means customers must uninstall (and lose data) to get updates.

## Part D — Test on real phones (do NOT skip)

Use at least 2 phones — one cheap Android (Redmi/Realme/Samsung M-series) and
one Android 14+.

- [ ] Install APK from your website link on mobile data (not from laptop).
- [ ] Onboarding → activation screen shows prices and your WhatsApp.
- [ ] Create owner PIN, add 2 services, 1 staff, 1 client, make 3 bills, share
      one on WhatsApp, print/share PDF.
- [ ] Activation screen shows ₹4,999 with ₹9,999 struck through.
- [ ] Tap Buy now → "Pay by UPI now" → your UPI app opens with the right amount
      (cancel the payment, do not pay yourself).
- [ ] Issue a key: `npm run issue -- --plan standard --order TEST-1`. Send it to
      the phone on WhatsApp, copy-paste into the app → Activate.
- [ ] Close app fully, reopen → goes straight in (no activation screen).
- [ ] Same key on phone 2 → blocked with "device limit" (needs Part B).
- [ ] Settings → License & Plan → Remove → key activates on phone 2.
- [ ] Settings → Backup → back up to email. Uninstall, reinstall, restore.
- [ ] Airplane mode: billing still works.
- [ ] Switch language to Hindi and one more.

## Part E — Selling day workflow

**Before launch**, make a stock of keys:

```bash
npm run batch -- --plan standard --count 120 --prefix LAUNCH
npm run batch -- --plan solo --count 120 --prefix LAUNCH
npm run batch -- --plan multi --count 99 --prefix LAUNCH
npm run batch -- --plan academy --count 99 --prefix LAUNCH
```

Import the CSV into the **Keys Master** tab (File → Import → Append rows).

**Per sale (about 1 minute):**
1. Payment arrives (Razorpay / Instamojo payment page, or UPI screenshot).
2. In the sheet, take the next `AVAILABLE` row of that plan. Fill Customer Name,
   Phone, Amount Paid.
3. WhatsApp the customer:
   > Thank you for buying SaloonBossX 🙏
   > Your licence key (copy the full text):
   > SBX-……
   > Open the app → paste in "Have a licence key?" → Activate.

Tell customers to **copy-paste, never type** the key. It's case-sensitive.

**Refund:** set that row's Status to `REVOKED`. The app locks within 24 hours of
next internet use.

**Customer changed phone:** clear the Device IDs cell and set Devices Used to 0.

## Part F — Website download page must have

- Direct `.apk` link (host on your site, Google Drive direct link, or GitHub Releases).
- 4 screenshots of the app + a 30-second screen-recording video.
- Install steps in Hindi + English: *Download → Open → "Allow from this source" →
  Install → if Play Protect warns, tap "More details → Install anyway".*
  Without this, a large share of downloads never get installed.
- "Launch price ₹4,999 (MRP ₹9,999) — first 99 salons" as the main line, with a
  7-day money-back guarantee under it.
- Refund policy (7 days), your WhatsApp number, GST/business name if you have one.

## Known limits — tell customers honestly

- No Bluetooth thermal printer yet (PDF/WhatsApp bill only).
- Android only.
- No cloud sync between phones; each phone has its own data.
- Data lives on the phone; they must take backups.
