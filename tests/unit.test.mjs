// Offline tests: the text converter, the folder rules, the API client with a
// fake transport, and the sync engine with an in-memory vault.
// Run: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { AsyntaiApi, ApiError, isOwnQuestion, newAskSession } from "./build/api.js";
import { markdownToText, noteText, splitFrontMatter, hashText, knowledgeContent } from "./build/text.js";
import { SyncEngine, parseFolders, shouldSync, MIN_LENGTH } from "./build/sync.js";

// ------------------------------------------------------------------ text

test("front matter is split off and its title wins", () => {
    const { frontMatter, body } = splitFrontMatter('---\ntitle: "Opening hours"\ntags: [a, b]\n---\nWe open at 9.');
    assert.equal(frontMatter.title, "Opening hours");
    assert.equal(body, "We open at 9.");
    assert.equal(noteText('---\ntitle: Hours\n---\nText', "file name").title, "Hours");
    assert.equal(noteText("Text", "file name").title, "file name");
});

test("markdown syntax goes, words stay", () => {
    const md = [
        "# Shipping",
        "",
        "We ship **worldwide** with *tracking*. See [[Returns policy|returns]] and [[Warranty]].",
        "![[photo.png]] ![alt](img.png)",
        "Read [our terms](https://example.com/terms) or [[Contact#Email]].",
        "- [ ] task one",
        "- [x] task two",
        "> quoted line",
        "%% hidden comment %%",
        "<!-- html comment -->",
        "#tag #another",
        "Use `code` here ^block-id",
        "---",
        "==mark== ~~gone~~ text[^1]",
    ].join("\n");
    const text = markdownToText(md);
    assert.equal(
        text,
        [
            "Shipping",
            "",
            "We ship worldwide with tracking. See returns and Warranty.",
            "",
            "Read our terms (https://example.com/terms) or Contact.",
            "- task one",
            "- task two",
            "quoted line",
            "",
            "Use code here",
            "",
            "mark gone text",
        ].join("\n"),
    );
});

test("hash changes with the text and is stable", () => {
    assert.equal(hashText("abc"), hashText("abc"));
    assert.notEqual(hashText("abc"), hashText("abd"));
    assert.match(hashText("x"), /^[0-9a-f]{16}$/);
});

test("knowledge content starts with the title", () => {
    assert.equal(knowledgeContent({ title: "T", text: "body" }), "T\n\nbody");
});

// --------------------------------------------------------------- folders

test("folder lists parse from lines or commas", () => {
    assert.deepEqual(parseFolders("Support\n/Products/FAQ/, Support"), ["Support", "Products/FAQ"]);
    assert.deepEqual(parseFolders(""), []);
    assert.deepEqual(parseFolders("/"), [""]);
});

test("shouldSync follows folders and exclusions", () => {
    const opt = { folders: ["Support"], excluded: ["Support/Drafts"] };
    assert.equal(shouldSync("Support/Hours.md", opt), true);
    assert.equal(shouldSync("Support/Deep/Hours.md", opt), true);
    assert.equal(shouldSync("Support/Drafts/Hours.md", opt), false);
    assert.equal(shouldSync("Supporters/Hours.md", opt), false);
    assert.equal(shouldSync("Hours.md", opt), false);
    assert.equal(shouldSync("Support/image.png", opt), false);
    assert.equal(shouldSync("Anything.md", { folders: [""], excluded: [] }), true);
    assert.equal(shouldSync("Anything.md", { folders: [], excluded: [] }), false);
});

// ------------------------------------------------------------------- api

function fakeTransport(handler) {
    const calls = [];
    const transport = async (req) => {
        calls.push(req);
        return handler(req);
    };
    return { transport, calls };
}

test("api sends the bearer key and parses errors", async () => {
    const { transport, calls } = fakeTransport(async (req) => {
        if (req.url.endsWith("/api/v1/account/")) {
            return { status: 200, text: JSON.stringify({ success: true, account: { email: "a@b.c", plan: "starter" } }) };
        }
        if (req.url.endsWith("/api/v1/knowledge/text/")) {
            return { status: 200, text: JSON.stringify({ success: true, id: "kb-1" }) };
        }
        if (req.url.includes("/api/v1/knowledge/kb-gone/")) {
            return { status: 404, text: JSON.stringify({ success: false, error: "not found" }) };
        }
        return { status: 500, text: "" };
    });
    const api = new AsyntaiApi(transport, () => "KEY", () => "http://rig/");
    const account = await api.account();
    assert.equal(account.email, "a@b.c");
    assert.equal(calls[0].headers.Authorization, "Bearer KEY");
    assert.equal(calls[0].url, "http://rig/api/v1/account/");

    assert.equal(await api.addText("T", "content"), "kb-1");
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(JSON.parse(calls[1].body), { title: "T", content: "content" });

    await api.deleteEntry("kb-gone"); // 404 is fine
    await assert.rejects(api.leads(), (e) => e instanceof ApiError && e.status === 500);
});

test("api refuses without a key, maps 401 and 403", async () => {
    const api401 = new AsyntaiApi(async () => ({ status: 401, text: "{}" }), () => "k");
    await assert.rejects(api401.account(), (e) => e.status === 401 && /API key/.test(e.message));
    const api403 = new AsyntaiApi(async () => ({ status: 403, text: JSON.stringify({ error: "needs plan" }) }), () => "k");
    await assert.rejects(api403.account(), (e) => e.status === 403 && e.message === "needs plan");
    const noKey = new AsyntaiApi(async () => ({ status: 200, text: "{}" }), () => "  ");
    await assert.rejects(noKey.account(), (e) => e.status === 401);
    const down = new AsyntaiApi(async () => { throw new Error("ECONNREFUSED"); }, () => "k");
    await assert.rejects(down.account(), (e) => e.status === 0);
});

test("own questions are filtered out of the chats list", async () => {
    const api = new AsyntaiApi(
        async () => ({
            status: 200,
            text: JSON.stringify({ success: true, sessions: [{ session_id: "api_x" }, { session_id: newAskSession() }] }),
        }),
        () => "k",
    );
    const sessions = await api.sessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].session_id, "api_x");
    assert.equal(isOwnQuestion("obsidian_ask_1_ab"), true);
});

// ------------------------------------------------------------------ sync

function memoryVault(files) {
    return {
        files,
        notes() {
            return Object.keys(files).map((path) => ({ path, basename: path.split("/").pop().replace(/\.md$/, "") }));
        },
        async read(path) {
            if (!(path in files)) throw new Error("missing " + path);
            return files[path];
        },
    };
}

function fakeServer() {
    const store = new Map();
    let n = 0;
    const log = [];
    const transport = async (req) => {
        log.push(`${req.method} ${req.url.replace(/^https?:\/\/[^/]+/, "")}`);
        if (req.method === "POST" && req.url.endsWith("/knowledge/text/")) {
            const body = JSON.parse(req.body);
            const id = `kb-${++n}`;
            store.set(id, body);
            return { status: 200, text: JSON.stringify({ success: true, id }) };
        }
        const del = req.url.match(/\/knowledge\/([^/]+)\/$/);
        if (req.method === "DELETE" && del) {
            const id = decodeURIComponent(del[1]);
            if (!store.has(id)) return { status: 404, text: JSON.stringify({ success: false, error: "gone" }) };
            store.delete(id);
            return { status: 200, text: JSON.stringify({ success: true }) };
        }
        return { status: 500, text: "" };
    };
    return { transport, store, log };
}

const LONG = "This is a sentence that is long enough to count as real content for the knowledge base. ".repeat(3);

function engine(files, folders = ["Support"], server = fakeServer()) {
    const vault = memoryVault(files);
    const api = new AsyntaiApi(server.transport, () => "k", () => "http://rig");
    let saved = null;
    const map = {};
    const sync = new SyncEngine(api, vault, map, async (m) => { saved = JSON.parse(JSON.stringify(m)); }, () => ({ folders, excluded: ["Support/Drafts"] }));
    return { sync, server, vault, map, getSaved: () => saved };
}

test("syncAll sends wanted notes, skips short ones, ignores other folders", async () => {
    const { sync, server, map } = engine({
        "Support/Hours.md": "# Hours\n\n" + LONG,
        "Support/Short.md": "Tiny.",
        "Support/Drafts/Secret.md": LONG,
        "Private/Diary.md": LONG,
    });
    const r = await sync.syncAll();
    assert.deepEqual(r, { sent: 1, skipped: 1, removed: 0, failed: 0, errors: [] });
    assert.equal(server.store.size, 1);
    const [entry] = server.store.values();
    assert.equal(entry.title, "Hours");
    assert.match(entry.content, /^Hours\n\nHours\n\nThis is a sentence/);
    assert.equal(map["Support/Hours.md"].kb, "kb-1");
    assert.equal(sync.count(), 1);
});

test("an unchanged note is not sent twice, a changed one is replaced", async () => {
    const files = { "Support/Hours.md": LONG };
    const { sync, server, vault } = engine(files);
    await sync.syncAll();
    const r2 = await sync.syncAll();
    assert.equal(r2.skipped, 1);
    assert.equal(server.log.filter((l) => l.startsWith("POST")).length, 1);

    vault.files["Support/Hours.md"] = LONG + " Now we also open on Sunday.";
    const r3 = await sync.push({ path: "Support/Hours.md", basename: "Hours" });
    assert.equal(r3.ok && !r3.skipped, true);
    // New entry first, then the old one removed: no gap for the chatbot.
    const tail = server.log.slice(-2);
    assert.match(tail[0], /^POST/);
    assert.match(tail[1], /^DELETE .*kb-1/);
    assert.equal(server.store.size, 1);
    assert.equal(sync.entries()["Support/Hours.md"].kb, "kb-2");
});

test("a note that became short is removed, a deleted note is removed", async () => {
    const files = { "Support/A.md": LONG, "Support/B.md": LONG };
    const { sync, server, vault } = engine(files);
    await sync.syncAll();
    assert.equal(server.store.size, 2);

    vault.files["Support/A.md"] = "now short";
    const r = await sync.push({ path: "Support/A.md", basename: "A" });
    assert.equal(r.skipped, true);
    assert.equal(server.store.size, 1);
    assert.equal(sync.isSynced("Support/A.md"), false);

    delete vault.files["Support/B.md"];
    const all = await sync.syncAll();
    assert.equal(all.removed, 1);
    assert.equal(server.store.size, 0);
});

test("rename moves the key, moving out of the folder removes the entry", async () => {
    const files = { "Support/A.md": LONG };
    const { sync, server, vault } = engine(files);
    await sync.syncAll();

    vault.files["Support/Renamed.md"] = vault.files["Support/A.md"];
    delete vault.files["Support/A.md"];
    await sync.rename("Support/A.md", { path: "Support/Renamed.md", basename: "Renamed" });
    assert.equal(sync.isSynced("Support/A.md"), false);
    assert.equal(sync.isSynced("Support/Renamed.md"), true);
    // The title comes from the file name, so the entry was replaced.
    assert.equal(sync.entries()["Support/Renamed.md"].title, "Renamed");
    assert.equal(server.store.size, 1);

    vault.files["Private/Renamed.md"] = vault.files["Support/Renamed.md"];
    delete vault.files["Support/Renamed.md"];
    await sync.rename("Support/Renamed.md", { path: "Private/Renamed.md", basename: "Renamed" });
    assert.equal(server.store.size, 0);
    assert.equal(sync.count(), 0);

    // Moved into the folder: it is sent.
    vault.files["Support/Back.md"] = vault.files["Private/Renamed.md"];
    await sync.rename("Private/Renamed.md", { path: "Support/Back.md", basename: "Back" });
    assert.equal(server.store.size, 1);
});

test("server errors are reported and the map is untouched", async () => {
    const bad = { transport: async () => ({ status: 403, text: JSON.stringify({ error: "Upgrade first" }) }), store: new Map(), log: [] };
    const { sync } = engine({ "Support/A.md": LONG }, ["Support"], bad);
    const r = await sync.syncAll();
    assert.equal(r.failed, 1);
    assert.equal(r.errors[0], "Support/A.md: Upgrade first");
    assert.equal(sync.count(), 0);
});

test("removeAll clears every entry", async () => {
    const { sync, server } = engine({ "Support/A.md": LONG, "Support/B.md": LONG });
    await sync.syncAll();
    assert.equal(await sync.removeAll(), 2);
    assert.equal(server.store.size, 0);
    assert.equal(sync.count(), 0);
});

test("MIN_LENGTH is the stub threshold", () => {
    assert.equal(MIN_LENGTH, 120);
});
