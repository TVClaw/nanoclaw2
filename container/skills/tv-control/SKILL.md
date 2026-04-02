---
name: tv-control
description: Control TVClaw Android TVs on the LAN. Open apps, URLs, search, media keys, D-pad, toast. Main group only. Use for Netflix, YouTube, games on the brain HTTP server, and HTML vibe pages on TV.
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

**Built-in games** (served by the host, same LAN): paths like `http://<brain-lan-ip>:8770/games/<name>.html` for `snake`, `tetris`, `pong`, `breakout`, `flappy` when those files exist. Open with **OPEN_URL**. For D-pad games, the user should open the **keypad** remote at `http://<brain-lan-ip>:8770/keypad` on a phone (or send KEY_EVENT from here).

**Vibe / HTML on TV:** Put full HTML inside `<vibe-page>...</vibe-page>` in your reply; the host strips it for chat, hosts the page, and can open it on the TV. Follow group CLAUDE.md for TV-safe layout (large type, readable from distance).

**Netflix titles:** Prefer a watch URL: `https://www.netflix.com/watch/<id>` via **OPEN_URL** when you know the id (resolve id from the web if needed).

After MCP or skill changes, rebuild the agent image: `bash container/build.sh` from the repo root.
