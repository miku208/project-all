import crypto  from 'crypto';

const pluginConfig = {
    name: 'hdvideo',
    alias: ['upscale', 'enhancevideo', 'hdvid'],
    category: 'tools',
    description: 'Tingkatkan kualitas video ke HD/2K menggunakan AI',
    usage: '.hdvideo (reply video)',
    example: '.hdvideo (reply ke video)',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 15,
    energi: 5,
    isEnabled: true
}

async function hdvideo(buffer) {
    try {
        const baseApi = 'https://api.unblurimage.ai'
        const productSerial = crypto.randomUUID().replace(/-/g, '')

        const sleep = ms => new Promise(r => setTimeout(r, ms))

        async function jsonFetch(url, options = {}) {
            const res = await fetch(url, options)
            const text = await res.text()
            let json
            try {
                json = text ? JSON.parse(text) : null
            } catch {
                return { __httpError: true, status: res.status, raw: text }
            }
            if (!res.ok) return { __httpError: true, status: res.status, raw: json }
            return json
        }

        const uploadForm = new FormData()
        uploadForm.set('video_file_name', `cli-${Date.now()}.mp4`)

        const uploadResp = await jsonFetch(`${baseApi}/api/upscaler/v1/ai-video-enhancer/upload-video`, {
            method: 'POST',
            body: uploadForm
        })

        if (uploadResp.__httpError || uploadResp.code !== 100000) throw new Error('Upload gagal')

        const { url: uploadUrl, object_name } = uploadResp.result || {}
        if (!uploadUrl || !object_name) throw new Error('Upload invalid')

        const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'video/mp4' },
            body: buffer
        })

        if (!putRes.ok) throw new Error('Upload video gagal')

        const cdnUrl = `https://cdn.unblurimage.ai/${object_name}`

        const jobForm = new FormData()
        jobForm.set('original_video_file', cdnUrl)
        jobForm.set('resolution', '2k')
        jobForm.set('is_preview', 'false')

        const createJobResp = await jsonFetch(`${baseApi}/api/upscaler/v2/ai-video-enhancer/create-job`, {
            method: 'POST',
            body: jobForm,
            headers: {
                'product-serial': productSerial,
                authorization: ''
            }
        })

        if (createJobResp.__httpError || createJobResp.code !== 100000) throw new Error('Create job gagal')

        const { job_id } = createJobResp.result || {}
        if (!job_id) throw new Error('Job tidak valid')

        const startTime = Date.now()
        let attempt = 0
        let result

        while (true) {
            attempt++
            const jobResp = await jsonFetch(`${baseApi}/api/upscaler/v2/ai-video-enhancer/get-job/${job_id}`, {
                method: 'GET',
                headers: {
                    'product-serial': productSerial,
                    authorization: ''
                }
            })

            if (jobResp.__httpError) throw new Error('Get job gagal')

            if (jobResp.code === 100000) {
                result = jobResp.result || {}
                if (result.output_url) break
            }

            if (Date.now() - startTime > 600000) throw new Error('Timeout proses') // 10 menit
            await sleep(attempt === 1 ? 20000 : 10000)
        }

        return result.output_url
    } catch (e) {
        throw e
    }
}

async function handler(m) {
    const quoted = m.quoted ? m.quoted : m
    const mime = quoted.mimetype || ''

    if (!mime.includes('video')) {
        return m.reply('❌ Reply/kirim video yang mau di-HD-kan ya!\n\nContoh: .hdvideo (reply video)')
    }

    const maxSize = 30 * 1024 * 1024 // 30MB
    if (quoted.fileLength && quoted.fileLength > maxSize) {
        return m.reply('❌ Ukuran video maksimal 30MB ya.')
    }

    await m.reply('⏳ Sedang memproses video, mohon tunggu (bisa sampai beberapa menit)...')

    try {
        const buffer = await quoted.download()
        if (!buffer) throw new Error('Gagal download video')

        const resultUrl = await hdvideo(buffer)
        if (!resultUrl) throw new Error('Hasil kosong')

        await m.reply({
            video: { url: resultUrl },
            mimetype: 'video/mp4',
            caption: '✅ Video berhasil di-enhance ke 2K!'
        })
    } catch (e) {
        console.error('[hdvideo] Error:', e)
        await m.reply(`❌ Gagal memproses video: ${e.message || 'Unknown error'}`)
    }
}

export { pluginConfig as config, handler }