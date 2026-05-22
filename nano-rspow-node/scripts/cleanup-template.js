const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.js');
if (fs.existsSync(indexPath)) {
  let content = fs.readFileSync(indexPath, 'utf8');
  
  const target = `const lddPath = require('child_process').execSync('which ldd').toString().trim()`;
  if (content.includes(target)) {
    console.log('Replacing system shell which ldd warning from index.js...');
    
    // Inlined finder logic
    const findLddStr = `function findLdd() {
  const pathEnv = process.env.PATH || ''
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const paths = pathEnv.split(delimiter)
  for (const dir of paths) {
    if (!dir) continue
    const fullPath = join(dir, 'ldd')
    try {
      if (existsSync(fullPath)) {
        return fullPath
      }
    } catch (e) {
      // Ignore access errors
    }
  }
  return null
}`;
    
    content = content.replace('let loadError = null', `let loadError = null\n\n${findLddStr}`);
    content = content.replace(target, `const lddPath = findLdd()\n      if (!lddPath) return true`);
    
    fs.writeFileSync(indexPath, content, 'utf8');
    console.log('index.js successfully sanitized!');
  }
}
