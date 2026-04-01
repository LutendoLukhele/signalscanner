# Signal Scanner — Outreach Intelligence System

Automatically scrapes pain signals from Reddit, Twitter/X, G2, and Capterra, scores them, and surfaces reply opportunities in a real-time dashboard.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ / Express |
| Scraping | Playwright + Cheerio |
| Storage | SQLite (better-sqlite3) |
| Scheduling | node-cron |
| AI scoring | Rule-based (free) + optional Ollama (local LLM) |
| Dashboard | Vanilla HTML/JS served as static files |

---

## Prerequisites

- **Node.js 20 or newer** — check with `node -v` (use [nvm](https://github.com/nvm-sh/nvm) if needed)
- **npm** (bundled with Node)

---

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/LutendoLukhele/signalscanner.git
cd signalscanner

# 2. Install dependencies
npm install

# 3. Download Playwright's Chromium browser
npx playwright install chromium

# 4. Create your local config
cp .env.example .env

# 5. Build the TypeScript source
npm run build

# 6. Start the server
npm start
# → http://localhost:3000
```

> **First run?** The SQLite database (`data/signals.db`) is created automatically on startup.

---

## Configuration (`.env`)

Copy `.env.example` to `.env` and adjust as needed:

```env
PORT=3000

# Reddit — no key required (public JSON API)
REDDIT_DELAY_MS=1500

# Nitter instances for Twitter/X (comma-separated, tried in order)
NITTER_INSTANCES=nitter.net,nitter.privacydev.net,nitter.poast.org

# Ollama — optional local LLM scoring (free, zero API cost)
OLLAMA_ENABLED=false
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Cron schedule for automatic daily scans (default: 8 am every day)
CRON_SCHEDULE=0 8 * * *

# LinkedIn — fragile, opt-in only
LINKEDIN_ENABLED=false
```

---

## Development (hot-reload)

```bash
npm run dev
```

---

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/leads` | Paginated lead feed. Query params: `source`, `urgency`, `minScore`, `unrepliedOnly`, `page`, `pageSize` |
| `POST` | `/api/scan` | Trigger a scan immediately (returns at once; scan runs in background) |
| `POST` | `/api/leads/:id/reply` | Save a draft reply — body: `{ "reply": "..." }` |
| `GET` | `/api/stats` | Aggregate counts: total leads, high-urgency, avg score, by source, by pain category |

---

## Project Structure

```
signalscanner/
  src/
    scrapers/
      reddit.ts         # Free unauthenticated JSON API
      twitter.ts        # Nitter public instances (Playwright)
      g2.ts             # Playwright + Cheerio
      capterra.ts       # Playwright + Cheerio
      linkedin.ts       # Opt-in stealth scraper (LINKEDIN_ENABLED=true)
    scorer.ts           # Rule-based scoring + optional Ollama
    db.ts               # SQLite: leads, scans, config tables
    scheduler.ts        # Orchestrates scrapers → scorer → DB
    server.ts           # Express server + cron scheduler
    types.ts            # Shared TypeScript interfaces
  public/
    index.html          # Dashboard UI
    app.js              # Dashboard logic
  data/
    signals.db          # Auto-created SQLite database
  .env.example          # Config template — copy to .env
  tsconfig.json
  package.json
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `cp: .env.example: No such file or directory` | Make sure you are in the repo directory and have pulled the latest code: `git pull` |
| `npm error Missing script: "build"` | Same as above — run `git pull` to get the latest `package.json` |
| `playwright: executable doesn't exist` | Run `npx playwright install chromium` |
| Port already in use | Change `PORT=` in your `.env` file |
| Ollama errors | Either set `OLLAMA_ENABLED=false` in `.env` or start Ollama with `ollama serve` |
