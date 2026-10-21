# Setting up Google Drive: backup, online booking and branches (10 minutes)

> **5.3: you can probably skip this whole guide.** If you deployed the shared
> Cloud Bridge once (see `HOSTED_CLOUD_SETUP.md`), owners do it all from the app:
> - **Backup:** tap *Turn on cloud*, or leave the onboarding switch on.
> - **Online booking:** tap *Start online booking — 1 tap*.
> - **Branches:** tap *Add a branch phone*, then the branch taps the WhatsApp link.
>
> This guide is now only for owners who insist on keeping the data in their own
> Google account (Branches & Cloud → *Advanced: use my own Google account*).

This guide is for **you, the seller**, sitting with the owner. Do it once per
chain. Single-salon owners do steps 1–3 only, which gives them the encrypted
daily Drive backup.

> **5.2:** if you set up the template (`CLOUD_TEMPLATE_SETUP.md`), steps 1–2 become: tap
> **Create my free cloud** → Make a copy → ☁️ SaloonBossX → Set up → one Deploy → scan the
> QR. Branches join by tapping the WhatsApp **join link**. The manual steps below still work.

## What the owner needs
- Their own Google account (the Gmail they already use is fine).
- SaloonBossX 5.0 installed on every branch phone and activated.
- For several branches: the Multi-Location or Academy plan.

## 1. Deploy the Cloud Bridge script (in the OWNER's Google account)
1. On the owner's phone, open **Settings → Branches & Cloud → How to get the
   Drive link → Send the script to myself**, and send it to their email or to
   your laptop. The same code is in `google-apps-script/BranchSync.gs`.
2. Go to **script.google.com** while signed in as the owner, click
   **New project**, delete the sample code, paste the script and click
   **Save**.
3. Click **Deploy → New deployment**. Under the gear icon choose
   **Web app**, then set:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
4. Click **Deploy → Authorise access → choose the account → Advanced → Go to
   project (unsafe) → Allow**. Google shows "unsafe" for every personal script
   it has not reviewed; this one only touches the folder it creates.
5. Copy the **Web app URL** (it ends in `/exec`).

> Use **one script per owner**. An owner's script accepts only one salon, so its
> link can never be reused for someone else's data. Only the seller's shared
> cloud (`HOSTED_CLOUD_SETUP.md`) serves many salons.

## 2. Head-office phone
On the owner's phone, go to **Branches & Cloud → Owner / Head office**:
- paste the URL;
- enter the chain name (e.g. *Glow Salons*);
- enter this salon's name (e.g. *Vashi*);
- turn "Bills are also made on this phone" off if this phone only watches the
  branches.

Tap **Connect & create HQ**. In the owner's Drive, a **"SaloonBossX Cloud"**
folder and a **"… SaloonBossX HQ Dashboard"** Google Sheet appear.

## 3. Check the backup
Tap **Backup now**. Then open **Restore from Google Drive**: the backup should
be listed. That is the "phone lost" answer, ready to show the owner.

## 4. Each branch phone
1. On the head-office phone, tap **Share join code** and send it on WhatsApp
   to each branch manager (or to yourself).
2. On the branch phone, go to **Branches & Cloud → Join as a branch**, paste
   the code, type the branch name and tap **Join chain**.
3. On head office, open **HQ Dashboard** and pull down to refresh. The branch
   appears within seconds.

## 5. One price list for the chain (optional)
Set the services and prices on the head-office phone, then tap **Publish price
list to all branches**. Each branch updates on its next sync, which happens
when the app is opened or closed. A branch can turn this off in its settings.

## Things to tell the owner
- Branches **never stop working without internet**. Figures appear at HQ when
  the branch is next online.
- A branch that hasn't synced for 6 hours is flagged on the HQ Dashboard.
- The **join code is a key**. Anyone who has it can read the chain's figures.
  Share it only with branch phones. If it leaks: disconnect all phones, deploy
  a fresh script, and set up HQ again.
- Backups are **encrypted on the phone**. Google and you cannot read them.
  Losing every phone **and** the join code means the backups cannot be opened,
  so ask the owner to keep the join code somewhere safe, e.g. a WhatsApp
  message to themselves.
- To stop, use **Disconnect** on each phone. The data stays on the phones and
  in Drive.

## 6. Online booking (Salon Pro and above)
1. On the salon phone, open **Settings → Online Booking → Setup & link**.
2. Set the opening hours, the weekly off day and the bookable services.
3. Turn **Accept online bookings** on, then tap **Save & publish**.
4. Tap **Open** to see the customer page. Tap **QR poster** and print it for the counter.
5. Paste the link into:
   - **Google Business Profile → Edit profile → Bookings / Appointment links**, which shows a "Book" button on Google Maps;
   - the Instagram bio link;
   - the WhatsApp Business website field.
6. Each branch has its own link, made on that branch's phone.

If the app says **"Update your script"**, follow the steps under *Changing the script later*.
It takes 1 minute and the URL stays the same.

## Test checklist before you sell 5.2
Tick these on a real phone with a real script:
- [ ] "Create my free cloud" opens Make a copy; the ☁️ menu appears in the copy.
- [ ] The sidebar QR scanned with the phone camera opens SaloonBossX on "Your cloud is ready".
- [ ] A join link tapped in WhatsApp on a second phone opens Join with the code filled in.
- [ ] HQ setup creates the Drive folder and the Google Sheet.
- [ ] *Backup now* → *Restore from Google Drive* lists it.
- [ ] A second phone joins with the code; HQ Dashboard shows 2 branches.
- [ ] Make a bill on the branch, close the app, refresh HQ: the figure updates.
- [ ] Publish a price change from HQ; reopen the branch app; the price has
      changed.
- [ ] Airplane mode on the branch: billing still works, and *Sync now* says
      "No internet right now".
- [ ] Wrong date/time on the phone gives the clear "fix date & time" message.
- [ ] Online booking: open the link on another phone (mobile data), book a slot,
      then open the salon app. You should see the notification and the dashboard
      card. Accept it and check the calendar entry and the WhatsApp confirmation.
- [ ] Book the same slot twice from the page. The second attempt is refused
      when there is only one stylist.

## Troubleshooting
| Message | Fix |
|---|---|
| "Google returned a web page instead of data" | Re-deploy with *Who has access: Anyone*, and use the **/exec** URL, not /dev |
| "The join code does not match this Drive" | Paste the code again from head office. The code must belong to the same script |
| "Sorry, unable to open the file at present" | A Google page, not the app. (1) The browser is signed in to several Google accounts: open the link in Incognito or sign out of the others. (2) The link is the /dev or editor link: use the **/exec** Web app URL. (3) The deployment's access is not **Anyone**. (4) The template/copy link was never shared ("Anyone with the link → Viewer"). With the 5.3 shared cloud, owners never open a Google page, which removes (2)–(4). For (1), the booking page now sends the request a second way automatically. |
| "This script is already used by a different chain" | That script already has a salon. Deploy a fresh copy for this owner |
| "Phone date/time is wrong" | Turn on automatic date & time on the phone |
| "Server busy" | Several branches synced at the same moment. It retries by itself |

## Changing the script later
After you edit `google-apps-script/BranchSync.gs`:
1. Run `node tools/embed-script.js`. `npm run preflight` also runs it.
2. Rebuild the app, so "Send the script to myself" shares the new code.
3. In each owner's script project, paste the new code and use **Deploy →
   Manage deployments → Edit → New version**. The URL stays the same.
