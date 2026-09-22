/**
 * Nama Plugin: AI Image Edit
 * Fungsi: Edit gambar menggunakan AI (Qwen Image Edit)
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import https from "https";
import { tmpdir } from "os";

const BASE_URL = "https://prithivmlmods-qwen-image-edit-2509-loras-fast.hf.space";

const LORA_OPTIONS = [
  "Photo-to-Anime",
  "Multiple-Angles",
  "Light-Restoration",
  "Relight",
  "Multi-Angle-Lighting",
  "Edit-Skin",
  "Next-Scene",
  "Flat-Log",
  "Upscale-Image",
  "Upscale2K",
];

class QwenImageEdit {
  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
      headers: {
        "User-Agent": "Mozilla/5.0",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
      timeout: 180000,
    });
  }

  async uploadImage(filePath) {
    const form = new FormData();
    form.append("files", fs.createReadStream(filePath), {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    const res = await this.client.post(
      "/gradio_api/upload",
      form,
      { headers: form.getHeaders() }
    );

    console.log("[AIEdit] Upload response:", JSON.stringify(res.data));

    const uploaded = res.data?.[0];
    if (!uploaded) throw new Error("Upload gagal: " + JSON.stringify(res.data));

    // Gradio 5 FileData format yang benar
    return {
      path: uploaded,
      orig_name: "image.jpg",
      mime_type: "image/jpeg",
      size: fs.statSync(filePath).size,
      meta: { _type: "gradio.FileData" },
    };
  }

  async editImage(filePath, prompt, lora = "Photo-to-Anime") {
    const fileData = await this.uploadImage(filePath);

    // Gradio 5: input_image adalah gr.Image(type="pil")
    // Harus dikirim sebagai object dengan key "path" saja (FileData minimal)
    const payload = {
      data: [
        { path: fileData.path, meta: { _type: "gradio.FileData" } },
        prompt,
        lora,
        0,
        true,
        1.0,
        4,
      ],
    };

    console.log("[AIEdit] Sending payload:", JSON.stringify(payload));

    const callRes = await this.client.post(
      "/gradio_api/call/infer",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("[AIEdit] Call response:", JSON.stringify(callRes.data));

    const eventId = callRes.data?.event_id;
    if (!eventId) throw new Error("Tidak mendapat event_id: " + JSON.stringify(callRes.data));

    return this.pollResult(eventId);
  }

  async pollResult(eventId) {
    return new Promise((resolve, reject) => {
      // Gradio 5 SSE stream — gunakan axios streaming bukan polling
      this.client.get(`/gradio_api/call/infer/${eventId}`, {
        responseType: "stream",
        timeout: 180000,
      }).then((res) => {
        let buffer = "";

        res.data.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop(); // simpan baris tidak lengkap

          for (const line of lines) {
            console.log("[AIEdit] SSE line:", line);

            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json || json === "[DONE]") continue;

            let parsed;
            try { parsed = JSON.parse(json); } catch { continue; }

            // Gradio 5 error format
            if (parsed?.error) {
              return reject(new Error(parsed.error));
            }

            // Gradio 5 success: array of outputs
            if (Array.isArray(parsed) && parsed.length > 0) {
              const out = parsed[0];
              if (!out) return reject(new Error("Output gambar kosong"));

              const imageUrl =
                out.url ||
                (out.path ? `${BASE_URL}/gradio_api/file=${out.path}` : null);

              if (!imageUrl) return reject(new Error("URL tidak ditemukan: " + JSON.stringify(out)));
              return resolve({ imageUrl });
            }
          }
        });

        res.data.on("end", () => {
          reject(new Error("Stream selesai tanpa hasil"));
        });

        res.data.on("error", (err) => {
          reject(new Error("Stream error: " + err.message));
        });

      }).catch(reject);
    });
  }
}

const pluginConfig = {
  name: "aiedit",
  alias: ["aieditv2", "imgedit", "imgeditv2"],
  category: "ai",
  description: "Edit gambar menggunakan AI dengan prompt teks",
  usage: ".aiedit <prompt> (reply gambar)",
  example: ".aiedit kasih topi santa",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 30,
  energi: 2,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const isImage = m.isImage || (m.quoted && m.quoted.type === "imageMessage");
  const prompt = m.text?.trim();

  if (!isImage) {
    return m.reply(
      `🖼️ *AI Image Edit*\n\n` +
      `Reply gambar dengan caption prompt kamu.\n\n` +
      `*Contoh:*\n` +
      `• \`${m.prefix}aiedit kasih topi santa\`\n` +
      `• \`${m.prefix}aiedit ubah jadi anime\`\n` +
      `• \`${m.prefix}aiedit upscale gambar\``
    );
  }

  if (!prompt || prompt.length < 3) {
    return m.reply("❌ Prompt terlalu pendek. Contoh: *kasih topi santa*");
  }

  m.react("🕐");

  try {
    const imgBuffer = m.quoted?.isMedia
      ? await m.quoted.download()
      : await m.download();

    const tempInput = path.join(tmpdir(), `aiedit_${Date.now()}.jpg`);
    fs.writeFileSync(tempInput, imgBuffer);

    // Pilih LoRA berdasarkan prompt
    let lora = "Photo-to-Anime";
    const p = prompt.toLowerCase();
    if (p.includes("upscale") || p.includes("hd") || p.includes("4k")) lora = "Upscale-Image";
    else if (p.includes("anime")) lora = "Photo-to-Anime";
    else if (p.includes("angle") || p.includes("kamera") || p.includes("rotate")) lora = "Multiple-Angles";
    else if (p.includes("cahaya") || p.includes("shadow") || p.includes("light")) lora = "Relight";
    else if (p.includes("skin") || p.includes("kulit")) lora = "Edit-Skin";

    const ai = new QwenImageEdit();
    const result = await ai.editImage(tempInput, prompt, lora);

    fs.unlinkSync(tempInput);

    await sock.sendMessage(
      m.chat,
      {
        image: { url: result.imageUrl },
        caption:
          `✨ *AI Edit Selesai*\n\n` +
          `📝 *Prompt:* ${prompt}\n` +
          `🎨 *Style:* ${lora}`,
      },
      { quoted: m }
    );

    m.react("✅");
  } catch (err) {
    console.error("[AIEdit Error]", err);
    m.react("❌");
    m.reply(`❌ *Gagal memproses gambar*\n${err.message || "Terjadi kesalahan"}`);
  }
}

export { pluginConfig as config, handler };