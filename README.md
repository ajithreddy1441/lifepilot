# LifePilot AI

Full-stack personal planner: tasks, habits, goals, AI scheduling, voice, web push, and Android phone alarms.

The AI never writes to the database directly. It proposes a structured action, you confirm (or say “yes”), then the same REST services that the UI uses execute it.

## What’s in this repo

| Path | What it is |
| --- | --- |
| `backend/` | Node/Express API, scheduling engine, notification worker, MySQL |
| `frontend/` | React + Vite PWA (and Capacitor web layer) |
| `mobile/android/` | Capacitor 8 Android app (`com.lifepilot.ai`) |

## Admin dashboard

Sign in, then open **Admin** in the sidebar (admins only).

| | |
| --- | --- |
| URL | `/admin` |
| Email | value of `ADMIN_EMAIL` in `backend/.env` (example: `admin@lifepilot.local`) |
| Password | value of `ADMIN_PASSWORD` in `backend/.env` |

Run `npm run migrate` after setting those env vars to create the account. The dashboard shows every user, daily/weekly/yearly readers (people who opened the app), story readers (creative / story work), plus tasks, alarms, devices, habits, and goals. Regular people still use **Sign Up**.

## Local development

You need Node 18+ and a MySQL/MariaDB database (Hostinger or local).

1. **Backend env**

   ```bash
   cd backend
   copy .env.example .env   # Windows
   npm install
   ```

   Fill in `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `JWT_SECRET`.

   - On the Hostinger server, `DB_HOST=localhost`.
   - For local development against Hostinger, enable **Remote MySQL** in hPanel for your IP and set `DB_HOST` to the Hostinger hostname (not `localhost`).
   - Never commit `.env`.

2. **Migrate + VAPID**

   ```bash
   npm run migrate
   npm run vapid
   ```

   `vapid` writes public/private keys into `.env` for Web Push.

3. **Run API** (also starts the scheduler worker in-process)

   ```bash
   npm run dev
   ```

   Health check: `http://localhost:4000/api/health`

4. **Frontend**

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Vite is at `http://localhost:5173` and proxies `/api` to port 4000.

5. **Optional LLM** (smarter parsing, goal breakdowns, weekly recs)

   Set `AI_API_KEY` (and optionally `AI_BASE_URL` / `AI_MODEL`) in `backend/.env`. Without it, the built-in rule-based parser is used. The key never ships to the browser.

## Android app

The website and the phone share the same backend. Alarm **ids stay stable**; if both sides change the same alarm, **the server version wins**. Already-synced alarms still ring if the phone is offline.

```bash
cd frontend
# set VITE_API_URL in frontend/.env to your HTTPS API, then:
npm run cap:sync
npm run cap:open
```

In Android Studio:

- Grant **Notifications** and **Alarms & reminders** (exact alarms) on the device.
- Sign in with the same account as the website.
- Open **Devices** and run the checklist + **Test phone alarm**.

**Release:** Android Studio → Generate Signed App Bundle / APK. Keep the keystore off git (already gitignored). Set `versionCode` / `versionName` in `mobile/android/app/build.gradle`.

**FCM (optional, wakes a killed app for instant sync):** put `google-services.json` in `mobile/android/app/`, set `FCM_SERVICE_ACCOUNT_JSON` on the server, and `VITE_ENABLE_FCM=true` in the frontend env. Without FCM the app still syncs on open, resume, and every 5 minutes while visible. Do not call `PushNotifications.register()` without `google-services.json` — it crashes.

Voice on Android uses the custom `LifePilotSpeech` plugin (`SpeechPlugin.java`). Web uses the Speech API; other browsers fall back to recording + Whisper if `AI_API_KEY` is set.

## Hostinger deployment

1. Upload the repo (or pull on the VPS).
2. `backend/.env`: `NODE_ENV=production`, `DB_HOST=localhost`, real DB credentials, `JWT_SECRET`, VAPID keys, `CORS_ORIGIN` including your HTTPS origin (and `https://localhost` / `capacitor://localhost` for the app).
3. `npm install --omit=dev` in `backend`, migrate, vapid if needed.
4. `frontend/.env.production`: `VITE_API_URL=` empty if the API serves the SPA on the same origin, or the public API URL if the app is on another host.
5. `cd frontend && npm ci && npm run build` — `backend/server.js` serves `frontend/dist` when it exists.
6. Point the Node app at `backend/server.js` (Passenger / PM2) and keep the process running so the **worker** can fire reminders. Browser timers are not used for scheduling.

## Security (already wired)

JWT (Bearer or httpOnly cookie), bcrypt, Helmet, CORS allowlist, rate limits on auth and AI, Zod validation, parameterized SQL, per-user authorization, env-based secrets. AI cannot delete or reschedule without a confirmed proposal; overlap and sleep-window warnings are shown before save.

## Tests

```bash
cd backend
npm test
```

17 unit tests cover the voice/text parser, DST-safe recurrence, and the “6:40–7:20 AM workout” scheduling example.

## Known limits

- A **force-killed** Android app cannot schedule *new* alarms until it is opened again (or an FCM data ping arrives). Alarms already written to the OS still fire offline.
- Web Push needs a user gesture + HTTPS (or localhost). If permission is denied, Settings explains how to unblock it.
- Without `AI_API_KEY`, transcription fallback and LLM extras are unavailable; scheduling still works.

## Phase map

1. Auth, schema, tasks, planner, categories, preferences  
2. Alarms + device sync  
3. Notification center, Web Push, worker  
4. AI propose → confirm → execute  
5. Voice (web / native / Whisper fallback)  
6. Habits, goals, reviews, analytics  
7. PWA + mobile layouts + dark mode  
8. Android Capacitor app + Hostinger notes  
