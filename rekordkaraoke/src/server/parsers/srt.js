/**
 * SRT Parser
 * Формат:
 * 1
 * 00:00:12,340 --> 00:00:15,670
 * Текст субтитров
 */

function parseTimestamp(ts) {
  const match = ts.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return null;
  
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4].padEnd(3, '0').slice(0, 3), 10);
  
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function parse(content, options = {}) {
  const { duration = null } = options;
  const blocks = content.trim().split(/\r?\n\r?\n/);
  const result = {
    meta: {},
    lines: []
  };

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 2) continue;

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const [startTs, endTs] = timeLine.split('-->').map(s => s.trim());
    
    const time = parseTimestamp(startTs);
    const endTime = parseTimestamp(endTs);
    if (time === null || endTime === null) continue;

    const text = lines.slice(timeLineIdx + 1).join(' ').trim();
    if (!text) continue;

    result.lines.push({ time, endTime, text });
  }

  result.lines.sort((a, b) => a.time - b.time);

  if (duration) {
    result.duration = duration;
  }

  return result;
}

module.exports = { parse };
