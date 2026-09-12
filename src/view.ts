import { ItemView, Notice, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import type AsyntaiPlugin from "./main";
import { Lead, Message, Session, newAskSession } from "./api";
import { errorText } from "./sync";

export const VIEW_TYPE = "asyntai-panel";

type Tab = "ask" | "chats" | "leads";

interface Answer {
    question: string;
    answer: string;
}

export class AsyntaiView extends ItemView {
    plugin: AsyntaiPlugin;
    private tab: Tab = "ask";
    private body: HTMLElement | null = null;
    private tabButtons: Record<Tab, HTMLElement> | null = null;
    private askSession = newAskSession();
    private answers: Answer[] = [];
    private openSession: Session | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: AsyntaiPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Asyntai";
    }

    getIcon(): string {
        return "bot-message-square";
    }

    async onOpen(): Promise<void> {
        const root = this.contentEl;
        root.empty();
        root.addClass("asyntai-panel");

        const tabs = root.createDiv({ cls: "asyntai-tabs" });
        const make = (id: Tab, label: string) => {
            const el = tabs.createEl("button", { text: label, cls: "asyntai-tab" });
            el.addEventListener("click", () => this.show(id));
            return el;
        };
        this.tabButtons = { ask: make("ask", "Ask"), chats: make("chats", "Chats"), leads: make("leads", "Leads") };
        this.body = root.createDiv({ cls: "asyntai-body" });
        this.show(this.tab);
    }

    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    show(tab: Tab): void {
        this.tab = tab;
        if (this.tabButtons) {
            for (const id of Object.keys(this.tabButtons) as Tab[]) {
                this.tabButtons[id].toggleClass("is-active", id === tab);
            }
        }
        if (!this.body) {
            return;
        }
        this.body.empty();
        if (tab === "ask") {
            this.renderAsk(this.body);
        } else if (tab === "chats") {
            void this.renderChats(this.body);
        } else {
            void this.renderLeads(this.body);
        }
    }

    // ---------------------------------------------------------------- Ask

    private renderAsk(root: HTMLElement): void {
        const list = root.createDiv({ cls: "asyntai-answers" });
        const draw = () => {
            list.empty();
            if (this.answers.length === 0) {
                list.createDiv({
                    cls: "asyntai-empty",
                    text: "Ask your chatbot anything. It answers from your knowledge base, the same way it answers visitors on your website.",
                });
            }
            for (const item of this.answers) {
                const q = list.createDiv({ cls: "asyntai-msg asyntai-msg-user" });
                q.setText(item.question);
                const a = list.createDiv({ cls: "asyntai-msg asyntai-msg-bot" });
                a.createDiv({ cls: "asyntai-msg-text", text: item.answer });
                const insert = a.createEl("button", { cls: "asyntai-small", text: "Insert into note" });
                insert.addEventListener("click", () => this.insertIntoNote(item.answer));
            }
            list.scrollTop = list.scrollHeight;
        };
        draw();

        const form = root.createDiv({ cls: "asyntai-ask-form" });
        const input = form.createEl("textarea", { cls: "asyntai-ask-input" });
        input.rows = 3;
        input.placeholder = "Type a question and press Enter";
        const send = form.createEl("button", { cls: "mod-cta", text: "Ask" });

        const submit = async () => {
            const question = input.value.trim();
            if (!question) {
                return;
            }
            input.value = "";
            send.setAttr("disabled", "true");
            const pending: Answer = { question, answer: "…" };
            this.answers.push(pending);
            draw();
            try {
                pending.answer = await this.plugin.api.chat(question, this.askSession);
            } catch (err) {
                pending.answer = errorText(err);
            } finally {
                send.removeAttribute("disabled");
                draw();
                input.focus();
            }
        };
        send.addEventListener("click", () => void submit());
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
            }
        });

        const foot = root.createDiv({ cls: "asyntai-foot" });
        const reset = foot.createEl("button", { cls: "asyntai-small", text: "New conversation" });
        reset.addEventListener("click", () => {
            this.askSession = newAskSession();
            this.answers = [];
            draw();
        });
    }

    private insertIntoNote(text: string): void {
        const editor = this.plugin.targetEditor();
        if (!editor) {
            new Notice("Open a note first, then insert.");
            return;
        }
        // Keep the answer on its own lines when the cursor sits inside text.
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const before = line.slice(0, cursor.ch).length > 0 ? "\n" : "";
        const after = line.slice(cursor.ch).length > 0 ? "\n" : "";
        editor.replaceSelection(before + text + after);
        new Notice("Inserted into the note.");
    }

    // -------------------------------------------------------------- Chats

    private async renderChats(root: HTMLElement): Promise<void> {
        if (this.openSession) {
            await this.renderConversation(root, this.openSession);
            return;
        }
        const head = root.createDiv({ cls: "asyntai-head" });
        head.createSpan({ text: "Latest website chats" });
        const refresh = head.createEl("button", { cls: "asyntai-icon-btn", attr: { "aria-label": "Refresh" } });
        setIcon(refresh, "refresh-cw");
        refresh.addEventListener("click", () => this.show("chats"));

        const list = root.createDiv({ cls: "asyntai-list" });
        list.createDiv({ cls: "asyntai-empty", text: "Loading…" });
        let sessions: Session[];
        try {
            sessions = await this.plugin.api.sessions(30);
        } catch (err) {
            list.empty();
            list.createDiv({ cls: "asyntai-empty asyntai-error", text: errorText(err) });
            return;
        }
        list.empty();
        if (sessions.length === 0) {
            list.createDiv({ cls: "asyntai-empty", text: "No chats yet." });
            return;
        }
        for (const s of sessions) {
            const row = list.createDiv({ cls: "asyntai-row" });
            row.createDiv({ cls: "asyntai-row-title", text: s.first_message || "(no text)" });
            const meta = [when(s.last_message_at), s.country, s.category, `${s.message_count} messages`].filter(Boolean);
            row.createDiv({ cls: "asyntai-row-meta", text: meta.join(" · ") });
            row.addEventListener("click", () => {
                this.openSession = s;
                this.show("chats");
            });
        }
    }

    private async renderConversation(root: HTMLElement, session: Session): Promise<void> {
        const head = root.createDiv({ cls: "asyntai-head" });
        const back = head.createEl("button", { cls: "asyntai-icon-btn", attr: { "aria-label": "Back" } });
        setIcon(back, "arrow-left");
        back.addEventListener("click", () => {
            this.openSession = null;
            this.show("chats");
        });
        head.createSpan({ text: session.page_url || session.website_domain || "Chat" });

        const list = root.createDiv({ cls: "asyntai-answers" });
        list.createDiv({ cls: "asyntai-empty", text: "Loading…" });
        let messages: Message[];
        try {
            messages = await this.plugin.api.conversation(session.session_id);
        } catch (err) {
            list.empty();
            list.createDiv({ cls: "asyntai-empty asyntai-error", text: errorText(err) });
            return;
        }
        list.empty();
        for (const m of messages) {
            const el = list.createDiv({ cls: `asyntai-msg ${m.role === "user" ? "asyntai-msg-user" : "asyntai-msg-bot"}` });
            el.setText(m.content);
        }

        const foot = root.createDiv({ cls: "asyntai-foot" });
        const save = foot.createEl("button", { cls: "mod-cta", text: "Save as note" });
        save.addEventListener("click", () => void this.saveChat(session, messages));
    }

    private async saveChat(session: Session, messages: Message[]): Promise<void> {
        const folder = normalizePath(this.plugin.settings.chatsFolder);
        if (!this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }
        const stamp = (session.first_message_at || new Date().toISOString()).replace(/[:T]/g, "-").slice(0, 16);
        const name = `${stamp} ${safeName(session.first_message || session.session_id)}`.slice(0, 80);
        const path = normalizePath(`${folder}/${name}.md`);
        const lines = [
            "---",
            `source: asyntai`,
            `session: ${session.session_id}`,
            `page: ${session.page_url || ""}`,
            `country: ${session.country || ""}`,
            `date: ${session.first_message_at || ""}`,
            "---",
            "",
            `# ${session.first_message || "Website chat"}`,
            "",
        ];
        for (const m of messages) {
            lines.push(`**${m.role === "user" ? "Visitor" : "Assistant"}:** ${m.content}`, "");
        }
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing) {
            new Notice("This chat is already saved.");
            return;
        }
        const file = await this.app.vault.create(path, lines.join("\n"));
        await this.app.workspace.getLeaf(false).openFile(file);
        new Notice("Chat saved as a note.");
    }

    // -------------------------------------------------------------- Leads

    private async renderLeads(root: HTMLElement): Promise<void> {
        const head = root.createDiv({ cls: "asyntai-head" });
        head.createSpan({ text: "Latest leads" });
        const refresh = head.createEl("button", { cls: "asyntai-icon-btn", attr: { "aria-label": "Refresh" } });
        setIcon(refresh, "refresh-cw");
        refresh.addEventListener("click", () => this.show("leads"));

        const list = root.createDiv({ cls: "asyntai-list" });
        list.createDiv({ cls: "asyntai-empty", text: "Loading…" });
        let leads: Lead[];
        try {
            leads = await this.plugin.api.leads(30);
        } catch (err) {
            list.empty();
            list.createDiv({ cls: "asyntai-empty asyntai-error", text: errorText(err) });
            return;
        }
        list.empty();
        if (leads.length === 0) {
            list.createDiv({ cls: "asyntai-empty", text: "No leads yet. A visitor who leaves an email or phone number in the chat appears here." });
            return;
        }
        for (const lead of leads) {
            const row = list.createDiv({ cls: "asyntai-row" });
            row.createDiv({ cls: "asyntai-row-title", text: lead.email || lead.phone || "(no contact)" });
            const meta = [when(lead.started_at), lead.email && lead.phone ? lead.phone : "", lead.page_url].filter(Boolean);
            row.createDiv({ cls: "asyntai-row-meta", text: meta.join(" · ") });
            row.addEventListener("click", () => {
                this.openSession = {
                    session_id: lead.session_id,
                    message_count: 0,
                    first_message: lead.email || lead.phone,
                    first_message_at: lead.started_at,
                    last_message_at: lead.started_at,
                    page_url: lead.page_url,
                    country: "",
                    category: "",
                    website_domain: "",
                };
                this.show("chats");
            });
        }
    }
}

function when(iso: string): string {
    if (!iso) {
        return "";
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
        return iso;
    }
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function safeName(text: string): string {
    return text.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "chat";
}
