# Tweet Heat Map

A Chrome/Opera extension that color-codes tweets by view-count and flags fresh ones with 🔥.

## Features

- **Visual heat map**: Tweets get colored right borders based on view count
  - Blue: 1K - 10K views
  - Green: 10K - 50K views  
  - Red: 50K+ views
- **Fresh tweet indicator**: 🔥 emoji for tweets ≤ 30 minutes old
- **Toggle control**: Easy on/off switch via extension popup
- **Wide compatibility**: Works across all Twitter/X page types

## Installation

### For Development

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd tweet-heat-map
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in browser:
   - **Chrome/Brave/Edge**: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", select the `dist` folder
   - **Opera**: Go to `opera://extensions/`, enable Developer mode, click "Load unpacked", select the `dist` folder

### For Users

Download from Chrome Web Store (coming soon)

## Development

### Commands

- `npm run build` - Build for production
- `npm run dev` - Build with file watching for development
- `npm run test` - Run unit tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Development Workflow

1. Make changes to source files in `src/`
2. Run `npm run dev` for automatic rebuilds
3. Reload the extension in your browser (click refresh icon in extensions page)
4. Test changes on Twitter/X

### Testing

```bash
npm test
```

Unit tests cover the view count parsing logic and ensure compatibility with various Twitter view count formats.

### Project Structure

```
src/
├── manifest.json         # Extension manifest
├── content.ts           # Main content script
├── utils.ts            # Utility functions
├── popup/              # Extension popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.ts
└── icons/              # Extension icons
    └── icon128.png

tests/                  # Unit tests
dist/                  # Built extension (generated)
```

## Technical Details

- **Manifest Version**: 3
- **Build Tool**: Vite + TypeScript
- **Testing**: Jest + jsdom
- **Linting**: ESLint with TypeScript rules
- **Target Browsers**: Chrome 120+, Opera 95+, Brave, Edge

## Permissions

- `activeTab` - Access current tab content
- `storage` - Save user preferences
- `scripting` - Inject content scripts

## Privacy

This extension:
- ✅ Works entirely locally (no external servers)
- ✅ Only accesses Twitter/X pages
- ✅ Stores preferences locally in your browser
- ❌ Does not collect or transmit any data

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make changes and add tests
4. Run `npm run lint && npm test && npm run build`
5. Submit a pull request

## License

ISC License - see LICENSE file for details
