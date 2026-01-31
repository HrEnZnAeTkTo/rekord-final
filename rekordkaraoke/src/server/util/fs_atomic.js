const fs = require('fs');
const path = require('path');

/**
 * Атомарная запись JSON: пишем во временный файл, потом переименовываем
 */
async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp`);
  
  // Убеждаемся что директория существует
  await fs.promises.mkdir(dir, { recursive: true });
  
  // Пишем во временный файл
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  
  // Атомарно переименовываем
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Читаем JSON с fallback на пустой объект/массив
 */
async function readJsonSafe(filePath, defaultValue = {}) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return defaultValue;
    throw err;
  }
}

/**
 * Проверяем существование файла
 */
async function exists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { writeJsonAtomic, readJsonSafe, exists };
