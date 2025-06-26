// scripts/build.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting NEXArk Bot Build Process...');

try {
  // Clean dist directory
  const distDir = path.join(__dirname, '../dist');
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Build with pkg
  console.log('📦 Building executable with pkg...');
  
  const buildCmd = 'npx pkg . --targets node18-win-x64 --output dist/nexark-bot.exe';
  execSync(buildCmd, { 
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });

  console.log('✅ Build completed successfully!');
  console.log('📁 Output: dist/nexark-bot.exe');

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}