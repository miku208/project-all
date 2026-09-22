/**
 * Contoh AMAN: mengirim pesan interaktif (tombol) WhatsApp lewat Baileys.
 *
 * Ini contoh dari nol untuk mempelajari bentuk struktur pesan — bukan versi
 * modifikasi dari file payload di repo ini. Yang sengaja TIDAK ada di sini:
 *   - metadata media palsu (fileLength/height/pageCount di luar batas)
 *   - protobuf bersarang rekursif
 *   - string pengisi "\0" / kontrol karakter di paramsJson
 *   - relayMessage ke "status@broadcast" + statusJidList (fan-out massal)
 *   - loop durasi 4 menit
 *
 * Kuncinya: pesan normal lewat sock.sendMessage(), bukan relayMessage().
 * relayMessage mengirim isi mentah tanpa validasi sisi-klien — itu pintu masuk
 * semua trik di file payload. sendMessage lewat jalur kirim normal.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@mikudeveloper/grace");

/**
 * Susun daftar tombol. Nilai-nilai di sini realistis dan wajar:
 * teks pendek, id pendek, tidak ada field yang menyatakan ukuran/durasi
 * yang tidak benar.
 */
function buatTombol(opsi) {
  return opsi.map((o) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: o.text,
      id: o.id,
    }),
  }));
}

/**
 * Satu kali kirim pesan interaktif yang sah.
 */
async function kirimPesanInteraktif(sock, jid, teks, opsiTombol) {
  const pesan = {
    interactiveMessage: {
      body: { text: teks },
      nativeFlowMessage: {
        buttons: buatTombol(opsiTombol),
      },
    },
  };

  const hasil = await sock.sendMessage(jid, pesan);
  return hasil;
}

async function main() {
  const { state, saveCreds } = await useMultiFileAuthState("./sesi-contoh");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection }) => {
    if (connection !== "open") return;

    // Ganti dengan JID yang Anda punya izin kirimi, misalnya nomor sendiri.
    const tujuan = "6281234567890@s.whatsapp.net";

    await kirimPesanInteraktif(sock, tujuan, "Silakan pilih salah satu:", [
      { text: "Ya", id: "ya" },
      { text: "Tidak", id: "tidak" },
    ]);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { kirimPesanInteraktif, buatTombol };
