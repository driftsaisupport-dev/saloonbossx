# Compliance notes

## Identity documents — why we no longer store full Aadhaar numbers

The academy student form used to collect and store a full 12-digit Aadhaar
number in `academy_students.aadhar`.

Private entities are heavily restricted from storing Aadhaar numbers under the
Aadhaar Act 2016 and UIDAI regulations, and the DPDP Act 2023 adds further
obligations on anyone holding personal data. A salon academy has no lawful basis
to retain one, and the salon owner — not you — carries that exposure.

What changed:

- The form now asks for the **last four digits of any ID proof**, not an Aadhaar
  number specifically. The salon can use a PAN, a driving licence, a voter ID,
  whatever they already photocopy.
- `maskIdNumber()` in `src/utils/sanitize.ts` truncates at the point of write,
  so even if a longer value is pasted, only the last four digits reach the
  database.
- The column name stays `aadhar` so existing installs migrate cleanly. Rename it
  in a future migration once the field has been shipped in this form for a
  release or two.

**Action still required before launch:** run a one-off migration to mask values
already stored by earlier versions. See `src/database/migrations.ts`.

## Invoice numbering

GST Rule 46(b) requires a consecutive serial number, unique within a financial
year. `_nextBillNumber()` allocates inside the same transaction as the insert
and only advances the counter once the row is written, so the series has no
gaps, and it resets on 1 April with the `SOS/26-27/00001` format.

Cancelling a bill issues a **credit note** rather than deleting the row. An
issued invoice number must stay in the series.

## Data residency

All salon data stays on the device in a SQLCipher-encrypted database. Nothing is
uploaded by the app. Backups go where the owner chooses. This is worth stating
plainly in the Play listing and in the sales pitch — it is a genuine advantage
over subscription competitors, not just a limitation.
