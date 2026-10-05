# Chaturbate Tip Bot

A WXT-powered browser extension for Chaturbate tipping automation. The bot runs
on broadcaster pages, watches chat commands, and exposes a modern React +
Tailwind floating control panel.

> This automates real token tips and token purchases. Test carefully and make
> sure this use is permitted by the site's terms before using it.

## Stack

- **WXT** — extension framework and build/zip tooling.
- **React** — floating control panel UI.
- **Tailwind CSS** — isolated styling inside a shadow-root content-script UI.
- **Main-world content script** — the bot logic runs in the page context so it
  can use Chaturbate's same-origin tipping and purchase UI.

## Source Layout

- `wxt.config.ts` — WXT config, manifest metadata, React module, Tailwind Vite plugin.
- `src/entrypoints/background.ts` — toolbar click handler; toggles the panel.
- `src/entrypoints/chaturbate-page.content.js` — main-world bot logic and command handling.
- `src/entrypoints/chaturbate-ui.content.jsx` — React/Tailwind shadow-root UI entrypoint.
- `src/components/TipBotPanel.jsx` — panel component and UI-to-bot message bridge.
- `src/entrypoints/tipbot.css` — Tailwind import and panel CSS boundary.

## Install Dependencies

```sh
npm install
```

## Development

```sh
# Chrome/Chromium target
npm run dev

# Firefox target
npm run dev:firefox
```

WXT opens a browser with the extension installed. Visit a Chaturbate broadcaster
page; the panel appears automatically and the toolbar button toggles it.

## Build

```sh
npm run build
npm run build:firefox
npm run zip
npm run zip:firefox
```

Build output is written under `.output/`.

## Control Panel

The floating panel lets you change settings without chat commands:

- **Number tips** — bare numbers from the broadcaster tip that amount when enabled.
- **Max tip / Limit / Rate per min** — safety controls; `-1` means unlimited.
- **Random** — enables `tip random` and `repeat random` ranges.
- **Guess game** — three guesses against your private target number.
- **Regex** — tips based on regex matches in broadcaster messages.
- **Buying** — gated controls for one-click token package purchases.
- **Spending** — pulls and caches token spending totals from Chaturbate token stats.

Settings persist in page `localStorage` and are owned by the main-world bot
entrypoint. The React panel sends settings over `window.postMessage`; the bot
sends live status back the same way.

## Guess Game

When **Guess game** is enabled, bare broadcaster numbers are guesses instead of
normal number-tip commands:

- Guess 1 and 2 — the bot replies with rotating hint variants, e.g. `higher`,
  `⬆️`, `the number is higher`, `lower`, `⬇️`, or `the number is lower`.
- Exact match — the bot tips twice the guessed amount immediately, then resets
  for another three guesses.
- Guess 3 — the bot tips the guessed amount when the guess is below or equal to
  your target number, then resets for another three guesses.
- Guess-game tips intentionally bypass **Max tip**, cumulative **Limit**, and
  **Rate per min**, and are not counted against those limits.

## Chat Commands

Broadcaster-only:

- `<number>` — tip that many tokens, unless Guess game is enabled.
- `tip random` — tip a random amount from the configured range.
- `token balance` — report available tokens after cumulative limit.
- `tip balance` — tip the full available balance; bypasses max-tip, rate-limited.
- `repeat <amount> <times> [delaySeconds]` — repeat a fixed tip.
- `repeat random <times> [delaySeconds]` — repeat fresh random draws.
- `ladder <n> [delaySeconds]` — tip `1, 2, 3, … n`.
- `stop repeat` — stop active repeat/ladder tipping.
- `buy <amount>` — buy an allowed token package when buying is enabled.
- `packages` — list currently buyable packages.

Anyone:

- `max tip <n>` — set per-tip cap; `-1` means unlimited.
- `limit <n>` — set cumulative cap; `-1` means unlimited.
- `rate <n>` — set tokens-per-minute cap; `-1` means unlimited.
- `update limits` — open the legacy in-page settings prompt.
