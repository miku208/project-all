/**
 * TypeScript declarations for the bundled interactive/rich message builder.
 *
 * TypeScript declarations for the Miku-Baileys interactive message builder.
 * Copyright (c) 2026 MikuHost
 */

export declare const VERSION: string;

export declare class Toolkit {
    constructor();
    static extractIE(text: string, options?: {
        extract?: boolean;
        hyperlink?: boolean;
        citation?: boolean;
        latex?: boolean;
    }): {
        text: string;
        ie: unknown[];
        inline_entities: unknown[];
    };
    static resize(buffer: Buffer | Uint8Array, x?: number | null, y?: number | null, fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'): Promise<Buffer>;
    static waitAllPromises<T>(input: T): Promise<T>;
    static fetchBuffer(url: string, options?: RequestInit, extra?: {
        silent?: boolean;
    }): Promise<Buffer>;
    static toUrl(client: unknown, path: string | Buffer | {
        url: string;
    }, mediaType?: string): Promise<string>;
    static resolveMedia(client: unknown, media: unknown, mediaType?: string, options?: {
        resolveUrl?: boolean;
        resolveWAUrl?: boolean;
        result?: 'url' | 'buffer';
        resize?: boolean;
        width?: number;
        height?: number;
    }): Promise<unknown>;
    static getMp4Duration(buffer: Buffer | Uint8Array, options?: {
        silent?: boolean;
    }): number | null;
    static getMp4Preview(videoBuffer: Buffer | Uint8Array, options?: {
        time?: string;
        result?: 'buffer' | 'base64';
        resize?: boolean;
        width?: number;
        height?: number;
        silent?: boolean;
    }): Buffer | string | null;
}

export declare class Button {
    constructor(client?: unknown);
    setImage(path: string | Buffer | {
        url: string;
    }, options?: Record<string, unknown>): this;
    setTitle(title: string): this;
    setBody(body: string): this;
    setFooter(footer: string): this;
    setSubtitle(subtitle: string): this;
    setContextInfo(obj: Record<string, unknown>): this;
    addPayload(obj: Record<string, unknown>): this;
    setMedia(obj: Record<string, unknown>): this;
    clearButtons(): this;
    setParams(obj: Record<string, unknown>): this;
    addButton(name: string, params: Record<string, unknown> | string): this;
    makeRow(header?: string, title?: string, description?: string, id?: string): this;
    makeSection(title?: string, highlightLabel?: string): this;
    addSelection(title: string, options?: Record<string, unknown>): this;
    addReply(displayText?: string, id?: string, options?: Record<string, unknown>): this;
    addCall(displayText?: string, id?: string, options?: Record<string, unknown>): this;
    addReminder(displayText?: string, id?: string, options?: Record<string, unknown>): this;
    addCancelReminder(displayText?: string, id?: string, options?: Record<string, unknown>): this;
    addAddress(displayText?: string, id?: string, options?: Record<string, unknown>): this;
    addLocation(options?: Record<string, unknown>): this;
    addUrl(displayText?: string, url?: string, webviewInteraction?: boolean, options?: Record<string, unknown>): this;
    addCopy(displayText?: string, copyCode?: string, options?: Record<string, unknown>): this;
    setVideo(path: string | Buffer | {
        url: string;
    }, options?: Record<string, unknown>): this;
    setDocument(path: string | Buffer | {
        url: string;
    }, options?: Record<string, unknown>): this;
    /** Alias of addReply */
    button(displayText: string, id: string): this;
    /** Alias of setTitle */
    title(t: string): this;
    /** Alias of setBody */
    text(t: string): this;
    /** Alias of setFooter */
    footer(f: string): this;
    /** Alias of setSubtitle */
    subtitle(s: string): this;
    image(url: string | Buffer | {
        url: string;
    }, opts?: Record<string, unknown>): this;
    send(jid: string, options?: Record<string, unknown>): Promise<unknown>;
}

export declare class ButtonV2 {
    constructor(client?: unknown);
    addButton(displayText?: string, buttonId?: string): this;
    addRawButton(obj: Record<string, unknown>): this;
    setThumbnail(path: string | Buffer | {
        url: string;
    }): this;
    setMedia(obj: Record<string, unknown>): this;
    /** Alias of addButton */
    button(displayText: string, id: string): this;
    image(url: string | Buffer | {
        url: string;
    }, opts?: Record<string, unknown>): this;
    title(t: string): this;
    text(t: string): this;
    footer(f: string): this;
    send(jid: string, options?: Record<string, unknown>): Promise<unknown>;
}

export declare class Carousel {
    constructor(client?: unknown);
    addCard(card: Button | ((card: Button) => void)): this;
    /** Shorthand for addCard with a fresh card builder */
    card(cb: (card: Button) => void): this;
    build(jid: string, options?: Record<string, unknown>): Promise<unknown>;
    send(jid: string, options?: Record<string, unknown>): Promise<unknown>;
    image(url: string | Buffer | {
        url: string;
    }, opts?: Record<string, unknown>): this;
    title(t: string): this;
    text(t: string): this;
    footer(f: string): this;
}

export declare class AIRich {
    constructor(client: unknown);
    addSubmessage(submessage: Record<string, unknown>): this;
    addSection(section: Record<string, unknown>): this;
    addText(text: string, options?: {
        hyperlink?: boolean;
        citation?: boolean;
        latex?: boolean;
    }): this;
    /** Alias of addText */
    text(t: string): this;
    addCode(language: string, code: string): this;
    addTable(table: string[] | string[][], options?: {
        hyperlink?: boolean;
        citation?: boolean;
        latex?: boolean;
    }): this;
    addSource(sources?: Array<Record<string, unknown>>): this;
    addReels(reelsItems?: Array<Record<string, unknown>>): this;
    addImage(imageUrl: string, options?: {
        resolveUrl?: boolean;
    }): this;
    addVideo(videoUrl: string, options?: {
        autoFill?: boolean;
    }): this;
    addProduct(data?: Record<string, unknown>): this;
    addPost(data?: Record<string, unknown>): this;
    addTip(text: string): this;
    addSuggest(suggestion: string[] | string, options?: {
        scroll?: boolean;
        layout?: Record<string, unknown>;
    }): this;
    send(jid: string, options?: {
        forwarded?: boolean;
        notification?: string;
        includesUnifiedResponse?: boolean;
        includesSubmessages?: boolean;
        [key: string]: unknown;
    }): Promise<unknown>;
    image(url: string | Buffer | {
        url: string;
    }, opts?: Record<string, unknown>): this;
}

/** Convenience alias of {@link AIRich} kept for upstream compatibility. */
export declare class ORich extends AIRich {
}
