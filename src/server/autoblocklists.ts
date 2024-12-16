import chalk from "chalk";
import { login, ServiceConfig } from "./bot";
import { AtpAgent } from "@atproto/api";
import { Repo } from "@atproto/api/dist/client/types/com/atproto/sync/listRepos";

async function didsVanillaskyClick() {
    try {
        const vanillaAgent = new AtpAgent({
            service: "https://vanillasky.click",
        });
        const repos: Repo[] = [];
        console.log(chalk.blue("Fetching repos..."));
        let cursor: string | undefined = undefined;
        do {
            const resp = await vanillaAgent.com.atproto.sync.listRepos({ cursor });
            if (resp.success != true) {
                console.error(chalk.red("Could not fetch repos"));
                process.exit(-1);
            }
            console.log(chalk.gray(`Fetched repo page (${repos.length} repos so far)`));
            repos.push(...resp.data.repos);
            cursor = resp.data.cursor;
        } while (cursor);

        console.log(chalk.green(`Found ${repos.length} total accounts`));

        return repos.map((r) => r.did);
    } catch (e) {
        console.error(chalk.red("Could not fetch dids from vanillasky.click"), e);
        return [];
    }
}

export async function saveBlocklist(agent: AtpAgent, dids: string[]) {
    try {
        const lists = await agent.app.bsky.graph.getLists({ actor: agent.session?.did! });
        let blocklistUri = lists.data.lists.find((list) => list.name === "Auto Blocklist")?.uri;

        if (!blocklistUri) {
            console.log(chalk.blue("Creating new Auto Blocklist..."));
            const created = await agent.app.bsky.graph.list.create(
                { repo: agent.session?.did! },
                {
                    name: "Auto Blocklist",
                    purpose: "app.bsky.graph.defs#modlist",
                    description: "Automatically maintained blocklist",
                    createdAt: new Date().toISOString(),
                }
            );
            blocklistUri = created.uri;
        }

        const currentBlocks = new Set<string>();
        let cursor: string | undefined;
        do {
            const items = await agent.app.bsky.graph.getList({
                list: blocklistUri,
                cursor,
            });
            items.data.items.forEach((item) => currentBlocks.add(item.subject.did));
            cursor = items.data.cursor;
        } while (cursor);

        const newDids = dids.filter((did) => !currentBlocks.has(did));
        const BATCH_SIZE = 100;
        console.log(chalk.blue(`Adding ${newDids.length} new blocks...`));

        for (let i = 0; i < newDids.length; i += BATCH_SIZE) {
            const batch = newDids.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map((did) =>
                    agent.app.bsky.graph.listitem
                        .create(
                            { repo: agent.session?.did! },
                            {
                                subject: did,
                                list: blocklistUri,
                                createdAt: new Date().toISOString(),
                            }
                        )
                        .catch((e) => {
                            console.error(chalk.yellow(`Failed to block ${did}`), e);
                        })
                )
            );
            console.log(chalk.gray(`Added ${i + batch.length}/${newDids.length} blocks`));
        }

        console.log(chalk.green(`Successfully updated Auto Blocklist with ${newDids.length} new blocks`));
    } catch (e) {
        console.error(chalk.red("Failed to save blocklist"), e);
        throw e;
    }
}

export async function startAutoblocklists() {
    return;
    const update = async () => {
        const blocker = (JSON.parse(process.env.CONFIG ?? "") as ServiceConfig).autoblocker;
        const agent = await login(blocker);

        console.log(chalk.magenta("Updating auto block lists"));
        try {
            const dids: string[] = [];
            dids.push(...(await didsVanillaskyClick()));

            saveBlocklist(agent, dids);
        } catch (e) {
            console.error(chalk.red("Could not update block list"), e);
        }
        setTimeout(update, 60000 * 15);
    };

    update();
}
