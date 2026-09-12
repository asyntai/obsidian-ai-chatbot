import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AsyntaiPlugin from "./main";
import { DEFAULT_ORIGIN } from "./api";
import { errorText, parseFolders } from "./sync";

export interface AsyntaiSettings {
    apiKey: string;
    origin: string;
    syncEnabled: boolean;
    folders: string;
    excluded: string;
    chatsFolder: string;
}

export const DEFAULT_SETTINGS: AsyntaiSettings = {
    apiKey: "",
    origin: DEFAULT_ORIGIN,
    syncEnabled: true,
    folders: "",
    excluded: "",
    chatsFolder: "Asyntai chats",
};

export class AsyntaiSettingTab extends PluginSettingTab {
    plugin: AsyntaiPlugin;
    private status: HTMLElement | null = null;

    constructor(app: App, plugin: AsyntaiPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("API key")
            .setDesc("From your Asyntai dashboard: Settings, then API. The API needs the Starter plan or higher.")
            .addText((text) => {
                text.inputEl.type = "password";
                text.inputEl.addClass("asyntai-key-input");
                text.setPlaceholder("Paste your API key")
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value.trim();
                        await this.plugin.saveSettings();
                    });
            })
            .addButton((button) =>
                button.setButtonText("Check").onClick(async () => {
                    button.setDisabled(true);
                    try {
                        const account = await this.plugin.api.account();
                        this.setStatus(`Connected as ${account.email} (${account.plan} plan).`, false);
                    } catch (err) {
                        this.setStatus(errorText(err), true);
                    } finally {
                        button.setDisabled(false);
                    }
                }),
            );

        this.status = containerEl.createDiv({ cls: "asyntai-settings-status" });

        new Setting(containerEl).setName("Knowledge base").setHeading();

        new Setting(containerEl)
            .setName("Send notes to Asyntai")
            .setDesc("When on, every note in the folders below goes to the knowledge base, and each edit updates it.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
                    this.plugin.settings.syncEnabled = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshStatusBar();
                }),
            );

        new Setting(containerEl)
            .setName("Folders to send")
            .setDesc("One folder per line. Subfolders are included. Write / for the whole vault.")
            .addTextArea((area) => {
                area.inputEl.rows = 4;
                area.inputEl.addClass("asyntai-folder-input");
                area.setPlaceholder("Support\nProducts/FAQ")
                    .setValue(this.plugin.settings.folders)
                    .onChange(async (value) => {
                        this.plugin.settings.folders = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Folders to keep out")
            .setDesc("One folder per line. A note in these folders never goes to Asyntai, even inside a folder above.")
            .addTextArea((area) => {
                area.inputEl.rows = 3;
                area.inputEl.addClass("asyntai-folder-input");
                area.setPlaceholder("Support/Drafts")
                    .setValue(this.plugin.settings.excluded)
                    .onChange(async (value) => {
                        this.plugin.settings.excluded = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName("Send all notes now")
            .setDesc("Sends every note in the folders above, and removes notes that left them.")
            .addButton((button) =>
                button.setButtonText("Send all").setCta().onClick(async () => {
                    if (parseFolders(this.plugin.settings.folders).length === 0) {
                        this.setStatus("Add at least one folder first.", true);
                        return;
                    }
                    button.setDisabled(true);
                    try {
                        const r = await this.plugin.syncAll((done, total) => {
                            button.setButtonText(`${done} / ${total}`);
                        });
                        const text = `Sent ${r.sent}, unchanged ${r.skipped}, removed ${r.removed}, failed ${r.failed}.`;
                        this.setStatus(r.errors.length ? `${text} ${r.errors[0]}` : text, r.failed > 0);
                    } finally {
                        button.setButtonText("Send all");
                        button.setDisabled(false);
                    }
                }),
            );

        new Setting(containerEl)
            .setName("Remove all notes from Asyntai")
            .setDesc("Deletes every note this plugin sent from the knowledge base. The notes in your vault stay.")
            .addButton((button) =>
                button.setButtonText("Remove all").setWarning().onClick(async () => {
                    button.setDisabled(true);
                    try {
                        const n = await this.plugin.sync.removeAll();
                        this.plugin.refreshStatusBar();
                        this.setStatus(`Removed ${n} notes from Asyntai.`, false);
                    } finally {
                        button.setDisabled(false);
                    }
                }),
            );

        new Setting(containerEl).setName("Panel").setHeading();

        new Setting(containerEl)
            .setName("Folder for saved chats")
            .setDesc("A website chat saved from the panel becomes a note in this folder.")
            .addText((text) =>
                text.setValue(this.plugin.settings.chatsFolder).onChange(async (value) => {
                    this.plugin.settings.chatsFolder = value.trim() || DEFAULT_SETTINGS.chatsFolder;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl).setName("Advanced").setHeading();

        new Setting(containerEl)
            .setName("Asyntai address")
            .setDesc("Leave this as it is. It is only for self-hosted test servers.")
            .addText((text) =>
                text.setValue(this.plugin.settings.origin).onChange(async (value) => {
                    this.plugin.settings.origin = value.trim() || DEFAULT_ORIGIN;
                    await this.plugin.saveSettings();
                }),
            );

        const count = this.plugin.sync.count();
        this.setStatus(count ? `${count} notes are in the Asyntai knowledge base.` : "", false);
    }

    private setStatus(text: string, isError: boolean): void {
        if (!this.status) {
            return;
        }
        this.status.setText(text);
        this.status.toggleClass("asyntai-error", isError);
        if (isError && text) {
            new Notice(text);
        }
    }
}
