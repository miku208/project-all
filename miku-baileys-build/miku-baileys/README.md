<div align="center">

<img src="https://u.pone.rs/avqaxbyl.jpg" alt="mikuhostt-baileys banner" width="100%" />

### Miku-Baileys — Modded Baileys Distribution

Interactive Messages, Rich AI Responses, Albums, Newsletters & VoIP

[![npm version](https://img.shields.io/npm/v/mikuhostt-baileys?color=39C5BB&logo=npm&logoColor=white&style=for-the-badge)](https://www.npmjs.com/package/mikuhostt-baileys)
[![npm downloads](https://img.shields.io/npm/dm/mikuhostt-baileys?color=39C5BB&logo=npm&logoColor=white&style=for-the-badge)](https://www.npmjs.com/package/mikuhostt-baileys)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-339933?logo=node.js&logoColor=white&style=for-the-badge)](https://nodejs.org)
[![ESM](https://img.shields.io/badge/ESM-only-F7DF1E?logo=javascript&logoColor=black&style=for-the-badge)](#)

</div>

---

**Miku-Baileys** is a modded Baileys distribution with native support for interactive messages, album messages, unified rich responses, newsletter helpers, status mentions, business/community utilities, and a built-in VoIP (voice call) engine.

This repository is a **distribution/build repo**: it ships compiled runtime files in `lib/` and protobuf artifacts in `WAProto/`, ready to be consumed from npm or as a vendored dependency.

---

## Table of Contents

- [Features](#-features)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Quick Start](#️-quick-start)
  - [Pairing Code](#5-pairing-code-example)
- [Authentication](#authentication-state--stores)
- [Sending Messages](#message-sending)
- [Interactive Messages](#interactive-messages)
- [Album Messages](#album-messages)
- [Rich Response Messages](#ai-rich-response-messages)
- [VoIP (Voice Calls)](#voip-voice-calls)
- [Newsletter Methods](#newsletter-methods)
- [Business Methods](#business-methods)
- [Community & Group Methods](#community-methods)
- [Utility Exports](#-utility-exports)
- [Building This Package](#️-building-this-package)
- [Differences from Official Baileys](#-differences-from-official-baileys)
- [Credits & Upstream](#-credits--upstream)
- [License](#-license)

---

## ✨ Features

| Feature                     | Description                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| **VoIP Voice Calls**        | Native VoIP engine (WASM/WebRTC) via `VoipClient`, single shared socket                |
| **Interactive Messages**    | Native flow buttons, list/select menus, button wrappers, carousel support via `Dugong` |
| **Album Messages**          | Multi-image/video album relay with count metadata and grouped delivery                 |
| **Rich Response Helpers**   | `sendTable`, `sendList`, `sendCodeBlock`, `sendRichMessage`, `sendUnifiedResponse`     |
| **Unified Response V2**     | `sendTableV2`, `sendCodeBlockV2`, `sendLinkV2` with Meta-AI-style unified sections     |
| **Link Messages**           | Rich inline links with citations, proofs, and forwarded bot context                    |
| **Payment Messages**        | Request payment messages with note/sticker support                                     |
| **Product / Catalog**       | Business product messages, catalog fetch/create/update/delete, cover photo helpers     |
| **Event / Poll Result**     | Event message builders and poll result snapshots                                       |
| **Newsletter Extras**       | URL resolve, metadata fetch, create/update, bulk follow, admin utilities               |
| **Communities & Groups**    | Community CRUD, linked groups, invite workflows, join approval, labels                 |
| **Status Mention**          | `sendStatusMention()` helper to mention users/groups in status flows                   |
| **LID & Session Handling**  | LID↔PN mapping, session migration, retry/session recreation helpers                    |
| **TypeScript Declarations** | Included `.d.ts` files for exported APIs and socket methods                            |

---

## ✅ Requirements

- **Node.js** `>= 20.0.0`
- **ESM project** (`"type": "module"` in your `package.json`)
- A persistent auth store implementation for production use
- Optional peer helpers depending on your use case:
  - `pino` for logging
  - `qrcode-terminal` if you want to render QR codes in the terminal yourself
  - `sharp`, `jimp`, `audio-decode`, `link-preview-js`, `@roamhq/wrtc` for optional media/VoIP utilities

> [!IMPORTANT]
> Miku-Baileys is **ESM-only**. CommonJS projects will need migration or dynamic import wrappers.

---

## 📦 Installation

```bash
npm install mikuhostt-baileys
```

Recommended companion packages for the examples in this README:

```bash
npm install pino qrcode-terminal
```

Or via an alias in `package.json` if you want to import it under a different name:

```json
{
  "dependencies": {
    "miku": "npm:mikuhostt-baileys@latest"
  }
}
```

> [!NOTE]
> Peer dependencies such as `sharp`, `jimp`, `audio-decode`, and `link-preview-js` are optional. Install only what your bot features need.

---

## 🛠️ Quick Start

### 1. Project Setup

```bash
mkdir my-bot && cd my-bot
npm init -y
```

Ensure `package.json` has `"type": "module"`:

```json
{
  "name": "my-bot",
  "type": "module",
  "dependencies": {
    "mikuhostt-baileys": "latest"
  }
}
```

> [!IMPORTANT]
> **Required**: `"type": "module"` — mikuhostt-baileys is ESM-only. Without this, imports will fail.

### 2. Install Dependencies

```bash
npm install mikuhostt-baileys pino qrcode-terminal
```

### 3. Create `index.js`

```js
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from "mikuhostt-baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "silent" });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    }
    if (connection === "open") console.log("Connected!");
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    if (text === ".ping") {
      await sock.sendMessage(msg.key.remoteJid, { text: "Pong!" });
    }
  });
}

startBot();
```

### 4. Run

```bash
node index.js
```

Scan the QR code, wait until the socket reaches `connection: "open"`, then send `.ping` to test.

### 5. Pairing Code Example

If you prefer pairing code over QR:

```js
const sock = makeWASocket({
  auth: state,
  logger,
  browser: Browsers.windows("Chrome"),
});

sock.ev.on("connection.update", async ({ connection }) => {
  if (connection === "connecting") {
    const code = await sock.requestPairingCode("6281234567890");
    console.log("Pairing code:", code);
  }
});
```

You can also provide your own custom pairing code:

```js
const code = await sock.requestPairingCode("6281234567890", "A1B2C3D4");
console.log("Custom pairing code:", code);
```

Custom pairing codes must be exactly `8` characters.

---

## Authentication State & Stores

```js
import { useMultiFileAuthState } from "mikuhostt-baileys";

const { state, saveCreds } = await useMultiFileAuthState("./session");
// state.creds → credentials (me, platform, noise keys, etc.)
// state.keys → SignalKeyStore (pre-keys, sessions, identity keys, etc.)
// saveCreds() → persist credentials to disk
```

**Custom Data Store / Memory Store Pattern:**

```js
import {
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
} from "mikuhostt-baileys";

const credsStore = new Map();
const keyStoreData = new Map();

const creds = credsStore.get("creds") || initAuthCreds();

const keys = makeCacheableSignalKeyStore({
  get: async (type, ids) => {
    const data = {};
    for (const id of ids) {
      data[id] = keyStoreData.get(`${type}:${id}`);
    }
    return data;
  },
  set: async (data) => {
    for (const category in data) {
      for (const id in data[category]) {
        const value = data[category][id];
        const key = `${category}:${id}`;
        if (value == null) keyStoreData.delete(key);
        else keyStoreData.set(key, value);
      }
    }
  },
});

const state = { creds, keys };

const saveCreds = async () => {
  credsStore.set(
    "creds",
    JSON.parse(
      JSON.stringify(state.creds, BufferJSON.replacer),
      BufferJSON.reviver,
    ),
  );
};
```

This package does **not** ship a built-in `makeInMemoryStore()` helper. Use:

- `useMultiFileAuthState()` for bot/local usage
- `initAuthCreds()` + custom `SignalKeyStore` for DB/Redis/in-memory persistence
- `makeCacheableSignalKeyStore()` for cached repeated key access

**Useful companion helpers:**

```js
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "mikuhostt-baileys";

const { version, isLatest } = await fetchLatestBaileysVersion();
console.log(version, isLatest);
```

---

## Message Sending

```js
// Text
await sock.sendMessage(jid, { text: "Hello!" });

// Text with mention
await sock.sendMessage(jid, {
  text: "Hello @628xxx!",
  mentions: ["628xxx@s.whatsapp.net"],
});

// Image
await sock.sendMessage(jid, {
  image: { url: "./photo.jpg" },
  caption: "A photo",
});

// Video
await sock.sendMessage(jid, {
  video: { url: "./video.mp4" },
  caption: "A video",
});

// Audio (voice note)
await sock.sendMessage(jid, {
  audio: { url: "./audio.ogg" },
  mimetype: "audio/ogg; codecs=opus",
  ptt: true,
});

// Sticker
await sock.sendMessage(jid, { sticker: { url: "./sticker.webp" } });

// Sticker pack
await sock.sendMessage(
  jid,
  makeStickerPack({
    name: "Miku Starter Pack",
    publisher: "Miku",
    description: "Starter sticker pack",
    stickers: [
      { url: "./stickers/1.webp", emojis: ["🔥"] },
      { url: "./stickers/2.webp", emojis: ["😎"] },
    ],
    cover: { url: "./stickers/cover.webp" },
  }),
);

// Document
await sock.sendMessage(jid, {
  document: { url: "./file.pdf" },
  fileName: "document.pdf",
  mimetype: "application/pdf",
});

// Reaction
await sock.sendMessage(jid, { react: { key: msg.key, text: "👍" } });

// Location
await sock.sendMessage(jid, {
  location: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: "Jakarta" },
});

// Contact
await sock.sendMessage(jid, {
  contacts: {
    displayName: "Contacts",
    contacts: [
      { vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:John\nTEL:+628xxx\nEND:VCARD" },
    ],
  },
});

// Poll
await sock.sendMessage(jid, {
  poll: { name: "Vote!", values: ["Option A", "Option B"], selectableCount: 1 },
});

// Forward / Delete / Edit
await sock.sendMessage(jid, { forward: msg, forwardingScore: 1, isForwarded: true });
await sock.sendMessage(jid, { delete: msg.key });
await sock.sendMessage(jid, { text: "Edited text", edit: msg.key });
```

---

## Interactive Messages

**Native Flow Buttons:**

```js
await sock.sendMessage(jid, {
  interactiveMessage: {
    title: "Welcome!",
    footer: "Powered by Miku",
    buttons: [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({ display_text: "Menu", id: "menu" }),
      },
      {
        name: "cta_url",
        buttonParamsJson: JSON.stringify({
          display_text: "Website",
          url: "https://example.com",
        }),
      },
      {
        name: "cta_copy",
        buttonParamsJson: JSON.stringify({
          display_text: "Copy Code",
          copy_code: "MIKU2026",
        }),
      },
    ],
    header: "Choose an option",
    image: { url: "https://example.com/banner.jpg" },
  },
});
```

**List Menu (`single_select`):**

```js
await sock.sendMessage(jid, {
  interactiveMessage: {
    title: "Select Category",
    footer: "Powered by Miku",
    buttons: [
      {
        name: "single_select",
        buttonParamsJson: JSON.stringify({
          title: "Menu",
          sections: [
            {
              title: "Games",
              rows: [
                { title: "Quiz", id: ".quiz" },
                { title: "Tebak Gambar", id: ".tebakgambar" },
              ],
            },
            {
              title: "Tools",
              rows: [
                { title: "Sticker", id: ".sticker" },
                { title: "TTS", id: ".tts" },
              ],
            },
          ],
        }),
      },
    ],
    header: "Bot Menu",
  },
});
```

---

## Album Messages

```js
await sock.sendMessage(jid, {
  albumMessage: [
    { image: { url: "./photo1.jpg" }, caption: "First" },
    { image: { url: "./photo2.jpg" }, caption: "Second" },
    { video: { url: "./clip.mp4" }, caption: "Video" },
  ],
});
```

> [!NOTE]
> Albums automatically set `expectedImageCount` and `expectedVideoCount` based on array content.

---

## AI Rich Response Messages

Send messages styled like Meta AI — tables, code blocks, and rich text, rendered via `botForwardedMessage` > `richResponseMessage`.

**Table:**

```js
await sock.sendTable(
  jid,
  "Java vs JavaScript",
  ["Feature", "Java", "JavaScript"],
  [
    ["Type", "Compiled", "Interpreted"],
    ["Typing", "Static", "Dynamic"],
    ["Main Use", "Enterprise", "Web, Full-stack"],
  ],
  quoted,
  { headerText: "Comparison:", footer: "Hope this helps!" },
);
```

**List:**

```js
await sock.sendList(
  jid,
  "Bot Info",
  [
    ["Name", "Miku Bot"],
    ["Version", "1.0.0"],
  ],
  quoted,
  { footer: "© Miku Bot" },
);
```

**Code Block (V1):**

```js
await sock.sendCodeBlock(
  jid,
  `const greeting = "Hello World"
function sayHello(name) {
    return greeting + " " + name
}
sayHello("Miku")`,
  quoted,
  { language: "javascript", title: "Example Code", footer: "Powered by Miku" },
);
```

**Table V2 (Unified Response):**

```js
await sock.sendTableV2(
  jid,
  [
    "Java vs JavaScript",
    "Feature | Java | JavaScript",
    "Type | Compiled | Interpreted;;Typing | Static | Dynamic",
  ],
  quoted,
  { headerText: "Comparison:", text: "Here is a comparison table:", footer: "Hope this helps!" },
);
```

**Code Block V2 (Unified Response, 6 language families):**

```js
await sock.sendCodeBlockV2(
  jid,
  `package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}`,
  quoted,
  { language: "go", title: "Go Example", footer: "Powered by Miku" },
);
```

**Link Message (inline embeds with citations/proofs):**

```js
await sock.sendLink(
  jid,
  "Upload results:\n🔗 Klik: {{IE_0}}link disini{{/IE_0}}",
  ["https://example.com/upload1"],
  quoted,
  { headerText: "📁 Media Uploader", footer: "✨ Selesai!" },
);
```

**Rich Message Builder (`ORich`):**

```js
import { ORich } from "mikuhostt-baileys";

const rich = new ORich(sock)
  .addText("Hello from Miku rich response!")
  .addSuggest(["Tell me more", "Next"]);

await rich.send(jid);
```

---

## VoIP (Voice Calls)

VoIP is integrated directly using `VoipClient` over a **shared socket** (no double pairing). WebAssembly assets are built into the package.

```js
import { VoipClient, CallState } from "mikuhostt-baileys";

// Do this AFTER connection === "open"
if (!global.voipClient) {
  global.voipClient = new VoipClient();
  await global.voipClient.connectWithSocket(sock);
  console.log("VoIP engine active!");
}
```

**Placing a call:**

```js
try {
  const call = await global.voipClient.call("6281234567890", {
    durationMs: 60000,
    audioSource: "silence", // or "mic" / "file" (requires audio-feeder & ffmpeg)
  });

  call.on("ringing", () => console.log("Ringing..."));
  call.on("connected", () => console.log("Connected!"));
  call.on("ended", (reason) => console.log("Call ended:", reason));

  await call.waitForEnd();
} catch (e) {
  console.error("Call failed:", e);
}
```

---

## Newsletter Methods

```js
// Resolve channel URL to metadata
const info = await sock.cekIDSaluran("https://whatsapp.com/channel/xxxxx");

// Bulk follow multiple channels
await sock.newsletterMultipleFollow("id1@newsletter id2@newsletter");

// Fetch all subscribed channels
const channels = await sock.newsletterFetchAllSubscribe();

// Generic action (follow/unfollow/mute/unmute)
await sock.newsletterAction("id@newsletter", "follow");

// Create / update
const nl = await sock.newsletterCreate("My Channel", "Description");
await sock.newsletterUpdate("id@newsletter", { name: "New Name" });

// Metadata & subscribers
const { subscribers } = await sock.newsletterSubscribers("id@newsletter");
const meta = await sock.newsletterMetadata("jid", "id@newsletter");

// Follow / Unfollow / Mute / Unmute
await sock.newsletterFollow("id@newsletter");
await sock.newsletterUnfollow("id@newsletter");
await sock.newsletterMute("id@newsletter");
await sock.newsletterUnmute("id@newsletter");

// Name / description / picture
await sock.newsletterUpdateName("id@newsletter", "New Name");
await sock.newsletterUpdateDescription("id@newsletter", "New Desc");
await sock.newsletterUpdatePicture("id@newsletter", mediaUpload);
await sock.newsletterRemovePicture("id@newsletter");

// React & fetch messages
await sock.newsletterReactMessage("id@newsletter", serverId, "👍");
const msgs = await sock.newsletterFetchMessages("id@newsletter", 50, 0, 0);

// Admin operations
const count = await sock.newsletterAdminCount("id@newsletter");
await sock.newsletterChangeOwner("id@newsletter", newOwnerJid);
await sock.newsletterDemote("id@newsletter", userJid);
await sock.newsletterDelete("id@newsletter");
```

---

## Business Methods

```js
// Catalog
const { products, nextPageCursor } = await sock.getCatalog({
  jid: "628xxx@s.whatsapp.net",
  limit: 10,
});
const { collections } = await sock.getCollections("628xxx@s.whatsapp.net", 10);

// Orders
const order = await sock.getOrderDetails(orderId, tokenBase64);

// Product CRUD
const product = await sock.productCreate({
  name: "Premium Package",
  description: "Official premium plan",
  price: 150000,
  currency: "IDR",
  originCountryCode: "ID",
  images: [mediaUpload],
});
await sock.productUpdate(product.id, { name: "Premium Package Plus" });
await sock.productDelete([product.id]);

// Business profile (legacy alias `updateBussinesProfile` still works)
await sock.updateBusinessProfile({
  address: "Jakarta, Indonesia",
  description: "Official store",
  websites: ["https://example.com"],
});

await sock.updateCoverPhoto(mediaUpload);
await sock.removeCoverPhoto(coverId);

// Quick replies
await sock.addOrEditQuickReply({ shortcut: "hello", message: "Hello!" });
await sock.removeQuickReply(timestamp);
```

---

## Community Methods

```js
// Communities
const community = await sock.communityCreate("My Community", "Description");
const meta = await sock.communityMetadata("communityid@g.us");
const subgroup = await sock.communityCreateGroup(
  "Announcements",
  ["628xxx@s.whatsapp.net"],
  "communityid@g.us",
);
await sock.communityLinkGroup("groupid@g.us", "communityid@g.us");
await sock.communityUnlinkGroup("groupid@g.us", "communityid@g.us");
const linked = await sock.communityFetchLinkedGroups("communityid@g.us");

// Groups
const group = await sock.groupCreate("My Group", ["628xxx@s.whatsapp.net"]);
const gmeta = await sock.groupMetadata("id@g.us");
await sock.groupParticipantsUpdate("id@g.us", ["628xxx@s.whatsapp.net"], "add");
await sock.groupSettingUpdate("id@g.us", "announcement");
const code = await sock.groupInviteCode("id@g.us");
await sock.groupAcceptInvite("ABCDE12345");
const groups = await sock.groupFetchAllParticipating();

// Status mentions
await sock.sendStatusMention({ text: "Big update coming!" }, [
  "628xxx@s.whatsapp.net",
]);
```

---

## 🔧 Utility Exports

```js
import {
  // Auth
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  fetchLatestBaileysVersion,

  // Code tokenization
  tokenizeCode,
  tokenizeCodeV2,
  CodeHighlightType,
  RichSubMessageType,

  // Rich message generators
  generateTableContent,
  generateTableContentV2,
  toTableMetadataV2,
  generateListContent,
  generateCodeBlockContent,
  generateCodeBlockContentV2,
  generateLinkContent,
  generateLinkContentV2,
  generateRichMessageContent,
  generateLatexContent,
  generateLatexImageContent,
  generateLatexInlineImageContent,
  generateUnifiedResponseContent,
  captureUnifiedResponse,

  // Rich message builders
  buildRichContextInfo,
  buildBotForwardedMessage,

  // Interactive message builders
  Button,
  ButtonV2,
  Carousel,
  AIRich,
  ORich,
  Toolkit,

  // Sticker pack helper
  makeStickerPack,

  // Language keyword sets
  JS_KEYWORDS,
  PYTHON_KEYWORDS,
  GO_KEYWORDS,
  LUA_KEYWORDS,
  BASH_KEYWORDS,
  LANGUAGE_KEYWORDS,

  // Crypto
  Curve,
  signedKeyPair,
  aesEncryptGCM,
  aesDecryptGCM,

  // JID utilities
  jidEncode,
  jidDecode,
  jidNormalizedUser,
  areJidsSameUser,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  isJidBot,
  isJidMetaAI,
  isJidBroadcast,
  isJidStatusBroadcast,

  // Connection
  DisconnectReason,
  Browsers,

  // VoIP
  VoipClient,
  ActiveCall,
  CallState,

  // Dugong (advanced message types)
  Dugong,

  // Types
  WASocket,
} from "mikuhostt-baileys";
```

---

## 🏗️ Building This Package

```bash
npm install
npm run build
```

The build script validates the distributable: it checks that `lib/`, `WAProto/`, and the WASM assets are present, verifies package metadata, and parses every ESM file so syntax/import problems fail the build. It does not recompile TypeScript — `lib/` is the shipped, compiled runtime.

---

## 🔀 Differences from Official Baileys

| Area                 | Official Baileys v7 | mikuhostt-baileys                             |
| -------------------- | ------------------- | ---------------------------------------- |
| Interactive messages | No native support   | Full support via Dugong                  |
| Album messages       | Not supported       | Multi-media albums                       |
| AI Rich Response     | Not available       | Table, code block, rich text             |
| Table V2             | Not available       | Unified response + GenATableUXPrimitive  |
| Code Block V1        | Not available       | Syntax highlighting (JS/TS/Python)       |
| Code Block V2        | Not available       | Unified response + 6 languages           |
| Link Message         | Not available       | Inline embeds + citations + verification |
| Business nodes       | Manual injection    | Auto-inject on relay                     |
| Newsletter extras    | Basic only          | Auto-follow, bulk follow, URL resolve    |
| Payment messages     | Not supported       | Full support                             |
| Status mentions      | Not available       | `sendStatusMention()`                    |
| Product messages     | Not supported       | Catalog + buttons                        |
| LID support          | Basic               | Full LID↔PN mapping + session migration  |
| Message retry        | Basic               | `MessageRetryManager` with cache         |
| VoIP voice calls     | Not available       | Built-in WASM/WebRTC `VoipClient`        |

---

## 🤝 Credits & Upstream

Miku-Baileys is **not an original work**. It is a fork/modification of existing open-source projects:

- **MikuHost** — development, maintenance, and packaging of Miku-Baileys.

Full upstream copyright notices are preserved in the [`LICENSE`](LICENSE) file and in source-file headers. Please respect the licenses of all upstream projects.

> [!CAUTION]
> This library is for **educational purposes**. Ensure compliance with WhatsApp Terms of Service.

> [!WARNING]
> Miku-Baileys is **not** an official WhatsApp library. It is **not** affiliated with, endorsed by, or connected to WhatsApp LLC or Meta Platforms, Inc. in any way. Use at your own risk.

---

## 📄 License

MIT — see [`LICENSE`](LICENSE). © MikuHost
