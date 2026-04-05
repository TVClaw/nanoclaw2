---
name: vibe-page
description: TV custom HTML — one reply with `<vibe-page>` for dashboards, stats, links, weather, etc. Use chat/context first; at most one WebSearch or WebFetch if something is missing; no agent-browser loops unless unavoidable.
---

See group **CLAUDE.md** → TVClaw / TV content.

- HTML inside `<vibe-page>` in the assistant reply only — no Write-to-file for the page
- If you need the web for the page: **`send_message` first** (one line), then **one** `WebSearch` or `WebFetch`, then `<vibe-page>` in the final result—WhatsApp shows no progress otherwise
- One-shot: thread text and URLs first; **one** quick web pull if needed; then done
- `<!-- nanoclaw:phone-remote -->` first line inside HTML **only** for gamepad/D-pad pages; skip for read-only TV layouts
- DPAD: `keydown` with `capture: true`; games: `canvas.focus()` on load when using gamepad gate
