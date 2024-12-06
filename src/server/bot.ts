import chalk from "chalk";
import { AppBskyFeedDefs, AppBskyFeedPost, AtpAgent, AtpSessionData } from "@atproto/api";
import { Jetstream } from "@skyware/jetstream";
import WebSocket from "ws";
import fs from "fs/promises";
import path from "path";
import { pickQuote } from "./llm";

export interface ImageInfo {
    path: string;
    alt: string;
}

export interface QuotesAndImages {
    quotes?: string[];
    images: ImageInfo[];
}

export type BotConfig = {
    account: string;
    password: string;
    configFile: string;
};

export type Bot = {
    agent: AtpAgent;
    config: BotConfig;
    lastImageIndex: number;
};

export type ServiceConfig = {
    bots: BotConfig[];
    autoblocker: {
        account: string;
        password: string;
    };
};

export const bots: Bot[] = [];

export async function getPostThread(agent: AtpAgent, botHandle: string, postUri: string): Promise<Array<{ text: string; uri: string }>> {
    const thread: Array<{ text: string; uri: string }> = [];

    async function fetchPost(uri: string): Promise<void> {
        try {
            const response = await agent.app.bsky.feed.getPostThread({ uri });

            if (!AppBskyFeedDefs.isThreadViewPost(response.data.thread)) {
                throw new Error("Invalid thread view");
            }

            const post = response.data.thread.post;

            if (!AppBskyFeedPost.isRecord(post.record)) {
                throw new Error("Invalid post record");
            }

            if (response.data.thread.post.author.handle != botHandle) {
                thread.unshift({
                    text: post.record.text,
                    uri: post.uri,
                });
            }

            // Check if this post is a reply
            if (post.record.reply) {
                const parentUri = post.record.reply.parent.uri;
                await fetchPost(parentUri);
            }
        } catch (error) {
            console.error("Error fetching post:", error);
            throw error;
        }
    }

    await fetchPost(postUri);
    return thread;
}

async function replyWithRandomImage(
    bot: Bot,
    replyTo: {
        did: string;
        cid: string;
        rkey: string;
        record: { reply?: { root: { uri: string; cid: string } } };
    }
) {
    try {
        const configJson = await fs.readFile(path.join("images", bot.config.configFile), "utf-8");
        const quotesAndImages = JSON.parse(configJson) as QuotesAndImages;
        bot.lastImageIndex = (bot.lastImageIndex + 1) % quotesAndImages.images.length;
        const randomImage = quotesAndImages.images[bot.lastImageIndex];
        const imageData = await fs.readFile(path.join("images", randomImage.path));

        const uploadResponse = bot.agent.api.com.atproto.repo.uploadBlob(imageData, {
            encoding: "image/jpeg",
        });

        let quote = "";
        if (quotesAndImages.quotes) {
            try {
                const threadResponse = getPostThread(
                    new AtpAgent({ service: "https://public.api.bsky.app" }),
                    bot.config.account,
                    `at://${replyTo.did}/app.bsky.feed.post/${replyTo.rkey}`
                );
                Promise.all([uploadResponse, threadResponse]);
                quote = await pickQuote(
                    quotesAndImages.quotes,
                    (
                        await threadResponse
                    )
                        .reverse()
                        .slice(0, 5)
                        .map((p) => p.text)
                        .join("\n\n")
                );
            } catch (e) {
                console.log("Could not pick quote", e);
            }
        } else {
            await uploadResponse;
        }

        const root = replyTo.record.reply?.root ?? {
            uri: `at://${replyTo.did}/app.bsky.feed.post/${replyTo.rkey}`,
            cid: replyTo.cid,
        };

        await bot.agent.post({
            text: quote ? `"${quote}"` : "",
            reply: {
                root: root,
                parent: {
                    uri: `at://${replyTo.did}/app.bsky.feed.post/${replyTo.rkey}`,
                    cid: replyTo.cid,
                },
            },
            embed: {
                $type: "app.bsky.embed.images",
                images: [
                    {
                        alt: randomImage.alt,
                        image: (await uploadResponse).data.blob,
                    },
                ],
            },
        });

        console.log(chalk.green(`Posted reply with image: ${randomImage.path} for bot ${bot.config.account}`));
    } catch (error) {
        console.error(chalk.red(`Error posting image reply for bot ${bot.config.account}:`), error);
    }
}

const tokenFile = (botConfig: BotConfig | ServiceConfig["autoblocker"]) => "images/" + botConfig.account + ".json";

async function saveSession(botConfig: BotConfig | ServiceConfig["autoblocker"], session: AtpSessionData) {
    try {
        await fs.writeFile(tokenFile(botConfig), JSON.stringify(session, null, 2));
        console.log(chalk.green(`Session saved successfully for bot ${botConfig.account}`));
    } catch (error) {
        console.error(chalk.yellow(`Failed to save session for bot ${botConfig.account}`), error);
    }
}

async function loadSession(botConfig: BotConfig | ServiceConfig["autoblocker"]): Promise<AtpSessionData | null> {
    try {
        const data = await fs.readFile(tokenFile(botConfig), "utf-8");
        return JSON.parse(data) as AtpSessionData;
    } catch (error) {
        console.log(chalk.yellow(`No saved session found for bot ${botConfig.account}`));
        return null;
    }
}

export async function login(botConfig: BotConfig | ServiceConfig["autoblocker"]) {
    const agent = new AtpAgent({
        service: "https://bsky.social",
        persistSession: (evt, session) => {
            if (session) {
                saveSession(botConfig, session);
                console.log(chalk.green("Session refreshed and saved"));
            }
        },
    });

    try {
        const savedSession = await loadSession(botConfig);
        if (savedSession) {
            try {
                console.log(chalk.magenta("Loggin via saved session"));
                await agent.resumeSession(savedSession);
                console.log(chalk.green("Session resumed with saved data"));
            } catch (error) {
                console.log(chalk.yellow("Saved session expired, logging in again"));
                const response = await agent.login({
                    identifier: botConfig.account,
                    password: botConfig.password,
                });
                await saveSession(botConfig, { ...response.data, active: true });
            }
        } else {
            console.log(chalk.magenta("Loggin in with handle + password"));
            const response = await agent.login({
                identifier: botConfig.account,
                password: botConfig.password,
            });
            await saveSession(botConfig, { ...response.data, active: true });
        }
    } catch (e) {
        console.error(chalk.red(`Could not log into bot account ${botConfig.account}`), e);
        throw new Error("Could not log into bot account");
    }

    console.log(chalk.green(`Logged into bot account ${botConfig.account}`));
    return agent;
}

export async function startBots() {
    try {
        const configs = (JSON.parse(process.env.CONFIG ?? "") as ServiceConfig).bots;
        for (const config of configs) {
            const agent = await login(config);
            bots.push({ agent, config, lastImageIndex: -1 });
        }
    } catch (e) {
        console.error(chalk.red("Could not parse config", process.env.CONFIG));
        throw new Error("Could not parse config");
    }

    const run = (cursor?: number) => {
        console.log(chalk.magenta("Connecting to firehose"));
        const jetstream = new Jetstream({ ws: WebSocket, cursor });
        jetstream.onCreate("app.bsky.feed.post", async (event) => {
            const record = event.commit.record as {
                text: string;
                $type: string;
                facets?: Array<{ features: Array<{ did: string; $type: string }> }>;
            };
            if (record.$type !== "app.bsky.feed.post") return;

            if (record.facets) {
                for (const facet of record.facets) {
                    for (const feature of facet.features) {
                        if (feature.$type === "app.bsky.richtext.facet#mention") {
                            for (const bot of bots) {
                                if (feature.did === bot.agent.session?.did) {
                                    const postUrl = `https://bsky.app/profile/${event.did}/post/${event.commit.rkey}`;
                                    console.log(chalk.magenta(`Bot ${bot.config.account} was mentioned in post: ${postUrl}`));
                                    await replyWithRandomImage(bot, {
                                        did: event.did,
                                        cid: event.commit.cid,
                                        rkey: event.commit.rkey,
                                        record: event.commit.record as any,
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });
        jetstream.on("error", (error: Error, cursor) => {
            console.error(chalk.red("Firehose interrupted, retrying in 10 seconds"), error);
            setTimeout(() => {
                console.log(chalk.magenta("Retrying to connect to firehose"));
                run();
            }, 10000);
            jetstream.close();
        });
        console.log(chalk.green("Starting Jetstream"));
        jetstream.start();
    };
    run();
}
