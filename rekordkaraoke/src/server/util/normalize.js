/**
 * Нормализация artist/title для поиска и индексации
 */

/**
 * Полная нормализация для ключей библиотеки
 */
function normalize(str) {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
    .replace(/\s*(feat\.?|ft\.?|featuring)\s+.*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sа-яё]/gi, '')
    .trim();
}

/**
 * Лёгкая очистка для поиска в API (сохраняет регистр)
 */
function cleanForSearch(str) {
  if (!str) return '';
  return str
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
    .replace(/\s*(feat\.?|ft\.?|featuring)\s+.*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeKey(artist, title) {
  const normArtist = normalize(artist);
  const normTitle = normalize(title);
  return `${normArtist}::${normTitle}`;
}

function makeSafeFilename(artist, title) {
  const safe = str => (str || 'unknown')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 50);
  
  return `${safe(artist)}_-_${safe(title)}`;
}

module.exports = { normalize, cleanForSearch, makeKey, makeSafeFilename };
