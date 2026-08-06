// api/webhook.js
// Single Vercel serverless function acting as the Telegram webhook endpoint.
// No Express, no polling — Telegram POSTs updates here directly.

const tmdb = require('../lib/tmdb');
const {
  loadConfig,
  saveConfig,
  isOwner,
  isAdmin,
  getTmdbKey,
  sendMessage,
  sendPhoto,
  renderCaption,
} = require('../lib/utils');

const HELP_TEXT = [
  '📚 *EuthCap Help*',
  '',
  '/movie <name> — search a movie',
  '/series <name> — search a TV series',
  '/anime <name> — search an anime',
  '/tmdb <id> — fetch by TMDb ID',
  '/imdb <id> — fetch by IMDb ID',
  '',
  'Admins only:',
  '/setcaption — set a new caption template',
  '/settings — view current bot settings',
  '/addadmin <id> — add an admin (owner only)',
  '/removeadmin <id> — remove an admin (owner only)',
  '/admins — list current admins',
].join('\n');

function developerText(config) {
  return `👨‍💻 *Developer*\n\nProject: ${config.botName}\nMade by ${config.developer}`;
}

function settingsText(config) {
  return [
    '⚙ *Settings*',
    '',
    `Bot Name: ${config.botName}`,
    `Footer: ${config.footer}`,
    `Developer: ${config.developer}`,
    `Admins: ${config.admins.length ? config.admins.join(', ') : 'none'}`,
    `TMDb Key: ${getTmdbKey(config) ? 'configured ✅' : 'missing ⚠️'}`,
    '',
    'Use /setcaption to change the caption template.',
    'Use /addadmin, /removeadmin to manage admins.',
  ].join('\n');
}

function startKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⚙ Settings', callback_data: 'settings' }, { text: '📝 Caption', callback_data: 'caption' }],
        [{ text: '📚 Help', callback_data: 'help' }, { text: '👨‍💻 Developer', callback_data: 'developer' }],
      ],
    },
  };
}

// Fetches TMDb data for a given command type + query/id, returns normalized fields or null.
async function resolveContent(kind, arg, apiKey) {
  if (kind === 'movie') {
    const hit = await tmdb.searchMovie(arg, apiKey);
    if (!hit) return null;
    const details = await tmdb.getMovieDetails(hit.id, apiKey);
    return tmdb.normalize(details, 'movie');
  }
  if (kind === 'series') {
    const hit = await tmdb.searchTv(arg, apiKey);
    if (!hit) return null;
    const details = await tmdb.getTvDetails(hit.id, apiKey);
    return tmdb.normalize(details, 'tv');
  }
  if (kind === 'anime') {
    const found = await tmdb.searchAnime(arg, apiKey);
    if (!found) return null;
    const details =
      found.type === 'movie'
        ? await tmdb.getMovieDetails(found.result.id, apiKey)
        : await tmdb.getTvDetails(found.result.id, apiKey);
    return tmdb.normalize(details, found.type);
  }
  if (kind === 'tmdb') {
    const { details, type } = await tmdb.getByTmdbId(arg, apiKey);
    return tmdb.normalize(details, type);
  }
  if (kind === 'imdb') {
    const found = await tmdb.getByImdbId(arg, apiKey);
    if (!found) return null;
    return tmdb.normalize(found.details, found.type);
  }
  return null;
}

async function handleSearchCommand(chatId, kind, arg, config) {
  const apiKey = getTmdbKey(config);
  if (!apiKey) {
    await sendMessage(chatId, '⚠️ TMDb API key is not configured yet. Ask the bot owner to set TMDB_API_KEY.');
    return;
  }
  if (!arg) {
    await sendMessage(chatId, `Usage: /${kind} <name or id>`);
    return;
  }

  try {
    const data = await resolveContent(kind, arg, apiKey);
    if (!data) {
      await sendMessage(chatId, '❌ No results found.');
      return;
    }
    const caption = renderCaption(config.captionTemplate, data, config);
    if (data.poster) {
      await sendPhoto(chatId, data.poster, caption);
    } else {
      await sendMessage(chatId, caption);
    }
  } catch (err) {
    console.error(`Error resolving ${kind} "${arg}":`, err.response?.data || err.message);
    await sendMessage(chatId, '⚠️ Something went wrong while fetching that. Please try again.');
  }
}

async function handleCommand(message, config) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim();
  const [rawCmd, ...rest] = text.split(/\s+/);
  const cmd = rawCmd.replace(/@\w+$/, ''); // strip @BotName suffix if present
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case '/start': {
      await sendMessage(
        chatId,
        `👋 Welcome to *${config.botName}*!\n\nSend /movie, /series, or /anime followed by a name to get a poster + caption instantly.`,
        { parse_mode: 'Markdown', ...startKeyboard() }
      );
      return;
    }

    case '/help':
      await sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
      return;

    case '/movie':
    case '/series':
    case '/anime': {
      const kind = cmd.slice(1);
      await handleSearchCommand(chatId, kind, arg, config);
      return;
    }

    case '/tmdb':
      await handleSearchCommand(chatId, 'tmdb', arg, config);
      return;

    case '/imdb':
      await handleSearchCommand(chatId, 'imdb', arg, config);
      return;

    case '/setcaption': {
      if (!isAdmin(config, userId)) {
        await sendMessage(chatId, '⛔ Admins only.');
        return;
      }
      config.conversationState[userId] = 'awaiting_caption';
      saveConfig(config);
      await sendMessage(
        chatId,
        'Send the new caption template now. Supported placeholders:\n' +
          '{title} {year} {season} {episodes} {status} {rating} {genres} {overview} {runtime} {country} {language} {imdb} {tmdb}\n\n' +
          'Send /cancel to abort.'
      );
      return;
    }

    case '/cancel': {
      delete config.conversationState[userId];
      saveConfig(config);
      await sendMessage(chatId, 'Cancelled.');
      return;
    }

    case '/settings': {
      if (!isAdmin(config, userId)) {
        await sendMessage(chatId, '⛔ Admins only.');
        return;
      }
      await sendMessage(chatId, settingsText(config), { parse_mode: 'Markdown' });
      return;
    }

    case '/addadmin': {
      if (!isOwner(userId)) {
        await sendMessage(chatId, '⛔ Owner only.');
        return;
      }
      const newId = Number(arg);
      if (!arg || Number.isNaN(newId)) {
        await sendMessage(chatId, 'Usage: /addadmin <telegram_user_id>');
        return;
      }
      if (!config.admins.includes(newId)) {
        config.admins.push(newId);
        saveConfig(config);
      }
      await sendMessage(chatId, `✅ Added admin: ${newId}`);
      return;
    }

    case '/removeadmin': {
      if (!isOwner(userId)) {
        await sendMessage(chatId, '⛔ Owner only.');
        return;
      }
      const targetId = Number(arg);
      if (!arg || Number.isNaN(targetId)) {
        await sendMessage(chatId, 'Usage: /removeadmin <telegram_user_id>');
        return;
      }
      config.admins = config.admins.filter((id) => id !== targetId);
      saveConfig(config);
      await sendMessage(chatId, `✅ Removed admin: ${targetId}`);
      return;
    }

    case '/admins': {
      await sendMessage(
        chatId,
        config.admins.length ? `👑 Admins:\n${config.admins.join('\n')}` : 'No admins added yet.'
      );
      return;
    }

    default:
      // Unknown command — stay silent to avoid noise, or optionally hint at /help.
      return;
  }
}

async function handlePlainText(message, config) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  if (config.conversationState[userId] === 'awaiting_caption') {
    config.captionTemplate = message.text;
    delete config.conversationState[userId];
    saveConfig(config);
    await sendMessage(chatId, '✅ Caption template updated.');
    return true;
  }
  return false;
}

async function handleCallbackQuery(callbackQuery, config) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data === 'settings') await sendMessage(chatId, settingsText(config), { parse_mode: 'Markdown' });
  else if (data === 'caption')
    await sendMessage(chatId, `📝 *Current caption template:*\n\n\`${config.captionTemplate}\``, {
      parse_mode: 'Markdown',
    });
  else if (data === 'help') await sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
  else if (data === 'developer') await sendMessage(chatId, developerText(config), { parse_mode: 'Markdown' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, message: 'EuthCap webhook is alive.' });
    return;
  }

  // Respond fast — Telegram retries if it doesn't get a timely 200.
  res.status(200).json({ ok: true });

  try {
    const update = req.body;
    const config = loadConfig();

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, config);
      return;
    }

    const message = update.message;
    if (!message || !message.text) return;

    if (message.text.startsWith('/')) {
      await handleCommand(message, config);
    } else {
      await handlePlainText(message, config);
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
};
