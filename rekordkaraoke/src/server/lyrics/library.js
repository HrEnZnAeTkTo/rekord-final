const path = require('path');
const { readJsonSafe, writeJsonAtomic } = require('../util/fs_atomic');
const { makeKey, normalize } = require('../util/normalize');
const logger = require('../util/logger');

class Library {
  constructor(libraryPath) {
    this.libraryPath = libraryPath;
    this.index = {}; // key -> { jsonPath, rawPath, format, ... }
    this.loaded = false;
  }

  async load() {
    this.index = await readJsonSafe(this.libraryPath, {});
    this.loaded = true;
    logger.info(`Library loaded: ${Object.keys(this.index).length} tracks`);
  }

  async save() {
    await writeJsonAtomic(this.libraryPath, this.index);
  }

  /**
   * Поиск по artist/title
   * Возвращает { jsonPath, rawPath, format } или null
   */
  find(artist, title) {
    const key = makeKey(artist, title);
    return this.index[key] || null;
  }

  /**
   * Добавление записи
   */
  async add(artist, title, entry) {
    const key = makeKey(artist, title);
    this.index[key] = {
      artist,
      title,
      ...entry,
      addedAt: new Date().toISOString()
    };
    await this.save();
    logger.info(`Library: added "${artist} - ${title}"`);
  }

  /**
   * Проверка наличия
   */
  has(artist, title) {
    return !!this.find(artist, title);
  }

  /**
   * Получить все записи
   */
  getAll() {
    return Object.entries(this.index).map(([key, val]) => ({ key, ...val }));
  }

  /**
   * Размер библиотеки
   */
  get size() {
    return Object.keys(this.index).length;
  }
}

// Singleton
let instance = null;

async function getLibrary(libraryPath) {
  if (!instance) {
    instance = new Library(libraryPath);
    await instance.load();
  }
  return instance;
}

module.exports = { Library, getLibrary };
