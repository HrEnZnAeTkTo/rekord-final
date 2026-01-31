const fs = require('fs');
const path = require('path');
const Store = require('./store');
const { getLibrary } = require('./library');
const { makeSafeFilename, makeKey } = require('../util/normalize');
const parsers = require('../parsers');
const logger = require('../util/logger');

// Импортируем наш единый провайдер
const UnifiedLyricsProvider = require('./providers/unified');

class Resolver {
  constructor(config) {
    this.config = config;
    this.store = new Store({
      lyricsRaw: config.paths.lyricsRaw,
      lyricsJson: config.paths.lyricsJson
    });
    this.library = null;
    this.rawDir = config.paths.lyricsRaw;
    
    this.pendingRequests = new Map();

    // Инициализируем ЕДИНЫЙ провайдер
    // Он внутри себя разберется с Яндекс/Мегалобиз/LRCLIB
    this.provider = new UnifiedLyricsProvider({
        timeout: 8000,
        lrclib: config.providers?.lrclib?.enabled // Можно выключить через конфиг
    });
  }

  async init() {
    await this.store.init();
    this.library = await getLibrary(this.config.paths.library);
  }

  /**
   * Resolve lyrics: Local -> Provider (Unified)
   */
  async resolve(artist, title, options = {}) {
    const { skipLocal = false, skipProviders = false } = options;
    const key = makeKey(artist, title);

    // 1. Library Check (Cache)
    if (!skipLocal) {
      const cached = this.library.find(artist, title);
      if (cached) {
        logger.debug(`Library hit: "${artist} - ${title}"`);
        return cached;
      }
    }

    // 2. Pending Requests Mutex
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    const requestPromise = this._doResolve(artist, title, skipLocal, skipProviders);
    this.pendingRequests.set(key, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  async _doResolve(artist, title, skipLocal, skipProviders) {
    // 1. Check Local Files (.lrc/.srt in raw folder)
    if (!skipLocal) {
      const localResult = await this.checkLocalFiles(artist, title);
      if (localResult) return localResult;
    }

    // 2. Ask Unified Provider
    if (!skipProviders) {
      try {
        logger.debug(`Searching via Unified Provider...`);
        const result = await this.provider.search(artist, title);
        
        if (result && result.content) {
          logger.info(`Found via ${result.meta?.source || 'Unified'}: "${artist} - ${title}"`);
          
          // Save to store
          const stored = await this.store.save(
            artist, 
            title, 
            result.content, 
            result.format,
            result.meta?.duration
          );
          
          // Add to library index
          await this.library.add(artist, title, {
            ...stored,
            provider: result.meta?.source || 'Unified'
          });

          return this.library.find(artist, title);
        }
      } catch (e) {
        logger.warn(`Unified search error: ${e.message}`);
      }
    }

    logger.warn(`Not found: "${artist} - ${title}"`);
    return null;
  }

  async checkLocalFiles(artist, title) {
    const baseName = makeSafeFilename(artist, title);
    const formats = parsers.getSupportedFormats();

    for (const ext of formats) {
      const rawPath = path.join(this.rawDir, `${baseName}${ext}`);
      try {
        await fs.promises.access(rawPath);
        logger.info(`Found local file: ${rawPath}`);
        const content = await fs.promises.readFile(rawPath, 'utf8');
        const stored = await this.store.save(artist, title, content, ext);
        await this.library.add(artist, title, { ...stored, provider: 'local' });
        return this.library.find(artist, title);
      } catch { }
    }
    return null;
  }
}

module.exports = Resolver;