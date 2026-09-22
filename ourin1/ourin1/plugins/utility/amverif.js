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

async function verifyLink(email, link) {
    const { data } = await axios.post(
        API_URL,
        { action: "verify", email, link },
        {
            headers: { "Content-Type": "application/json" },
            timeout: 30000
        }
    );
    return data;
}

const pluginConfig = {
    name: "amverif",
    alias: ["amverif"],
    category: "utility",
    description: "Verifikasi link AMPREM dari email",
    usage: ".amverif <link>",
    example: ".amverif https://example.com/verify",
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
        const link = m.text?.trim();

        if (!link) {
            return m.reply(
                `🔗 *AMPREM Verifikasi*\n\n` +
                `Penggunaan:\n` +
                `*${prefix}amverif <link>*\n\n` +
                `Contoh:\n` +
                `*${prefix}amverif https://example.com/verify*`
            );
        }

        const dbData = readDB();
        const user = dbData[m.sender];

        if (!user?.email) {
            return m.reply(
                `❌ Kamu belum melakukan register.\n\n` +
                `Gunakan:\n` +
                `*${prefix}amprem <email>*`
            );
        }

        await m.reply("⏳ Sedang memverifikasi link...");

        const data = await verifyLink(user.email, link);

        return m.reply(
            `✅ *Verifikasi selesai*\n\n` +
            `📧 Email: ${user.email}\n` +
            `🔗 Link: ${link}\n\n` +
            `*Response API:*\n` +
            `\`\`\`${JSON.stringify(data, null, 2)}\`\`\``
        );
    } catch (err) {
        console.error("AMVERIF ERROR:", err);
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