#!/usr/bin/env node

import esbuild from "esbuild";
import * as glob from "glob";
import chokidar from "chokidar";

function getTestEntries() {
    return glob.sync("src/server/test/*.ts").reduce((acc, file) => {
        const name = file.replace("src/server/test/", "").replace(".ts", "");
        acc[name] = file;
        return acc;
    }, {});
}

function getConfig() {
    return {
        entryPoints: {
            server: "src/server/server.ts",
            ...getTestEntries(),
        },
        bundle: true,
        sourcemap: true,
        platform: "node",
        external: ["fsevents"],
        outdir: "build/",
        logLevel: "info",
        minify: false,
        loader: {
            ".ttf": "dataurl",
            ".woff": "dataurl",
            ".woff2": "dataurl",
            ".eot": "dataurl",
            ".html": "text",
            ".svg": "text",
            ".css": "text",
        },
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
    console.log("Building server");
    await esbuild.build(getConfig());
} else {
    // Watch the test directory for added/removed files
    chokidar
        .watch("src/server/test/*.ts", {
            ignoreInitial: true,
        })
        .on("all", (event, path) => {
            if (event === "add" || event === "unlink") {
                console.log(`Test file ${event}: ${path}`);
                rebuild();
            }
        });

    // Initial build
    rebuild();
}
