# Fixtures of `npm run test:verifiers`

What Google answers, kept as files, so `scripts/test-verifiers.mjs` runs with no network. The test plays Google
from these and changes them one field at a time. No file here holds a secret: the test makes its own service-account
key, its own "Google" signing key and its own ad key on every run and keeps none of them.

| File | What it is | A recording? |
|---|---|---|
| `ssv-keys.json` | AdMob's verifier keys, in Google's format. Key `3335741209` is Google's real key, read from `https://www.gstatic.com/admob/reward/verifier-keys.json` on 2026-11-27. Key `990000001` is the synthetic one below. | The first key: yes |
| `ssv-callback.synthetic.txt` | A rewarded-ad callback in AdMob's format, signed by `make-ssv.mjs` with a key pair it made and whose private half it threw away. | No: synthetic |
| `ssv-callback.real.txt` | **Not there yet.** A callback captured from AdMob (below). When the file exists the test checks it against Google's real key, and again with one parameter changed. | Yes, once captured |
| `play-product.json` | `purchases.products.get`: a `ProductPurchase` of `coins_500` by the account `google:8800001` (its hash is in `obfuscatedExternalAccountId`). | No: written from Google's reference |
| `play-subscription.json` | `purchases.subscriptionsv2.get`: a `SubscriptionPurchaseV2`. | No: written from the reference |
| `play-voided.json` | `purchases.voidedpurchases.list`: the purchase above, one this server never saw, one partial refund. | No: written from the reference |
| `rtdn-voided.json` | A Real-time Developer Notification (what `message.data` of the Pub/Sub push decodes to) voiding the purchase above. | No: written from the reference |
| `integrity-verdict.json` | `decodeIntegrityToken`: a standard request's verdict that passes. The test fills in the request hash and the time. | No: written from the reference |

## Capturing a real AdMob callback

Only the owner of the AdMob account can do this, and it is worth doing once: it proves the signature check against a
signature Google really made.

1. Production must know the ad unit (`ADMOB_AD_UNITS`, see `wrangler.toml`) and be deployed.
2. In one terminal: `npx wrangler pages deployment tail --project-name shadoku`
3. In AdMob: Apps > Shadoku > Ad units > the rewarded unit > Server-side verification, enter
   `https://www.shadoku.net/api/app/ads/ssv` and press **Verify URL**. AdMob should say the URL was verified
   (the endpoint answers 200 to anything Google signed for our ad unit; this test callback names no ticket, so it pays nothing).
4. Copy the whole request URL from the tail (it ends in `&signature=...&key_id=...`) into `ssv-callback.real.txt`, one line.
5. `npm run test:verifiers`. If it says the key is unknown, Google rotated its keys: replace the first key of
   `ssv-keys.json` with what `https://www.gstatic.com/admob/reward/verifier-keys.json` shows now.

The same way, a real purchase JSON (Play Console > Order management, or the API Explorer of `purchases.products.get` with a
license tester's token) or a real Integrity verdict can replace the written ones; remove any token, order id and account
hash you would not want in the repository first.

## Remaking the synthetic callback

`node scripts/fixtures/verifiers/make-ssv.mjs` makes a new key pair, signs the callback again and replaces key `990000001`.
