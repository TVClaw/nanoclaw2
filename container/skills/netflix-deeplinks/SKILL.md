---
name: netflix-deeplinks
description: Netflix-specific deep link strategy for TVClaw. Use when user intent mentions Netflix titles, playback.
---

# Netflix deep links (TVClaw)

## ABSOLUTE RULE — NO EXCEPTIONS

**Any URL containing `search`, `q=`, or a query string is FORBIDDEN.**
This includes `OPEN_URL` with search URLs. It includes every action type. There are no exceptions.

Valid Netflix URLs contain a **numeric content ID only**:
- `http://www.netflix.com/watch/70153373` ✅
- `nflx://www.netflix.com/search?q=anything` ❌ NEVER
- `http://www.netflix.com/search?q=anything` ❌ NEVER
- Any URL with `?` or `q=` or `search` in it ❌ NEVER

If you find yourself writing a URL with `search` or `q=` in it — **stop immediately**. That is always wrong.

## How to get the numeric content ID

You MUST have the numeric ID before sending any command. Get it by:

1. **From your own knowledge** — if you already know the Netflix ID, use it.
2. **WebSearch** — search: `netflix "<title>" site:netflix.com`
   - Find a URL like `netflix.com/watch/70153373`
   - The number is the ID

## Command to send

Once you have the ID:
- `action`: `OPEN_URL`
- `url`: `http://www.netflix.com/watch/<numeric-id>`
- `app_id`: `com.netflix.ninja`

## What to do if WebSearch finds nothing

Ask the user to confirm the title name, then try one more search. Only use the `SEARCH` action (in-app search) as a true last resort after at least one real web search attempt has failed.
