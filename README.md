# EuthCap

A lightweight Telegram bot that searches Movies, TV Series, and Anime on TMDb and replies with a poster + a beautifully formatted caption. Webhook-only, no polling, no Express — built to run on Vercel's serverless functions.

Made by **Euthle**.

## Features

- `/movie <name>`, `/series <name>`, `/anime <name>` — search and get poster + caption
- `/tmdb <id>` — fetch directly by TMDb ID
- `/imdb <id>` — fetch directly by IMDb ID
- `/setcaption` — admins can edit the caption template live from Telegram
- `/addadmin`, `/removeadmin`, `/admins` — owner-managed admin list
- `/settings` — view bot name, footer, developer, admins, TMDb key status
- Clean `/start` message with Settings / Caption / Help / Developer buttons
- Results never include buttons — just poster + caption

## Project Structure

```
api/webhook.js   — Telegram webhook handler (Vercel serverless function)
lib/tmdb.js      — TMDb API wrapper
lib/utils.js     — config storage, Telegram send helpers, caption rendering
data/config.json — seed config (bot name, footer, caption template, admins)
```

## Setup

1. **Create a Telegram bot** via [@BotFather](https://t.me/BotFather) and grab the token.
2. **Get a TMDb API key** at https://www.themoviedb.org/settings/api (v3 auth key).
3. **Get your Telegram user ID** via [@userinfobot](https://t.me/userinfobot) — this becomes `OWNER_ID`.
4. Copy `.env.example` to `.env` locally, or add the same three variables in the Vercel dashboard:
   - `BOT_TOKEN`
   - `TMDB_API_KEY`
   - `OWNER_ID`

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Set the environment variables in the Vercel project settings (Project → Settings → Environment Variables), then redeploy:

```bash
vercel --prod
```

## Register the Telegram Webhook

Once deployed, point Telegram at your function (replace both placeholders):

```bash
curl -F "url=https://YOUR-PROJECT.vercel.app/api/webhook" \
  https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
```

Confirm it's set:

```bash
curl https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

## ⚠️ A note on config storage

Vercel's serverless filesystem is **read-only** except for `/tmp`, and `/tmp` is wiped on cold starts / redeploys. `data/config.json` is seeded on first run and cached in `/tmp` for as long as the instance stays warm, so `/setcaption`, `/addadmin`, etc. work in real time — but changes are **not guaranteed to survive a redeploy or a cold start**. `OWNER_ID` is always re-seeded as an admin automatically, so ownership is never lost.

If you need admin/caption changes to persist permanently across deploys, swap `loadConfig` / `saveConfig` in `lib/utils.js` for a call to an external store (Vercel KV, Upstash Redis, a small Postgres table, etc). The rest of the bot doesn't need to change.

## Caption Placeholders

`{title}` `{year}` `{season}` `{episodes}` `{status}` `{rating}` `{genres}` `{overview}` `{runtime}` `{country}` `{language}` `{imdb}` `{tmdb}`

Edit the template any time with `/setcaption` (admins only).

---

Project: **EuthCap** · Made by **Euthle**
