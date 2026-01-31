/**
 * LRCLIB Provider
 * API: https://lrclib.net/api
 */

const logger = require('../../util/logger');
const { cleanForSearch } = require('../../util/normalize');

class LrclibProvider {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'https://lrclib.net/api';
    this.timeout = config.timeout || 5000;
    this.name = 'lrclib';
  }

  async search(artist, title) {
    // Сначала ищем "как есть"
    let result = await this._doSearch(artist, title);
    if (result) return result;

    // Fallback: очищаем от мусора и пробуем снова
    const cleanArtist = cleanForSearch(artist);
    const cleanTitle = cleanForSearch(title);
    
    if (cleanArtist !== artist || cleanTitle !== title) {
      logger.debug(`LRCLIB fallback search: "${cleanArtist} - ${cleanTitle}"`);
      result = await this._doSearch(cleanArtist, cleanTitle);
      if (result) return result;
    }

    return null;
  }

  async _doSearch(artist, title) {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('artist_name', artist);
    url.searchParams.set('track_name', title);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'RekordKaraoke/1.0' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        logger.warn(`LRCLIB search failed: ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }

      const synced = data.find(item => item.syncedLyrics);
      if (synced) {
        return {
          content: synced.syncedLyrics,
          format: 'lrc',
          provider: this.name,
          meta: {
            id: synced.id,
            artist: synced.artistName,
            title: synced.trackName,
            album: synced.albumName,
            duration: synced.duration
          }
        };
      }

      const plain = data.find(item => item.plainLyrics);
      if (plain) {
        logger.warn(`LRCLIB: only plain lyrics for "${artist} - ${title}"`);
        return null;
      }

      return null;
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`LRCLIB timeout for "${artist} - ${title}"`);
      } else {
        logger.error(`LRCLIB error: ${err.message}`);
      }
      return null;
    }
  }

  async get(artist, title, album = '', duration = 0) {
    const url = new URL(`${this.baseUrl}/get`);
    url.searchParams.set('artist_name', artist);
    url.searchParams.set('track_name', title);
    if (album) url.searchParams.set('album_name', album);
    if (duration) url.searchParams.set('duration', Math.round(duration));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'RekordKaraoke/1.0' }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 404) return null;
        logger.warn(`LRCLIB get failed: ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (!data.syncedLyrics) return null;

      return {
        content: data.syncedLyrics,
        format: 'lrc',
        provider: this.name,
        meta: {
          id: data.id,
          artist: data.artistName,
          title: data.trackName,
          album: data.albumName,
          duration: data.duration
        }
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`LRCLIB timeout for "${artist} - ${title}"`);
      } else {
        logger.error(`LRCLIB error: ${err.message}`);
      }
      return null;
    }
  }
}

module.exports = LrclibProvider;
