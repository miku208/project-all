/**
 * Gemini — pakai Ryuu API
 * Support: text, system prompt/karakter, vision (image via base64)
 */

import axios from "axios";

const RYUU_API_URL = "https://api.ryuu-dev.my.id/ai/chat/gemini";
const RYUU_API_KEY = "ryuu-apis-2e33cd8dad39d42f1778386234154";
const MODEL = "gemini-3.1-flash-lite-preview";

async function callRyuuAPI(message, instruction, imageBuffer = null, retries = 3) {
  const params = new URLSearchParams();
  params.append("text", message || "Analisis gambar ini.");
  if (instruction) params.append("prompt", instruction);
  params.append("model", MODEL);

  // Kalau ada gambar, encode ke base64 dan sisipkan ke text
  if (imageBuffer) {
    const base64 = imageBuffer.toString("base64");
    params.append("image", base64);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.post(RYUU_API_URL, params.toString(), {
        headers: {
          "X-RYUU-APIKEY": RYUU_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 60000,
      });

      const text = data?.result?.response;
      if (!text) throw new Error("API tidak mengembalikan respons");

      return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
    } catch (err) {
      const status = err?.response?.status;

      if ((status === 429 || status === 503) && attempt < retries) {
        const delay = attempt * 5000;
        console.warn(`[Gemini Ryuu] Status ${status}, retry ${attempt}/${retries} dalam ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    }
  }
}

async function gemini(input = {}) {
  const payload =
    typeof input === "string" ? { message: input } : input || {};
  const { message, instruction = "", imageBuffer = null } = payload;

  if (!message && !imageBuffer) throw new Error("Message is required.");

  const text = await callRyuuAPI(message, instruction, imageBuffer);

  return {
    text,
    sessionId: null,
  };
}

export { gemini as chat };
export default gemini;