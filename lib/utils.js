// lib/utils.js
// Shared helpers: persistent-ish config storage, Telegram API calls, caption rendering.
//
// NOTE ON STORAGE: Vercel serverless functions have a READ-ONLY filesystem except
// for /tmp, and /tmp is wiped whenever an instance is recycled (cold start).
// That means true persistent JSON storage is not possible on Vercel without an
// external store (Vercel KV, Upstash Redis, a database, etc). To keep this
// project dependency-free and matching the "JSON storage" requirement, config
// is seeded from data/config.json on cold start and cached in /tmp for the
// lifetime of the running instance. Writes (admins, caption, settings) will
// survive as long as the same instance stays warm, but WILL reset after a
// redeploy or a cold start. If you need guaranteed persistence, swap
// loadConfig/saveConfig below for a call to an external KV/DB.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SEED_PATH = path.join(__dirname, '..', 'data', 'config.json');
const RUNTIME_PATH = path.join('/tmp', 'euthcap-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(RUNTIME_PATH)) {
      return JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read runtime config, falling back to seed:', err.message);
  }

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

  // OWNER_ID from env is always an implicit admin, seeded once.
  if (process.env.OWNER_ID && !seed.admins.includes(Number(process.env.OWNER_ID))) {
    seed.admins.push(Number(process.env.OWNER_ID));
  }

  saveConfig(seed);
  return seed;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(RUNTIME_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to persist config to /tmp:', err.message);
  }
  return config;
}

function isOwner(userId) {
  return String(userId) === String(process.env.OWNER_ID);
}

function isAdmin(config, userId) {
  return isOwner(userId) || config.admins.includes(Number(userId));
}

function getTmdbKey(config) {
  return config.tmdbApiKey || process.env.TMDB_API_KEY || '';
}

// ---- Telegram API ----

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

async function sendMessage(chatId, text, extra = {}) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (err) {
    console.error('sendMessage failed:', err.response?.data || err.message);
  }
}

async function sendPhoto(chatId, photoUrl, caption) {
  try {
    await axios.post(`${TELEGRAM_API}/sendPhoto`, {
      chat_id: chatId,
      photo: photoUrl,
      caption,
    });
  } catch (err) {
    console.error('sendPhoto failed:', err.response?.data || err.message);
    // Fallback to a text message if Telegram rejects the photo (e.g. bad poster URL)
    await sendMessage(chatId, caption);
  }
}

// ---- Caption rendering ----

function renderCaption(template, data, config) {
  const values = {
    title: data.title || 'Unknown',
    year: data.year || '—',
    season: data.season || '',
    episodes: data.episodes || '—',
    status: data.status || 'Unknown',
    rating: data.rating || '—',
    genres: data.genres || '—',
    overview: data.overview || 'No overview available.',
    runtime: data.runtime || '—',
    country: data.country || '—',
    language: data.language || '—',
    imdb: data.imdb || '—',
    tmdb: data.tmdb || '—',
    footer: config.footer || '',
  };

  let out = template;
  for (const [key, val] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(val);
  }

  // Clean up a stray "(S) ()" style artifact when season is empty (movies).
  out = out.replace(/\s*\(\)\s*/g, ' ').replace(/[ \t]+\n/g, '\n');

  // Respect Telegram's 1024 char caption limit for photos.
  if (out.length > 1024) {
    out = out.slice(0, 1000).trimEnd() + '…';
  }
  return out;
}

module.exports = {
  loadConfig,
  saveConfig,
  isOwner,
  isAdmin,
  getTmdbKey,
  sendMessage,
  sendPhoto,
  renderCaption,
};
