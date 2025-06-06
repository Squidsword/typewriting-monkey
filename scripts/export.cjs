const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');

const IGNORES = [
  'node_modules', '.git', 'dist', 'build',
  '*.js', 'words.txt', 'package-lock.json', '.DS_Store', 'all_files_dump.txt',
  '*.timestamp-*.mjs', // Add pattern for Vite temp files
  '.vite' // Ignore Vite cache directory
]; 

function walk(dir, cb) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORES.some(p => minimatch.minimatch(name, p))) continue;
    const full = path.join(dir, name);
    
    // Add error handling for files that might disappear
    let stats;
    try {
      stats = fs.statSync(full);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File disappeared between readdirSync and statSync - skip it
        continue;
      }
      throw err; // Re-throw other errors
    }
    
    if (stats.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

let out = '';
walk(process.cwd(), file => {
  out += `\n===== ${file} =====\n`;
  try {
    out += fs.readFileSync(file, 'utf8')
               .split('\n')
               .map(l => '    ' + l)
               .join('\n');
  } catch (err) {
    if (err.code === 'ENOENT') {
      out += '    [File disappeared during export]';
    } else {
      out += `    [Error reading file: ${err.message}]`;
    }
  }
});

fs.writeFileSync('all_files_dump.txt', out);