# FB Messenger Userbot v2.2.0

A Facebook Messenger bot built on `fca-unofficial` with full support for individual and group chat messages, a live dashboard, economy/coins system, SQLite database, and scheduled cron jobs.

## Architecture

- **Runtime**: Node.js (CommonJS)
- **Bot Library**: fca-unofficial
- **Dashboard**: Express + Socket.IO (serves on port 5000)
- **Database**: SQLite via Sequelize (stored at `data/bot.db`)
- **Entry Point**: `src/index.js`

## Project Structure

```
├── src/
│   ├── index.js          # Main entry point
│   ├── commands/         # All bot commands (25+ commands)
│   ├── utils/
│   │   ├── database.js   # SQLite / Sequelize models & helpers
│   │   ├── loader.js     # Auto-load commands
│   │   └── imageGen.js   # Image generation
│   └── dashboard/
│       ├── server.js     # Express + Socket.IO server
│       └── public/       # Dashboard static HTML
├── config.example.json   # Config template
├── appstate.json         # Facebook cookies (gitignored)
├── config.json           # Bot settings (gitignored)
└── data/                 # SQLite database (gitignored)
```

## Configuration

Copy `config.example.json` to `config.json` and set:
- `botName`: Display name
- `prefix`: Command prefix (default `/`)
- `ownerID`: Your Facebook UID (from `c_user` cookie)
- `adminIDs`: Array of admin Facebook UIDs
- `dashboardPort`: Port (overridden by `PORT=5000` in Replit)
- `timezone`: Your timezone

## Running

The app starts via `npm start` (workflow sets `PORT=5000`).

- Dashboard URL: `http://0.0.0.0:5000`
- Upload Facebook cookies via the dashboard to connect the bot

## Cookie Setup

1. Open [messenger.com](https://messenger.com) in Chrome (click a conversation to get `m_sess`)
2. Use Cookie-Editor extension → Export JSON
3. Upload via the dashboard at `/`

## Deployment

Configured as a `vm` deployment (always-running) since it needs persistent WebSocket/MQTT connections.
Run command: `node src/index.js`
