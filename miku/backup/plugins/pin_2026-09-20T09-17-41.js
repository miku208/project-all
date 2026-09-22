import {
  generateWAMessage,
  generateWAMessageFromContent,
  jidNormalizedUser,
} from "mikuhostt-baileys";
import axios from "axios";
import crypto from "crypto";
import te from "../../src/lib/miku-error.js";
import { f } from "../../src/lib/miku-http.js";
import { AIRich } from "../../src/lib/miku-builder.js";

const pluginConfig = {
  name: "pin",
  alias: ["pinsearch", "pinterestsearch", "pins"],
  category: "search",
  description: "Cari gambar di Pinterest dengan album optimal",
  usage: ".pin <query>",
  example: ".pin Zhao Lusi",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 1,
  isEnabled: true,
};

const API_TIMEOUT = 15000;
const MIN_IMAGE_SIZE = 5000;
const MAX_RESULTS = 5;
const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES = 800;
const DELAY_BETWEEN_IMAGES = 400;
const MAX_RETRIES = 2;

const imageCache = new Map();
const searchCache = new Map();
const CACHE_DURATION = 3600000;

function getCacheKey(query) {
  return `pin_${query.toLowerCase().replace(/\s+/g, '_')}`;
}

function isCacheValid(timestamp) {
  return Date.now() - timestamp < CACHE_DURATION;
}

async function downloadImageOptimized(imageUrl, retries = MAX_RETRIES) {
  const cacheKey = `img_${imageUrl}`;
  
  if (imageCache.has(cacheKey)) {
    const cached = imageCache.get(cacheKey);
    if (isCacheValid(cached.timestamp)) {
      return cached.buffer;
    }
    imageCache.delete(cacheKey);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: API_TIMEOUT,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "image/*",
          "Referer": "https://www.pinterest.com/",
        },
        maxRedirects: 5,
      });

      const buffer = Buffer.from(response.data);

      if (buffer.length < MIN_IMAGE_SIZE) {
        console.warn(`[Pinterest] Gambar terlalu kecil: ${buffer.length} bytes`);
        continue;
      }

      const magicNumbers = buffer.slice(0, 4);
      const isValidImage = 
        (magicNumbers[0] === 0xFF && magicNumbers[1] === 0xD8) ||
        (magicNumbers[0] === 0x89 && magicNumbers[1] === 0x50) ||
        (magicNumbers[0] === 0x47 && magicNumbers[1] === 0x49) ||
        (magicNumbers[0] === 0xFF && magicNumbers[1] === 0xE0);

      if (!isValidImage) {
        console.warn(`[Pinterest] Format gambar tidak valid`);
        continue;
      }

      imageCache.set(cacheKey, {
        buffer,
        timestamp: Date.now(),
      });

      return buffer;
    } catch (error) {
      console.warn(`[Pinterest] Attempt ${attempt}/${retries} gagal:`, error.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  return null;
}

async function searchPinterestOptimized(query) {
  const cacheKey = getCacheKey(query);

  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (isCacheValid(cached.timestamp)) {
      console.log(`[Pinterest] Cache hit untuk: ${query}`);
      return cached.results;
    }
    searchCache.delete(cacheKey);
  }

  try {
    const encodedQuery = encodeURIComponent(query);
    const apiUrl = `https://api.cuki.biz.id/api/search/pinterest?apikey=cuki-x&query=${encodedQuery}&type=image`;

    const data = await f(apiUrl);

    if (!data?.data?.results || !Array.isArray(data.data.results)) {
      return [];
    }

    const results = data.data.results
      .filter((item) => {
        if (!item.image_url || typeof item.image_url !== 'string') return false;
        const url = item.image_url.trim();
        if (!url.startsWith('http')) return false;
        return true;
      })
      .slice(0, MAX_RESULTS);

    searchCache.set(cacheKey, {
      results,
      timestamp: Date.now(),
    });

    return results;
  } catch (error) {
    console.error("[Pinterest] Error fetch:", error.message);
    return [];
  }
}

async function createAlbumBatch(m, sock, mediaList, batchIndex) {
  try {
    const opener = generateWAMessageFromContent(
      m.chat,
      {
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32),
        },
        albumMessage: {
          expectedImageCount: mediaList.length,
          expectedVideoCount: 0,
        },
      },
      {
        userJid: jidNormalizedUser(sock.user.id),
        quoted: m,
        upload: sock.waUploadToServer,
      },
    );

    await sock.relayMessage(opener.key.remoteJid, opener.message, {
      messageId: opener.key.id,
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    for (let i = 0; i < mediaList.length; i++) {
      try {
        const content = mediaList[i];
        const msg = await generateWAMessage(opener.key.remoteJid, content, {
          upload: sock.waUploadToServer,
        });

        msg.message.messageContextInfo = {
          messageSecret: crypto.randomBytes(32),
          messageAssociation: {
            associationType: 1,
            parentMessageKey: opener.key,
          },
        };

        await sock.relayMessage(msg.key.remoteJid, msg.message, {
          messageId: msg.key.id,
        });

        if (i < mediaList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_IMAGES));
        }
      } catch (itemError) {
        console.error(`[Pinterest] Error gambar batch ${batchIndex} item ${i + 1}:`, itemError.message);
        continue;
      }
    }

    return true;
  } catch (error) {
    console.error(`[Pinterest] Album batch ${batchIndex} error:`, error.message);
    return false;
  }
}

async function sendAlbumBatches(m, sock, mediaList) {
  try {
    if (mediaList.length === 0) return false;

    const batches = [];
    for (let i = 0; i < mediaList.length; i += BATCH_SIZE) {
      batches.push(mediaList.slice(i, i + BATCH_SIZE));
    }

    console.log(`[Pinterest] Mengirim ${batches.length} batch(es) dengan total ${mediaList.length} gambar`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const success = await createAlbumBatch(m, sock, batch, batchIndex + 1);

      if (!success) {
        console.warn(`[Pinterest] Batch ${batchIndex + 1} gagal`);
      }

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    return true;
  } catch (error) {
    console.error("[Pinterest] Batch error:", error.message);
    return false;
  }
}

async function sendImagesOneByOne(m, sock, mediaList, config) {
  try {
    if (mediaList.length === 0) return false;

    const saluranId = config?.saluran?.id || "120363400911374213@newsletter";
    const saluranName = config?.saluran?.name || config?.bot?.name || "Miku-AI";

    for (let i = 0; i < mediaList.length; i++) {
      try {
        const content = mediaList[i];

        await sock.sendMessage(
          m.chat,
          {
            image: content.image,
            caption: `📌 ${i + 1}/${mediaList.length}`,
            contextInfo: {
              forwardingScore: 9999,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: saluranId,
                newsletterName: saluranName,
                serverMessageId: 127,
              },
            },
          },
          { quoted: m },
        );

        if (i < mediaList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_IMAGES));
        }
      } catch (itemError) {
        console.error(`[Pinterest] Error gambar ${i + 1}:`, itemError.message);
        continue;
      }
    }

    return true;
  } catch (error) {
    console.error("[Pinterest] One-by-one error:", error.message);
    return false;
  }
}

function sanitizeQuery(query) {
  return query
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .substring(0, 100);
}

function formatFileSize(bytes) {
  const units = ['B', 'KB', 'MB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

async function handler(m, { sock, config }) {
  const query = m.text?.trim();

  if (!query) {
    return m.reply(
      `🔍 *ᴘɪɴᴛᴇʀᴇsᴛ sᴇᴀʀᴄʜ*\n\n` +
      `> Contoh penggunaan:\n` +
      `\`${m.prefix}pin Zhao Lusi\`\n` +
      `\`${m.prefix}pin Aesthetic Wallpaper\`\n\n` +
      `> Info:\n` +
      `• Max 5 gambar per pencarian\n` +
      `• Format album optimal\n` +
      `• Tunggu proses loading...`
    );
  }

  const sanitized = sanitizeQuery(query);
  if (!sanitized) {
    return m.reply(`❌ Query tidak valid. Gunakan kata kunci yang benar.`);
  }

  m.react("🕕");

  try {
    const results = await searchPinterestOptimized(sanitized);

    if (results.length === 0) {
      m.react("❌");
      return m.reply(
        `❌ *Tidak ditemukan hasil*\n\n` +
        `Coba gunakan kata kunci lain untuk: *${sanitized}*`
      );
    }

    const mediaList = [];
    let totalSize = 0;

    for (const item of results) {
      const buffer = await downloadImageOptimized(item.image_url);
      if (buffer) {
        mediaList.push({ image: buffer });
        totalSize += buffer.length;
      }
    }

    if (mediaList.length === 0) {
      m.react("❌");
      return m.reply(
        `❌ *Gagal memuat gambar*\n\n` +
        `Silakan coba lagi nanti atau gunakan kata kunci berbeda.`
      );
    }

    let success = false;
    success = await sendAlbumBatches(m, sock, mediaList);

    if (!success) {
      console.log(`[Pinterest] Album gagal, mengirim ${mediaList.length} gambar satu per satu...`);
      success = await sendImagesOneByOne(m, sock, mediaList, config);
    }

    if (success) {
      m.react("✅");
      await m.reply(
        `✅ *Berhasil!*\n\n` +
        `📸 Ditemukan *${mediaList.length}* gambar\n` +
        `💾 Total: *${formatFileSize(totalSize)}*\n` +
        `🔍 Query: *${sanitized}*\n\n` +
        `_Gambar sedang dikirim..._`
      );
    } else {
      m.react("⚠️");
      m.reply(`⚠️ Gagal mengirim hasil pencarian. Coba lagi nanti.`);
    }
  } catch (error) {
    console.error("[Pinterest] Fatal error:", error);
    m.react("☢");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };