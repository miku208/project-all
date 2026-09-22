# Miku Bot

Standalone **single-bot** WhatsApp multi-device bot, migrated from the Ourin codebase as an independent fork. Uses [`mikuhostt-baileys`](https://www.npmjs.com/package/mikuhostt-baileys) as its WhatsApp library.

> ⚠️ **Jadibot (child-bot) functionality is NOT included in this version.** This build is single-bot only: one WhatsApp session, one auth state. Jadibot may be added manually in a future release.

## Features

- Full WhatsApp multi-device connection (pairing code / QR)
- Modular plugin system with hot-reload (849 plugins, 42 categories)
- Command handler + case system, owner/admin/premium/registration system
- Groups: welcome/goodbye, promote/demote cards, antilink/antitoxic/antispam/anti-delete, slowmode, botmode
- Media: stickers, images, video, audio, documents, stickers-from-reply, auto-download
- Downloader & search integrations, AI features (Gemini/Groq/AutoAI personas)
- Scheduled tasks: daily limit reset, sholat reminders, notifications, auto-JPM, giveaways, auto-backup
- Level/energi (limit) system, store mode, cpanel/panel integrations, OTP poller hooks

## Installation

```bash
cd /root/miku
npm install
```

Requirements: Node.js ≥ 22.

## Configuration

All settings live in `config.js`:

| Key | Purpose |
|---|---|
| `bot.name` / `bot.version` / `bot.developer` | Bot identity shown in menus/boot |
| `owner.number` | Owner WhatsApp number(s) |
| `session.pairingNumber` | Number to request a pairing code for |
| `session.usePairingCode` | `true` = pairing code, `false` = QR terminal |
| `session.folderName` | Auth folder name under `storage/` (default `session`) |
| `command.prefix` | Command prefix (default `.`) |
| `mode` | `public` / `self` |
| `APIkey` | Third-party API keys (register with each provider) |
| `energi` | Daily energy/limit system |

> API keys from the upstream project were preserved as-is. Replace them with your own where needed. **Never commit real credentials.**

## Authentication

```bash
npm start            # or: pm2 start index.js --name miku
```

With `usePairingCode: true`, a pairing code is printed at first start. Enter it in WhatsApp → **Settings → Linked Devices → Link a Device → Link with phone number instead**.

- Auth state is stored in **`/root/miku/storage/session`** — fully isolated from any other bot installation. Never share or copy session folders between bots.
- To reset: stop the bot, delete `storage/session`, start again.

## Library: mikuhostt-baileys

The WhatsApp connection layer is [`mikuhostt-baileys`](https://www.npmjs.com/package/mikuhostt-baileys). All application imports (`makeWASocket`, `useMultiFileAuthState`, `proto`, media/interactive helpers, etc.) were verified against the package's actual exports during migration.

## Startup (production)

```bash
pm2 start index.js --name miku
pm2 save
```

- Local asset cache server listens on **port 3001** (change in `index.js` if needed).
- Logs: `pm2 logs miku`

## Plugin system

Drop a `.js` file into `plugins/<category>/`:

```js
export const pluginConfig = {
  name: "ping",
  alias: ["p"],
  category: "main",
  description: "Cek kecepatan bot",
  usage: ".ping",
  isOwner: false,
  isGroup: false,
  cooldown: 3,
  isEnabled: true,
};

export async function handler(m, { sock, args, text, config, db }) {
  await m.reply("Pong!");
}
```

Plugins hot-reload in dev mode (`NODE_ENV=development`).

## License

ISC — see upstream project for original licensing.

## Upstream attribution

This project is a **fork/modification** of the Ourin WhatsApp bot (upstream lib: `ourin-baileys`, a Baileys derivative from the WhiskeySockets/Baileys lineage). Original plugin and handler logic by the Ourin contributors; adapted for `mikuhostt-baileys` with Jadibot removed. Upstream attribution and licenses are preserved.
