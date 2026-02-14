# ChromeRec

Record any Chrome tab with one click. Captures all visual activity including DOM mutations, CSS animations, scrolling, user interactions, canvas, WebGL, and video playback as WebM/VP9.

## Features

- One-click tab recording from the extension popup
- VP9 + Opus codec with automatic fallback chain
- Live duration timer with pulsing REC indicator
- IndexedDB storage via Dexie.js for recorded videos
- Recordings list with download and delete management
- Delete confirmation dialog after download
- Storage quota monitoring
- Badge indicators for all recording states
- Graceful handling of tab close and browser restart
- Dark theme popup (380x500px)

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| Bun | 1.x | Runtime, package manager, test runner |
| Vite | 5.4 | Build tool |
| CRXJS | 2.0-beta | Chrome extension Vite plugin |
| React | 18.3 | Popup UI |
| TypeScript | 5.7 | Type-safe development (strict mode) |
| Dexie.js | 4.0 | IndexedDB wrapper for blob storage |
| Chrome MV3 | Manifest V3 | Extension platform |

## Architecture

```
Popup (React)
  │
  ├── START_RECORDING ──► Service Worker ──► chrome.tabCapture.getMediaStreamId()
  │                           │
  │                           ├── chrome.offscreen.createDocument()
  │                           │
  │                           └── STREAM_ID_READY ──► Offscreen Document
  │                                                      │
  │                                                      ├── getUserMedia() (tab capture)
  │                                                      ├── MediaRecorder (VP9, 1s timeslice)
  │                                                      │
  │   RECORDING_STOPPED ◄── Service Worker ◄──────────── RECORDING_STOPPED
  │        │                                              (ArrayBuffer[] chunks)
  │        ▼
  ├── Blob assembly
  ├── Dexie.js save ──► IndexedDB
  └── Download panel
```

**Message flow:** All communication uses TypeScript discriminated unions (`ExtensionMessage`) with `satisfies` for compile-time checking and `isExtensionMessage()` type guard for runtime validation.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Chrome >= 116 (for `chrome.offscreen` API)

### Install

```bash
git clone <repo-url> && cd chromerec
bun install
```

### Development

```bash
bun run dev
```

### Production Build

```bash
bun run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` directory

## Usage

1. Navigate to the tab you want to record
2. Click the **ChromeRec** extension icon
3. Click the **Record** button (red circle)
4. The badge shows **REC** and the popup displays a live timer
5. Interact with the page normally — everything on screen is captured
6. Click **Stop** (square icon) when done
7. Click **Download** to save the `.webm` file
8. Choose **Delete** or **Keep** when prompted about the local copy
9. View past recordings in the list below the record button

## Project Structure

```
chromerec/
├── src/
│   ├── background/
│   │   └── index.ts          # Service worker: tab capture, offscreen lifecycle, messaging
│   ├── offscreen/
│   │   ├── index.html         # Offscreen document HTML entry
│   │   └── offscreen.ts       # MediaRecorder engine, chunk collection
│   ├── popup/
│   │   ├── index.html         # Popup HTML entry
│   │   ├── main.tsx           # React root
│   │   └── App.tsx            # UI state machine, recordings list, download
│   ├── lib/
│   │   ├── codec.ts           # VP9 codec negotiation with fallback chain
│   │   ├── db.ts              # Dexie.js database, CRUD operations
│   │   ├── filename.ts        # Filename generation and title sanitization
│   │   └── format.ts          # Duration, size, and date formatting
│   └── types/
│       └── messages.ts        # Discriminated union message protocol
├── tests/
│   ├── messages.test.ts       # Type guard tests
│   ├── format.test.ts         # Formatting utility tests
│   ├── filename.test.ts       # Filename generation tests
│   └── codec.test.ts          # Codec negotiation tests
├── manifest.config.ts         # Chrome MV3 manifest (defineManifest)
├── vite.config.ts             # Vite + CRXJS + React config
├── bunfig.toml                # Bun test configuration
├── tsconfig.json              # TypeScript strict config
└── package.json
```

## Permissions

| Permission | Reason |
|---|---|
| `tabCapture` | Capture the active tab's video and audio streams |
| `offscreen` | Create an offscreen document to run MediaRecorder (not available in service workers) |
| `storage` | Persist recording state across popup close/reopen via `chrome.storage.session` |
| `activeTab` | Access the current tab's metadata for capture targeting |

## Testing

```bash
bun test              # Run all tests
bun test --coverage   # Run with coverage report
```

41 tests across 4 files covering message type guards, formatting utilities, filename generation, and codec negotiation.

## Contributing

1. Fork the repository
2. Create a branch: `feature/my-feature`, `fix/bug-name`, or `docs/update-readme`
3. Make your changes
4. Ensure checks pass:
   ```bash
   bun run tsc --noEmit   # Type check
   bun test               # Unit tests
   bun run build          # Build
   ```
5. Open a pull request

### Commit Convention

Use conventional commit style:
- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `test:` test additions/changes
- `refactor:` code restructuring

## License

MIT
