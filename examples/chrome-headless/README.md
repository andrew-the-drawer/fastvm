# Headless Chromium

Runs Chromium headless with the Chrome DevTools Protocol (CDP) exposed on the
guest's port 9222. `auto_publish` maps it to the same loopback port on the host.

```sh
fastvmctl run -d -f examples/chrome-headless/chrome.fvmfile

fastvmctl get chrome | grep -A4 ports
curl -s http://127.0.0.1:9222/json/version
```

## Smoke test

A small Playwright script connects to the guest over CDP and verifies it can
control the browser:

```sh
cd examples/chrome-headless
npm install

fastvmctl run -d -f chrome.fvmfile
./smoke.sh
```

Expected output:

```text
title:   fastvm chrome
heading: headless Chrome is working
```

`smoke.sh` waits for the CDP endpoint, then runs `playwright_test.mjs`. It uses
CDP, so no Playwright browser download is needed.

The same CDP endpoint can be used directly by any client:

```js
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());
```

Notes:

- Chromium uses `--headless=old`; new headless binds DevTools to localhost only.
- Chromium runs with `--no-sandbox` inside the dedicated VM.
- `--disable-dev-shm-usage` avoids small `/dev/shm` limits.
- The image is a starting point; pin a version for reproducibility.
- `auto_publish` requires networking and publishes non-loopback guest listeners.
