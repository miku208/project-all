import config from "../../config.js";

const pluginConfig = {
    name: 'getpp',
    alias: ['pp', 'profilepic', 'avatar', 'getavatar'],
    category: 'tools',
    description: 'Ambil foto profil target (reply/mention/nomor/grup)',
    usage: '.getpp @user\n.getpp (reply)\n.getpp 628xxx\n.getpp --grup',
    example: '.getpp @628xxx',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true
};

function cleanJid(jid = '') {
    return String(jid).split(':')[0].split('@')[0];
}

function toJid(input) {
    if (!input) return null;
    let s = String(input).trim();
    if (s.includes('@')) return s;
    s = s.replace(/[^0-9]/g, '');
    if (s.startsWith('0')) s = '62' + s.slice(1);
    else if (s.startsWith('8')) s = '62' + s;
    if (s.length < 8) return null;
    return s + '@s.whatsapp.net';
}

function resolveTarget(m) {
    if (m.quoted?.sender) return m.quoted.sender;
    if (m.mentionedJid?.length) return m.mentionedJid[0];
    if (m.args?.[0]) {
        const jid = toJid(m.args[0]);
        if (jid) return jid;
    }
    return m.sender;
}

async function tryProfilePic(sock, jid) {
    const variants = [jid, jid.split('@')[0] + '@lid', jid.split('@')[0] + '@s.whatsapp.net'];
    for (const v of variants) {
        try {
            const url = await sock.profilePictureUrl(v, 'image');
            if (url) return url;
        } catch {}
    }
    return null;
}

async function handler(m, { sock }) {
    try {
        const isGroupPP = /--grup|--group|--gc\b/i.test(String(m.body || ''));

        if (isGroupPP) {
            if (!m.isGroup) return m.reply('❌ Cuma bisa di grup.');
            let url = null;
            try {
                url = await sock.profilePictureUrl(m.chat, 'image');
            } catch {}
            if (!url) return m.reply('❌ Grup ini tidak punya foto profil.');
            return sock.sendMedia(m.chat, url, '', m, { type: 'image' });
        }

        const jid = resolveTarget(m);
        const targetNum = cleanJid(jid);

        try { await sock.sendMessage(m.chat, { react: { text: '⏳', key: m.key } }); } catch {}

        const ppUrl = await tryProfilePic(sock, jid);

        if (!ppUrl) {
            try { await sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } }); } catch {}
            return m.reply(`❌ @${targetNum} tidak punya foto profil.`, { mentions: [jid] });
        }

        await sock.sendMedia(m.chat, ppUrl, '', m, {
            type: 'image',
            mentions: [jid]
        });

        try { await sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } }); } catch {}
    } catch (err) {
        console.error('[getpp] error:', err?.message || err);
        try {
            await sock.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        } catch {}
        try { await m.reply('❌ Gagal ambil foto profil.'); } catch {}
    }
}

export { pluginConfig as config, handler };