import { marked } from "marked";
import PQueue from "p-queue";
import puppeteer, { Browser } from "puppeteer";
import * as fs from "fs";
import { getScriptText } from "./scripts";
import { bechdel } from "./llm";
import chalk from "chalk";

let browserInstance: Browser | null = null;
const queue = new PQueue({ concurrency: 2 });

["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
    process.on(signal, async () => {
        console.log(chalk.gray(`Shuttin down browser instance`));
        await browserInstance?.close();
        process.exit();
    });
});

async function ensureBrowser(): Promise<Browser> {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        browserInstance.on("disconnected", () => {
            browserInstance = null;
        });
    }
    return browserInstance;
}

export async function generateScreenshot(html: string): Promise<Uint8Array> {
    const result = await queue.add(async () => {
        const browser = await ensureBrowser();
        const page = await browser.newPage();

        try {
            await page.setContent(html);
            const screenshot = await page.screenshot({
                fullPage: true,
            });
            if (!screenshot) {
                throw new Error("Screenshot generation failed");
            }
            return screenshot;
        } finally {
            await page.close();
        }
    });

    if (!result) {
        throw new Error("Screenshot generation was cancelled");
    }

    return result;
}

export async function applyBechdelTest(search: string) {
    console.log(chalk.green(`Applying Bechdel Test to query "${search}"`));
    const script = await getScriptText(search);
    console.log(chalk.grey(`Got script ${script.scriptUrl}.`));

    const pngFile = "/data/" + script.id + ".png";
    const mdFile = "/data/" + script.id + ".md";
    let png: Uint8Array;
    let markdown: string;

    if (fs.existsSync(pngFile) && fs.existsSync(mdFile)) {
        markdown = fs.readFileSync(mdFile, "utf-8");
        png = fs.readFileSync(pngFile);
        console.log(chalk.gray(`Returning cached test results.`));
    } else {
        markdown = await bechdel(script);
        const html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                line-height: 1.6;
                                max-width: 800px;
                                margin: 40px auto;
                                padding: 0 20px;
                                color: #333;
                            }
                            h1, h2, h3 { color: #111; }
                            pre, code {
                                background: #f5f5f5;
                                padding: 2px 5px;
                                border-radius: 3px;
                            }
                            pre { padding: 1em; }
                            blockquote {
                                border-left: 4px solid #ddd;
                                margin: 0;
                                padding-left: 1em;
                                color: #666;
                            }
                        </style>
                    </head>
                    <body>
                        ${marked(markdown)}
                    </body>
                    </html>
                `;

        png = await generateScreenshot(html);
        fs.writeFileSync(mdFile, markdown, "utf-8");
        fs.writeFileSync(pngFile, png);
        console.log(chalk.gray(`Returning fresh test results.`));
    }
    return { png, markdown };
}
