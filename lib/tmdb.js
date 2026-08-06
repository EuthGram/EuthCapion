// lib/tmdb.js
// Thin wrapper around TMDb's REST API. Keeps all HTTP + data-shaping logic
// isolated from the webhook handler.

const axios = require('axios');

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/original';

function client(apiKey) {
  return axios.create({
    baseURL: BASE_URL,
    params: { api_key: apiKey },
    timeout: 8000,
  });
}

function posterUrl(posterPath) {
  return posterPath ? `${IMAGE_BASE}${posterPath}` : null;
}

// ---- Search ----

async function searchMovie(query, apiKey) {
  const { data } = await client(apiKey).get('/search/movie', {
    params: { query, include_adult: false },
  });
  return data.results?.[0] || null;
}

async function searchTv(query, apiKey) {
  const { data } = await client(apiKey).get('/search/tv', {
    params: { query, include_adult: false },
  });
  return data.results?.[0] || null;
}

// TMDb has no dedicated "anime" media type. Anime is TV/movie content tagged
// with the Animation genre (id 16), usually of Japanese origin. We search TV
// first (most anime requests are series) and prefer an Animation-tagged hit;
// if nothing matches we fall back to the top TV result, then movies.
async function searchAnime(query, apiKey) {
  const { data } = await client(apiKey).get('/search/tv', {
    params: { query, include_adult: false },
  });
  const results = data.results || [];
  const animeHit = results.find((r) => r.genre_ids?.includes(16)) || results[0];
  if (animeHit) return { result: animeHit, type: 'tv' };

  const { data: movieData } = await client(apiKey).get('/search/movie', {
    params: { query, include_adult: false },
  });
  const movieResults = movieData.results || [];
  const movieHit = movieResults.find((r) => r.genre_ids?.includes(16)) || movieResults[0];
  return movieHit ? { result: movieHit, type: 'movie' } : null;
}

// ---- Details ----

async function getMovieDetails(id, apiKey) {
  const { data } = await client(apiKey).get(`/movie/${id}`, {
    params: { append_to_response: 'external_ids' },
  });
  return data;
}

async function getTvDetails(id, apiKey) {
  const { data } = await client(apiKey).get(`/tv/${id}`, {
    params: { append_to_response: 'external_ids' },
  });
  return data;
}

// Tries /tmdb <id> against movie first, then tv, since the ID alone doesn't
// tell us the media type.
async function getByTmdbId(id, apiKey) {
  try {
    const details = await getMovieDetails(id, apiKey);
    return { details, type: 'movie' };
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }
  const details = await getTvDetails(id, apiKey);
  return { details, type: 'tv' };
}

async function getByImdbId(imdbId, apiKey) {
  const { data } = await client(apiKey).get(`/find/${imdbId}`, {
    params: { external_source: 'imdb_id' },
  });
  if (data.movie_results?.length) {
    const details = await getMovieDetails(data.movie_results[0].id, apiKey);
    return { details, type: 'movie' };
  }
  if (data.tv_results?.length) {
    const details = await getTvDetails(data.tv_results[0].id, apiKey);
    return { details, type: 'tv' };
  }
  return null;
}

// ---- Normalization into caption-ready fields ----

function normalizeMovie(details) {
  return {
    title: details.title,
    year: (details.release_date || '').slice(0, 4) || 'N/A',
    season: '',
    episodes: 'N/A',
    status: details.status || 'Unknown',
    rating: details.vote_average ? details.vote_average.toFixed(1) : 'N/A',
    genres: (details.genres || []).map((g) => g.name).join(', ') || 'N/A',
    overview: details.overview || 'No overview available.',
    runtime: details.runtime ? `${details.runtime} min` : 'N/A',
    country: (details.production_countries || []).map((c) => c.name).join(', ') || 'N/A',
    language: (details.spoken_languages || []).map((l) => l.english_name).join(', ') || 'N/A',
    imdb: details.external_ids?.imdb_id || 'N/A',
    tmdb: details.id,
    poster: posterUrl(details.poster_path),
  };
}

function normalizeTv(details) {
  const seasons = details.number_of_seasons;
  return {
    title: details.name,
    year: (details.first_air_date || '').slice(0, 4) || 'N/A',
    season: seasons ? `S${seasons}` : '',
    episodes: details.number_of_episodes ?? 'N/A',
    status: details.status || 'Unknown',
    rating: details.vote_average ? details.vote_average.toFixed(1) : 'N/A',
    genres: (details.genres || []).map((g) => g.name).join(', ') || 'N/A',
    overview: details.overview || 'No overview available.',
    runtime: details.episode_run_time?.[0] ? `${details.episode_run_time[0]} min` : 'N/A',
    country: (details.origin_country || []).join(', ') || 'N/A',
    language: (details.spoken_languages || []).map((l) => l.english_name).join(', ') || 'N/A',
    imdb: details.external_ids?.imdb_id || 'N/A',
    tmdb: details.id,
    poster: posterUrl(details.poster_path),
  };
}

function normalize(details, type) {
  return type === 'movie' ? normalizeMovie(details) : normalizeTv(details);
}

module.exports = {
  searchMovie,
  searchTv,
  searchAnime,
  getMovieDetails,
  getTvDetails,
  getByTmdbId,
  getByImdbId,
  normalize,
  posterUrl,
};
