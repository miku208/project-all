import { getAssetBuffer } from "../../src/lib/miku-asset-manager.js";
import config from "../../config.js";
import { getDatabase } from "../../src/lib/miku-database.js";

const pluginConfig = {
  name: "setmenucat",
  alias: ["menucatvariant", "menucatstyle"],
  category: "owner",
  description: "Mengatur variant tampilan menucat",
  usage: ".setmenucat <v1-v2, v5-v7>",
  example: ".setmenucat v2",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

const VARIANTS = {
  v1: {
    id: 1,
    name: "Plain Text",
    desc: "Tampilan teks biasa tanpa media, cocok untuk koneksi lambat atau device yang tidak support interactive message",
    emoji: "📝",
  },
  v2: {
    id: 2,
    name: "Interactive + Image Header",
    desc: "Tampilan premium dengan gambar header, limited time offer, dan tombol navigasi interaktif",
    emoji: "🖼️",
  },
  v5: {
    id: 5,
    name: "MENUCAT NATIVEFLOW",
    desc: "Tampilan native flow premium dengan video & cuaca",
    emoji: "✨",
  },
  v6: {
    id: 6,
    name: "MENUCAT LOCATION",
    desc: "Tampilan location message tanpa tombol interaktif",
    emoji: "📍",
  },
  v7: {
    id: 7,
    name: "A2UI WIDGET",
    desc: "Menu interaktif A2UI (bloksWidget) dengan daftar perintah di dalam widget",
    emoji: "🧩",
  },
};

async function handler(m, { sock, db }) {
  const args = m.args || [];
  const variant = args[0]?.toLowerCase();

  if (variant) {
    const selected = VARIANTS[variant];
    if (!selected) {
      await m.reply(`❌ *VARIANT TIDAK VALID*\n\nGunakan: *v1*, *v2*, *v5*, *v6*, atau *v7*`);
      return;
    }

    db.setting("menucatVariant", selected.id);
    await db.save();

    await m.reply(
      `✅ *MENUCAT VARIANT DIUBAH*\n\n` +
        `${selected.emoji} *V${selected.id} — ${selected.name}*\n` +
        `${selected.desc}`,
    );
    return;
  }

  const current =
    db.setting("menucatVariant") || config.ui?.menucatVariant || 2;

  const rows = [];
  for (const [key, val] of Object.entries(VARIANTS)) {
    const mark = val.id === current ? " ✓" : "";
    rows.push({
      title: `${val.emoji} ${key.toUpperCase()}${mark} — ${val.name}`,
      description: val.desc,
      id: `${m.prefix}setmenucat ${key}`,
    });
  }

  const buttons = [
    {
      name: "single_select",
      buttonParamsJson: JSON.stringify({
        title: "📂 Pilih Variant Menucat",
        sections: [{ title: "Daftar Variant Menucat", rows }],
      }),
    },
  ];

  const bodyText =
    `📂🗂️ *MENUCAT VARIANT*\n\n` +
    `Atur tampilan menu per kategori ketika user memilih kategori dari menu utama 📋✨\n` +
    `Variant aktif saat ini: *V${current} — ${VARIANTS[`v${current}`]?.name || "Unknown"}* 🎯\n\n` +
    `> Pilih variant menucat dari tombol di bawah 👇`;

  await sock.sendButton(
    m.chat,
    getAssetBuffer("miku"),
    bodyText,
    m,
    { buttons },
  );
}

export { pluginConfig as config, handler };
