/**
 * Link Bridge - принимает OSC от rkbx_osc (или rkbx_link)
 * 
 * Ожидаемые сообщения:
 * /track/master/title (string)   - название трека
 * /track/master/artist (string)  - исполнитель
 * /time/master (float)           - позиция в секундах
 * /bpm/master/current (float)    - BPM (или /bpm/master)
 * /beat/master (int)             - номер бита
 * /deck/master (int)             - активная дека (0 или 1)
 */

const dgram = require('dgram');
const { EventEmitter } = require('events');
const logger = require('./util/logger');

// Простой OSC парсер (без зависимостей)
function parseOscMessage(buffer) {
  let offset = 0;

  // Читаем адрес (null-terminated string, padded to 4 bytes)
  let addressEnd = buffer.indexOf(0, offset);
  if (addressEnd === -1) return null;
  
  const address = buffer.toString('utf8', offset, addressEnd);
  offset = Math.ceil((addressEnd + 1) / 4) * 4;

  // Читаем type tag string
  if (buffer[offset] !== 0x2C) return null; // должно начинаться с ','
  
  let typeTagEnd = buffer.indexOf(0, offset);
  if (typeTagEnd === -1) return null;
  
  const typeTags = buffer.toString('utf8', offset + 1, typeTagEnd);
  offset = Math.ceil((typeTagEnd + 1) / 4) * 4;

  // Читаем аргументы
  const args = [];
  for (const tag of typeTags) {
    switch (tag) {
      case 'f': // float32
        args.push(buffer.readFloatBE(offset));
        offset += 4;
        break;
      case 'i': // int32
        args.push(buffer.readInt32BE(offset));
        offset += 4;
        break;
      case 's': // string
        let strEnd = buffer.indexOf(0, offset);
        if (strEnd === -1) strEnd = buffer.length;
        args.push(buffer.toString('utf8', offset, strEnd));
        offset = Math.ceil((strEnd + 1) / 4) * 4;
        break;
      default:
        // Неизвестный тип, пропускаем
        break;
    }
  }

  return { address, args };
}

class LinkBridge extends EventEmitter {
  constructor(config) {
    super();
    this.host = config.host || '127.0.0.1';
    this.port = config.port || 4460;
    this.socket = null;
    
    // Текущее состояние
    this.state = {
      master: {
        artist: '',
        title: '',
        time: 0,
        bpm: 0,
        beat: 0,
        deck: 0
      }
    };
    
    // Для отслеживания смены трека
    this.lastTrackKey = '';
    this.trackChangeTimer = null;
  }

  start() {
    this.socket = dgram.createSocket('udp4');
    
    this.socket.on('message', (msg) => {
      try {
        const osc = parseOscMessage(msg);
        if (osc) this.handleOsc(osc);
      } catch (err) {
        logger.error('OSC parse error:', err.message);
      }
    });

    this.socket.on('error', (err) => {
      logger.error('OSC socket error:', err.message);
    });

    this.socket.bind(this.port, this.host, () => {
      logger.info(`LinkBridge listening on ${this.host}:${this.port}`);
    });
  }

  handleOsc({ address, args }) {
    // /track/master/title
    if (address === '/track/master/title' && args[0]) {
      this.state.master.title = String(args[0]);
      this.checkTrackChange();
    }
    // /track/master/artist
    else if (address === '/track/master/artist' && args[0]) {
      this.state.master.artist = String(args[0]);
      this.checkTrackChange();
    }
    // /time/master - принимаем и float (секунды) и int (может быть мс)
    else if (address === '/time/master' && typeof args[0] === 'number') {
      let time = args[0];
      // Если время > 10000, вероятно это миллисекунды - конвертируем
      if (time > 10000) {
        time = time / 1000;
      }
      this.state.master.time = time;
      this.emit('time', this.state.master.time);
    }
    // /bpm/master/current или /bpm/master - оба варианта
    else if ((address === '/bpm/master/current' || address === '/bpm/master') && typeof args[0] === 'number') {
      this.state.master.bpm = args[0];
      this.emit('bpm', this.state.master.bpm);
    }
    // /beat/master
    else if (address === '/beat/master' && typeof args[0] === 'number') {
      this.state.master.beat = args[0];
      this.emit('beat', this.state.master.beat);
    }
    // /deck/master - смена активной деки
    else if (address === '/deck/master' && typeof args[0] === 'number') {
      this.state.master.deck = args[0];
      this.emit('deckChanged', args[0]);
    }
  }

  checkTrackChange() {
    const { artist, title } = this.state.master;
    const key = `${artist}::${title}`;
    
    if (key !== this.lastTrackKey && artist && title) {
      // Debounce: ждём 100мс, чтобы оба поля (artist + title) успели обновиться
      clearTimeout(this.trackChangeTimer);
      this.trackChangeTimer = setTimeout(() => {
        // Перепроверяем после debounce
        const currentKey = `${this.state.master.artist}::${this.state.master.title}`;
        if (currentKey !== this.lastTrackKey && this.state.master.artist && this.state.master.title) {
          this.lastTrackKey = currentKey;
          logger.info(`Track changed: ${this.state.master.artist} - ${this.state.master.title}`);
          this.emit('trackChanged', { 
            artist: this.state.master.artist, 
            title: this.state.master.title 
          });
        }
      }, 50);
    }
  }

  getState() {
    return { ...this.state.master };
  }

  stop() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

module.exports = LinkBridge;
