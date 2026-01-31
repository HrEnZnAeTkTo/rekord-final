#!/usr/bin/env node
/**
 * Prefetch CLI
 * Использование: node prefetch.js <playlist.m3u8|playlist.txt>
 */

const fs = require('fs');
const path = require('path');
const Resolver = require('../lyrics/resolver');
const logger = require('../util/logger');

// Загружаем конфиг
const configPath = path.join(__dirname, '../../../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * Парсит плейлист (m3u8 или txt)
 * Возвращает массив { artist, title }
 */
function parsePlaylist(content, format) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const tracks = [];

  if (format === 'm3u8' || format === 'm3u') {
    // M3U8: #EXTINF:123,Artist - Title
    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        const match = line.match(/#EXTINF:[^,]*,\s*(.+?)\s*-\s*(.+)/);
        if (match) {
          const artist = match[1].trim();
          const title = match[2].trim();
          if (artist && title) {
            tracks.push({ artist, title });
          }
        }
      }
    }
  } else {
    // TXT: Artist - Title (по одному на строку)
    for (let line of lines) {
      // Пропускаем комментарии
      if (line.startsWith('#')) continue;
      
      // Убираем BOM, случайные управляющие символы и лишние пробелы/тире в начале
      line = line
        .replace(/^\uFEFF/, '')           // BOM
        .replace(/^[\s\-–—]+/, '')         // пробелы и тире в начале
        .replace(/[\s\-–—]+$/, '')         // пробелы и тире в конце
        .trim();
      
      if (!line) continue;
      
      // Ищем разделитель " - " (с пробелами)
      const match = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      if (match) {
        const artist = match[1].trim();
        const title = match[2].trim();
        if (artist && title) {
          tracks.push({ artist, title });
        } else {
          logger.warn(`Skipping invalid line (empty artist/title): "${line}"`);
        }
      } else {
        logger.warn(`Skipping unparseable line: "${line}"`);
      }
    }
  }

  return tracks;
}

/**
 * Парсит rekordbox XML экспорт
 */
function parseRekordboxXml(content) {
  const tracks = [];
  const trackRegex = /<TRACK[^>]*Artist="([^"]*)"[^>]*Name="([^"]*)"[^>]*>/gi;
  
  let match;
  while ((match = trackRegex.exec(content)) !== null) {
    if (match[1] && match[2]) {
      tracks.push({ artist: match[1], title: match[2] });
    }
  }
  
  return tracks;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node prefetch.js <playlist.m3u8|playlist.txt|playlist.xml>');
    console.log('       node prefetch.js --all (все плейлисты из data/playlists)');
    process.exit(1);
  }

  const resolver = new Resolver(config);
  await resolver.init();

  let allTracks = [];

  if (args[0] === '--all') {
    // Все плейлисты из директории
    const playlistDir = config.paths.playlists;
    const files = await fs.promises.readdir(playlistDir);
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!['.m3u8', '.m3u', '.txt', '.xml'].includes(ext)) continue;
      
      const content = await fs.promises.readFile(path.join(playlistDir, file), 'utf8');
      const tracks = ext === '.xml' 
        ? parseRekordboxXml(content)
        : parsePlaylist(content, ext.slice(1));
      
      logger.info(`Playlist ${file}: ${tracks.length} tracks`);
      allTracks.push(...tracks);
    }
  } else {
    // Конкретный файл
    const playlistPath = args[0];
    const ext = path.extname(playlistPath).toLowerCase();
    const content = await fs.promises.readFile(playlistPath, 'utf8');
    
    allTracks = ext === '.xml'
      ? parseRekordboxXml(content)
      : parsePlaylist(content, ext.slice(1));
  }

  // Дедупликация
  const seen = new Set();
  const uniqueTracks = allTracks.filter(t => {
    const key = `${t.artist.toLowerCase()}::${t.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(`Total unique tracks: ${uniqueTracks.length}`);

  // Прогоняем
  const report = {
    timestamp: new Date().toISOString(),
    total: uniqueTracks.length,
    found: 0,
    notFound: 0,
    errors: 0,
    results: []
  };

  for (let i = 0; i < uniqueTracks.length; i++) {
    const { artist, title } = uniqueTracks[i];
    const progress = `[${i + 1}/${uniqueTracks.length}]`;
    
    try {
      const result = await resolver.resolve(artist, title);
      
      if (result) {
        report.found++;
        report.results.push({ artist, title, status: 'found', ...result });
        logger.info(`${progress} ✓ ${artist} - ${title}`);
      } else {
        report.notFound++;
        report.results.push({ artist, title, status: 'not_found' });
        logger.warn(`${progress} ✗ ${artist} - ${title}`);
      }
    } catch (err) {
      report.errors++;
      report.results.push({ artist, title, status: 'error', error: err.message });
      logger.error(`${progress} ! ${artist} - ${title}: ${err.message}`);
    }

    // Небольшая задержка между запросами
    if (i < uniqueTracks.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Сохраняем отчёт
  const reportDir = config.paths.reports;
  await fs.promises.mkdir(reportDir, { recursive: true });
  
  const reportName = `prefetch_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const reportPath = path.join(reportDir, reportName);
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Итоги
  console.log('\n=== SUMMARY ===');
  console.log(`Total:     ${report.total}`);
  console.log(`Found:     ${report.found} (${Math.round(report.found / report.total * 100)}%)`);
  console.log(`Not found: ${report.notFound}`);
  console.log(`Errors:    ${report.errors}`);
  console.log(`Report:    ${reportPath}`);
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
