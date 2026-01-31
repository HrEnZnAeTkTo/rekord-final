/**
 * Unified Lyrics Provider
 * Sources: Yandex Music (RU), Megalobiz (Global), LRCLIB (Open)
 * Priority: Yandex -> Megalobiz -> LRCLIB
 */

const cheerio = require('cheerio');
const logger = require('../../util/logger');

class UnifiedLyricsProvider {
  constructor(config = {}) {
    this.name = 'UnifiedProvider';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.timeout = config.timeout || 10000;
    
    // Включаем LRCLIB по умолчанию, если явно не отключен
    this.useLrclib = config.lrclib !== false;
  }

  /**
   * Главный метод поиска.
   * Пробегает по всем источникам по очереди.
   */
  async search(artist, title) {
    let result = null;

    // 1. YANDEX MUSIC (Лучшее качество для РФ, часто есть таймкоды)
    try {
      result = await this._searchYandex(artist, title);
      if (result) return result;
    } catch (e) {
      logger.warn(`[Unified] Yandex failed: ${e.message}`);
    }

    // 2. MEGALOBIZ (Огромная база .lrc от пользователей)
    try {
      result = await this._searchMegalobiz(artist, title);
      if (result) return result;
    } catch (e) {
      logger.warn(`[Unified] Megalobiz failed: ${e.message}`);
    }

    // 3. LRCLIB (Открытая база, очень быстрая)
    if (this.useLrclib) {
      try {
        result = await this._searchLrclib(artist, title);
        if (result) return result;
      } catch (e) {
        logger.warn(`[Unified] LRCLIB failed: ${e.message}`);
      }
    }

    return null;
  }

  // ===========================================================================
  // ИСТОЧНИК 1: YANDEX MUSIC
  // ===========================================================================
  async _searchYandex(artist, title) {
    const query = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://music.yandex.ru/handlers/music-search.jsx?text=${query}&type=tracks&lang=ru`;
    
    const searchRes = await this._fetch(searchUrl);
    const searchData = await searchRes.json();
    
    const track = searchData.tracks?.items?.[0];
    if (!track || !track.id) return null;

    // Получаем детали трека и текст
    const lyricsUrl = `https://music.yandex.ru/handlers/track-lyrics.jsx?trackId=${track.id}`;
    const lyricsRes = await this._fetch(lyricsUrl);
    const lyricsData = await lyricsRes.json();

    // Вариант А: Ссылка на файл (LRC/XML)
    if (lyricsData.downloadUrl) {
        const fileRes = await this._fetch(lyricsData.downloadUrl);
        const fileText = await fileRes.text();
        
        // Если это XML (TTML), мы пока пропускаем, так как нужен конвертер.
        // Но если это LRC (текст с []), берем.
        if (fileText.includes('[00:')) {
            return {
                content: fileText,
                format: '.lrc',
                meta: { source: 'YandexMusic', duration: track.durationMs ? track.durationMs / 1000 : 0 }
            };
        }
    }
    
    // Вариант Б: JSON с линиями (самый частый)
    if (lyricsData.result?.lyrics?.lines) {
        const lrc = this._yandexToLrc(lyricsData.result.lyrics.lines);
        return {
            content: lrc,
            format: '.lrc',
            meta: { source: 'YandexMusic', duration: track.durationMs ? track.durationMs / 1000 : 0 }
        };
    }

    return null;
  }

  _yandexToLrc(lines) {
    return lines.map(line => {
      if (typeof line.time === 'undefined') return '';
      const min = Math.floor(line.time / 60000);
      const sec = Math.floor((line.time % 60000) / 1000);
      const ms = Math.floor((line.time % 1000) / 10);
      return `[${this._pad(min)}:${this._pad(sec)}.${this._pad(ms)}]${line.text || ''}`;
    }).join('\n');
  }

  // ===========================================================================
  // ИСТОЧНИК 2: MEGALOBIZ
  // ===========================================================================
  async _searchMegalobiz(artist, title) {
    const query = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://www.megalobiz.com/search/all?qry=${query}&display=lrc`;

    const html = await this._fetchText(searchUrl);
    const $ = cheerio.load(html);

    // Берем первую ссылку в результатах
    const link = $('.entity_name a').first().attr('href');
    if (!link) return null;

    const trackUrl = `https://www.megalobiz.com${link}`;
    const trackHtml = await this._fetchText(trackUrl);
    const $t = cheerio.load(trackHtml);

    const lrcContent = $t('#lrc_content').val();
    if (!lrcContent || !lrcContent.includes('[')) return null;

    return {
      content: lrcContent,
      format: '.lrc',
      meta: { source: 'Megalobiz' }
    };
  }

  // ===========================================================================
  // ИСТОЧНИК 3: LRCLIB
  // ===========================================================================
  async _searchLrclib(artist, title) {
    const query = new URLSearchParams({ 
      artist_name: artist, 
      track_name: title 
    });
    
    // Используем метод get для точного совпадения
    const url = `https://lrclib.net/api/get?${query}`;
    
    const res = await this._fetch(url);
    if (res.status === 404) return null; // Не найдено
    
    const data = await res.json();
    
    if (data.syncedLyrics) {
      return {
        content: data.syncedLyrics,
        format: '.lrc',
        meta: { source: 'LRCLIB', duration: data.duration }
      };
    }
    
    return null;
  }

  // ===========================================================================
  // УТИЛИТЫ
  // ===========================================================================
  async _fetch(url) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent, 'Accept': 'application/json' }
      });
      clearTimeout(id);
      if (!res.ok && res.status !== 404) throw new Error(`Status ${res.status}`);
      return res;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  async _fetchText(url) {
    const res = await this._fetch(url);
    return await res.text();
  }

  _pad(num) {
    return num.toString().padStart(2, '0');
  }
}

module.exports = UnifiedLyricsProvider;