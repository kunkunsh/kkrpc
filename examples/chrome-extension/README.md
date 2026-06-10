# Chrome Extension kkrpc Demo

This example demonstrates `kkrpc` communication between a Chrome extension popup, side panel, background service worker, and content script using Chrome runtime ports.

## Features

- React with TypeScript
- TypeScript support
- Vite build tool
- CRXJS Vite plugin integration
- Chrome extension manifest configuration

## Manual Testing

### Build The Extension

```bash
pnpm install
pnpm build
```

### Load It In Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `examples/chrome-extension/dist`.
5. Open any normal web page, then open the extension popup or side panel.

### What To Verify

- The extension loads without errors in `chrome://extensions`.
- The popup and side panel render the React UI.
- RPC calls between the popup or side panel and the content script complete and update the UI.
- The extension service worker console does not show unhandled kkrpc errors.

### Development Mode

For iterative testing, run:

```bash
pnpm dev
```

Then reload the extension from `chrome://extensions` after source changes.

### Troubleshooting

- If Chrome says the manifest is missing, make sure you selected the `dist` folder, not the project folder.
- If UI changes do not appear, click the reload button for the extension on `chrome://extensions`.
- Content scripts usually do not run on Chrome internal pages such as `chrome://extensions`.

## Project Structure

- `src/popup/` - Extension popup UI
- `src/content/` - Content scripts
- `manifest.config.ts` - Chrome extension manifest configuration

## Documentation

- [React Documentation](https://reactjs.org/)
- [Vite Documentation](https://vitejs.dev/)
- [CRXJS Documentation](https://crxjs.dev/vite-plugin)

## Chrome Extension Development Notes

- Use `manifest.config.ts` to configure your extension
- The CRXJS plugin automatically handles manifest generation
- Content scripts should be placed in `src/content/`
- Popup UI should be placed in `src/popup/`
