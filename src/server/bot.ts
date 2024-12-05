import chalk from "chalk";
import { AtpAgent, AtpSessionData } from "@atproto/api";
import { Jetstream } from "@skyware/jetstream";
import WebSocket from "ws";
import fs from "fs/promises";
import path from "path";

const TOKENS_FILE = "tokens.json";

interface ImageInfo {
    path: string;
    alt: string;
}

let lastImageIndex = -1;  // Start at -1 so first increment goes to 0

async function replyWithRandomImage(agent: AtpAgent, replyTo: {
    did: string,
    cid: string,
    rkey: string,
    record: { reply?: { root: { uri: string, cid: string } } }
}) {
    try {
        const imagesJson = await fs.readFile(path.join("images", "images.json"), "utf-8");
        const images = JSON.parse(imagesJson) as ImageInfo[];
        lastImageIndex = (lastImageIndex + 1) % images.length;
        const randomImage = images[lastImageIndex];
        const imageData = await fs.readFile(path.join("images", randomImage.path));

        const uploadResponse = await agent.api.com.atproto.repo.uploadBlob(imageData, {
            encoding: "image/jpeg",
        });

        const root = replyTo.record.reply?.root ?? {
            uri: `at://${replyTo.did}/app.bsky.feed.post/${replyTo.rkey}`,
            cid: replyTo.cid
        };

        await agent.post({
            text: "",
            reply: {
                root: root,
                parent: {
                    uri: `at://${replyTo.did}/app.bsky.feed.post/${replyTo.rkey}`,
                    cid: replyTo.cid
                }
            },
            embed: {
                $type: "app.bsky.embed.images",
                images: [{
                    alt: randomImage.alt,
                    image: uploadResponse.data.blob
                }]
            }
        });

        console.log(chalk.green(`Posted reply with image: ${randomImage.path}`));
    } catch (error) {
        console.error(chalk.red("Error posting image reply:"), error);
    }
}

async function saveSession(session: AtpSessionData) {
    try {
        await fs.writeFile(TOKENS_FILE, JSON.stringify(session, null, 2));
        console.log(chalk.green("Session saved successfully"));
    } catch (error) {
        console.error(chalk.yellow("Failed to save session"), error);
    }
}

async function loadSession(): Promise<AtpSessionData | null> {
    try {
        const data = await fs.readFile(TOKENS_FILE, "utf-8");
        return JSON.parse(data) as AtpSessionData;
    } catch (error) {
        console.log(chalk.yellow("No saved session found"));
        return null;
    }
}

export async function startBot() {
    const account = process.env.ACCOUNT;
    const password = process.env.PASSWORD;

    if (!account || !password) {
        console.error(chalk.red("ACCOUNT and/or PASSWORD not set."));
        process.exit(0);
        return;
    }

    const agent = new AtpAgent({
        service: "https://bsky.social",
        persistSession: (evt, session) => {
            if (session) {
                saveSession(session);
                console.log(chalk.green("Session refreshed and saved"));
            }
        },
    });

    try {
        const savedSession = await loadSession();
        if (savedSession) {
            try {
                console.log(chalk.magenta("Loggin via saved session"));
                await agent.resumeSession(savedSession);
                console.log(chalk.green("Session resumed with saved data"));
            } catch (error) {
                console.log(chalk.yellow("Saved session expired, logging in again"));
                const response = await agent.login({
                    identifier: account,
                    password,
                });
                await saveSession({ ...response.data, active: true });
            }
        } else {
            console.log(chalk.magenta("Loggin in with handle + password"));
            const response = await agent.login({
                identifier: account,
                password,
            });
            await saveSession({ ...response.data, active: true });
        }
    } catch (e) {
        console.error(chalk.red("Could not log into bot account"), e);
        process.exit(1);
    }

    console.log(chalk.green("Logged into bot account"));

    const run = (cursor?: number) => {
        const jetstream = new Jetstream({ ws: WebSocket, cursor });
        jetstream.onCreate("app.bsky.feed.post", async (event) => {
            const record = event.commit.record as { text: string, $type: string, facets?: Array<{ features: Array<{ did: string, $type: string }> }> };

            if (record.$type !== "app.bsky.feed.post") {
                return;
            }

            if (record.facets) {
                for (const facet of record.facets) {
                    for (const feature of facet.features) {
                        if (feature.$type === "app.bsky.richtext.facet#mention" &&
                            feature.did === agent.session?.did) {
                            const postUrl = `https://bsky.app/profile/${event.did}/post/${event.commit.rkey}`;
                            console.log(chalk.magenta(`Bot was mentioned in post: ${postUrl}`));
                            await replyWithRandomImage(agent, {
                                did: event.did,
                                cid: event.commit.cid,
                                rkey: event.commit.rkey,
                                record: event.commit.record as any
                            });
                            break;
                        }
                    }
                }
            }
        });
        jetstream.on("error", (error: Error, cursor) => {
            console.error(chalk.red("Firehose interrupted, retrying in 10 seconds"), error);
            jetstream.close();
            setTimeout(() => {
                console.log(chalk.magenta("Retrying to connect to firehose"));
                run();
            }, 10000);
        });
        console.log(chalk.green("Starting Jetstream"));
        jetstream.start();
    };
    run();
}
