const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

let currentLevel = LOG_LEVELS.info;

function setLevel(level) {
  currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
}

function formatTime() {
  return new Date().toISOString().slice(11, 23);
}

function log(level, ...args) {
  if (LOG_LEVELS[level] < currentLevel) return;
  
  const prefix = `[${formatTime()}] [${level.toUpperCase()}]`;
  console[level === 'error' ? 'error' : 'log'](prefix, ...args);
}

module.exports = {
  setLevel,
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args)
};
