# Vantage

A stock market simulator that lets you learn how investing works by trading with play money against real market data.

> **Disclaimer:** Vantage is for informational and educational purposes only. It does not provide financial advice. See [Disclaimer](#disclaimer) for details.

## What problem does it solve?

Learning to invest has a bad first step: the only realistic way to practice is to risk real money. Paper-trading tools that avoid that risk tend to be either buried inside a brokerage account you must open and fund first, or so simplified that they teach nothing about how a real portfolio behaves.

Vantage removes the risk without removing the realism:

- **Trade with simulated cash against real prices.** Deposit play money into a virtual "bank" balance, then buy and sell using live quotes and historical charts pulled from real market data.
- **Watch a portfolio behave over time.** Holdings track average cost, unrealized profit and loss, and total portfolio value, so you see how positions actually move — not a static list of tickers.
- **Organize what you follow.** Custom watchlists, pinning, manual ordering, and per-symbol chart ranges let you build the habits of tracking a market.
- **Ask questions in context.** A built-in AI assistant (Vantage AI) answers questions grounded in your actual watchlist and holdings — what a sector is, why a position moved, how to read a chart.
- **Keep your progress.** Sign in and your balance, holdings, transaction history, watchlists, and preferences sync across devices.

The intended user is someone learning markets — a student, a first-time investor, or anyone who wants to test an idea before committing real capital.

## Architecture

Vantage is a single-page React app backed by a small Python market-data API, with Firebase handling identity and storage.

```
Browser (React + Vite)
  ├── /api/*  ──►  FastAPI service (Python)  ──►  Yahoo Finance (via yfinance)
  │                  quotes · history · search · news · image proxy
  ├── Firebase Auth        (email + password sign-in)
  ├── Cloud Firestore      (users/{uid} — balance, holdings, transactions, prefs)
  └── Firebase AI Logic    (Gemini — the Vantage AI assistant)
```

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 4, Radix UI, Recharts, Motion |
| Backend | FastAPI, Uvicorn, yfinance (Python 3.12) |
| Auth & data | Firebase Auth, Cloud Firestore |
| AI | Firebase AI Logic, `gemini-flash-latest` |
| Hosting | Vercel (frontend), Render (API), Firebase (auth + Firestore) |

### Key paths

| Path | Purpose |
| --- | --- |
| `src/app/App.tsx` | Main application — pages, trading logic, state, Firestore sync |
| `src/app/lib/firebase.ts` | Firebase init, auth helpers, debounced user-state persistence |
| `src/app/lib/stocks.ts` | Market data client, quote caching, sparkline prefetch |
| `src/app/lib/gemini.ts` | Vantage AI chat session and prompt context |
| `src/app/components/` | Shared UI components |
| `server/main.py` | FastAPI market-data API |
| `firestore.rules` | Firestore security rules and schema validation |

The API surface is small: `/api/quotes`, `/api/history/{symbol}`, `/api/search`, `/api/news/{symbol}`, `/api/img`, and `/api/health`.

## Local development setup

### Prerequisites

- **Node.js 20 or 22+** and npm — Vite 6.4 requires `^18.0.0 || ^20.0.0 || >=22.0.0`; Node 24 LTS is recommended since 18 is end-of-life
- **Python 3.12** — matches the version pinned for production in `render.yaml`
- A **Firebase project** with Email/Password authentication and Cloud Firestore enabled

### 1. Clone and install frontend dependencies

```bash
git clone <repository-url> Vantage
cd Vantage
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root. All client variables must be prefixed with `VITE_` to be exposed to the browser (see `envPrefix` in `vite.config.ts`).

```bash
# Firebase web config — from Firebase Console → Project settings → Your apps
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:abcdef123456
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX   # optional

# Leave empty for local dev — Vite proxies /api to the local FastAPI server.
# Set to a full URL only if you want the browser to call a remote API directly.
VITE_API_BASE_URL=
```

Every `VITE_FIREBASE_*` variable except `MEASUREMENT_ID` is required. If one is missing, the app deliberately refuses to boot and renders the missing variable's name instead of failing silently (`src/app/lib/firebase.ts`).

The Firebase web config is public by design — it ships inside the browser bundle. It is not a secret, but you should still restrict the API key by HTTP referrer in the Google Cloud Console. `.env` and `.env.*` are gitignored, with `.env.example` and `.env.production` explicitly allowed.

### 3. Set up the backend

The `npm run api` script expects a virtualenv at `server/.venv`, so create it at exactly that path:

```bash
python3.12 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
```

### 4. Configure Firebase

In the [Firebase Console](https://console.firebase.google.com):

1. **Authentication** → enable the **Email/Password** provider.
2. **Firestore Database** → create a database.
3. **Firebase AI Logic** → enable it with the Gemini Developer API backend, so the Vantage AI assistant works.

Then publish the security rules. Firestore is deny-by-default here, so the app cannot read or write until they are deployed:

```bash
npm install -g firebase-tools
firebase login
firebase use your-project-id
firebase deploy --only firestore:rules,firestore:indexes
```

### 5. Run it

Start both the API and the frontend together:

```bash
npm run dev:all
```

The app opens at **http://localhost:5173**. Vite proxies `/api/*` to the FastAPI server on port 8000, so the browser only ever talks to one origin in development.

To run the two halves separately in different terminals:

```bash
npm run api    # FastAPI on http://127.0.0.1:8000 (auto-reload)
npm run dev    # Vite on http://localhost:5173
```

Verify the API is healthy:

```bash
curl http://127.0.0.1:8000/api/health
```

### Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 with HMR |
| `npm run api` | FastAPI dev server on port 8000 with auto-reload |
| `npm run dev:all` | Both of the above concurrently — the usual way to work |
| `npm run build` | Production build to `dist/` |

There is no test or lint script configured yet.

### Notes for developers

- **Signed out, nothing persists.** Guest sessions keep state in memory only and reset on reload. Sign in to exercise the Firestore sync path.
- **Writes are debounced.** User state is written as a single full-document `setDoc` to `users/{uid}`, 800ms after the last change, coalescing rapid trades into one write.
- **The API caches to disk.** `server/.yf_cache.json` holds market data between restarts and is gitignored. Delete it if you suspect stale quotes.
- **Upstream data can be rate-limited.** Yahoo Finance may throttle or return partial data. The UI degrades to a `stale` or `error` status and keeps the last good prices rather than showing placeholders.

## Deploying to production

Production runs across three services. The frontend and API deploy independently; only Firestore rules need the Firebase CLI.

### 1. Backend — Render

`render.yaml` defines the service, so a Blueprint deploy picks up the whole configuration:

- **Service:** `vantage-api`, Python runtime, Oregon region, root directory `server`
- **Build:** `pip install -r requirements.txt`
- **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Health check:** `/api/health`

To deploy, connect the repository to Render as a Blueprint (or create a Web Service pointing at `render.yaml`). Render redeploys on push to the tracked branch.

**Environment variables** — set on the Render service, not committed as secrets:

| Variable | Purpose |
| --- | --- |
| `PYTHON_VERSION` | `3.12.8` |
| `VANTAGE_CORS_ORIGINS` | Comma-separated list of browser origins allowed to call the API. **Must include your production frontend URL**, or requests fail CORS. |
| `VANTAGE_CORS_ORIGIN_REGEX` | Regex covering Vercel preview deployment URLs, which change per deploy |

Both CORS variables have defaults in `server/main.py`, but the deployed values in `render.yaml` are the ones that matter. Adding a new frontend domain means updating `VANTAGE_CORS_ORIGINS` — this is the most common cause of a production frontend that loads but shows no market data.

Note the free Render plan sleeps after inactivity, so the first request after an idle period can take several seconds.

### 2. Frontend — Vercel

```bash
npm install -g vercel
vercel --prod
```

Or connect the repository to Vercel for automatic deploys on push, with preview deployments per pull request.

Vercel settings:

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables:** every `VITE_FIREBASE_*` value for the production Firebase project. Vite inlines these at build time, so **changing one requires a redeploy**, not just a restart.
- **`VITE_API_BASE_URL`:** leave **empty**. `vercel.json` rewrites `/api/:path*` to the Render service, so the browser makes same-origin requests and avoids CORS entirely. Setting this variable bypasses the rewrite and makes the browser call Render directly — only do that deliberately.

If you point the API at a different Render service, update the rewrite destination in `vercel.json`.

### 3. Firebase — auth and Firestore rules

Rules are not deployed by Vercel or Render. Push them yourself whenever `firestore.rules` or `firestore.indexes.json` changes:

```bash
firebase use your-production-project-id
firebase deploy --only firestore:rules,firestore:indexes
```

Also confirm in the Firebase Console that your production domain is listed under **Authentication → Settings → Authorized domains**, or sign-in will be rejected in production.

### Deployment checklist

1. `npm run build` passes locally.
2. Firestore rules and indexes deployed to the production Firebase project.
3. Production domain added to Firebase authorized domains.
4. Render env vars set, including the production URL in `VANTAGE_CORS_ORIGINS`.
5. Vercel env vars set; `VITE_API_BASE_URL` left empty.
6. After deploy: `/api/health` returns OK, sign-in works, quotes and charts load.

## Disclaimer

**Vantage is for informational and educational purposes only. It does not provide financial advice.**

- Nothing in this application — including market data, charts, news, portfolio metrics, or output from the Vantage AI assistant — constitutes financial, investment, tax, legal, or other professional advice, and none of it is a recommendation, offer, or solicitation to buy or sell any security.
- All trading in Vantage is **simulated**. Balances, deposits, holdings, and transactions use play money with no real-world value. No real funds are held, transferred, or invested, and the app connects to no brokerage or bank.
- Market data is sourced from third-party providers and may be delayed, incomplete, or inaccurate. It is not suitable for any real trading decision.
- The AI assistant is powered by a large language model and can produce content that is incorrect, outdated, or misleading. Verify anything it tells you against authoritative sources.
- Simulated results do not predict real outcomes. Investing involves risk, including the possible loss of principal.
- Consult a qualified, licensed financial professional before making any investment decision. You are solely responsible for any decision you make, and the authors and contributors accept no liability for any loss arising from use of this application.
