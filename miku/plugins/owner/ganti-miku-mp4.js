import fs from 'fs'
import path from 'path'
import te from '../../src/lib/miku-error.js'
import { updateAssetUrl } from '../../src/lib/miku-uploader.js'
const pluginConfig = {
    name: 'ganti-miku.mp4',
    alias: ['gantimikuvideo', 'setmikuvideo'],
    category: 'owner',
    description: 'Ganti video miku.mp4',
    usage: '.ganti-miku.mp4 (reply/kirim video)',
    example: '.ganti-miku.mp4',
    isOwner: true,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true
}

async function handler(m, { sock }) {
    const isVideo = m.type === 'videoMessage' || (m.quoted && m.quoted.type === 'videoMessage')
    
    if (!isVideo) {
        return m.reply(`🎬 *ɢᴀɴᴛɪ ᴍɪᴋᴜ.ᴍᴘ4*\n\n> Kirim/reply video untuk mengganti\n> File: assets/video/miku.mp4`)
    }
    
    try {
        let buffer
        if (m.quoted && m.quoted.isMedia) {
            buffer = await m.quoted.download()
        } else if (m.isMedia) {
            buffer = await m.download()
        }
        
        if (!buffer) {
            return m.reply(`❌ Gagal mendownload video`)
        }
        
        await m.reply(`⏳ Sedang mengupload gambar...`)
        try {
            const newUrl = await updateAssetUrl('miku-mp4', buffer, 'miku.mp4')
            m.reply(`✅ *ʙᴇʀʜᴀsɪʟ*\n\n> File miku.mp4 telah diganti ke URL baru:\n> ${newUrl}\n> Config telah diupdate secara realtime!`)
        } catch (e) {
            m.reply(`❌ Gagal mengupload file: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }