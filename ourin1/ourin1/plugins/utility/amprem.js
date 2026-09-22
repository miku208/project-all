import fs from "fs";
import path from "path";
import axios from "axios";

const API_URL = "https://dapjimotionpro.my.id/api/proxy-amprem";
const DB_DIR = "database";
const DB_FILE = path.join(DB_DIR, "amprem.json");

function ensureDB() {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
}

function readDB() {
    ensureDB();
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch {
        return {};
    }
}

function writeDB(data) {
    ensureDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

async function sendLink(email) {
    const { data } = await axios.post(
        API_URL,
        { action: "send", email },
        {
            headers: { "Content-Type": "application/json" },
            timeout: 30000
        }
    );
    return data;
}

const pluginConfig = {
    name: "amprem",
    alias: ["amprem"],
    category: "utility",
    description: "Register email AMPREM dan kirim link verifikasi",
    usage: ".amprem <email>",
    example: ".amprem email@gmail.com",
    isOwner: false,
    isPremium: true,
    isGroup: false,
    isPrivate: false,
    cooldown: 10,
    energi: 0,
    isEnabled: true,
};

async function handler(m, { sock, config: botConfig, db, uptime }) {
    try {
        const prefix = botConfig.command?.prefix || ".";
        const email = m.text?.trim();

        if (!email) {
            return m.reply(
                `📧 *AMPREM Register*\n\n` +
                `Penggunaan:\n` +
                `*${prefix}amprem <email>*\n\n` +
                `Contoh:\n` +
                `*${prefix}amprem email@gmail.com*`
            );
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return m.reply("❌ Format email tidak valid.");
        }

        await m.reply("⏳ Sedang memproses...");

        const data = await sendLink(email);

        const dbData = readDB();
        dbData[m.sender] = {
            email,
            registeredAt: Date.now()
        };
        writeDB(dbData);

        return m.reply(
            `✅ *Register berhasil*\n\n` +
            `📧 Email: ${email}\n\n` +
            `Silakan cek email tersebut untuk mendapatkan link verifikasi.\n\n` +
            `Setelah mendapatkan link, gunakan:\n` +
            `*${prefix}amverif <link>*\n\n` +
            `*Response:*\n\`\`\`${JSON.stringify(data, null, 2)}\`\`\``
        );
    } catch (err) {
        console.error("AMPREM ERROR:", err);
        return m.reply(
            `❌ Terjadi error:\n\n` +
            `\`\`\`${err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message}\`\`\``
        );
    }
}

export default {
    config: pluginConfig,
    handler,
};