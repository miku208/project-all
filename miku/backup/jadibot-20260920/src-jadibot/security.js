// src/jadibot/security.js — Command Security (§48-§52)
// User jadibot TIDAK BOLEH menjalankan arbitrary shell/exec/eval.
// Owner-only command divalidasi via JID WhatsApp dari config.js (§50) —
// bukan display name / username / nama kontak.

import { getOwnerJids } from "../lib/miku-topup.js";

/** Nomor/JID owner dari config.js — satu-satunya sumber (§27) */
export function isServerOwner(jid) {
  if (!jid) return false;
  const clean = String(jid).split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
  if (!clean) return false; // guard: string kosong tidak boleh match apa pun
  return getOwnerJids().some((o) => {
    const c = o.split("@")[0];
    return c && (clean === c || clean.endsWith(c) || c.endsWith(clean));
  });
}

/** Command bawaan jadibot yang aman untuk semua user */
const PUBLIC_COMMANDS = new Set([
  "ping",
  "menu",
  "id",
  "status",
  "trial",
  "saldo",
  "balance",
  "help",
  "start",
]);

/**
 * Pola berbahaya (§49): exec/eval/shell dan variasinya.
 * Bukan sekadar blacklist string — dikombinasikan dengan authorization
 * berbasis JID (hanya server owner yang lolos OWNER_ONLY).
 */
const DANGEROUS_PATTERNS = [
  /^\s*\$/, // $ ...
  /(^|\s)>>/, // >>
  /(^|\s)=>/, // =>
  /\b(?:eval|exec|execfile|spawn|fork|child_process)\b/i,
  /\b(?:shell|terminal|bash|sh|cmd|powershell)\b/i,
  /`[^`]*`/, // backtick command substitution
  /\$\(/, // $( )
];

/**
 * Klasifikasi command (§51).
 * @param {string} text   isi pesan
 * @param {string} senderJid JID pengirim
 * @returns {{isCommand:boolean, category:"PUBLIC"|"USER"|"OWNER_ONLY", allowed:boolean, code?:string, reason?:string}}
 */
export function classifyCommand(text, senderJid) {
  const raw = String(text || "").trim();
  if (!raw.startsWith(".")) return { isCommand: false, category: "PUBLIC", allowed: false };

  const body = raw.slice(1).trim();
  const command = body.split(/\s+/)[0]?.toLowerCase() || "";

  if (!command) return { isCommand: false, category: "PUBLIC", allowed: false };

  const dangerous =
    DANGEROUS_PATTERNS.some((re) => re.test(body)) && !PUBLIC_COMMANDS.has(command);

  if (dangerous) {
    // OWNER_ONLY — hanya JID owner dari config.js (§50)
    if (isServerOwner(senderJid)) {
      return { isCommand: true, category: "OWNER_ONLY", allowed: true, command };
    }
    return {
      isCommand: true,
      category: "OWNER_ONLY",
      allowed: false,
      command,
      code: "FORBIDDEN",
      reason: "Command berbahaya hanya untuk owner bot (server owner)",
    };
  }

  if (PUBLIC_COMMANDS.has(command)) {
    return { isCommand: true, category: "PUBLIC", allowed: true, command };
  }

  // Command tidak dikenal & tidak berbahaya → USER (biarkan / info)
  return { isCommand: true, category: "USER", allowed: true, command };
}
