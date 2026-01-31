const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const LinkBridge = require('./link-bridge');
const Resolver = require('./lyrics/resolver');
const CoverProvider = require('./lyrics/providers/cover');
const logger = require('./util/logger');

// Загружаем конфиг
const configPath = path.join(__dirname, '../../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Текущее состояние для клиентов
let currentState = {
  artist: '',
  title: '',
  time: 0,
  bpm: 0,
  lyrics: null,
  lyricsStatus: 'none',
  coverUrl: null
};

// WebSocket клиенты
const wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

async function main() {
  // Инициализируем resolver
  const resolver = new Resolver(config);
  await resolver.init();

  // Инициализируем провайдер обложек
  const coverProvider = new CoverProvider({
    paths: { covers: config.paths?.covers || './data/covers' },
    timeout: 5000
  });
  await coverProvider.init();

  // HTTP сервер для статики
  const server = http.createServer((req, res) => {
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };

    let filePath;
    
    // Роут для обложек
    if (req.url.startsWith('/covers/')) {
      filePath = path.join(__dirname, '../../data/covers', decodeURIComponent(req.url.slice(8)));
    } else {
      filePath = path.join(__dirname, '../public', req.url === '/' ? 'index.html' : req.url);
    }
    
    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    });
  });

  // WebSocket сервер
  const wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws) => {
    logger.info('Client connected');
    wsClients.add(ws);
    
    ws.send(JSON.stringify({ type: 'state', data: currentState }));
    
    ws.on('close', () => {
      wsClients.delete(ws);
      logger.info('Client disconnected');
    });
  });

  // Link Bridge (OSC от rkbx_link)
  const bridge = new LinkBridge(config.osc);
  
  bridge.on('trackChanged', async ({ artist, title }) => {
    currentState.artist = artist;
    currentState.title = title;
    currentState.lyrics = null;
    currentState.lyricsStatus = 'loading';
    currentState.coverUrl = null;
    
    broadcast({ type: 'track', data: { artist, title, status: 'loading' } });
    
    // Параллельно ищем лирику и обложку
    const [lyricsResult, coverUrl] = await Promise.all([
      resolver.resolve(artist, title),
      coverProvider.getCover(artist, title).catch(err => {
        logger.error(`Cover error: ${err.message}`);
        return null;
      })
    ]);
    
    // Обложка
    if (coverUrl) {
      currentState.coverUrl = coverUrl;
      broadcast({ type: 'cover', data: coverUrl });
    }
    
    // Лирика
    if (lyricsResult) {
      try {
        const lyrics = await resolver.store.load(lyricsResult.jsonPath);
        currentState.lyrics = lyrics;
        currentState.lyricsStatus = 'found';
        broadcast({ type: 'lyrics', data: { status: 'found', lyrics } });
      } catch (err) {
        logger.error(`Failed to load lyrics: ${err.message}`);
        currentState.lyricsStatus = 'not_found';
        broadcast({ type: 'lyrics', data: { status: 'not_found' } });
      }
    } else {
      currentState.lyricsStatus = 'not_found';
      broadcast({ type: 'lyrics', data: { status: 'not_found' } });
    }
  });

  bridge.on('time', (time) => {
    currentState.time = time;
    broadcast({ type: 'time', data: time });
  });

  bridge.on('bpm', (bpm) => {
    currentState.bpm = bpm;
    broadcast({ type: 'bpm', data: bpm });
  });

  bridge.start();

  const port = config.server.httpPort || 3000;
  server.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    logger.info('Waiting for OSC from rkbx_link...');
  });
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
