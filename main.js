"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AsyntaiPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/api.ts
var DEFAULT_ORIGIN = "https://asyntai.com";
var ApiError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
var ASK_MARKER = "obsidian_ask_";
function newAskSession() {
  return `${ASK_MARKER}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function isOwnQuestion(sessionId) {
  return typeof sessionId === "string" && sessionId.includes(ASK_MARKER);
}
function query(params) {
  const search = new URLSearchParams();
  for (const name of Object.keys(params)) {
    const value = params[name];
    if (value !== void 0 && value !== null && value !== "") {
      search.set(name, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
var AsyntaiApi = class {
  constructor(transport2, apiKey, origin = () => DEFAULT_ORIGIN) {
    this.transport = transport2;
    this.apiKey = apiKey;
    this.origin = origin;
  }
  async request(path, method = "GET", body) {
    const key = this.apiKey().trim();
    if (!key) {
      throw new ApiError("Add your Asyntai API key in the plugin settings.", 401);
    }
    const headers = {
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    };
    const req = {
      url: this.origin().replace(/\/+$/, "") + path,
      method,
      headers
    };
    if (body !== void 0) {
      headers["Content-Type"] = "application/json";
      req.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await this.transport(req);
    } catch {
      throw new ApiError("Asyntai did not answer. Check your connection.", 0);
    }
    let data = {};
    try {
      data = res.text ? JSON.parse(res.text) : {};
    } catch {
      data = {};
    }
    if (res.status === 401) {
      throw new ApiError("Asyntai does not accept this API key.", 401);
    }
    if (res.status === 403) {
      throw new ApiError(
        typeof data.error === "string" ? data.error : "The Asyntai API needs the Starter plan or higher.",
        403
      );
    }
    if (res.status < 200 || res.status >= 300 || data.success === false) {
      const message = typeof data.error === "string" ? data.error : `Asyntai answered with status ${res.status}.`;
      throw new ApiError(message, res.status);
    }
    return data;
  }
  async account() {
    const data = await this.request("/api/v1/account/");
    return data.account;
  }
  async sessions(limit = 30) {
    const data = await this.request(`/api/v1/sessions/${query({ limit })}`);
    const list = data.sessions || [];
    return list.filter((s) => !isOwnQuestion(s.session_id));
  }
  async conversation(sessionId) {
    const data = await this.request(`/api/v1/conversations/${query({ session_id: sessionId, limit: 100 })}`);
    return data.messages || [];
  }
  async leads(limit = 30) {
    const data = await this.request(`/api/v1/leads/${query({ limit })}`);
    return data.leads || [];
  }
  async chat(message, sessionId) {
    const data = await this.request("/api/v1/chat/", "POST", { message, session_id: sessionId });
    return String(data.response || "");
  }
  async addText(title, content) {
    const data = await this.request("/api/v1/knowledge/text/", "POST", { title, content });
    const id = data.id;
    if (typeof id !== "string" || !id) {
      throw new ApiError("Asyntai stored the note but returned no id.", 500);
    }
    return id;
  }
  // 404 counts as done: the entry is already gone on the Asyntai side.
  async deleteEntry(id) {
    try {
      await this.request(`/api/v1/knowledge/${encodeURIComponent(id)}/`, "DELETE");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return;
      }
      throw err;
    }
  }
  async knowledge(limit = 100) {
    const data = await this.request(`/api/v1/knowledge/${query({ limit })}`);
    return data.entries || [];
  }
};

// src/settings.ts
var import_obsidian = require("obsidian");

// src/text.ts
function splitFrontMatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontMatter: {}, body: raw };
  }
  const frontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      frontMatter[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { frontMatter, body: raw.slice(match[0].length) };
}
function markdownToText(body) {
  let text = body.replace(/\r\n/g, "\n");
  text = text.replace(/!\[\[[^\]]*\]\]/g, "");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target, label) => {
    return (label || target || "").trim();
  });
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)[^)]*\)/g, "$1 ($2)");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/%%[\s\S]*?%%/g, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^(\s*[-*+]\s+)\[[ xX]\]\s+/gm, "$1");
  text = text.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(^|[^*\w])(\*|_)([^*_\n]+)\2(?=[^*\w]|$)/g, "$1$3");
  text = text.replace(/==([^=\n]+)==/g, "$1");
  text = text.replace(/~~([^~\n]+)~~/g, "$1");
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/^\s*(#[\w/-]+\s*)+$/gm, "");
  text = text.replace(/\s\^[\w-]+$/gm, "");
  text = text.replace(/\[\^[^\]]+\]/g, "");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/[ \t]*\n[ \t]*/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
function noteText(raw, basename) {
  const { frontMatter, body } = splitFrontMatter(raw);
  const title = (frontMatter.title || basename).trim();
  return { title, text: markdownToText(body) };
}
function knowledgeContent(note) {
  return `${note.title}

${note.text}`;
}
function hashText(text) {
  let h1 = 3735928559;
  let h2 = 1103547991;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

// src/sync.ts
var MIN_LENGTH = 120;
function parseFolders(raw) {
  const out = [];
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
function inFolder(path, folder) {
  if (folder === "" || folder === "/") {
    return true;
  }
  return path === folder || path.startsWith(folder + "/");
}
function shouldSync(path, options) {
  if (!path.toLowerCase().endsWith(".md")) {
    return false;
  }
  const folders = options.folders.filter((f) => f !== void 0);
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
var SyncEngine = class {
  constructor(api, vault, map, save, options) {
    this.api = api;
    this.vault = vault;
    this.map = map;
    this.save = save;
    this.options = options;
  }
  entries() {
    return this.map;
  }
  count() {
    return Object.keys(this.map).length;
  }
  isSynced(path) {
    return Boolean(this.map[path]?.kb);
  }
  wanted(path) {
    return shouldSync(path, this.options());
  }
  /**
   * Send one note. A note already in the knowledge base is replaced: the
   * new entry goes up first, then the old one is removed, so the chatbot
   * never has a gap.
   */
  async push(note, raw) {
    const content = raw === void 0 ? await this.vault.read(note.path) : raw;
    const parsed = noteText(content, note.basename);
    if (parsed.text.length < MIN_LENGTH) {
      await this.remove(note.path);
      return { ok: true, skipped: true, message: "Note is too short to send." };
    }
    const body = knowledgeContent(parsed);
    const hash = hashText(body);
    const known = this.map[note.path];
    if (known && known.hash === hash && known.kb) {
      return { ok: true, skipped: true, message: "Note is unchanged." };
    }
    let kb;
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
      }
    }
    return { ok: true, skipped: false, message: "Note sent to Asyntai." };
  }
  /** Remove a note from the knowledge base, if it was ever sent. */
  async remove(path) {
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
  async rename(oldPath, note) {
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
    await this.push(note);
  }
  /** Send every wanted note and remove every note that is no longer wanted. */
  async syncAll(onProgress) {
    const result = { sent: 0, skipped: 0, removed: 0, failed: 0, errors: [] };
    const notes = this.vault.notes().filter((n) => this.wanted(n.path));
    const present = new Set(notes.map((n) => n.path));
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
  async removeAll() {
    let removed = 0;
    for (const path of Object.keys(this.map)) {
      if (await this.remove(path)) {
        removed += 1;
      }
    }
    return removed;
  }
};
function errorText(err) {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  apiKey: "",
  origin: DEFAULT_ORIGIN,
  syncEnabled: true,
  folders: "",
  excluded: "",
  chatsFolder: "Asyntai chats"
};
var AsyntaiSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.status = null;
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("API key").setDesc("From your Asyntai dashboard: Settings, then API. The API needs the Starter plan or higher.").addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.addClass("asyntai-key-input");
      text.setPlaceholder("Paste your API key").setValue(this.plugin.settings.apiKey).onChange(async (value) => {
        this.plugin.settings.apiKey = value.trim();
        await this.plugin.saveSettings();
      });
    }).addButton(
      (button) => button.setButtonText("Check").onClick(async () => {
        button.setDisabled(true);
        try {
          const account = await this.plugin.api.account();
          this.setStatus(`Connected as ${account.email} (${account.plan} plan).`, false);
        } catch (err) {
          this.setStatus(errorText(err), true);
        } finally {
          button.setDisabled(false);
        }
      })
    );
    this.status = containerEl.createDiv({ cls: "asyntai-settings-status" });
    new import_obsidian.Setting(containerEl).setName("Knowledge base").setHeading();
    new import_obsidian.Setting(containerEl).setName("Send notes to Asyntai").setDesc("When on, every note in the folders below goes to the knowledge base, and each edit updates it.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
        this.plugin.settings.syncEnabled = value;
        await this.plugin.saveSettings();
        this.plugin.refreshStatusBar();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Folders to send").setDesc("One folder per line. Subfolders are included. Write / for the whole vault.").addTextArea((area) => {
      area.inputEl.rows = 4;
      area.inputEl.addClass("asyntai-folder-input");
      area.setPlaceholder("Support\nProducts/FAQ").setValue(this.plugin.settings.folders).onChange(async (value) => {
        this.plugin.settings.folders = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Folders to keep out").setDesc("One folder per line. A note in these folders never goes to Asyntai, even inside a folder above.").addTextArea((area) => {
      area.inputEl.rows = 3;
      area.inputEl.addClass("asyntai-folder-input");
      area.setPlaceholder("Support/Drafts").setValue(this.plugin.settings.excluded).onChange(async (value) => {
        this.plugin.settings.excluded = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Send all notes now").setDesc("Sends every note in the folders above, and removes notes that left them.").addButton(
      (button) => button.setButtonText("Send all").setCta().onClick(async () => {
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
      })
    );
    new import_obsidian.Setting(containerEl).setName("Remove all notes from Asyntai").setDesc("Deletes every note this plugin sent from the knowledge base. The notes in your vault stay.").addButton(
      (button) => button.setButtonText("Remove all").setWarning().onClick(async () => {
        button.setDisabled(true);
        try {
          const n = await this.plugin.sync.removeAll();
          this.plugin.refreshStatusBar();
          this.setStatus(`Removed ${n} notes from Asyntai.`, false);
        } finally {
          button.setDisabled(false);
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Panel").setHeading();
    new import_obsidian.Setting(containerEl).setName("Folder for saved chats").setDesc("A website chat saved from the panel becomes a note in this folder.").addText(
      (text) => text.setValue(this.plugin.settings.chatsFolder).onChange(async (value) => {
        this.plugin.settings.chatsFolder = value.trim() || DEFAULT_SETTINGS.chatsFolder;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Advanced").setHeading();
    new import_obsidian.Setting(containerEl).setName("Asyntai address").setDesc("Leave this as it is. It is only for self-hosted test servers.").addText(
      (text) => text.setValue(this.plugin.settings.origin).onChange(async (value) => {
        this.plugin.settings.origin = value.trim() || DEFAULT_ORIGIN;
        await this.plugin.saveSettings();
      })
    );
    const count = this.plugin.sync.count();
    this.setStatus(count ? `${count} notes are in the Asyntai knowledge base.` : "", false);
  }
  setStatus(text, isError) {
    if (!this.status) {
      return;
    }
    this.status.setText(text);
    this.status.toggleClass("asyntai-error", isError);
    if (isError && text) {
      new import_obsidian.Notice(text);
    }
  }
};

// src/view.ts
var import_obsidian2 = require("obsidian");
var VIEW_TYPE = "asyntai-panel";
var AsyntaiView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.tab = "ask";
    this.body = null;
    this.tabButtons = null;
    this.askSession = newAskSession();
    this.answers = [];
    this.openSession = null;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Asyntai";
  }
  getIcon() {
    return "bot-message-square";
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("asyntai-panel");
    const tabs = root.createDiv({ cls: "asyntai-tabs" });
    const make = (id, label) => {
      const el = tabs.createEl("button", { text: label, cls: "asyntai-tab" });
      el.addEventListener("click", () => this.show(id));
      return el;
    };
    this.tabButtons = { ask: make("ask", "Ask"), chats: make("chats", "Chats"), leads: make("leads", "Leads") };
    this.body = root.createDiv({ cls: "asyntai-body" });
    this.show(this.tab);
  }
  async onClose() {
    this.contentEl.empty();
  }
  show(tab) {
    this.tab = tab;
    if (this.tabButtons) {
      for (const id of Object.keys(this.tabButtons)) {
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
  renderAsk(root) {
    const list = root.createDiv({ cls: "asyntai-answers" });
    const draw = () => {
      list.empty();
      if (this.answers.length === 0) {
        list.createDiv({
          cls: "asyntai-empty",
          text: "Ask your chatbot anything. It answers from your knowledge base, the same way it answers visitors on your website."
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
      const pending = { question, answer: "\u2026" };
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
  insertIntoNote(text) {
    const editor = this.plugin.targetEditor();
    if (!editor) {
      new import_obsidian2.Notice("Open a note first, then insert.");
      return;
    }
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const before = line.slice(0, cursor.ch).length > 0 ? "\n" : "";
    const after = line.slice(cursor.ch).length > 0 ? "\n" : "";
    editor.replaceSelection(before + text + after);
    new import_obsidian2.Notice("Inserted into the note.");
  }
  // -------------------------------------------------------------- Chats
  async renderChats(root) {
    if (this.openSession) {
      await this.renderConversation(root, this.openSession);
      return;
    }
    const head = root.createDiv({ cls: "asyntai-head" });
    head.createSpan({ text: "Latest website chats" });
    const refresh = head.createEl("button", { cls: "asyntai-icon-btn", attr: { "aria-label": "Refresh" } });
    (0, import_obsidian2.setIcon)(refresh, "refresh-cw");
    refresh.addEventListener("click", () => this.show("chats"));
    const list = root.createDiv({ cls: "asyntai-list" });
    list.createDiv({ cls: "asyntai-empty", text: "Loading\u2026" });
    let sessions;
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
      row.createDiv({ cls: "asyntai-row-meta", text: meta.join(" \xB7 ") });
      row.addEventListener("click", () => {
        this.openSession = s;
        this.show("chats");
      });
    }
  }
  async renderConversation(root, session) {
    const head = root.createDiv({ cls: "asyntai-head" });
    const back = head.createEl("button", { cls: "asyntai-icon-btn", attr: { "aria-label": "Back" } });
    (0, import_obsidian2.setIcon)(back, "arrow-left");
    back.addEventListener("click", () => {
      this.openSession = null;
      this.show("chats");
    });
    head.createSpan({ text: session.page_url || session.website_domain || "Chat" });
    const list = root.createDiv({ cls: "asyntai-answers" });
    list.createDiv({ cls: "asyntai-empty", text: "Loading\u2026" });
    let messages;
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
  async saveChat(session, messages) {
    const folder = (0, import_obsidian2.normalizePath)(this.plugin.settings.chatsFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const stamp = (session.first_message_at || (/* @__PURE__ */ new Date()).toISOString()).replace(/[:T]/g, "-").slice(0, 16);
    const name = `${stamp} ${safeName(session.first_message || session.session_id)}`.slice(0, 80);
    const path = (0, import_obsidian2.normalizePath)(`${folder}/${name}.md`);
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
      ""
    ];
    for (const m of messages) {
      lines.push(`**${m.role === "user" ? "Visitor" : "Assistant"}:** ${m.content}`, "");
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      new import_obsidian2.Notice("This chat is already saved.");
      return;
    }
    const file = await this.app.vault.create(path, lines.join("\n"));
    await this.app.workspace.getLeaf(false).openFile(file);
    new import_obsidian2.Notice("Chat saved as a note.");
  }
  // -------------------------------------------------------------- Leads
  async renderLeads(root) {
    const head = root.createDiv({ cls: "asyntai-head" });
    head.createSpan({ text: "Latest leads" });
    const refresh = head.createEl("button", { cls: "asyntai-icon-btn", attr: { "aria-label": "Refresh" } });
    (0, import_obsidian2.setIcon)(refresh, "refresh-cw");
    refresh.addEventListener("click", () => this.show("leads"));
    const list = root.createDiv({ cls: "asyntai-list" });
    list.createDiv({ cls: "asyntai-empty", text: "Loading\u2026" });
    let leads;
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
      row.createDiv({ cls: "asyntai-row-meta", text: meta.join(" \xB7 ") });
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
          website_domain: ""
        };
        this.show("chats");
      });
    }
  }
};
function when(iso) {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(void 0, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function safeName(text) {
  return text.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "chat";
}

// src/main.ts
var SEND_DELAY_MS = 3e3;
var transport = async (req) => {
  const res = await (0, import_obsidian3.requestUrl)({
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: req.body,
    throw: false
  });
  return { status: res.status, text: res.text };
};
var AsyntaiPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.map = {};
    this.statusBar = null;
    this.timers = /* @__PURE__ */ new Map();
    // The note the user last worked in. A click in the side panel makes the
    // panel the active leaf, so "the active note" must be remembered.
    this.lastNoteView = null;
  }
  async onload() {
    await this.loadStored();
    this.api = new AsyntaiApi(
      transport,
      () => this.settings.apiKey,
      () => this.settings.origin
    );
    const vault = {
      notes: () => this.app.vault.getMarkdownFiles().map(toNote),
      read: async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian3.TFile)) {
          throw new Error(`Note not found: ${path}`);
        }
        return this.app.vault.cachedRead(file);
      }
    };
    this.sync = new SyncEngine(
      this.api,
      vault,
      this.map,
      async (map) => {
        this.map = map;
        await this.saveStored();
      },
      () => ({ folders: parseFolders(this.settings.folders), excluded: parseFolders(this.settings.excluded) })
    );
    this.registerView(VIEW_TYPE, (leaf) => new AsyntaiView(leaf, this));
    this.addSettingTab(new AsyntaiSettingTab(this.app, this));
    this.addRibbonIcon("bot-message-square", "Open Asyntai", () => void this.openPanel());
    this.statusBar = this.addStatusBarItem();
    this.refreshStatusBar();
    this.addCommand({
      id: "open-panel",
      name: "Open panel",
      callback: () => void this.openPanel()
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
      }
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
      }
    });
    this.addCommand({
      id: "send-all",
      name: "Send all notes in the chosen folders",
      callback: () => void this.syncAllWithNotice()
    });
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof import_obsidian3.MarkdownView) {
          this.lastNoteView = leaf.view;
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("modify", (file) => this.onChanged(file)));
      this.registerEvent(this.app.vault.on("create", (file) => this.onChanged(file)));
      this.registerEvent(this.app.vault.on("delete", (file) => void this.onDeleted(file)));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.onRenamed(file, oldPath)));
    });
  }
  onunload() {
    for (const id of this.timers.values()) {
      window.clearTimeout(id);
    }
    this.timers.clear();
  }
  // ------------------------------------------------------------ storage
  async loadStored() {
    const raw = await this.loadData() || {};
    this.settings = { ...DEFAULT_SETTINGS, ...raw.settings || {} };
    this.map = raw.map || {};
  }
  async saveStored() {
    const data = { settings: this.settings, map: this.map };
    await this.saveData(data);
  }
  async saveSettings() {
    await this.saveStored();
  }
  // ------------------------------------------------------------- events
  syncActive() {
    return this.settings.syncEnabled && this.settings.apiKey.trim() !== "";
  }
  onChanged(file) {
    if (!(file instanceof import_obsidian3.TFile) || file.extension !== "md" || !this.syncActive()) {
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
  async onDeleted(file) {
    if (!(file instanceof import_obsidian3.TFile) || !this.sync.isSynced(file.path)) {
      return;
    }
    const ok = await this.sync.remove(file.path);
    if (!ok) {
      new import_obsidian3.Notice(`Asyntai: could not remove ${file.basename} from the knowledge base.`);
    }
    this.refreshStatusBar();
  }
  async onRenamed(file, oldPath) {
    if (!(file instanceof import_obsidian3.TFile) || file.extension !== "md" || !this.syncActive()) {
      return;
    }
    await this.sync.rename(oldPath, toNote(file));
    this.refreshStatusBar();
  }
  async sendQuietly(file) {
    if (this.sync.wanted(file.path)) {
      const r = await this.sync.push(toNote(file));
      if (!r.ok) {
        new import_obsidian3.Notice(`Asyntai: ${r.message}`);
      }
    } else if (this.sync.isSynced(file.path)) {
      await this.sync.remove(file.path);
    }
    this.refreshStatusBar();
  }
  // ----------------------------------------------------------- commands
  async sendOne(file) {
    const r = await this.sync.push(toNote(file));
    new import_obsidian3.Notice(r.ok ? `Asyntai: ${r.message}` : `Asyntai: ${r.message}`);
    this.refreshStatusBar();
  }
  async removeOne(file) {
    const ok = await this.sync.remove(file.path);
    new import_obsidian3.Notice(ok ? "Asyntai: note removed from the knowledge base." : "Asyntai: could not remove the note.");
    this.refreshStatusBar();
  }
  async syncAll(onProgress) {
    const r = await this.sync.syncAll(onProgress);
    this.refreshStatusBar();
    return r;
  }
  async syncAllWithNotice() {
    if (parseFolders(this.settings.folders).length === 0) {
      new import_obsidian3.Notice("Asyntai: choose the folders to send in the plugin settings first.");
      return;
    }
    const notice = new import_obsidian3.Notice("Asyntai: sending notes\u2026", 0);
    const r = await this.syncAll((done, total) => notice.setMessage(`Asyntai: ${done} / ${total}`));
    notice.hide();
    new import_obsidian3.Notice(`Asyntai: sent ${r.sent}, unchanged ${r.skipped}, removed ${r.removed}, failed ${r.failed}.`);
  }
  async openPanel() {
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
  targetEditor() {
    const active = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (active) {
      return active.editor;
    }
    const open = this.app.workspace.getLeavesOfType("markdown");
    if (this.lastNoteView && open.some((leaf) => leaf.view === this.lastNoteView)) {
      return this.lastNoteView.editor;
    }
    if (open.length === 1 && open[0].view instanceof import_obsidian3.MarkdownView) {
      return open[0].view.editor;
    }
    return null;
  }
  refreshStatusBar() {
    if (!this.statusBar) {
      return;
    }
    const n = this.sync.count();
    const state = this.syncActive() ? "" : " (paused)";
    this.statusBar.setText(`Asyntai: ${n} ${n === 1 ? "note" : "notes"}${state}`);
  }
};
function toNote(file) {
  return { path: file.path, basename: file.basename };
}
