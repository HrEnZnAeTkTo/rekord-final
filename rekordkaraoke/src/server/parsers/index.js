const lrcParser = require('./lrc');
const srtParser = require('./srt');

const parsers = {
  '.lrc': lrcParser,
  '.srt': srtParser,
  'lrc': lrcParser,
  'srt': srtParser
};

function getParser(formatOrExtension) {
  const key = formatOrExtension.startsWith('.') 
    ? formatOrExtension.toLowerCase() 
    : formatOrExtension.toLowerCase();
  return parsers[key] || null;
}

function parse(content, formatOrExtension, options = {}) {
  const parser = getParser(formatOrExtension);
  if (!parser) {
    throw new Error(`Unsupported format: ${formatOrExtension}`);
  }
  return parser.parse(content, options);
}

function getSupportedFormats() {
  return ['.lrc', '.srt'];
}

module.exports = { parse, getParser, getSupportedFormats };
