try {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  console.log('Postinstall: data directory ready.');
} catch (e) {
  console.log('Postinstall skipped:', e.message);
}

