const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');

const IGNORES = [
  'node_modules', '.git', 'dist', 'build',
  '*.js', 'words.txt', 'package-lock.json', '.DS_Store', 'all_files_dump.txt'
]; 

function walk(dir, cb) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORES.some(p => minimatch.minimatch(name, p))) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, cb);
    else cb(full);
  }
}

let out = '';
walk(process.cwd(), file => {
  out += `\n===== ${file} =====\n`;
  out += fs.readFileSync(file, 'utf8')
             .split('\n')
             .map(l => '    ' + l)
             .join('\n');
});
fs.writeFileSync('all_files_dump.txt', out);
