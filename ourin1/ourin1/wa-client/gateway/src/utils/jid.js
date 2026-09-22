// Validasi JID WhatsApp untuk mencegah unauthorized chat access / injection.
// Format valid:
//   628xxx@s.whatsapp.net        (personal)
//   1203xxx@g.us                 (group)
//   status@broadcast             (status)
//   xxx@newsletter               (channel)
export function isValidJid(jid) {
  if (typeof jid !== "string" || jid.length === 0 || jid.length > 128) return false;
  const valid = [
    /^[\d.]+@s\.whatsapp\.net$/,
    /^[\d.-]+@g\.us$/,
    /^status@broadcast$/,
    /^[\d.]+@newsletter$/,
    /^[\d.]+@lid$/,
  ];
  return valid.some((re) => re.test(jid));
}

export function normalizeJid(jid) {
  return typeof jid === "string" ? jid.trim().toLowerCase() : "";
}

export function isValidMessageId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && /^[\w./+-]+$/.test(id);
}
