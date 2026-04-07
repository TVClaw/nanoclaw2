---
name: tv-control
description: Control TVClaw Android TVs on the LAN. Open apps, URLs, search, media keys, D-pad, toast. Main group only. Use for Netflix, YouTube, games on the brain HTTP server, and HTML vibe pages on TV. Never send brain /keypad URLs to the user. Mention scan-TV QR and START only for built-in brain games or vibe HTML that used `<!-- nanoclaw:phone-remote -->`.
---

# TV control (TVClaw)

The host discovers TVs via mDNS `_tvclaw._tcp` and keeps outbound WebSockets to each TV. If no TV is connected, `send_tv_command` has no effect — tell the user to open **Connect bridge** in the TVClaw Android app on the same LAN.

**Tool:** `send_tv_command` (MCP, **main group only**). Arguments are a discriminated union on `action` (flat fields).

Actions:

- **LAUNCH_APP** — `app_id`: package or common alias (`netflix`, `youtube`, etc.)
- **OPEN_URL** — `url`, optional `app_id` to force a package
- **MEDIA_CONTROL** — `control`: `PLAY` | `PAUSE` | `REWIND_30` | `FAST_FORWARD_30` | `MUTE` | `HOME` | `BACK`
- **KEY_EVENT** — `keycode`: `DPAD_UP` | `DPAD_DOWN` | `DPAD_LEFT` | `DPAD_RIGHT` | `DPAD_CENTER` | `ENTER` | `BACK` | `HOME` | `MENU` | `CHANNEL_UP` | `CHANNEL_DOWN` | `VOLUME_UP` | `VOLUME_DOWN`
- **SHOW_TOAST** — `message`
- **SEARCH** — `app_id`, `query` (in-app search)
- **UNIVERSAL_SEARCH** — `query` (Android TV global search)
- **SLEEP_TIMER** — `minutes` (positive int)

**Games on the brain** (same LAN): open with **OPEN_URL** only for files that exist under `games/` on the project (see group CLAUDE.md for the shipped list). If the user wants a game that is not shipped, use `<vibe-page>` with `<!-- nanoclaw:phone-remote -->` and a full inline HTML game (SSE `/vibe-key-sse`, keypad commands, `canvas.focus()`), not a bogus `/games/...` URL. **Do not** tell the user to open `.../keypad` or paste the brain keypad URL in chat or `send_message`. For built-in brain games or phone-remote vibe HTML, the TV shows a QR — then say scan QR and **START**. For plain **vibe** pages without `<!-- nanoclaw:phone-remote -->`, the page opens directly; do not tell them to scan a gamepad QR unless you know that gate is active.

**Vibe / HTML on TV:** Put full HTML inside `<vibe-page>...</vibe-page>` in your reply; the host strips it for chat, hosts the page, and can open it on the TV. Follow group CLAUDE.md for TV-safe layout (large type, readable from distance).

**For Netflix:** always follow the **netflix-deeplinks** skill — resolve the numeric title ID (e.g. via web search), then **OPEN_URL** with `http://www.netflix.com/watch/<id>` and `app_id`: `com.netflix.ninja`. Do not use `/title/` or generic https links as a substitute. Never use **SEARCH** as the first attempt.

After MCP or skill changes, rebuild the agent image: `bash container/build.sh` from the repo root.
