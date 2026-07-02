# Chaturbate Tip Bot (Firefox extension)

A chat-driven tipping bot for Chaturbate, packaged as a Firefox extension. It
watches the chat for commands and tips on your behalf, with optional max-tip,
cumulative, and per-minute rate limits.

## Files

- `manifest.json` — extension manifest (Manifest V3).
- `background.js` — listens for the toolbar-button click and injects the bot.
- `script.js` — the bot itself (runs in the page so it can use the site's
  jQuery and CSRF cookie for same-origin tip requests).

## How it works

The bot **loads only when you click the toolbar button** — it does not run
automatically on page load. Clicking the button runs `background.js`, which uses
`scripting.executeScript` (with `activeTab`, so no broad host-permission prompt)
to inject `script.js` into the page's **main world**.

Running in the main world matters: a normal content script lives in an isolated
world and cannot see the page's `$`/jQuery, but the bot uses `$.post` /
`$.cookie` and posts to `chaturbate.com/tipping/...`. Injecting into the main
world keeps everything same-origin.

Clicking the button again on an already-loaded page just **toggles the control
panel's visibility** (the bot guards against running twice).

## Install (temporary, for testing)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in this folder.
4. Open a broadcaster page on `chaturbate.com`, open the PM/chat panel, then
   **click the Tip Bot toolbar button** to load the bot.

Temporary add-ons are removed when Firefox restarts. To install permanently you
must sign the extension via [AMO](https://addons.mozilla.org/developers/)
(`web-ext sign`) or use Firefox Developer/Nightly Edition with unsigned add-ons
allowed.

## Packaging

```sh
# from this directory
zip -r tip-bot.zip manifest.json background.js script.js
# or, with Mozilla's tool:
npx web-ext build
```

## Control panel

A draggable panel appears on the broadcaster page (top-right by default). Use it
to change parameters at any time without chat commands:

- **Max tip / Limit / Rate per min** — same meaning as the chat commands; `-1`
  means no limit. Click **Apply** to commit and persist them.
- **Random** — enable and set min/max for random tipping.
- **Stop repeat** — cancels an active repeat run.
- Settings persist across page reloads (stored in `localStorage`), and the
  fields stay in sync when limits are changed via chat commands.
- A live status line shows tokens tipped this session, the per-minute usage, and
  whether a repeat is running.
- Drag the title bar to move the panel; click **–** to collapse it.

## Spending summary

The panel's **Spending** section pulls your token transaction history from
Chaturbate's `token-stats` API (same-origin, uses your logged-in session) and
shows:

- **Today** — tokens spent today.
- **Last 14 days** — rolling-period total.
- **Total tracked** — sum across all fetched history.
- A short list of the most recent days.

Spending is **cached in `localStorage`**. The first load fetches your full
history; after that the panel shows the cached totals instantly and only fetches
transactions newer than the last one it saw — so opening it is fast and makes
just a few API calls. Click **Refresh spending** to pull the latest tips, or
**rebuild full history** to discard the cache and re-fetch everything from
scratch. Detailed breakdowns are also printed to the console.

## Buying tokens

> ⚠️ **This spends real money.** `buy 400` drives Chaturbate's one-click
> purchase UI: it opens the purchase widget, selects the matching package, and
> clicks **Complete Purchase**, which charges your saved payment method
> instantly with no further confirmation. Because the bot fires on chat
> messages, treat this as a live spend button.

The **Buy tokens** section of the panel controls it:

- **Allow buying** — master switch. Buying is **OFF by default**; nothing is
  purchased until you tick this and click **Apply**.
- **Buy limit** — maximum tokens the bot may buy cumulatively this session
  (`-1` = no limit).
- **Min package / Max package** — exclude packages that are too small or too
  large (`-1` = no bound). Available packages are fixed by Chaturbate:
  `100 · 200 · 400 · 550 · 750 · 1000 · 1255 · 2025 · 4050 · 6350 · 12700`.

The chat command is **`buy <amount>`** (broadcaster-only), e.g. `buy 400`. The
amount must match one of the packages above and pass the limit/min/max checks,
otherwise the purchase is rejected and the reason is reported in chat.

How it works under the hood: the purchase flow is rendered by Chaturbate's own
React app in the page (not a cross-origin iframe), so the injected script can
find and click the real buttons — `.product-button` for the package and
`.complete-purchase-button` to confirm. If Chaturbate changes that markup, these
selectors (in `buyTokens()` / `findPurchaseTrigger()` in `script.js`) need
updating.

## Chat commands

Broadcaster-only:

- `<number>` — tip that many tokens (respects all limits).
- `tip balance` — tip the full available balance (bypasses max-tip, capped by
  the rate limit).
- `token balance` / `tip balance` — report/use available tokens.
- `repeat <amount> <times> [delaySeconds]` — tip repeatedly.
- `stop repeat` — stop an active repeat.
- `buy <amount>` — buy a token package (see **Buying tokens** above; OFF by
  default).

Anyone:

- `max tip <n>` — set per-tip cap (`-1` = unlimited).
- `limit <n>` — set cumulative cap (`-1` = unlimited).
- `rate <n>` — set tokens-per-minute cap (`-1` = unlimited).
- `update limits` — open the settings dialog.

> Note: this automates real token tips. Test carefully and make sure such
> automation is permitted by the site's terms before using it.
