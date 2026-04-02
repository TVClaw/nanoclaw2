---
name: capabilities
description: Show what this TVClaw instance can do — skills, tools, TV + browser. Read-only. Use when the user asks what the bot can do or runs /capabilities.
---

# /capabilities — TVClaw capabilities

**Main-channel check:** Only the main channel has `/workspace/project` mounted.

```bash
test -d /workspace/project && echo "MAIN" || echo "NOT_MAIN"
```

If `NOT_MAIN`, say this command is for the main chat only, then stop.

## Gather information

### Skills

```bash
ls -1 /home/node/.claude/skills/ 2>/dev/null || echo "No skills found"
```

### Tools

- Core: Bash, Read, Write, Edit, Glob, Grep
- Web: WebSearch, WebFetch (and **agent-browser** for live pages)
- Orchestration: Task, SendMessage, etc. per your SDK
- **MCP (nanoclaw):** `send_message`, `send_tv_command`, task/group tools as configured

### MCP TVClaw tools

- `send_message` — immediate WhatsApp/Telegram-style user updates (use for progress on long tasks)
- `send_tv_command` — LAUNCH_APP, OPEN_URL, MEDIA_CONTROL, KEY_EVENT, SEARCH, UNIVERSAL_SEARCH, SHOW_TOAST, SLEEP_TIMER (main group only)
- Plus schedule/list/update tasks and `register_group` if present in your build

### Container

```bash
which agent-browser 2>/dev/null && echo "agent-browser: yes" || echo "agent-browser: no"
```

### Group

```bash
test -f /workspace/group/CLAUDE.md && echo "group memory: yes" || echo "group memory: no"
```

## Report format

Summarize: **TVClaw** — TV control via MCP, browser for fresh web data, vibe pages with `<vibe-page>` for the TV, HTML games on the brain host; user gets the phone remote via QR on the TV (do not send keypad URLs in chat). List skills and tools you actually find.

**See also:** `/status` for a quick health check.
