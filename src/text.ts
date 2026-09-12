// Turns a note into the text the chatbot answers from.
//
// The knowledge base wants readable prose, not Markdown syntax. Links keep
// their label, embeds and images go, front matter goes, and everything else
// stays as the writer typed it.

export interface NoteText {
    title: string;
    text: string;
}

/** Splits YAML front matter off the top of a note. */
export function splitFrontMatter(raw: string): { frontMatter: Record<string, string>; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        return { frontMatter: {}, body: raw };
    }
    const frontMatter: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (pair) {
            frontMatter[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
        }
    }
    return { frontMatter, body: raw.slice(match[0].length) };
}

export function markdownToText(body: string): string {
    let text = body.replace(/\r\n/g, "\n");

    // Embeds and images carry nothing the chatbot can say.
    text = text.replace(/!\[\[[^\]]*\]\]/g, "");
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

    // Wiki links: [[note|label]] -> label, [[note#heading]] -> note.
    text = text.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => {
        return (label || target || "").trim();
    });

    // Markdown links keep the label and the address, so an answer can point
    // the visitor somewhere.
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)[^)]*\)/g, "$1 ($2)");
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

    // Comments never reach a reader.
    text = text.replace(/%%[\s\S]*?%%/g, "");
    text = text.replace(/<!--[\s\S]*?-->/g, "");

    // Headings, emphasis, quotes, tasks, and horizontal rules.
    text = text.replace(/^#{1,6}\s+/gm, "");
    text = text.replace(/^\s*>\s?/gm, "");
    text = text.replace(/^(\s*[-*+]\s+)\[[ xX]\]\s+/gm, "$1");
    text = text.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");
    text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
    text = text.replace(/(^|[^*\w])(\*|_)([^*_\n]+)\2(?=[^*\w]|$)/g, "$1$3");
    text = text.replace(/==([^=\n]+)==/g, "$1");
    text = text.replace(/~~([^~\n]+)~~/g, "$1");
    text = text.replace(/`([^`\n]+)`/g, "$1");

    // Tags at the start of a line are metadata, inline ones may be words.
    text = text.replace(/^\s*(#[\w/-]+\s*)+$/gm, "");

    // Block ids and footnote markers.
    text = text.replace(/\s\^[\w-]+$/gm, "");
    text = text.replace(/\[\^[^\]]+\]/g, "");

    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/[ \t]*\n[ \t]*/g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}

/** The title is the front matter title, else the file name without .md. */
export function noteText(raw: string, basename: string): NoteText {
    const { frontMatter, body } = splitFrontMatter(raw);
    const title = (frontMatter.title || basename).trim();
    return { title, text: markdownToText(body) };
}

/** What goes into the knowledge base entry. */
export function knowledgeContent(note: NoteText): string {
    return `${note.title}\n\n${note.text}`;
}

// A small, fast, non-cryptographic hash: the map only needs to know whether
// the note changed since it was last sent.
export function hashText(text: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
