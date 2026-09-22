import config from '../../config.js'

const pluginConfig = {
    name: 'fakemsg',
    alias: ['fakes', 'fakeedit'],
    category: 'owner',
    description: 'Memalsukan pesan orang lain menggunakan teknik edit & delete temporary (Owner Only)',
    usage: '.fakemsg <teks> (reply pesan target)',
    example: '.fakemsg Halo semua',
    isOwner: true,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

/**
 * Helper untuk mengambil nomor HP pengirim (Phone Number / PN)
 * meskipun WhatsApp menggunakan mode LID (Linked ID)
 */
function getSenderPN(m) {
    const rawJid = m.contact?.secondaryId ||
        m.key?.participantAlt ||
        m.node?.attrs?.participant_pn ||
        m.sender ||
        ""
    // Ambil deretan angka saja (misal: 6281210061590)
    return rawJid.replace(/[^0-9]/g, '')
}

async function handler(m, { sock }) {
    const jid = m.chat

    // 1. DETEKSI AKURAT SENDER & OWNER ONLY (Support LID & PN)
    const senderNumber = getSenderPN(m)

    const ownerList = config?.owner?.number || global?.owner || []
    const isOwner = Boolean(
        m.isOwner ||
        m.key?.fromMe ||
        ownerList.some(owner => owner.toString().replace(/[^0-9]/g, '') === senderNumber)
    )

    if (!isOwner) {
        return m.reply('Fitur ini khusus untuk Owner bot!')
    }

    // 2. EKSTRAKSI QUOTED & CONTEXTINFO (Direct Parse untuk Reply Message)
    const contextInfo = m.message?.extendedTextMessage?.contextInfo ||
        m.message?.imageMessage?.contextInfo ||
        m.message?.videoMessage?.contextInfo ||
        m.quoted?.message || null

    const stanzaId = m.quoted?.id || contextInfo?.stanzaId
    const participant = m.quoted?.sender ||
        m.quoted?.participant ||
        contextInfo?.participant ||
        contextInfo?.remoteJid

    // Validasi input
    if (!stanzaId) {
        return m.reply('Reply ke pesan yang ingin dipalsukan!')
    }
    const text = m.text || m.fullArgs || ''
    if (!text) {
        return m.reply('Masukkan teks pengganti!')
    }

    try {
        // 3. Kirim pesan sementara (gunakan ' ' spasi agar tidak ditolak Baileys)
        const temp = await sock.sendMessage(
            jid,
            { text: ' ' },
            { quoted: m }
        )
        const tempId = temp.key.id

        // 4. Edit pesan sementara dengan teks pengganti (messageId = stanzaId target)
        await sock.sendMessage(
            jid,
            {
                text: text.trim(),
                edit: {
                    remoteJid: jid,
                    id: tempId
                }
            },
            {
                messageId: stanzaId
            }
        )

        // 5. Hapus pesan sementara, pesan target, dan command
        await Promise.allSettled([
            // Hapus pesan temporary bot
            sock.sendMessage(jid, {
                delete: {
                    remoteJid: jid,
                    id: tempId,
                    fromMe: true
                }
            }),

            // Hapus pesan asli target (perlu hak Admin pada akun BOT di grup)
            sock.sendMessage(jid, {
                delete: {
                    remoteJid: jid,
                    id: stanzaId,
                    fromMe: false,
                    participant
                }
            }),

            // Hapus pesan command dari pengirim
            sock.sendMessage(jid, {
                delete: {
                    remoteJid: jid,
                    id: m.key.id,
                    fromMe: false,
                    participant: m.sender
                }
            })
        ])
    } catch (e) {
        console.error('[fakemsg]', e)
        m.reply('Error: ' + (e?.message || e))
    }
}

export { pluginConfig as config, handler }
