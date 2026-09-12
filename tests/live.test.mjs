// Live tests against a running Asyntai server, with node's fetch as the
// transport. Set ASYNTAI_ORIGIN and ASYNTAI_KEY, then: npm run test:live
//
// Default: the local rig on 8022 (companion.obsidian_test_settings, database
// asyntai_apitest, user obsidian-test@example.com).

import test from "node:test";
import assert from "node:assert/strict";
import { AsyntaiApi, newAskSession } from "./build/api.js";
import { SyncEngine } from "./build/sync.js";

const ORIGIN = process.env.ASYNTAI_ORIGIN || "http://127.0.0.1:8022";
const KEY = process.env.ASYNTAI_KEY || "asyntai_obsidian_test_key_2026";

const transport = async (req) => {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    return { status: res.status, text: await res.text() };
};

const api = new AsyntaiApi(transport, () => KEY, () => ORIGIN);
const STAMP = Date.now();
const LONG = `Obsidian live test ${STAMP}. The warranty on every lamp is three years. Returns are free within thirty days of delivery. Our shop is in Brno and opens at nine every weekday.`;

test("account answers with the plan", async () => {
    const account = await api.account();
    assert.equal(account.email, "obsidian-test@example.com");
    assert.equal(account.plan, "starter");
});

test("a wrong key answers 401", async () => {
    const wrong = new AsyntaiApi(transport, () => "wrong-key", () => ORIGIN);
    await assert.rejects(wrong.account(), (e) => e.status === 401);
});

test("a note goes up, is listed, is replaced, and is removed", async () => {
    const files = { [`Support/Live ${STAMP}.md`]: `---\ntitle: Lamp warranty ${STAMP}\n---\n# Warranty\n\n${LONG}` };
    const vault = {
        notes: () => Object.keys(files).map((path) => ({ path, basename: path.split("/").pop().replace(/\.md$/, "") })),
        read: async (path) => files[path],
    };
    const map = {};
    const sync = new SyncEngine(api, vault, map, async () => {}, () => ({ folders: ["Support"], excluded: [] }));

    const r = await sync.syncAll();
    assert.deepEqual(r, { sent: 1, skipped: 0, removed: 0, failed: 0, errors: [] });
    const first = map[`Support/Live ${STAMP}.md`].kb;
    assert.ok(first);

    const listed = await api.knowledge(200);
    assert.ok(listed.some((e) => e.id === first), "the new entry is in the knowledge list");
    assert.equal(listed.find((e) => e.id === first).title, `Lamp warranty ${STAMP}`);

    files[`Support/Live ${STAMP}.md`] += "\n\nWe also repair lamps on Saturdays.";
    const r2 = await sync.syncAll();
    assert.equal(r2.sent, 1);
    const second = map[`Support/Live ${STAMP}.md`].kb;
    assert.notEqual(second, first);
    const after = await api.knowledge(200);
    assert.ok(after.some((e) => e.id === second));
    assert.ok(!after.some((e) => e.id === first), "the old entry is gone");

    delete files[`Support/Live ${STAMP}.md`];
    const r3 = await sync.syncAll();
    assert.equal(r3.removed, 1);
    const end = await api.knowledge(200);
    assert.ok(!end.some((e) => e.id === second));
});

test("chats, conversations and leads answer", async () => {
    const sessions = await api.sessions(5);
    assert.ok(Array.isArray(sessions));
    const leads = await api.leads(5);
    assert.ok(Array.isArray(leads));
    if (sessions.length > 0) {
        const messages = await api.conversation(sessions[0].session_id);
        assert.ok(Array.isArray(messages));
    }
});

test("ask answers from a synced note and stays out of the chats list", { timeout: 120000 }, async () => {
    const path = `Support/Ask ${STAMP}.md`;
    const files = { [path]: `# Lamp warranty\n\n${LONG}` };
    const vault = { notes: () => [{ path, basename: `Ask ${STAMP}` }], read: async () => files[path] };
    const map = {};
    const sync = new SyncEngine(api, vault, map, async () => {}, () => ({ folders: ["Support"], excluded: [] }));
    await sync.syncAll();
    try {
        const session = newAskSession();
        const answer = await api.chat("How long is the warranty on a lamp?", session);
        assert.ok(answer.length > 0, "an answer came back");
        assert.match(answer.toLowerCase(), /three|3/, `the answer should use the note: ${answer}`);
        const sessions = await api.sessions(50);
        assert.ok(!sessions.some((s) => s.session_id.includes(session)), "own question is hidden");
    } finally {
        await sync.removeAll();
    }
});
