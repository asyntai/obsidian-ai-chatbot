# Asyntai AI Chatbot for Obsidian

Turn your notes into the knowledge base of your website chatbot.

[Asyntai](https://asyntai.com) is an AI chat assistant for websites. It answers visitors from your own content, in more than 80 languages, day and night. This plugin connects your Obsidian vault to it.

## What it does

- **Send notes to the knowledge base.** Choose the folders. Every note in them goes to Asyntai, and each edit, rename or delete updates it. The chatbot on your website answers from your notes within seconds.
- **Ask your chatbot inside Obsidian.** Open the Asyntai panel, type a question, and get the answer the chatbot gives your visitors. Insert it into the note you are writing.
- **Read website chats and leads.** The panel lists the latest conversations from your website and every visitor who left an email address or phone number. Save any chat as a note.

## Setup

1. Sign in to Asyntai, open **Settings**, then **API**, and copy your API key. The API needs the Starter plan or higher.
2. In Obsidian, open **Settings**, then **Asyntai AI Chatbot**, and paste the key. Press **Check**.
3. Add the folders to send, one per line. Write `/` for the whole vault.
4. Press **Send all**. From now on, every change in those folders goes to Asyntai on its own.

## Commands

- **Asyntai: Open panel**
- **Asyntai: Send this note to the knowledge base**
- **Asyntai: Remove this note from the knowledge base**
- **Asyntai: Send all notes in the chosen folders**

The status bar shows how many notes are in the knowledge base.

## How notes are sent

The plugin sends the text of the note, with the front matter removed and the Markdown syntax turned into plain text. Links keep their label, embeds and images are dropped. The title is the `title` front matter field, or else the file name. A note shorter than 120 characters is skipped.

The plugin remembers which knowledge base entry belongs to which note in its own `data.json`, so an edit replaces the entry instead of adding a second one.

## Documentation

https://asyntai.com/documentation/integrations/obsidian/

## Development

```bash
npm install
npm run build      # main.js
npm test           # offline tests
npm run test:live  # against a running Asyntai server, see tests/live.test.mjs
```

## License

MIT
