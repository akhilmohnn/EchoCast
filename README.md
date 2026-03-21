# 🎙️ EchoCast

A web-based live audio relay system. Effortlessly broadcast synchronized audio from your computer to other devices via simple room codes and a real-time WebRTC infrastructure.

---

## ✨ Features

- **Live Audio Relay:** Ultra-low latency, synchronized audio streaming using LiveKit.
- **Easy Access:** Join rooms via a 4-digit code or quickly scan a QR code.
- **Robust Infrastructure:** Decoupled frontend (Vite/React) and signaling backend (Node/WebSocket).
- **Fast Development:** Scaffolded with Vite for lightning-fast HMR.

---

## 🚀 Local Development setup

The project is split into two parts: the Vite frontend and a tiny Node.js WebSocket signaling server. **You must run both locally.**

### 1. Start the Signaling Server (Terminal 1)
```bash
cd server
npm install
npm run dev
# The WebSocket server will start on ws://localhost:3001
```

### 2. Start the Frontend (Terminal 2)
```bash
# In the root project folder
npm install
npm run dev
# The Vite app will start on https://localhost:5173
```
*Note: Vite acts as a proxy, automatically routing `/ws` requests to port `3001`.*

---

## 🌍 Production Deployment

Because Vercel (where the frontend lives) uses Serverless Functions, it **kills long-running Server connections**. Therefore, you cannot host your WebSocket `signaling.js` server on Vercel. 

You must deploy the Backend and Frontend separately:

### Step 1: Deploy Backend to Render (or similar)
1. Go to your Render Dashboard and create a new **Web Service**.
2. Set the **Root Directory** to: `server`
3. Set **Build Command** to: `npm install`
4. Set **Start Command** to: `npm start`
5. Go to **Environment Variables** and add your LiveKit credentials:
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
6. Click **Deploy**. Render will generate a URL for you like `https://echocast-signaling.onrender.com`.

### Step 2: Deploy Frontend to Vercel
1. Import your main GitHub repository into Vercel.
2. In the Vercel project Settings, go to **Environment Variables**.
3. Add the following variable so your app knows where the Render signaling server is:
   - **Name**: `VITE_SIGNALING_URL`
   - **Value**: `wss://your-render-app-url.onrender.com` *(Replace with your actual Render URL, but use `wss://` instead of `https://`)*
4. Click **Deploy**.

> 🎉 **Done!** Your Vercel frontend will now correctly route all real-time WebRTC room coordination to your persistent Render backend.
