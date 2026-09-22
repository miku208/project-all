import config from '../../config.js'
import te from '../../src/lib/miku-error.js'

const pluginConfig = {
    name: ['fixsession', 'resetsession'],
    alias: [],
    category: 'owner',
    description: 'Reset session enkripsi WhatsApp bot ke nomor/grup tertentu. Dipakai kalau pesan bot muncul "Menunggu pesan ini. Ini mungkin membutuhkan waktu beberapa saat." di penerima.',
    usage: '.fixsession <nomor/reply/mention> | .fixsession (di chat target)',
    example: '.fixsession 628xxx',
    isOwner: true,
    cooldown: 3,
    energi: 0,
    isEnabled: true
}

/**
 * Hapus session Signal (PN + LID) untuk 1 JID.
 * Session stale = penyebab pesan bot tidak bisa didekripsi penerima.
 */
async function clearSession(sock, jid) {
    if (!jid) return { cleared: [], errors: [] }
    const targets = new Set([jid])
    try {
        const repo = sock.signalRepository || sock.repository
        if (repo?.lidMapping?.getLIDForPN) {
            const lid = await repo.lidMapping.getLIDForPN(jid)
            if (lid) targets.add(lid)
        }
    } catch { }

    const cleared = []
    const errors = []
    for (const t of targets) {
        try {
            const repo = sock.signalRepository || sock.repository
            if (repo?.deleteSession) {
                await repo.deleteSession([t])
                cleared.push(t)
            }
        } catch (e) {
            errors.push(`${t}: ${e.message}`)
        }
    }

    // Paksa distribusi sender key baru untuk grup
    try {
        if (jid.endsWith('@g.us')) {
            await sock.authState?.keys?.set({ 'sender-key-memory': { [jid]: null } })
            cleared.push(jid + ' (sender-key)')
        }
    } catch (e) {
        errors.push(`sender-key: ${e.message}`)
    }

    return { cleared, errors }
}

async function handler(m, { sock }) {
    let targetJid = null

    if (m.mentionedJid?.length > 0) {
        targetJid = m.mentionedJid[0]
    } else if (m.quoted) {
        targetJid = m.quoted.sender || m.quoted.participant
    } else if (m.args[0]) {
        let num = m.args[0].replace(/[^0-9]/g, '')
        if (!num) return m.reply('❌ Nomor tidak valid.')
        targetJid = num + '@s.whatsapp.net'
    } else {
        // Tanpa argumen: reset session chat ini (grup/private tempat command diketik)
        targetJid = m.chat
    }

    if (!targetJid) {
        return m.reply(
            '⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n' +
            '> `.fixsession 628xxx` — reset session ke nomor\n' +
            '> `.fixsession` (reply pesan) — reset ke pengirim\n' +
            '> `.fixsession @mention` — reset ke yang di-mention\n' +
            '> `.fixsession` (di grup/private) — reset session chat ini\n\n' +
            '_Dipakai kalau penerima melihat "Menunggu pesan ini..." pada pesan bot_'
        )
    }

    await m.reply(`🔄 *RESET SESSION*\n\n> Target: \`${targetJid}\`\n> Menghapus session lama & membangun ulang...`)

    try {
        const { cleared, errors } = await clearSession(sock, targetJid)

        if (!cleared.length && errors.length) {
            return m.reply(`❌ *GAGAL*\n\n> ${errors.join('\n> ')}`)
        }

        // Bangun ulang session: fetch prekey bundle terbaru dari server
        let rebuilt = false
        try {
            if (sock.assertSessions) {
                await sock.assertSessions([targetJid], true)
                rebuilt = true
            }
        } catch (e) {
            errors.push(`assertSessions: ${e.message}`)
        }
        try {
            if (sock.uploadPreKeys) await sock.uploadPreKeys(5)
        } catch { }

        let txt =
            `✅ *SESSION DIRESET*\n\n` +
            `> Target: @${targetJid.split('@')[0]}\n` +
            `> Dihapus: ${cleared.length ? cleared.map(c => `\`${c}\``).join(', ') : '-'}\n` +
            `> Session baru: ${rebuilt ? '✅ dibangun ulang' : '⚠️ otomatis saat kirim berikutnya'}\n\n` +
            `_Coba kirim pesan ke target untuk mengetes. Jika penerima masih melihat "Menunggu pesan ini", minta dia reply/pesannya di-forward ulang._`

        if (errors.length) txt += `\n\n⚠️ Errors:\n> ${errors.join('\n> ')}`

        await m.reply(txt, { mentions: [targetJid] })
    } catch (e) {
        return m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }
