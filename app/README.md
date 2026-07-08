# GOD MODE — AI Browser (Electron)

The GOD MODE desktop app: a browser with **Claude wired in** to drive it, plus
**LiveKit voice** so you can talk to it out loud, and a **Living Labs API** hook
for tokens and data.

This is not a website — it's an Electron app. `../browser.html` is only the
marketing page.

## What's here

| File | Role |
|------|------|
| `main.js` | Electron main process. Owns the window, the embedded web view (the browsing surface), and the bridge Claude uses to control it. |
| `agent/claude.js` | The AI loop. Claude calls tools (`navigate`, `read_page`, `click`, `type`, `back`) that map to real actions on the web view. |
| `renderer/` | The UI shell — address bar, transcript, and the voice orb. Connects to LiveKit. |
| `preload.js` | Safe bridge between the sandboxed UI and main. |

## Setup

```bash
cd app
cp .env.example .env      # then fill in your keys
npm install
npm start
```

## Keys you need in `.env`

- **`ANTHROPIC_API_KEY`** — makes the AI work (control + chat).
- **`LIVEKIT_URL`** — your LiveKit server (e.g. `wss://xxx.livekit.cloud`).
- **`LIVING_LABS_API_URL`** — your backend. The app calls
  `POST {LIVING_LABS_API_URL}/livekit/token` to mint a LiveKit join token.
  A LiveKit voice **agent** (STT → LLM → TTS) should join the same room to
  actually talk. Adjust the path in `main.js` if your endpoint differs.

## How the pieces fit

```
 You ──speak──▶ LiveKit room ──▶ voice agent (STT→LLM→TTS) ──speaks──▶ You
                    ▲                         │
                    │ token (Living Labs API) │ tool calls
                    │                         ▼
              GOD MODE desktop app ──▶ Claude ──▶ controls the web view
```

Typed asks in the panel run entirely through `agent/claude.js` today; the voice
path streams transcripts back over LiveKit data messages. Wiring the voice
agent's tool calls into the same browser controls is the next step.
