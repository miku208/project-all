import express from "express";
import { requestJadibotPairing, getJadibotStatus } from "./ourin-jadibot-manager.js";

const router = express.Router();

// mainSock = socket WhatsApp bot utama yang sudah connect (ambil dari state global project kamu)
export function jadibotApiRouter(mainSock) {
  // POST /api/jadibot  { "number": "6281234567890" }
  router.post("/jadibot", async (req, res) => {
    const { number } = req.body || {};

    if (!number) {
      return res.status(400).json({ success: false, error: "Nomor wajib diisi" });
    }

    const result = await requestJadibotPairing(mainSock, number);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  });

  // GET /api/jadibot/:number/status
  router.get("/jadibot/:number/status", (req, res) => {
    const jid = req.params.number.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    const status = getJadibotStatus(jid);

    if (!status) {
      return res.status(404).json({ success: false, error: "Jadibot tidak aktif" });
    }

    return res.json({ success: true, ...status });
  });

  return router;
}
