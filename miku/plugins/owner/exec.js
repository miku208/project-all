import fs from 'fs'
import path from 'path'
import config from '../../config.js'
import util from 'util'
import { getDatabase } from '../../src/lib/miku-database.js'
import { getPluginCount, getPlugin } from '../../src/lib/miku-plugins.js'
import { sendWelcomeMessage } from '../group/welcome.js'
import { sendGoodbyeMessage } from '../group/goodbye.js'

const pluginConfig = {
    name: 'exec',
    alias: ['>', 'run', 'execute', 'ev'],
    category: 'owner',
    description: 'Exec kode JS setara >> + preset tes welcome/goodbye (Owner Only)',
    usage: '.exec <kode> | reply pesan berisi kode',
    example: '.exec return m.sender',
    isOwner: true,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 0,
    energi: 0,
    isEnabled: true
}

/* ══════════════ HELPERS ══════════════ */

function formatOutput(result) {
    if (typeof result === 'undefined') return 'undefined'
    if (result === null) return 'null'
    if (typeof result === 'object') {
        try {
            return util.inspect(result, { depth: 2, maxArrayLength: 50, maxStringLength: 500 })
        } catch {
            return String(result)
        }
    }
    return String(result)
}

function truncate(str, max = 3000) {
    if (str.length > max) return str.slice(0, max) + '\n\n... (truncated)'
    return str
}

function pickTargetGroup(m, args) {
    // prioritas: argumen jid/link grup -> grup chat aktif -> grup pertama yang diikuti bot
    const firstArg = args?.[0]
    if (firstArg && (firstArg.endsWith('@g.us') || firstArg.includes('chat.whatsapp.com'))) {
        return firstArg.endsWith('@g.us') ? firstArg : null // link perlu di-resolve via kode
    }
    if (m.isGroup) return m.chat
    return null
}

async function resolveAnyGroup(m, sock, db) {
    // buat preset yang butuh grup walau bot dipakai di private chat
    let jid = pickTargetGroup(m, m.args)
    if (jid) return jid
    try {
        const groups = await sock.groupFetchAllParticipating()
        const ids = Object.keys(groups || {})
        if (ids.length === 0) return null
        // pilih grup paling baru aktif (punya data chat) atau grup pertama
        const allGroups = db.getAllGroups?.() || {}
        ids.sort((a, b) => (allGroups[b]?.chat ? 1 : 0) - (allGroups[a]?.chat ? 1 : 0))
        return ids[0]
    } catch {
        return null
    }
}

/* ══════════════ PRESET: TES WELCOME ══════════════ */

async function presetWelcome(m, { sock }) {
    const db = getDatabase()
    const groupJid = await resolveAnyGroup(m, sock, db)
    if (!groupJid) {
        return m.reply('❌ Bot tidak tergabung di grup manapun, tidak bisa tes welcome.')
    }

    // bot jadi "member baru" simulan
    const botJid = sock.user?.id
    const meta = await sock.groupMetadata(groupJid).catch(() => null)
    if (!meta) return m.reply('❌ Gagal mengambil metadata grup target.')

    const prevWelcome = db.getGroup(groupJid)?.welcome
    const prevParticipants = meta.participants
    // pastikan welcome aktif & bot ada di daftar participants
    db.setGroup(groupJid, { welcome: true })
    meta.participants = [
        ...(prevParticipants || []).filter(p => p.id !== botJid && p.jid !== botJid),
        { id: botJid, jid: botJid, admin: null }
    ]

    try {
        const ok = await sendWelcomeMessage(sock, groupJid, botJid, meta)
        return m.reply(
            `🧪 *ᴛᴇs ᴡᴇʟᴄᴏᴍᴇ* ${ok ? '✅' : '❌'}\n\n` +
            `> Grup : ${meta.subject}\n` +
            `> JID : \`${groupJid}\`\n` +
            `> welcomeType : *${db.setting('welcomeType') || 1}*\n` +
            `> Simulan : bot (sebagai member baru)\n\n` +
            (ok ? `Welcome terkirim ke grup, cek dulu hasilnya~` : `Gagal kirim, cek console log.`)
        )
    } finally {
        // restore state supaya tidak ada side effect
        if (prevWelcome !== undefined) {
            db.setGroup(groupJid, { welcome: prevWelcome })
        }
        meta.participants = prevParticipants
    }
}

/* ══════════════ PRESET: TES GOODBYE ══════════════ */

async function presetGoodbye(m, { sock }) {
    const db = getDatabase()
    const groupJid = await resolveAnyGroup(m, sock, db)
    if (!groupJid) {
        return m.reply('❌ Bot tidak tergabung di grup manapun, tidak bisa tes goodbye.')
    }

    const botJid = sock.user?.id
    const meta = await sock.groupMetadata(groupJid).catch(() => null)
    if (!meta) return m.reply('❌ Gagal mengambil metadata grup target.')

    const prevGoodbye = db.getGroup(groupJid)?.goodbye
    const prevParticipants = meta.participants
    db.setGroup(groupJid, { goodbye: true })
    meta.participants = [
        ...(prevParticipants || []).filter(p => p.id !== botJid && p.jid !== botJid),
        { id: botJid, jid: botJid, admin: null }
    ]

    try {
        const ok = await sendGoodbyeMessage(sock, groupJid, botJid, meta)
        return m.reply(
            `🧪 *ᴛᴇs ɢᴏᴏᴅʙʏᴇ* ${ok ? '✅' : '❌'}\n\n` +
            `> Grup : ${meta.subject}\n` +
            `> JID : \`${groupJid}\`\n` +
            `> Simulan : bot (sebagai member keluar)\n\n` +
            (ok ? `Goodbye terkirim ke grup, cek dulu hasilnya~` : `Gagal kirim, cek console log.`)
        )
    } finally {
        if (prevGoodbye !== undefined) {
            db.setGroup(groupJid, { goodbye: prevGoodbye })
        }
        meta.participants = prevParticipants
    }
}

/* ══════════════ HANDLER UTAMA ══════════════ */

async function handler(m, { sock }) {
    if (!config.isOwner(m.sender)) {
        return m.reply('❌ *Owner Only!*')
    }

    const sub = m.args?.[0]?.toLowerCase()

    /* ── PRESET MODE ── */
    if (sub === 'welcome' || sub === 'teswelcome' || sub === 'testwelcome') {
        return presetWelcome(m, { sock })
    }
    if (sub === 'goodbye' || sub === 'tesgoodbye' || sub === 'testgoodbye') {
        return presetGoodbye(m, { sock })
    }

    /* ── CODE MODE ── */
    let code = null
    const isPresetWord = ['welcome', 'teswelcome', 'testwelcome', 'goodbye', 'tesgoodbye', 'testgoodbye'].includes(sub)

    if (m.quoted) {
        code = m.quoted.text || m.quoted.body || m.quoted.caption
    }

    // inline code (skip kalau arg pertama cuma sisa nama preset yang tidak dikenal)
    if (!code && !isPresetWord) {
        code = m.fullArgs?.trim() || m.text?.trim()
    }

    if (!code) {
        const pluginCount = getPluginCount()
        return m.reply(
            `⚙️ *ᴇxᴇᴄ ᴄᴏɴsᴏʟᴇ* (setara \`>>\`)\n\n` +
            `*Format:*\n` +
            `> \`${m.prefix}exec <kode>\`\n` +
            `> Reply pesan berisi kode, lalu \`${m.prefix}exec\`\n\n` +
            `*Preset tes:*\n` +
            `> \`${m.prefix}exec welcome\` → tes welcome (bot jadi member baru)\n` +
            `> \`${m.prefix}exec goodbye\` → tes goodbye\n` +
            `> Bisa plus jid grup: \`${m.prefix}exec welcome 1203...@g.us\`\n\n` +
            `*Variabel tersedia:*\n` +
            `> \`m\` · \`sock\` · \`db\` · \`config\` · \`getDatabase\`\n` +
            `> \`axios\` · \`fs\` · \`path\` · \`os\` · \`util\` · \`exec\`\n` +
            `> \`proto\` · \`generateWAMessage\` · \`generateWAMessageFromContent\` · \`generateMessageID\`\n` +
            `> \`VERSION\` · \`Button\` · \`ButtonV2\` · \`Carousel\` · \`AIRich\`\n` +
            `> \`plugins\` (count) · \`getPlugin\`\n\n` +
            `*Contoh:*\n` +
            `> \`${m.prefix}exec return m.sender\`\n` +
            `> \`${m.prefix}exec return sock.user.id\`\n` +
            `> \`${m.prefix}exec return Object.keys(db.getAllGroups()).length\`\n\n` +
            `📦 Plugin terload: *${pluginCount}*`
        )
    }

    code = code.trim()

    // buang code fence kalau di-copy dari chat
    if (code.startsWith('```') && code.endsWith('```')) {
        code = code.slice(3, -3)
        code = code.replace(/^(javascript|js)\n?/, '')
    }

    const db = getDatabase()

    let result
    let isError = false

    try {
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor

        const execCode = new AsyncFunction(
            'm', 'sock', 'db', 'config', 'getDatabase', 'console', 'plugins', 'getPlugin',
            `
            const { default: axios } = await import('axios')
            const { default: fs } = await import('fs')
            const { default: path } = await import('path')
            const { default: os } = await import('os')
            const { promisify } = await import('util')
            const util = await import('util')
            const { generateWAMessage, generateWAMessageFromContent, proto, generateMessageID } = await import('mikuhostt-baileys')
            const { exec: childExec } = await import('child_process')
            const { VERSION, Button, ButtonV2, Carousel, AIRich } = await import('./src/lib/miku-builder.js')
            const exec = promisify(childExec)

            ${code}
            `
        )

        result = await execCode(m, sock, db, config, getDatabase, console, { count: getPluginCount() }, getPlugin)
    } catch (e) {
        isError = true
        result = e
    }

    const output = truncate(formatOutput(result))

    const status = isError ? '❌ Error' : '✅ Success'
    const type = isError ? result?.name || 'Error' : typeof result

    const codePreview = code.length > 100 ? code.slice(0, 100) + '...' : code

    await m.reply(
        `⚙️ *ᴇxᴇᴄ ʀᴇsᴜʟᴛ*\n\n` +
        `╭┈┈⬡「 📋 *ᴄᴏᴅᴇ* 」\n` +
        `┃ \`${codePreview}\`\n` +
        `├┈┈⬡「 📊 *ʀᴇsᴜʟᴛ* 」\n` +
        `┃ ${status}\n` +
        `┃ Type: ${type}\n` +
        `╰┈┈┈┈┈┈┈┈⬡\n\n` +
        `\`\`\`${output}\`\`\``
    )
}

export { pluginConfig as config, handler }
