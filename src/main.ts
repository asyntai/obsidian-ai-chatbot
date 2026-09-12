import { Editor, MarkdownView, Notice, Plugin, TAbstractFile, TFile, requestUrl } from "obsidian";
import { AsyntaiApi, Transport } from "./api";
import { AsyntaiSettingTab, AsyntaiSettings, DEFAULT_SETTINGS } from "./settings";
import { SyncAllResult, SyncEngine, SyncMap, VaultLike, VaultNote, parseFolders } from "./sync";
import { AsyntaiView, VIEW_TYPE } from "./view";

interface StoredData {
    settings: AsyntaiSettings;
    map: SyncMap;
}

/** How long after the last keystroke a changed note is sent. */
const SEND_DELAY_MS = 3000;

// requestUrl is Obsidian's own HTTP call. It runs outside the page, so the
// browser's CORS rules do not apply to it.
const transport: Transport = async (req) => {
    const res = await requestUrl({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
        throw: false,
    });
    return { status: res.status, text: res.text };
};

export default class AsyntaiPlugin extends Plugin {
    settings: AsyntaiSettings = { ...DEFAULT_SETTINGS };
    map: SyncMap = {};
    api!: AsyntaiApi;
    sync!: SyncEngine;
    private statusBar: HTMLElement | null = null;
    private timers = new Map<string, number>();
    // The note the user last worked in. A click in the side panel makes the
    // panel the active leaf, so "the active note" must be remembered.
    private lastNoteView: MarkdownView | null = null;

    async onload(): Promise<void> {
        await this.loadStored();

        this.api = new AsyntaiApi(
            transport,
            () => this.settings.apiKey,
            () => this.settings.origin,
        );

        const vault: VaultLike = {
            notes: () => this.app.vault.getMarkdownFiles().map(toNote),
            read: async (path) => {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (!(file instanceof TFile)) {
                    throw new Error(`Note not found: ${path}`);
                }
                return this.app.vault.cachedRead(file);
            },
        };
        this.sync = new SyncEngine(
            this.api,
            vault,
            this.map,
            async (map) => {
                this.map = map;
                await this.saveStored();
            },
            () => ({ folders: parseFolders(this.settings.folders), excluded: parseFolders(this.settings.excluded) }),
        );

        this.registerView(VIEW_TYPE, (leaf) => new AsyntaiView(leaf, this));
        this.addSettingTab(new AsyntaiSettingTab(this.app, this));

        this.addRibbonIcon("bot-message-square", "Open Asyntai", () => void this.openPanel());
        this.statusBar = this.addStatusBarItem();
        this.refreshStatusBar();

        this.addCommand({
            id: "open-panel",
            name: "Open panel",
            callback: () => void this.openPanel(),
        });
        this.addCommand({
            id: "send-note",
            name: "Send this note to the knowledge base",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") {
                    return false;
                }
                if (!checking) {
                    void this.sendOne(file);
                }
                return true;
            },
        });
        this.addCommand({
            id: "remove-note",
            name: "Remove this note from the knowledge base",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || !this.sync.isSynced(file.path)) {
                    return false;
                }
                if (!checking) {
                    void this.removeOne(file);
                }
                return true;
            },
        });
        this.addCommand({
            id: "send-all",
            name: "Send all notes in the chosen folders",
            callback: () => void this.syncAllWithNotice(),
        });

        // Vault events only after Obsidian finished indexing, so the start-up
        // scan does not look like a thousand edits.
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                if (leaf && leaf.view instanceof MarkdownView) {
                    this.lastNoteView = leaf.view;
                }
            }),
        );

        this.app.workspace.onLayoutReady(() => {
            this.registerEvent(this.app.vault.on("modify", (file) => this.onChanged(file)));
            this.registerEvent(this.app.vault.on("create", (file) => this.onChanged(file)));
            this.registerEvent(this.app.vault.on("delete", (file) => void this.onDeleted(file)));
            this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.onRenamed(file, oldPath)));
        });
    }

    onunload(): void {
        for (const id of this.timers.values()) {
            window.clearTimeout(id);
        }
        this.timers.clear();
    }

    // ------------------------------------------------------------ storage

    private async loadStored(): Promise<void> {
        const raw = ((await this.loadData()) || {}) as Partial<StoredData>;
        this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
        this.map = raw.map || {};
    }

    private async saveStored(): Promise<void> {
        await this.saveData({ settings: this.settings, map: this.map } as StoredData);
    }

    async saveSettings(): Promise<void> {
        await this.saveStored();
    }

    // ------------------------------------------------------------- events

    private syncActive(): boolean {
        return this.settings.syncEnabled && this.settings.apiKey.trim() !== "";
    }

    private onChanged(file: TAbstractFile): void {
        if (!(file instanceof TFile) || file.extension !== "md" || !this.syncActive()) {
            return;
        }
        if (!this.sync.wanted(file.path) && !this.sync.isSynced(file.path)) {
            return;
        }
        const existing = this.timers.get(file.path);
        if (existing) {
            window.clearTimeout(existing);
        }
        const id = window.setTimeout(() => {
            this.timers.delete(file.path);
            void this.sendQuietly(file);
        }, SEND_DELAY_MS);
        this.timers.set(file.path, id);
    }

    private async onDeleted(file: TAbstractFile): Promise<void> {
        if (!(file instanceof TFile) || !this.sync.isSynced(file.path)) {
            return;
        }
        const ok = await this.sync.remove(file.path);
        if (!ok) {
            new Notice(`Asyntai: could not remove ${file.basename} from the knowledge base.`);
        }
        this.refreshStatusBar();
    }

    private async onRenamed(file: TAbstractFile, oldPath: string): Promise<void> {
        if (!(file instanceof TFile) || file.extension !== "md" || !this.syncActive()) {
            return;
        }
        await this.sync.rename(oldPath, toNote(file));
        this.refreshStatusBar();
    }

    private async sendQuietly(file: TFile): Promise<void> {
        if (this.sync.wanted(file.path)) {
            const r = await this.sync.push(toNote(file));
            if (!r.ok) {
                new Notice(`Asyntai: ${r.message}`);
            }
        } else if (this.sync.isSynced(file.path)) {
            await this.sync.remove(file.path);
        }
        this.refreshStatusBar();
    }

    // ----------------------------------------------------------- commands

    async sendOne(file: TFile): Promise<void> {
        const r = await this.sync.push(toNote(file));
        new Notice(r.ok ? `Asyntai: ${r.message}` : `Asyntai: ${r.message}`);
        this.refreshStatusBar();
    }

    async removeOne(file: TFile): Promise<void> {
        const ok = await this.sync.remove(file.path);
        new Notice(ok ? "Asyntai: note removed from the knowledge base." : "Asyntai: could not remove the note.");
        this.refreshStatusBar();
    }

    async syncAll(onProgress?: (done: number, total: number) => void): Promise<SyncAllResult> {
        const r = await this.sync.syncAll(onProgress);
        this.refreshStatusBar();
        return r;
    }

    private async syncAllWithNotice(): Promise<void> {
        if (parseFolders(this.settings.folders).length === 0) {
            new Notice("Asyntai: choose the folders to send in the plugin settings first.");
            return;
        }
        const notice = new Notice("Asyntai: sending notes…", 0);
        const r = await this.syncAll((done, total) => notice.setMessage(`Asyntai: ${done} / ${total}`));
        notice.hide();
        new Notice(`Asyntai: sent ${r.sent}, unchanged ${r.skipped}, removed ${r.removed}, failed ${r.failed}.`);
    }

    async openPanel(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) {
            return;
        }
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
    }

    /** The editor of the note the user is working in, if any. */
    targetEditor(): Editor | null {
        const active = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active) {
            return active.editor;
        }
        const open = this.app.workspace.getLeavesOfType("markdown");
        if (this.lastNoteView && open.some((leaf) => leaf.view === this.lastNoteView)) {
            return this.lastNoteView.editor;
        }
        if (open.length === 1 && open[0].view instanceof MarkdownView) {
            return open[0].view.editor;
        }
        return null;
    }

    refreshStatusBar(): void {
        if (!this.statusBar) {
            return;
        }
        const n = this.sync.count();
        const state = this.syncActive() ? "" : " (paused)";
        this.statusBar.setText(`Asyntai: ${n} ${n === 1 ? "note" : "notes"}${state}`);
    }
}

function toNote(file: TFile): VaultNote {
    return { path: file.path, basename: file.basename };
}
