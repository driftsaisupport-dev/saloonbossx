# One-tap cloud for every customer (do this ONCE, 10 minutes)

In 5.2, every salon owner had to copy a Google script, deploy it and allow
access. That was the hard part, and the usual source of Google's
**"Sorry, unable to open the file at present"** page.

In 5.3, **you** deploy the Cloud Bridge once, in a Google account you own. Every
app you build points at it. The owner then just taps:

| Owner wants | Owner taps |
|---|---|
| Backup | Nothing if they left "Free cloud backup" on at first setup. Otherwise **Turn on** on the home checklist |
| Online booking | **Start online booking — 1 tap** (link, QR poster and share appear) |
| A branch | **Add a branch phone** → WhatsApp; the branch taps the link → Join |
| A new / lost phone | **Join / new phone** → paste the recovery key → pick the backup |

There is no Google login and no setup on the owner's side, and no monthly fee
for anyone.

## Is it safe to keep salons' data in my Google account?
- Backups and branch figures are **encrypted on the phone** (AES-256 + HMAC)
  with a key that only that salon's phones and its recovery key hold. The
  server only stores a one-way *signing* key (`_auth`), from which the backup
  key cannot be worked out. You see
  files like `backup-Mon.sbx` and `branches/ab12cd.json` full of random
  characters. You cannot read them, and neither can Google.
- Each salon gets its own folder and its own secret. One salon's key cannot
  read, list or restore another salon's files. This is tested in
  `tests/hosted.test.js`.
- The booking page shows only what is public anyway: the salon name, services,
  prices, hours and busy times.
- A customer's name and number stay in the cloud only until the salon phone
  has collected **and confirmed** them, which is usually minutes. After that, only the time slot is
  kept, for up to 30 days, to stop double booking.

## Steps
1. **Create a fresh Gmail** just for this, e.g. `saloonbossx.cloud@gmail.com`.
   Don't use your personal account: it keeps the 15 GB free storage for this
   alone, and nobody else signs in to it.
2. In that account, open **script.google.com** → **New project** and name it
   *SaloonBossX Cloud*. Delete the sample code, paste all of
   `google-apps-script/BranchSync.gs` and click **Save**.
3. **Deploy → New deployment** → gear icon → **Web app**:
   - Description: `v4`
   - **Execute as: Me**
   - **Who has access: Anyone** (*not* "Anyone with Google account")
4. **Deploy → Authorise access** → choose the account → **Advanced → Go to
   SaloonBossX Cloud (unsafe) → Allow**. Google shows "unsafe" for any script it
   hasn't reviewed. This one only touches the folder it creates.
5. Copy the **Web app URL**. It must end in **/exec**.
6. Put it in `.env`:
   ```
   EXPO_PUBLIC_CLOUD_URL=https://script.google.com/macros/s/AKfy…/exec
   ```
   Then run `npm run preflight`. It refuses a /dev or editor link.
7. Check the URL in a **private / incognito** window. You should see
   `{"ok":true,"app":"SaloonBossX Cloud Bridge","version":5,…}`. If you see
   "unable to open the file", go back to step 3: access is not *Anyone*, or you
   copied the wrong link.
8. Build the APK as usual. Every phone running this build gets one-tap cloud.

## Updating the script later
Paste the new code → **Deploy → Manage deployments → ✏️ Edit → Version: New
version → Deploy**. The URL stays the same, so no app update is needed.
**Never** create a *New deployment* for an update: that makes a new URL, and
every phone would lose its cloud.

## Limits of a free Gmail (good to know, nothing to do now)
- **Storage:** 15 GB. Each salon keeps 7 rotating backups, overwritten in place
  so nothing piles up in the trash. An encrypted backup is about 0.2–3 MB,
  so a salon uses roughly 2–20 MB in total: 15 GB is enough for several hundred
  to a few thousand salons. Check *Drive → Storage*
  once a month.
- **Traffic:** each phone syncs at most every 15 minutes, plus when the app is
  opened or closed. Google limits how many requests run at the same time; when
  that is hit, the app says "Cloud is busy" and retries by itself. Nobody loses
  data, because the phone is always the main copy.
- **When you grow** past a few hundred active salons: do steps 1–5 again with a
  second Gmail, and put the new URL in builds for *new* customers. Existing
  phones keep their old URL, which goes on working.
- **Never delete** the script, the Gmail account or the "SaloonBossX Cloud"
  folder. That would switch off backup and booking for every customer.

## If a customer's customer sees "unable to open the file"
That is a Google page, shown when the phone's browser is signed in to several
Google accounts. 5.3 handles it two ways:
- the booking page sends the request a second way if Google's usual channel is
  blocked;
- the in-app FAQ tells the salon to suggest Chrome Incognito.

Always share the link from the app's **Share** button, so it is never cut off.

## Owners who want their own Google account
They still can: Branches & Cloud → **Advanced: use my own Google account
instead**. The old 5.2 path (template copy / pasted script) is unchanged. See
`MULTI_BRANCH_SETUP.md` and `CLOUD_TEMPLATE_SETUP.md`.
