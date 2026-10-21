# Licences: Monthly and One-time

## Prices (what the app shows)
| Plan | Monthly | One-time | One-time is cheaper after | Devices |
|---|---|---|---|---|
| Solo | ₹199 | ₹1,999 | 11 months | 1 |
| Salon Pro | ₹599 | ₹5,999 | 11 months | 1 |
| Chain | ₹1,299 | ₹12,999 | 11 months | 3 |
| Salon + Academy | ₹899 | ₹9,999 | 12 months | 2 |

A year of monthly payments always costs more than one-time, so owners who can afford it pay
once. The buy screen opens on **One-time (BEST VALUE)**.

Yearly is **hidden**. The app still accepts yearly keys, and
`npm run issue -- --billing yearly` still makes them, for special deals.

Prices live in **one place**, `src/services/licensePlans.ts` (`PRICES`). The key tools
read `tools/lib/sign.js`. Change both together; a test fails if they differ.

## How the keys work
- **One-time** key: never expires (`LIFETIME`).
- **Monthly** key = 31 days (a hidden yearly key = 366 days), counted **from the day the customer
  activates it**. A key bought today and typed in next week still gives the full month.
- **Renewing early:** enter a new key and its days are added *after* the current end date
  (same plan). An old renewal key can't be used twice.
- **Reminders and grace:** the home screen shows a reminder 7 days before the end date. After the
  end date the app keeps working for **3 grace days**. After that it opens the renew screen.
  **No data is ever deleted**, and renewing continues exactly where the salon stopped.
- **Upgrades:** entering a key for a bigger plan or for one-time works any time, on the same phone.
- **Licence server** (`google-apps-script/Code.gs`, optional but recommended):
  - It records the real end date the first time a monthly or yearly key is activated, so
    reinstalling the app can't restart the month.
  - It enforces device limits, and lets you **revoke** a key.
  - **Renew without a new key:** change that row's **Expiry** to the new date (YYYY-MM-DD). The
    phone picks it up within a day, or at once with *"I have already paid — check again"*.

## Your files
| File | What it is | Where |
|---|---|---|
| `license-public.key` | Public key, built into the app | In the project (commit it) |
| `keys/private.key` | Signs keys. **Never share it, and back it up in 2 places** | Sent to you separately |
| `SaloonBossX_Licence_Keys.xlsx` | **1,600 keys**: for each plan, 200 Monthly + 200 One-time. Also price list, sales log and summary (stock left per plan) | Import into Google Sheets |

The 1,600 keys were signed with this private key and **only work with builds made from this
project** (it contains the matching `license-public.key`).

## Selling a key
1. The customer pays.
2. In **Keys Master**, filter by Plan and Billing and take the first row with an empty
   *Customer Name*.
3. Fill in Name, Phone, Sale Date and Amount Paid, then send the key on WhatsApp.
4. The customer pastes the key in the app and taps **Activate**.

## More keys later (on your laptop)
```
npm run batch -- --plan standard --billing monthly --count 200
npm run batch -- --all --count 20            # every plan × (monthly + one-time)
npm run issue -- --plan solo --billing monthly --order UPI-4471     # just one
```
The CSV is saved in `keys/`. In the Google Sheet, use File → Import → *Append to current sheet*.

## Set up the Google Sheet (10 min)
1. Upload `SaloonBossX_Licence_Keys.xlsx` to Drive, open it with Google Sheets, then
   **File → Save as Google Sheets**.
2. Rename that Google Sheet **exactly** `SaloonBossX Licenses`. Delete the uploaded .xlsx so only
   one file has that name.
3. **Extensions → Apps Script:**
   - paste `google-apps-script/Code.gs`;
   - add the Script property `RESPONSE_SECRET` = a long random text;
   - Deploy as a Web app with *Execute as: Me* and *Anyone* access.
4. In `.env`, set:
   - `EXPO_PUBLIC_LICENSE_URL` = the /exec link;
   - `SBX_RESPONSE_SECRET` = the same random text.

   Then rebuild.
