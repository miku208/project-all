import crypto from "crypto";
import fs from "fs";
import path from "path";
import config, { getOwnerName } from "../../config.js";
import { getDatabase } from "../../src/lib/miku-database.js";
import {
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
} from "mikuhostt-baileys";
import { AIRich } from "../../src/lib/miku-builder.js";
import axios from "axios";
import sharp from "sharp";
const pluginConfig = {
  name: "owner",
  alias: ["creator", "dev", "developer"],
  category: "main",
  description: "Menampilkan kontak owner bot",
  usage: ".owner",
  example: ".owner",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 0,
  isEnabled: true,
};

/* Voice note owner — assets/audio/owner-opus.ogg (Ogg Opus) */
const OWNER_SOUND = path.resolve("assets/audio/owner-opus.ogg");

async function sendOwnerSound(sock, m, quoted = null) {
  try {
    if (!fs.existsSync(OWNER_SOUND)) return;
    await sock.sendMessage(
      m.chat,
      {
        audio: { url: OWNER_SOUND },
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      },
      { quoted: quoted || m.raw },
    );
  } catch (e) {
    console.error("[owner] gagal kirim sound:", e.message);
  }
}

async function handler(m, { sock, config: botConfig }) {
  const db = getDatabase();
  const ownerType = db.setting("ownerType") || 1;
  const configOwners = botConfig.owner?.number || [];
  const dbOwners = db.data.owner || [];
  const ownerNumbers = [...new Set([...configOwners, ...dbOwners])];
  const botName = botConfig.bot?.name || "Miku-AI";
  if (ownerType === 2) {
    const contacts = [];

    for (const number of ownerNumbers) {
      const cleanNumber = number.replace(/[^0-9]/g, "");

      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${getOwnerName(number)}\nTEL;type=CELL;type=VOICE;waid=${cleanNumber}:+${cleanNumber}\nEND:VCARD`;

      contacts.push({ vcard });
    }

    const zanne = await sock.sendMessage(
      m.chat,
      {
        contacts: {
          displayName: `Ini adalah owner kami`,
          contacts,
        },
      },
      { quoted: m.raw },

    );
    await sock.sendMessage(m.chat, {
      text: "💬 Jika kamu memiliki pertanyaan, jangan ragu untuk bertanya, owner ramah kok"
    }, { quoted: zanne })

    await sendOwnerSound(sock, m, zanne);
  } else {
    const ownerText = `👑 *ᴏᴡɴᴇʀ ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ*\n\n╭┈┈⬡「 📋 *ᴅᴇᴛᴀɪʟ* 」\n┃ ㊗ ɴᴀᴍᴀ: *${ownerNumbers.map((n) => getOwnerName(n)).join(", ")}*\n┃ ㊗ ʙᴏᴛ: *${botName}*\n┃ ㊗ sᴛᴀᴛᴜs: *🟢 Online*\n╰┈┈⬡\n\n> _Jika ada pertanyaan atau kendala,_\n> _silakan hubungi owner di atas!_\n> _📞 Contact card di bawah._`;

    await m.reply(ownerText);

    for (const number of ownerNumbers) {
      const cleanNumber = number.replace(/[^0-9]/g, "");

      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${getOwnerName(number)} (Owner ${botName})\nTEL;type=CELL;type=VOICE;waid=${cleanNumber}:+${cleanNumber}\nEND:VCARD`;

      await sock.sendMessage(
        m.chat,
        {
          contacts: {
            displayName: getOwnerName(number),
            contacts: [{ vcard }],
          },
        },
        { quoted: m.raw },
      );
    }

    await sendOwnerSound(sock, m);
  }
}

export { pluginConfig as config, handler };
