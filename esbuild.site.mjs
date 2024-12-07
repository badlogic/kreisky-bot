#!/usr/bin/env node

import esbuild from "esbuild";
import * as glob from "glob";
import chokidar from "chokidar";

function getFunEntries() {
    return glob.sync("src/fun/*.ts").reduce((acc, file) => {
        const name = file.replace("src/fun/", "").replace(".ts", "");
        acc[name] = file;
        return acc;
    }, {});
}

function getConfig() {
    return {
        entryPoints: {
            app: "src/app.ts",
            ...getFunEntries(),
        },
        bundle: true,
        sourcemap: true,
        outdir: "html/build/",
        loader: {
            ".ttf": "dataurl",
            ".woff": "dataurl",
            ".woff2": "dataurl",
            ".eot": "dataurl",
            ".html": "text",
            ".svg": "text",
            ".css": "text",
        },
        logLevel: "info",
        minify: false,
    };
}

let buildContext = null;

async function rebuild() {
    if (buildContext) {
        await buildContext.dispose();
    }
    buildContext = await esbuild.context(getConfig());
    await buildContext.watch();
}

const watchMode = process.argv.length >= 3 && process.argv[2] == "--watch";

if (!watchMode) {
    console.log("Building site");
    await esbuild.build(getConfig());
} else {
    // Watch the test directory for added/removed files
    chokidar
        .watch("src/*.ts", {
            ignoreInitial: true,
        })
        .on("all", (event, path) => {
            if (event === "add" || event === "unlink") {
                console.log(`File ${event}: ${path}`);
                rebuild();
            }
        });

    // Initial build
    rebuild();
}
