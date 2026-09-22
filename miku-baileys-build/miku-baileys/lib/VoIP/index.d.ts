import { EventEmitter } from "node:events";
import { CallState } from "./types.js";
import type { WasmEngine } from "./wasm-engine.js";
import type { WasmEngineConfig } from "./wasm-engine.js";

export { CallState } from "./types.js";
export type { AudioConfig, CallOptions, CallEvents } from "./types.js";

/**
 * A single ongoing voice call. Emitting events:
 * `ringing`, `connected`, `audio` (16 kHz mono Float32 PCM), `ended(reason)`.
 */
export declare class ActiveCall extends EventEmitter {
    readonly callId: string;
    readonly engine: WasmEngine;
    get state(): (typeof CallState)[keyof typeof CallState];
    constructor(callId: string, engine: WasmEngine, durationMs: number);
    end(): void;
    mute(muted: boolean): void;
    waitForEnd(): Promise<string>;
}

/**
 * VoIP client bound to an existing WASocket (shared socket, no double pairing).
 */
export declare class VoipClient {
    constructor(config?: Partial<Pick<WasmEngineConfig, "resourcesPath">>);
    connectWithSocket(existingSock: unknown): Promise<void>;
    call(phoneNumber: string, opts?: {
        durationMs?: number;
        audioSource?: "silence" | "mic" | "file" | string;
        [key: string]: unknown;
    }): Promise<ActiveCall>;
    disconnect(): void;
}
