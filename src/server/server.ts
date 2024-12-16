import bodyParser from "body-parser";
import * as chokidar from "chokidar";
import compression from "compression";
import cors from "cors";
import express from "express";
import * as fs from "fs";
import * as http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { startBots } from "./bot";
import { startAutoblocklists } from "./autoblocklists";
import { getScriptText } from "./scripts";
import { bechdel } from "./llm";
import puppeteer, { Browser } from "puppeteer";
import { marked } from "marked";
import * as path from "path";
import PQueue from "p-queue";
import chalk from "chalk";
import { applyBechdelTest } from "./bechdel";

const port = process.env.PORT ?? 3333;

(async () => {
    deletePngFiles("/data");

    const app = express();
    app.set("json spaces", 2);
    app.use(cors());
    app.use(compression());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.get("/api/hello", (req, res) => {
        res.json({ message: "Hello world" });
    });

    app.get("/api/script", async (req, res) => {
        const search = req.query.s;
        if (!search || typeof search != "string") {
            res.status(400);
            return;
        }
        try {
            res.send(await getScriptText(search));
        } catch (e) {
            res.status(500).json(e);
        }
    });

    app.get("/api/clear", async (req, res) => {
        deletePngFiles("/data");
        res.send("OK");
    });

    app.get("/api/bechdel", async (req, res) => {
        const search = req.query.s;
        if (!search || typeof search != "string") {
            res.status(400);
            return;
        }
        try {
            const result = await applyBechdelTest(search);
            res.setHeader("Content-Type", "image/png");
            res.send(Buffer.from(result.png));
        } catch (e) {
            res.status(500).json(e);
        }
    });

    const server = http.createServer(app);
    server.listen(port, async () => {
        console.log(`App listening on port ${port}`);
    });

    setupLiveReload(server);
    startBots();
    startAutoblocklists();
})();

function setupLiveReload(server: http.Server) {
    const wss = new WebSocketServer({ server });
    const clients: Set<WebSocket> = new Set();
    wss.on("connection", (ws: WebSocket) => {
        clients.add(ws);
        ws.on("close", () => {
            clients.delete(ws);
        });
    });

    chokidar.watch("html/", { ignored: /(^|[\/\\])\../, ignoreInitial: true }).on("all", (event, path) => {
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(`File changed: ${path}`);
            }
        });
    });
    console.log("Initialized live-reload");
}

function deletePngFiles(dir: string): void {
    try {
        // Check if directory exists
        if (!fs.existsSync(dir)) {
            console.log(`Directory ${dir} does not exist`);
            return;
        }

        // Read all files in the directory
        const files = fs.readdirSync(dir);

        // Filter and delete PNG files
        const pngFiles = files.filter((file) => path.extname(file).toLowerCase() === ".png");

        if (pngFiles.length === 0) {
            console.log("No PNG files found");
            return;
        }

        pngFiles.forEach((file) => {
            const filePath = path.join(dir, file);
            fs.unlinkSync(filePath);
            console.log(`Deleted: ${filePath}`);
        });

        console.log(`Successfully deleted ${pngFiles.length} PNG file(s)`);
    } catch (error) {
        console.error("Error deleting PNG files:", error);
    }
}
