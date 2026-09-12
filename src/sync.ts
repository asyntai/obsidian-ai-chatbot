// Keeps the chosen notes and the Asyntai knowledge base in step.
//
// The vault is injected as a small interface, so the engine has no Obsidian
// import and the tests can drive it with an in-memory vault.

import { ApiError, AsyntaiApi } from "./api";
import { hashText, knowledgeContent, noteText } from "./text";

/** A note shorter than this is a stub, and it is skipped. */
export const MIN_LENGTH = 120;

export interface SyncEntry {
    kb: string;
    hash: string;
    sent: number;
    title: string;
}

export type SyncMap = Record<string, SyncEntry>;

export interface VaultNote {
    path: string;
    basename: string;
}

export interface VaultLike {
    /** Every Markdown note in the vault. */
    notes(): VaultNote[];
    read(path: string): Promise<string>;
}

export interface SyncOptions {
    /** Folder paths, "" or "/" means the whole vault. */
    folders: string[];
    /** Folder paths that stay out even when a parent folder is in. */
    excluded: string[];
}

export interface PushResult {
    ok: boolean;
    skipped: boolean;
    message: string;
}

export interface SyncAllResult {
    sent: number;
    skipped: number;
    removed: number;
    failed: number;
    errors: string[];
}

// "/" alone means the whole vault and becomes "". An empty line means
// nothing at all, so an empty setting never sends the whole vault by mistake.
export function parseFolders(raw: string): string[] {
    const out: string[] = [];
    for (const piece of raw.split(/[\n,]+/)) {
        const token = piece.trim();
        if (token === "") {
            continue;
        }
        const folder = token.replace(/^\/+|\/+$/g, "");
        if (!out.includes(folder)) {
            out.push(folder);
        }
    }
    return out;
}

function inFolder(path: string, folder: string): boolean {
    if (folder === "" || folder === "/") {
        return true;
    }
    return path === folder || path.startsWith(folder + "/");
}

/** Whether a note belongs in the knowledge base at all. */
export function shouldSync(path: string, options: SyncOptions): boolean {
    if (!path.toLowerCase().endsWith(".md")) {
        return false;
    }
    const folders = options.folders.filter((f) => f !== undefined);
    if (folders.length === 0) {
        return false;
    }
    for (const excluded of options.excluded) {
        if (excluded !== "" && inFolder(path, excluded)) {
            return false;
        }
    }
    return folders.some((folder) => inFolder(path, folder));
}

export class SyncEngine {
    private api: AsyntaiApi;
    private vault: VaultLike;
    private map: SyncMap;
    private save: (map: SyncMap) => Promise<void>;
    private options: () => SyncOptions;

    constructor(
        api: AsyntaiApi,
        vault: VaultLike,
        map: SyncMap,
        save: (map: SyncMap) => Promise<void>,
        options: () => SyncOptions,
    ) {
        this.api = api;
        this.vault = vault;
        this.map = map;
        this.save = save;
        this.options = options;
    }

    entries(): SyncMap {
        return this.map;
    }

    count(): number {
        return Object.keys(this.map).length;
    }

    isSynced(path: string): boolean {
        return Boolean(this.map[path]?.kb);
    }

    wanted(path: string): boolean {
        return shouldSync(path, this.options());
    }

    /**
     * Send one note. A note already in the knowledge base is replaced: the
     * new entry goes up first, then the old one is removed, so the chatbot
     * never has a gap.
     */
    async push(note: VaultNote, raw?: string): Promise<PushResult> {
        const content = raw === undefined ? await this.vault.read(note.path) : raw;
        const parsed = noteText(content, note.basename);
        if (parsed.text.length < MIN_LENGTH) {
            // Too short to answer anything. Drop a stale copy.
            await this.remove(note.path);
            return { ok: true, skipped: true, message: "Note is too short to send." };
        }

        const body = knowledgeContent(parsed);
        const hash = hashText(body);
        const known = this.map[note.path];
        if (known && known.hash === hash && known.kb) {
            return { ok: true, skipped: true, message: "Note is unchanged." };
        }

        let kb: string;
        try {
            kb = await this.api.addText(parsed.title, body);
        } catch (err) {
            return { ok: false, skipped: false, message: errorText(err) };
        }

        const old = known?.kb;
        this.map[note.path] = { kb, hash, sent: Date.now(), title: parsed.title };
        await this.save(this.map);

        if (old && old !== kb) {
            try {
                await this.api.deleteEntry(old);
            } catch {
                // The new entry is live; a leftover copy is harmless.
            }
        }
        return { ok: true, skipped: false, message: "Note sent to Asyntai." };
    }

    /** Remove a note from the knowledge base, if it was ever sent. */
    async remove(path: string): Promise<boolean> {
        const known = this.map[path];
        if (!known?.kb) {
            return true;
        }
        try {
            await this.api.deleteEntry(known.kb);
        } catch {
            return false;
        }
        delete this.map[path];
        await this.save(this.map);
        return true;
    }

    /** A rename keeps the entry and moves the key, unless the note left the folders. */
    async rename(oldPath: string, note: VaultNote): Promise<void> {
        const known = this.map[oldPath];
        if (!known) {
            if (this.wanted(note.path)) {
                await this.push(note);
            }
            return;
        }
        if (!this.wanted(note.path)) {
            await this.remove(oldPath);
            return;
        }
        delete this.map[oldPath];
        this.map[note.path] = known;
        await this.save(this.map);
        // The title may come from the file name, so the text may differ now.
        await this.push(note);
    }

    /** Send every wanted note and remove every note that is no longer wanted. */
    async syncAll(onProgress?: (done: number, total: number) => void): Promise<SyncAllResult> {
        const result: SyncAllResult = { sent: 0, skipped: 0, removed: 0, failed: 0, errors: [] };
        const notes = this.vault.notes().filter((n) => this.wanted(n.path));
        const present = new Set(notes.map((n) => n.path));

        // Entries whose note is gone, or moved out of the folders.
        for (const path of Object.keys(this.map)) {
            if (!present.has(path)) {
                if (await this.remove(path)) {
                    result.removed += 1;
                } else {
                    result.failed += 1;
                    result.errors.push(`${path}: could not remove`);
                }
            }
        }

        let done = 0;
        for (const note of notes) {
            const r = await this.push(note);
            if (!r.ok) {
                result.failed += 1;
                result.errors.push(`${note.path}: ${r.message}`);
            } else if (r.skipped) {
                result.skipped += 1;
            } else {
                result.sent += 1;
            }
            done += 1;
            onProgress?.(done, notes.length);
        }
        return result;
    }

    /** Remove every synced note from the knowledge base. */
    async removeAll(): Promise<number> {
        let removed = 0;
        for (const path of Object.keys(this.map)) {
            if (await this.remove(path)) {
                removed += 1;
            }
        }
        return removed;
    }
}

export function errorText(err: unknown): string {
    if (err instanceof ApiError) {
        return err.message;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
