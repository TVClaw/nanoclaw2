---
name: vibe-page
description: TV custom HTML — one reply with `<vibe-page>` for dashboards, stats, links, weather, games. Use chat/context first; at most one WebSearch or WebFetch if something is missing; no agent-browser loops unless unavoidable.
---

See group **CLAUDE.md** → TVClaw / TV content.

- HTML inside `<vibe-page>` in the assistant reply only — no Write-to-file for the page
- If you need the web for the page: **`send_message` first** (one line), then **one** `WebSearch` or `WebFetch`, then `<vibe-page>` in the final result—WhatsApp shows no progress otherwise
- One-shot: thread text and URLs first; **one** quick web pull if needed; then done
- **`<!-- nanoclaw:phone-remote -->`** alone on the **first line** of the inner HTML when the TV must use the phone keypad. Omit for read-only dashboards. Do not use **`<!-- nanoclaw:no-vibe-shell -->`** unless you intentionally want the raw page with no QR gate wrapper

## Phone-remote games (inner HTML only)

The host wraps that HTML in a shell: TV shows a QR to `/keypad`, then **START** / **OK** / **A** on the phone dismisses the gate and loads your HTML inside an **iframe** (`srcdoc`, `about:srcdoc`). Your fragment runs **inside that iframe**, not as a full tab like `games/snake.html`.

**SSE (required for keypad):** use a **path-only** URL so the browser resolves it against the brain page (the parent), not the iframe URL:

```text
new EventSource('/vibe-key-sse')
```

Do **not** use `new EventSource('http://' + location.host + '/vibe-key-sse')` or `location.protocol + '//' + location.host + ...` in inner phone-remote HTML — in an `about:srcdoc` iframe `location.host` is usually empty, so the URL becomes invalid and **START / D-pad do nothing**.

Reconnect on `error` (close, `setTimeout` retry) like the built-in games.

**Keypad → `e.data` on `onmessage`:** trim and lowercase. Handle at least **`start`** (START), **`select`** (SEL), **`a`** **`b`** **`x`** **`y`**, **`up`** **`down`** **`left`** **`right`**. The shell consumes the first **`start`** / **`ok`** / **`a`** only to open the iframe; **every** press still hits your listener too, so treat **`start`** as “begin / restart / fire” as appropriate and idempotent where needed.

**Keyboard on TV:** `addEventListener('keydown', ..., true)` (`capture: true`); map Arrow keys and Enter / Space to the same directions and actions where it helps.

**Focus:** call **`canvas.focus()`** (or your interactive root) after load so key events reach the game.

**Layout:** no second full-screen QR idle inside the inner HTML unless you duplicate remote URL logic — the shell already handled scan + START. Prefer showing the playable surface (or a simple “ready” state) so the user is not stuck on another gate. If you must show a QR inside the iframe, build the link as **`(parent.location?.origin || location.origin) + '/keypad'`** (not `location.host` alone in the iframe).

**Reference:** same input mapping patterns as `games/breakout.html` / `games/snake.html`, but **SSE URL must be `/vibe-key-sse`** in the inner fragment. Full `games/*.html` files are loaded **top-level** and may keep host-based URLs; **vibe inner fragments may not**.

## Non-game vibe pages

`<!-- nanoclaw:phone-remote -->` **omit** for read-only TV layouts. Large assets or extreme DOM complexity can delay first paint; keep games lean (canvas + one script block) when possible.
