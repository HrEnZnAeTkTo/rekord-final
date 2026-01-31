#!/usr/bin/env node
/**
 * OSC Emulator - эмулирует rkbx_link для тестирования
 * 
 * Использование:
 *   node emulator.js                    # интерактивный режим
 *   node emulator.js --auto             # авто-режим с тестовыми треками
 *   node emulator.js --track "Artist" "Title"  # загрузить конкретный трек
 */

const dgram = require('dgram');
const readline = require('readline');

const HOST = '127.0.0.1';
const PORT = 4460;  // куда шлём (туда слушает наш сервер)

const socket = dgram.createSocket('udp4');

// Простой OSC encoder
function encodeOscString(str) {
  const buf = Buffer.from(str + '\0', 'utf8');
  const padding = (4 - (buf.length % 4)) % 4;
  return Buffer.concat([buf, Buffer.alloc(padding)]);
}

function encodeOscFloat(val) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(val, 0);
  return buf;
}

function sendOsc(address, typeTag, ...args) {
  const parts = [
    encodeOscString(address),
    encodeOscString(',' + typeTag)
  ];
  
  for (let i = 0; i < args.length; i++) {
    const type = typeTag[i];
    if (type === 's') {
      parts.push(encodeOscString(args[i]));
    } else if (type === 'f') {
      parts.push(encodeOscFloat(args[i]));
    }
  }
  
  const msg = Buffer.concat(parts);
  socket.send(msg, PORT, HOST);
}

// Состояние эмулятора
let currentTrack = { artist: '', title: '' };
let currentTime = 0;
let bpm = 128;
let isPlaying = false;
let timeInterval = null;

function loadTrack(artist, title) {
  currentTrack = { artist, title };
  currentTime = 0;
  
  console.log(`\n▶ Loading: ${artist} - ${title}`);
  
  sendOsc('/track/master/artist', 's', artist);
  sendOsc('/track/master/title', 's', title);
  sendOsc('/bpm/master/current', 'f', bpm);
  sendOsc('/time/master', 'f', 0);
}

function play() {
  if (isPlaying) return;
  isPlaying = true;
  
  console.log('▶ Playing...');
  
  timeInterval = setInterval(() => {
    currentTime += 0.1;
    sendOsc('/time/master', 'f', currentTime);
    
    // Beat каждые 60/bpm секунд
    const beatInterval = 60 / bpm;
    const beat = currentTime / beatInterval;
    sendOsc('/beat/master', 'f', beat);
  }, 100);
}

function pause() {
  if (!isPlaying) return;
  isPlaying = false;
  clearInterval(timeInterval);
  console.log('⏸ Paused');
}

function seek(time) {
  currentTime = time;
  sendOsc('/time/master', 'f', currentTime);
  console.log(`⏩ Seek to ${time.toFixed(1)}s`);
}

function setBpm(newBpm) {
  bpm = newBpm;
  sendOsc('/bpm/master/current', 'f', bpm);
  console.log(`🎵 BPM: ${bpm}`);
}

// Тестовые треки
const testTracks = [
  { artist: 'Дети RAVE', title: 'Zidane' },
];

// Авто-режим
async function autoMode() {
  console.log('🤖 Auto mode started\n');
  
  for (const track of testTracks) {
    loadTrack(track.artist, track.title);
    play();
    
    // Играем 15 секунд
    await new Promise(r => setTimeout(r, 250000));
    pause();
    
    // Пауза между треками
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n✅ Auto mode finished');
  process.exit(0);
}

// Интерактивный режим
function interactiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`
╔════════════════════════════════════════════╗
║         rkbx_link OSC Emulator             ║
╠════════════════════════════════════════════╣
║ Commands:                                  ║
║   load <artist> - <title>   Load track     ║
║   play                      Start playback ║
║   pause                     Pause          ║
║   seek <seconds>            Jump to time   ║
║   bpm <value>               Set BPM        ║
║   test                      Load test track║
║   quit                      Exit           ║
╚════════════════════════════════════════════╝
`);

  let testIndex = 0;

  rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase();
    const parts = input.trim().split(/\s+/);
    
    if (cmd === 'play') {
      play();
    } else if (cmd === 'pause') {
      pause();
    } else if (cmd === 'quit' || cmd === 'exit') {
      pause();
      socket.close();
      rl.close();
      process.exit(0);
    } else if (cmd === 'test') {
      const track = testTracks[testIndex % testTracks.length];
      testIndex++;
      loadTrack(track.artist, track.title);
    } else if (parts[0] === 'load') {
      const rest = input.slice(5).trim();
      const match = rest.match(/(.+?)\s*-\s*(.+)/);
      if (match) {
        loadTrack(match[1].trim(), match[2].trim());
      } else {
        console.log('Usage: load Artist - Title');
      }
    } else if (parts[0] === 'seek' && parts[1]) {
      seek(parseFloat(parts[1]) || 0);
    } else if (parts[0] === 'bpm' && parts[1]) {
      setBpm(parseFloat(parts[1]) || 128);
    } else {
      console.log('Unknown command. Type "quit" to exit.');
    }
    
    rl.prompt();
  });

  rl.prompt();
}

// Main
const args = process.argv.slice(2);

if (args[0] === '--auto') {
  autoMode();
} else if (args[0] === '--track' && args[1] && args[2]) {
  loadTrack(args[1], args[2]);
  play();
} else {
  interactiveMode();
}
