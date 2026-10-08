# bmegle

Talk to strangers — random video + text chat.

## Local development

```bash
npm install
npm install --prefix client
npm install --prefix server
npm run dev
```

- App: http://localhost:5173  
- Signaling: http://localhost:3001  

Open two browser windows and click **Start a conversation** in both.

## Deploy (go live)

Video chat needs **HTTPS** and a **always-on Node server** (Socket.io + WebRTC signaling). Deploy the whole app as one service.

### Option A — Render (recommended, free SSL)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Blueprint**
3. Connect the repo (uses `render.yaml`)
4. Deploy — you’ll get a URL like `https://bmegle.onrender.com`

Or **New Web Service** manually:

| Setting | Value |
|--------|--------|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check | `/health` |

> Free tier sleeps after inactivity. First load can take ~30–60s. Upgrade for always-on.

### Option B — Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Build: `npm install && npm run build`
3. Start: `npm start`
4. Generate a public domain (HTTPS included)

### Option C — Docker

```bash
docker build -t bmegle .
docker run -p 3001:3001 bmegle
```

Put it behind any HTTPS reverse proxy.

## Production notes

- **Camera/mic only work on HTTPS** (or localhost)
- Both users must be online at the same time to match
- STUN/TURN is configured for real-world networks; for serious traffic, add your own TURN (Metered, Twilio, or coturn) in `client/src/useBmegle.js`
- Health check: `GET /health`
