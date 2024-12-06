import chalk from "chalk";
import { getPostThread, QuotesAndImages } from "../bot";
import { pickQuote } from "../llm";
import * as fs from "fs";
import { AtpAgent } from "@atproto/api";

const posts = [
    "Max Lercher wird neuer steirischer Bundesparteiobmann",
    "Ich bin der Meinung, dass der @kreiskybot.bsky.social…",
    `Wie geht's dem @kreiskybot.bsky.social heute?`,
    `Jetzt muss ich das auch ausprobieren @kreiskybot.bsky.social`,
    `Aja @kreiskybot.bsky.social?`,
    `@kreiskybot.bsky.social geht's dir gut?`,
    `Statt „Kein weiter wie bisher“: ÖVP, SPÖ und Neos einigen sich auf „Bisher kein weiter“ dietagespresse.com/statt-kein-w... Das hätte der @kreiskybot.bsky.social noch erleben sollen.`,
    `Es ist Zeit für eine Neue Rote.

Gehen wir gemeinsam ein Stück des Weges Richtung einer Sozialdemokratie, auf wir alle in Österreich stolz sein können.

Macht mit auf neuerote.at!

Oh Rudi...
@kreiskybot.bsky.social`,
];

async function main() {
    const quotes = (JSON.parse(fs.readFileSync("images/kreisky.json", "utf-8")) as QuotesAndImages).quotes;

    if (!quotes) {
        console.error("Could not parse quotes.");
        process.exit(-1);
    }

    const agent = new AtpAgent({
        service: "https:/public.api.bsky.app",
    });
    const thread = await getPostThread(agent, "at://badlogictest.bsky.social/app.bsky.feed.post/3lcodzlf4ls2d");

    for (const post of posts) {
        const quote = await pickQuote(
            quotes?.map((q) => q.text),
            post
        );
        console.log(chalk.green(`Post: ${post}`));
        console.log(chalk.magenta(`Quote: ${quote}`));
    }
}

main();
