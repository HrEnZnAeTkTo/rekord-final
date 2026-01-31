/**
 * LRC Parser
 * Формат: [mm:ss.xx] текст строки
 */

function parseTimestamp(ts) {
  const match = ts.match(/(\d+):(\d+)[.:](\d+)/);
  if (!match) return null;
  
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const ms = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
  
  return minutes * 60 + seconds + ms / 1000;
}

function parse(content, options = {}) {
  const { duration = null } = options;
  const lines = content.split(/\r?\n/);
  const result = {
    meta: {},
    lines: []
  };

  for (const line of lines) {
    // Метаданные: [ti:Title], [ar:Artist], [al:Album], [offset:+/-ms], [length:mm:ss]
    const metaMatch = line.match(/^\[(\w+):(.+)\]$/);
    if (metaMatch) {
      const [, key, value] = metaMatch;
      result.meta[key.toLowerCase()] = value.trim();
      continue;
    }

    // Тайм-коды: [00:12.34] текст
    const timestamps = [];
    let text = line;
    let match;
    
    while ((match = text.match(/^\[(\d+:\d+[.:]\d+)\]/))) {
      const time = parseTimestamp(match[1]);
      if (time !== null) timestamps.push(time);
      text = text.slice(match[0].length);
    }

    text = text.trim();
    if (timestamps.length === 0 || !text) continue;

    for (const time of timestamps) {
      result.lines.push({ time, text });
    }
  }

  // Сортируем по времени
  result.lines.sort((a, b) => a.time - b.time);

  // Определяем длительность трека
  let trackDuration = duration;
  
  // Пробуем взять из метаданных [length:mm:ss]
  if (!trackDuration && result.meta.length) {
    const lengthMatch = result.meta.length.match(/(\d+):(\d+)/);
    if (lengthMatch) {
      trackDuration = parseInt(lengthMatch[1], 10) * 60 + parseInt(lengthMatch[2], 10);
    }
  }

  // Вычисляем endTime для каждой строки
  for (let i = 0; i < result.lines.length; i++) {
    if (i < result.lines.length - 1) {
      result.lines[i].endTime = result.lines[i + 1].time;
    } else {
      // Последняя строка: используем duration или +30 сек для длинных аутро
      result.lines[i].endTime = trackDuration || (result.lines[i].time + 30);
    }
  }

  // Применяем offset если есть
  if (result.meta.offset) {
    const offsetMs = parseInt(result.meta.offset, 10) || 0;
    const offsetSec = offsetMs / 1000;
    for (const line of result.lines) {
      line.time = Math.max(0, line.time + offsetSec);
      line.endTime = Math.max(0, line.endTime + offsetSec);
    }
  }

  if (trackDuration) {
    result.duration = trackDuration;
  }

  return result;
}

module.exports = { parse };
