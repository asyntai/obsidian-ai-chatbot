import esbuild from "esbuild";
import process from "process";

// Three modes:
//   node esbuild.config.mjs             dev build, watches src/
//   node esbuild.config.mjs production  one minified-free build of main.js
//   node esbuild.config.mjs test        bundles the Obsidian-free modules for node --test
const mode = process.argv[2] || "dev";

if (mode === "test") {
    await esbuild.build({
        entryPoints: ["src/api.ts", "src/text.ts", "src/sync.ts"],
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        outdir: "tests/build",
        logLevel: "info",
    });
    process.exit(0);
}

const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    // Obsidian provides these at run time.
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    format: "cjs",
    target: "es2020",
    platform: "browser",
    logLevel: "info",
    sourcemap: mode === "production" ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
});

if (mode === "production") {
    await context.rebuild();
    process.exit(0);
} else {
    await context.watch();
}
