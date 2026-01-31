/**
 * RekordKaraoke Frontend
 * Optimized rendering with Transform & Scale & Pre-rendered DOM
 */

const app = document.getElementById('app');
const artistEl = document.getElementById('artist');
const titleEl = document.getElementById('title');
const lyricsEl = document.getElementById('lyrics');
const currentTimeEl = document.getElementById('current-time');
const bpmEl = document.getElementById('bpm');
const progressFill = document.getElementById('progress-fill');
const coverImage = document.getElementById('cover-image');

let lyrics = null;
let ws = null;
let lyricsWrapper = null; // Контейнер для скролла

// Интерполяция времени
let serverTime = 0;
let serverTimestamp = 0;
let isPlaying = true;
let animationFrameId = null;
let lastActiveIndex = -2; // Чтобы форсировать обновление при старте

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getCurrentTime() {
  if (!isPlaying || serverTimestamp === 0) {
    return serverTime;
  }
  const elapsed = (Date.now() - serverTimestamp) / 1000;
  return serverTime + elapsed;
}

// === LYRICS RENDERING (OPTIMIZED) ===

/**
 * Инициализация DOM: вызывается один раз при получении новой лирики.
 * Создает все строки сразу.
 */
function initLyricsDOM() {
  lyricsEl.innerHTML = '';
  lastActiveIndex = -2; // Сброс индекса для ререндера
  
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) return;

  // Создаем обертку
  lyricsWrapper = document.createElement('div');
  lyricsWrapper.className = 'lyrics-wrapper';
  lyricsEl.appendChild(lyricsWrapper);

  // Генерируем строки
  lyrics.lines.forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'lyric-line'; // Начальный класс
    div.textContent = line.text;
    div.dataset.index = i;
    lyricsWrapper.appendChild(div);
  });
}

/**
 * Обновление кадра: ищет активную строку, меняет классы и сдвигает контейнер.
 */
function renderLyrics(currentTime) {
  if (!lyrics || !lyrics.lines || !lyricsWrapper) return;

  // 1. Ищем индекс активной строки
  let activeIndex = -1;
  
  for (let i = 0; i < lyrics.lines.length; i++) {
    // Используем endTime, если он есть, или начало следующей строки
    const start = lyrics.lines[i].time;
    const end = lyrics.lines[i].endTime || (i < lyrics.lines.length - 1 ? lyrics.lines[i+1].time : start + 10);

    if (currentTime >= start && currentTime < end) {
      activeIndex = i;
      break;
    }
  }

  // Граничные условия
  if (activeIndex === -1 && lyrics.lines.length > 0) {
    // Если время больше последней строки -> последняя активна
    if (currentTime >= lyrics.lines[lyrics.lines.length - 1].time) {
      activeIndex = lyrics.lines.length - 1;
    }
  }

  // Оптимизация: не трогаем DOM, если активная строка не изменилась
  if (activeIndex === lastActiveIndex) return;
  lastActiveIndex = activeIndex;

  // 2. Обновляем классы и считаем смещение
  const children = lyricsWrapper.children;
  const viewportHeight = lyricsEl.offsetHeight;
  let scrollOffset = 0;
  let activeElement = null;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    let newClass = 'lyric-line';

    if (i === activeIndex) {
      newClass += ' active';
      activeElement = child;
    } else if (i === activeIndex + 1) {
      newClass += ' next';
    } else if (i < activeIndex) {
      newClass += ' past';
    }
    // Остальные остаются 'lyric-line' (с blur и opacity)

    // Меняем класс только если нужно (DOM performance)
    if (child.className !== newClass) {
      child.className = newClass;
    }
  }

  // 3. Сдвигаем контейнер к центру активной строки
  if (activeElement) {
    // Вычисляем центр:
    // (Позиция строки внутри wrapper) + (Половина высоты строки) - (Половина высоты экрана)
    const centerPos = activeElement.offsetTop + (activeElement.offsetHeight / 2);
    scrollOffset = -(centerPos - (viewportHeight / 2));
  } else {
    scrollOffset = 0; 
  }

  // Hardware accelerated translate
  lyricsWrapper.style.transform = `translate3d(0, ${scrollOffset}px, 0)`;
}

// === PROGRESS ===

function updateProgress(currentTime) {
  if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    progressFill.style.width = '0%';
    return;
  }
  
  const duration = lyrics.duration || 
    (lyrics.lines[lyrics.lines.length - 1].time + 10);
    
  const progress = Math.min(100, Math.max(0, (currentTime / duration) * 100));
  progressFill.style.width = `${progress}%`;
}

// === ANIMATION LOOP ===

function tick() {
  const time = getCurrentTime();
  currentTimeEl.textContent = formatTime(time);
  renderLyrics(time);
  updateProgress(time);
  animationFrameId = requestAnimationFrame(tick);
}

function startAnimationLoop() {
  if (animationFrameId === null) {
    animationFrameId = requestAnimationFrame(tick);
  }
}

function stopAnimationLoop() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// === COVER ===

function setCover(url) {
  if (!coverImage) return;
  const img = new Image();
  img.onload = () => { coverImage.src = url; };
  img.onerror = () => { coverImage.src = ''; };
  img.src = url;
}

function updateFallback(artist, title) {
  if (artist && title) {
    lyricsEl.setAttribute('data-fallback', `${artist} — ${title}`);
  } else {
    lyricsEl.setAttribute('data-fallback', '');
  }
}

// === WEBSOCKET ===

function connect() {
  const wsUrl = `ws://${location.hostname}:${location.port || 3000}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to server');
    app.classList.remove('disconnected');
    startAnimationLoop();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (err) {
      console.error('Failed to parse message:', err);
    }
  };

  ws.onclose = () => {
    console.log('Disconnected, reconnecting...');
    app.classList.add('disconnected');
    setTimeout(connect, 2000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      artistEl.textContent = msg.data.artist || '—';
      titleEl.textContent = msg.data.title || 'Waiting for track...';
      serverTime = msg.data.time || 0;
      
      // Обновляем isPlaying из стейта
      if (typeof msg.data.isPlaying !== 'undefined') {
        isPlaying = msg.data.isPlaying;
      }

      if (isPlaying) {
        serverTimestamp = Date.now();
      } else {
        serverTimestamp = 0;
      }
      
      bpmEl.textContent = msg.data.bpm ? `${Math.round(msg.data.bpm)} BPM` : '— BPM';
      
      lyrics = msg.data.lyrics;
      app.className = `status-${msg.data.lyricsStatus}`;
      updateFallback(msg.data.artist, msg.data.title);
      
      if (msg.data.coverUrl) setCover(msg.data.coverUrl);
      
      // Инициализируем DOM, если лирика уже есть
      initLyricsDOM();
      break;

    case 'track':
      artistEl.textContent = msg.data.artist || '—';
      titleEl.textContent = msg.data.title || '—';
      lyrics = null;
      lyricsEl.innerHTML = ''; // Очистка
      serverTime = 0;
      serverTimestamp = Date.now();
      
      app.className = `status-${msg.data.status}`;
      updateFallback(msg.data.artist, msg.data.title);
      if (coverImage) coverImage.src = '';
      progressFill.style.width = '0%';
      break;

    case 'lyrics':
      app.className = `status-${msg.data.status}`;
      
      if (msg.data.status === 'found' && msg.data.lyrics) {
        lyrics = msg.data.lyrics;
        // Строим DOM, когда пришла новая лирика
        initLyricsDOM();
      } else {
        // === ВАЖНО: Очищаем старую лирику, если новая не найдена ===
        lyrics = null;
        lyricsEl.innerHTML = '';
        if (lyricsWrapper) lyricsWrapper = null;
        // ==========================================================
      }
      break;

    case 'cover':
      if (msg.data) setCover(msg.data);
      break;

    case 'time':
      serverTime = msg.data;
      if (isPlaying) {
        serverTimestamp = Date.now();
      }
      break;

    case 'bpm':
      bpmEl.textContent = `${Math.round(msg.data)} BPM`;
      break;

    case 'status':
      if (typeof msg.data.isPlaying !== 'undefined') {
        isPlaying = msg.data.isPlaying;
        
        if (!isPlaying) {
            serverTimestamp = 0; 
            renderLyrics(serverTime);
            updateProgress(serverTime);
            currentTimeEl.textContent = formatTime(serverTime);
        } else {
            serverTimestamp = Date.now();
        }
      }
      break;
  }
}

// Start
connect();