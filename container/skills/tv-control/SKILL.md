---
name: tv-control
description: Control TVClaw Android TVs on the LAN. Open apps, URLs, search, media keys, D-pad, toast. Main group only. Use for Netflix, YouTube, games on the brain HTTP server, and HTML vibe pages on TV. Never send brain /keypad URLs to the user; for games say scan TV QR and press START.
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

**Games on the brain** (same LAN): open with **OPEN_URL** and a full game URL or path the host resolves (see group CLAUDE.md). **Do not** tell the user to open `.../keypad` or paste the brain keypad URL in chat or `send_message`. For phone control of D-pad games, instruct them to **scan the QR displayed on the TV** and **press START** on the remote page that opens (or use **KEY_EVENT** from here).

**Vibe / HTML on TV:** Put full HTML inside `<vibe-page>...</vibe-page>` in your reply; the host strips it for chat, hosts the page, and can open it on the TV. Follow group CLAUDE.md for TV-safe layout (large type, readable from distance).

**Netflix titles:** Prefer a watch URL: `https://www.netflix.com/watch/<id>` via **OPEN_URL** when you know the id (resolve id from the web if needed).

After MCP or skill changes, rebuild the agent image: `bash container/build.sh` from the repo root.
