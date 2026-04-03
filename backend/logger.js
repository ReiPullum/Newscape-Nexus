const levels = ['debug', 'info', 'warn', 'error'];

function createLogger({ service, level = 'info' }) {
  const threshold = levels.indexOf(level);

  function write(entryLevel, message, fields = {}) {
    if (levels.indexOf(entryLevel) < threshold) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      service,
      message,
      ...fields,
    };

    const line = JSON.stringify(payload);
    if (entryLevel === 'error') {
      console.error(line);
      return;
    }
    if (entryLevel === 'warn') {
      console.warn(line);
      return;
    }
    console.log(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

module.exports = { createLogger };