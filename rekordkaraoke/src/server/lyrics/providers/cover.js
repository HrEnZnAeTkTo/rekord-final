/**
 * Cover Art Provider (RU Optimized)
 * Priority: Local -> Yandex Music -> iTunes -> Genius
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns");
const logger = require("../../util/logger");
const { makeSafeFilename } = require("../../util/normalize");

// Устанавливаем предпочтение IPv4 (иногда помогает с таймаутами в Node.js)
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CoverProvider {
  constructor(config) {
    this.coversDir = config.paths?.covers || "./data/covers";
    this.timeout = config.timeout || 8000; // 8 секунд на запрос
    this.retries = 2; // Количество повторных попыток
    
    // Yandex требует приличный User-Agent, иначе вернет капчу или 403
    this.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    
    // Очередь загрузок (чтобы не качать одну и ту же обложку дважды)
    this._inFlight = new Map();
  }

  async init() {
    await fs.promises.mkdir(this.coversDir, { recursive: true });
  }

  // === 1. ПРОВЕРКА ЛОКАЛЬНОГО ФАЙЛА ===
  async checkLocal(artist, title) {
    const safeName = makeSafeFilename(artist, title);
    const extensions = ['.jpg', '.jpeg', '.png', '.webp'];

    for (const ext of extensions) {
      const filename = `${safeName}${ext}`;
      const filePath = path.join(this.coversDir, filename);
      
      try {
        await fs.promises.access(filePath);
        // Если файл существует и размер > 0
        const stat = await fs.promises.stat(filePath);
        if (stat.size > 0) {
            logger.debug(`[Cover] Found local: ${filename}`);
            return `/covers/${encodeURIComponent(filename)}`;
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  // === ОСНОВНОЙ МЕТОД ===
  async getCover(artist, title) {
    // 1. Сначала ищем локально
    const local = await this.checkLocal(artist, title);
    if (local) return local;

    // Имя файла для сохранения (всегда .jpg для простоты)
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);
    const publicUrl = `/covers/${filename}`;

    // Если уже качаем этот файл — вернем промис
    if (this._inFlight.has(filename)) return this._inFlight.get(filename);

    const task = (async () => {
        let imageUrl = null;

        // 2. Yandex Music (Приоритет №1 в РФ)
        try {
            imageUrl = await this._searchYandex(artist, title);
        } catch (e) {
            logger.warn(`Yandex Cover failed: ${e.message}`);
        }

        // 3. iTunes (Приоритет №2)
        if (!imageUrl) {
            try {
                imageUrl = await this._searchItunes(artist, title);
            } catch (e) {
                logger.warn(`iTunes Cover failed: ${e.message}`);
            }
        }

        // 4. Genius (Приоритет №3 - Backup)
        if (!imageUrl) {
            try {
                imageUrl = await this._searchGenius(artist, title);
            } catch (e) {
                logger.warn(`Genius Cover failed: ${e.message}`);
            }
        }

        if (imageUrl) {
            logger.info(`[Cover] Downloading from: ${imageUrl}`);
            const success = await this._downloadImageAtomic(imageUrl, filePath);
            return success ? publicUrl : null;
        }
        
        return null;
    })();

    this._inFlight.set(filename, task);
    try {
        return await task;
    } finally {
        this._inFlight.delete(filename);
    }
  }

  // === ПРОВАЙДЕР: YANDEX MUSIC ===
  async _searchYandex(artist, title) {
    const query = encodeURIComponent(`${artist} ${title}`);
    // Используем публичный хендлер, который использует веб-версия
    const url = `https://music.yandex.ru/handlers/music-search.jsx?text=${query}&type=tracks&lang=ru`;

    const res = await this._fetchWithTimeout(url, {
        headers: {
            "User-Agent": this.userAgent,
            "Accept": "application/json",
            "Referer": "https://music.yandex.ru/"
        }
    });

    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();

    const tracks = data.tracks?.items;
    if (!tracks || tracks.length === 0) return null;

    // Берем первый трек
    const track = tracks[0];
    if (!track.coverUri) return null;

    // coverUri приходит вида: "avatars.yandex.net/get-music-content/123/456.%%.jpg"
    // Нам нужно заменить "%%" на размер, например "600x600"
    const rawUrl = track.coverUri.replace('%%', '600x600');
    return `https://${rawUrl}`;
  }

  // === ПРОВАЙДЕР: ITUNES ===
  async _searchItunes(artist, title) {
    const query = encodeURIComponent(`${artist} ${title}`);
    const url = `https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=1`;

    const res = await this._fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) return null;

    const item = data.results[0];
    if (!item.artworkUrl100) return null;

    // Меняем размер 100x100 на 600x600 (High Res)
    return item.artworkUrl100.replace('100x100bb', '600x600bb');
  }

  // === ПРОВАЙДЕР: GENIUS ===
  async _searchGenius(artist, title) {
    const query = encodeURIComponent(`${artist} ${title}`);
    const url = `https://genius.com/api/search/multi?q=${query}`;

    const res = await this._fetchWithTimeout(url, {
        headers: { "User-Agent": this.userAgent }
    });
    
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    
    // Ищем в секциях секцию 'song'
    const sections = data.response?.sections;
    if (!sections) return null;

    const songSection = sections.find(s => s.type === 'song');
    if (!songSection || !songSection.hits || songSection.hits.length === 0) return null;

    const hit = songSection.hits[0];
    return hit.result?.song_art_image_url || null;
  }

  // === UTIL: ЗАГРУЗКА ===
  async _downloadImageAtomic(url, filePath) {
    const tmp = `${filePath}.tmp`;

    try {
      const res = await this._fetchWithTimeout(url);
      if (!res.ok) return false;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1024) return false; // Слишком маленький файл - подозрительно

      await fs.promises.writeFile(tmp, buffer);
      await fs.promises.rename(tmp, filePath);
      return true;
    } catch (e) {
      // Удаляем временный файл если что-то пошло не так
      fs.promises.unlink(tmp).catch(() => {});
      logger.warn(`Download failed: ${e.message}`);
      return false;
    }
  }

  // === UTIL: FETCH С ТАЙМАУТОМ И ПОВТОРАМИ ===
  async _fetchWithTimeout(url, options = {}, retries = this.retries) {
    for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), this.timeout);
        
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                throw new Error(`Retryable status ${res.status}`);
            }
            return res;
        } catch (err) {
            clearTimeout(id);
            const isLast = i === retries;
            if (isLast) throw err;
            await sleep(500 * (i + 1)); // Backoff
        }
    }
  }
}

module.exports = CoverProvider;