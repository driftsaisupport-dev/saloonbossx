# SaloonBossX 6.0.0 "Global" — the universal edition

SaloonBossX was built for Indian salons. 6.0 makes it work for any salon, spa or
barbershop in the world, and moves selling to premium monthly / yearly plans.

## Countries (src/config/regions.ts)
- 38 countries built in plus "Other country (US$)": India, US, UK, Canada, Australia,
  New Zealand, Ireland, Germany, France, Spain, Italy, Netherlands, Portugal, UAE,
  Saudi Arabia, Qatar, Kuwait, Oman, Bahrain, Singapore, Malaysia, Indonesia,
  Philippines, Thailand, Pakistan, Bangladesh, Sri Lanka, Nepal, Nigeria, Kenya,
  Ghana, South Africa, Egypt, Türkiye, Brazil, Mexico, Colombia, Chile.
- Each country sets: currency + symbol, number/date locale, compact units (L/Cr vs K/M),
  phone format and dial code, tax name (GST, VAT, Sales tax, IVA, MwSt, TVA…), tax-id
  name and quick rates, the QR wallet (UPI, PIX, PayNow, M-Pesa, GCash, Bizum…), cash
  notes for day close, and its subscription price list.
- New installs pick the country from the phone's locale; owners can change it in
  onboarding ("Where is your salon?") and Settings → Country & currency.
- Existing Indian installs are untouched (₹, GST with CGST/SGST, UPI, +91).

## What changes outside India
- Bills say "Invoice"/"Receipt"; tax shows as one line (VAT 20%), not CGST/SGST.
- Tax reports become a monthly / yearly tax summary (GSTR tabs only in India).
- QR on bills encodes the owner's payment link or wallet id (PayPal.me and Revolut get the amount).
- Phones: local numbers validated per country; tourists' +international numbers kept.
- Amounts: decimal comma (12,50) works where the locale uses it.
- Starter menus, demo salon, examples and bulk price rounding use local salon prices.
- Every India-only word in the UI (₹, GST, GSTIN, UPI, udhaar, CA) is swapped for the local one.
- Online booking page and Cloud Bridge: salon's currency, time zone and phone rules.

## Languages
- New: Spanish, Portuguese, French (core screens), joining English + 7 Indian languages.

## Pricing (src/services/licensePlans.ts → MONTHLY_PRICE_BOOK)
- Monthly and Yearly only (yearly = 10 × monthly, two months free). Lifetime keys
  already sold keep working; lifetime is no longer offered.
- Priced in 32 currencies. US$: Solo 19, Salon Pro 39, Salon + Academy 59, Chain 99 per month.
  India: ₹499 / ₹999 / ₹1,499 / ₹2,499 per month.
- Checkout URL now carries `currency` and `country`; UPI pay-on-phone only in India.

## Tests
- 109 automated tests (8 new for countries, phones, prices and the booking server).
