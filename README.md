# Shadoku

A murder-mystery logic puzzle. Suspects see along rows and columns until something blocks the view; place every suspect so that nobody sees anybody else, and the last empty tile is where the killer, S. H. Adow, hides.

React + Vite front end, hosted on Cloudflare Pages at <https://shadoku.net>. Sign-in with Google or GitHub runs on Cloudflare Pages Functions (`functions/`).

## Run it

```
npm install
npm run dev        # the game; sign-in falls back to a local demo session (no backend)
npm run build      # → dist/
npm run dev:cf     # build + Cloudflare Pages locally, with the real sign-in backend (needs .dev.vars)
```

The puzzle files are in `src/puzzles/`. Translations are in `src/locales/<lang>.json`.

## Deploy (Cloudflare Pages)

```
npx wrangler login
npm run deploy     # vite build, then wrangler pages deploy dist --project-name shadoku
```

Then in the Cloudflare dashboard attach the custom domain (Workers & Pages → shadoku → Custom domains).

### Sign-in setup

The backend needs two OAuth apps and a session secret. Redirect URIs are `https://<your-domain>/api/auth/google/callback` and `https://<your-domain>/api/auth/github/callback` (add `http://localhost:8788/…` ones for `npm run dev:cf`).

1. **Google**: Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application). Add the redirect URI above. Configure the consent screen (scopes `openid`, `email`, `profile`).
2. **GitHub**: Settings → Developer settings → OAuth Apps → New OAuth App. Callback URL = the redirect URI above.
3. **Secrets** (production; locally copy `.dev.vars.example` to `.dev.vars`):

   ```
   npx wrangler pages secret put SESSION_SECRET      --project-name shadoku   # 32+ random characters
   npx wrangler pages secret put GOOGLE_CLIENT_ID    --project-name shadoku
   npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name shadoku
   npx wrangler pages secret put GITHUB_CLIENT_ID    --project-name shadoku
   npx wrangler pages secret put GITHUB_CLIENT_SECRET --project-name shadoku
   ```

4. **Unique codenames** (optional): `npx wrangler kv namespace create SHADOKU_KV`, then uncomment `[[kv_namespaces]]` in `wrangler.toml` with the printed id and redeploy. Without it, people can sign in but codenames are not reserved.

5. **Ranking and community puzzles** (D1): the database `shadoku` (`npx wrangler d1 create shadoku`) is bound as `SHADOKU_DB` in `wrangler.toml`; a new account would create its own and paste its `database_id` there. The tables are created on first use (`functions/_lib/db.js`). Without it, sign-in and the game work as before; the Ranking tab and the community pages say they are unavailable.

Testing the ranking and the community puzzles locally, with several players and no OAuth apps:

```
npm run build
npx wrangler pages dev dist --d1 SHADOKU_DB --binding DEV_LOGIN=1 --binding SESSION_SECRET=<32+ random characters>
```

Then open `http://localhost:8788/api/auth/dev/login` to sign in as a test player (a private window = a second player; the page can also add six sample players to the ranking). That test sign-in answers 404 unless `DEV_LOGIN=1` is set and the page is served from localhost, so it never works in production.

**The Android app's wallet** (`functions/api/app/`, `functions/_lib/app/`). Syndicate Coins, hints, inventory, quests and the daily streak live in the same D1 database, in tables that come from `migrations/` (not created on first use): `npx wrangler d1 migrations apply shadoku --local` for the database `wrangler pages dev` uses, `--remote` for production. Until the migrations are applied, `/api/app/*` answers 503 `schema` and the site is unaffected. The phone never sends an amount: it reports events (a solve, a claim) and the server prices them from its own tables; every change of a balance is a ledger line, and database triggers refuse a balance no line explains. Play Billing and AdMob verification are stubs behind `functions/_lib/app/verifiers.js` and fail closed (503, nothing granted). For test builds only, `--binding DEV_ADS=1` and `--binding DEV_BILLING=1` stand in for them on localhost and Pages preview addresses, never on the site's own domain. Tests: `npm run test:wallet` (in `npm test`).

**The app's sign-in** (`functions/api/app/auth/`, `functions/_lib/app/accounts.js`, `identity.js`, `cors.js`; architecture 4.10). The app has no cookie: it holds a bearer token for a device row (migration `0003_app_identity.sql`). `POST /api/app/auth/guest` makes a guest account on first launch; `POST /api/app/auth/google` signs in with a Google ID token made for the site's own `GOOGLE_CLIENT_ID` and brings the guest's things along; `/auth/refresh` renews the token, `/auth/logout` revokes the device, `/auth/link` adds a second sign-in. The API answers CORS for `https://app.shadoku.net` only, without credentials, and never accepts a cookie from it. For the app's browser build (`npm --prefix app run dev`), start wrangler with `--binding APP_DEV_ORIGINS=http://localhost:5183` and `--binding DEV_LOGIN=1`: `POST /api/app/auth/dev {name}` then signs in the same test players as `/api/auth/dev/login`; both work on localhost only. Tests: `npm run test:app-auth` (in `npm test`); over HTTP: `scripts/smoke-app-auth.mjs`.

**The endpoints the app shares with the site, and deleting an account** (`functions/_lib/caller.js`, `eraseAppAccount` in `functions/_lib/app/context.js`; architecture 4.11). `/api/progress`, `/api/community/*`, `/api/username`, `/api/avatar`, `/api/report` and `DELETE /api/account` take the site's cookie as before, or the app's bearer token when the call comes from the app's origin; never a token from the site's origin, never a cookie from the app's. A guest account is refused on them, except to delete itself. Deleting an account erases every row that names it, on both sides, and signs out every phone; what stays without the account id is its purchase rows, their ledger lines (`kept_ledger`) and, for a banned account, a hash of its sign-in (`kept_bans`), all from migration `0004_app_erasure.sql`: apply it before deploying this code, or `/api/app/*` answers 503 `schema`. A permanent purchase (No ads, a membership) of a deleted account comes back to the same sign-in when the app sends its token again. Tests: `npm run test:app-shared` (in `npm test`); over HTTP: `scripts/smoke-app-shared.mjs`.

**How long things are kept** (`functions/_lib/retention.js`, `POST /api/cron/retention`; architecture 4.12). An account not seen for 12 months is deleted; error reports and other logs go after 30 or 90 days. The periods are in that file and in the privacy policy (`ui.legal.s10.p`): the two must say the same. The endpoint needs the Pages secret `CRON_SECRET` and is called every night by the Worker in `tools/cloud/retention` (setup in its README; it starts in dry mode and deletes nothing until you switch it). Tests: `npm run test:retention` (in `npm test`).

How it works: `/api/auth/<provider>/login` sends the player to the provider (state + PKCE), `/callback` exchanges the code and sets an HttpOnly, SameSite=Lax cookie signed with `SESSION_SECRET`; `/api/auth/session` tells the page who is signed in. The server stores only the codename (KV). `DELETE /api/account` erases it, as the legal page promises. A provider whose secrets are not set is simply refused, and without any backend the site keeps its local demo sign-in.
