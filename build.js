const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Check if watch mode is enabled
const isWatchMode = process.argv.includes('--watch');

// Clean dist directory
if (fs.existsSync('dist')) {
  fs.rmSync('dist', { recursive: true });
}
fs.mkdirSync('dist');
fs.mkdirSync('dist/popup');
fs.mkdirSync('dist/icons');

// Copy static files function
function copyStaticFiles() {
  fs.copyFileSync('src/popup/popup.html', 'dist/popup/popup.html');
  fs.copyFileSync('src/popup/popup.css', 'dist/popup/popup.css');
  fs.copyFileSync('src/icons/icon128.png', 'dist/icons/icon128.png');
  
  // Create manifest.json
  const manifest = {
    manifest_version: 3,
    name: "Tweet Heat Map",
    version: "0.1.0",
    description: "Color-codes tweets by view-count and flags fresh ones with 🔥.",
    permissions: ["storage"],
    host_permissions: ["https://*.twitter.com/*", "https://*.x.com/*"],
    action: {
      default_popup: "popup/popup.html",
      default_icon: "icons/icon128.png"
    },
    content_scripts: [{
      matches: ["https://*.twitter.com/*", "https://*.x.com/*"],
      js: ["content.js"],
      run_at: "document_idle"
    }],
    icons: {
      "128": "icons/icon128.png"
    }
  };
  
  fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
}

// Build configuration
const buildOptions = {
  bundle: true,
  target: 'chrome100',
  minify: !isWatchMode, // Don't minify in dev mode for easier debugging
  sourcemap: isWatchMode, // Add sourcemaps in dev mode
};

if (isWatchMode) {
  // Watch mode for development
  console.log('🔄 Starting development mode with file watching...');
  
  // Build and watch content script
  esbuild.context({
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
    ...buildOptions,
  }).then(ctx => ctx.watch());
  
  // Build and watch popup script
  esbuild.context({
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup/popup.js',
    format: 'iife',
    ...buildOptions,
  }).then(ctx => ctx.watch());
  
  // Copy static files once
  copyStaticFiles();
  
  console.log('✅ Watching for changes... Press Ctrl+C to stop.');
} else {
  // Production build
  esbuild.buildSync({
    entryPoints: ['src/content.ts'],
    outfile: 'dist/content.js',
    format: 'iife',
    ...buildOptions,
  });
  
  esbuild.buildSync({
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup/popup.js',
    format: 'iife',
    ...buildOptions,
  });
  
  copyStaticFiles();
  
  console.log('✅ Extension built successfully!');
} 