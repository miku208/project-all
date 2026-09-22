/**
 * Type-level consumer test: every import here must resolve against the
 * published TypeScript declarations (lib/index.d.ts). Executed by
 * test/compat.test.mjs via `tsc --noEmit`.
 */
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  Dugong,
  VoipClient,
  ActiveCall,
  CallState,
  Button,
  ButtonV2,
  Carousel,
  AIRich,
  ORich,
  Toolkit,
  makeStickerPack,
  generateTableContent,
  generateTableContentV2,
  generateListContent,
  generateCodeBlockContent,
  generateCodeBlockContentV2,
  generateLinkContent,
  generateLinkContentV2,
  generateRichMessageContent,
  generateUnifiedResponseContent,
  captureUnifiedResponse,
  tokenizeCode,
  tokenizeCodeV2,
  jidEncode,
  jidDecode,
  jidNormalizedUser,
  areJidsSameUser,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  Curve,
  signedKeyPair,
  aesEncryptGCM,
  aesDecryptGCM,
} from "../lib/index.js";

// Default export
const sockCreator: typeof makeWASocket = makeWASocket;

// Value-level checks
const _creds: ReturnType<typeof initAuthCreds> = initAuthCreds();
const _browsers: [string, string, string] = Browsers.ubuntu("Chrome");
const _reason: number = DisconnectReason.loggedOut;
const _state: number = CallState.Idle;
const _client: VoipClient = new VoipClient();
const _rich: AIRich = new ORich(sockCreator as never);
const _tokens: unknown = tokenizeCode("const x = 1;", "javascript");
const _pack: object = makeStickerPack({ name: "p", stickers: [Buffer.alloc(1)] });
const _j: string = jidNormalizedUser("123@s.whatsapp.net");

// Type-level checks
type _Socket = ReturnType<typeof sockCreator>;
type _Dugong = InstanceType<typeof Dugong>;
type _Call = InstanceType<typeof ActiveCall>;
type _Btn = InstanceType<typeof Button>;
type _Carousel = InstanceType<typeof Carousel>;
type _Toolkit = InstanceType<typeof Toolkit>;

// Ensure values are used (avoid unused-symbol lint noise)
void _creds;
void _browsers;
void _reason;
void _state;
void _client;
void _rich;
void _tokens;
void _pack;
void _j;
void useMultiFileAuthState;
void makeCacheableSignalKeyStore;
void BufferJSON;
void fetchLatestBaileysVersion;
void generateTableContent;
void generateTableContentV2;
void generateListContent;
void generateCodeBlockContent;
void generateCodeBlockContentV2;
void generateLinkContent;
void generateLinkContentV2;
void generateRichMessageContent;
void generateUnifiedResponseContent;
void captureUnifiedResponse;
void tokenizeCodeV2;
void jidEncode;
void jidDecode;
void areJidsSameUser;
void isJidGroup;
void isJidNewsletter;
void isLidUser;
void isPnUser;
void Curve;
void signedKeyPair;
void aesEncryptGCM;
void aesDecryptGCM;
