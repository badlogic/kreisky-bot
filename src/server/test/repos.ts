import { AtpAgent } from "@atproto/api";
import { Repo } from "@atproto/api/dist/client/types/com/atproto/sync/listRepos";
import chalk from "chalk";
import { ServiceConfig } from "../bot";
import { appendFileSync } from "fs";
import * as fs from "fs";
import { sleep } from "../../utils/utils";
import { ProfileViewDetailed } from "@atproto/api/dist/client/types/app/bsky/actor/defs";

function appendJsonLine<T extends object>(filePath: string, data: T[]): void {
    try {
        const jsonLine = data.map((o) => JSON.stringify(o)).join("\n");
        appendFileSync(filePath, jsonLine, { encoding: "utf8" });
    } catch (error) {
        throw new Error(`Failed to append JSONL: ${error instanceof Error ? error.message : String(error)}`);
    }
}

interface RateLimit {
    limit: number;
    remaining: number;
    reset: number;
}

async function resolveProfiles(agent: AtpAgent, dids: string[], reqs: { reqs: number; errs: number }): Promise<Map<string, ProfileViewDetailed>> {
    const BATCH_SIZE = 25;
    const MAX_CONCURRENT = 5; // Limit concurrent requests
    const MIN_DELAY = 50; // Minimum delay between requests in ms
    const handleMap = new Map<string, ProfileViewDetailed>();
    let rateLimit: RateLimit = { limit: 3000, remaining: 3000, reset: 0 };

    try {
        const batches: string[][] = [];
        for (let i = 0; i < dids.length; i += BATCH_SIZE) {
            batches.push(dids.slice(i, i + BATCH_SIZE));
        }

        for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
            const currentBatches = batches.slice(i, i + MAX_CONCURRENT);

            if (rateLimit.remaining <= currentBatches.length) {
                const now = Date.now() / 1000;
                if (rateLimit.reset > now) {
                    const waitTime = (rateLimit.reset - now) * 1000;
                    console.log(`Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
                    await sleep(waitTime);
                }
            }

            const batchResults = await Promise.all(
                currentBatches.map(async (batch, index) => {
                    // Add delay between requests within concurrent batch
                    await sleep(index * MIN_DELAY);

                    try {
                        reqs.reqs++;
                        const response = await agent.app.bsky.actor.getProfiles({ actors: batch });

                        // Update rate limit info from headers
                        if (response.headers) {
                            rateLimit = {
                                limit: parseInt(response.headers["ratelimit-limit"] || "3000"),
                                remaining: parseInt(response.headers["ratelimit-remaining"] || "0"),
                                reset: parseInt(response.headers["ratelimit-reset"] || "0"),
                            };
                        }

                        return response.data.profiles;
                    } catch (error: any) {
                        if (error.status === 429) {
                            // Too Many Requests
                            // Extract rate limit info from error headers
                            if (error.headers) {
                                rateLimit = {
                                    limit: parseInt(error.headers["ratelimit-limit"] || "3000"),
                                    remaining: parseInt(error.headers["ratelimit-remaining"] || "0"),
                                    reset: parseInt(error.headers["ratelimit-reset"] || "0"),
                                };
                            }
                            console.error("Rate limit exceeded:", error);
                        } else {
                            console.error(`Error processing batch:`, error);
                        }
                        reqs.errs++;
                        return []; // Return empty array for failed batch
                    }
                })
            );

            // Add successful results to map
            batchResults.flat().forEach((profile) => {
                if (profile) {
                    handleMap.set(profile.did, profile);
                }
            });

            // Small delay between concurrent batches
            await sleep(MIN_DELAY);
        }

        return handleMap;
    } catch (error) {
        console.error("Error in resolveProfiles:", error);
        reqs.errs++;
        return handleMap;
    }
}

// @ts-ignore
import pdsData from "./pds.json";

type PDSConfig = {
    pdses: {
        [url: string]: {
            inviteCodeRequired: boolean;
            version: string;
        };
    };
};

const pdsList: PDSConfig = pdsData;

async function main() {
    const botConfig = (JSON.parse(process.env.KREISKYBOT_CONFIG!) as ServiceConfig).autoblocker;
    const agent = new AtpAgent({
        service: "https://bsky.social",
    });
    await agent.login({
        identifier: botConfig.account,
        password: botConfig.password,
    });

    const pdsUrls: string[] = [];
    for (const pds in pdsList.pdses) {
        if (pds == "https://bsky.social") continue;
        pdsUrls.push(pds);
    }

    pdsUrls.sort((a, b) => (b.includes("bsky.network") ? 1 : -1));

    let cursor: string | undefined;
    let repos = 0;
    let suspended = 0;
    let errors = 0;
    let reqs = 0;
    let pdsIndex = 0;

    if (fs.existsSync("profiles-cursor.json")) {
        const saved = JSON.parse(fs.readFileSync("profiles-cursor.json", "utf-8")) as any;
        cursor = saved.cursor;
        repos = saved.repos;
        suspended = saved.suspended;
        errors = saved.errors;
        reqs = saved.reqs;
        pdsIndex = saved.pdsIndex || 0;
    }

    for (; pdsIndex < pdsUrls.length; pdsIndex++) {
        const pds = pdsUrls[pdsIndex];
        const pdsAgent = new AtpAgent({ service: pds });
        console.log(chalk.magenta("Fetching repos from PDS " + pds));
        do {
            const start = performance.now();
            const resp = await pdsAgent.com.atproto.sync.listRepos({ cursor });
            if (!resp.success) {
                console.error(chalk.red("Could not fetch repos page, sleeping for 5 seconds"));
                await sleep(5000);
                continue;
            }
            reqs++;
            repos += resp.data.repos.length;
            const active = resp.data.repos.filter((r) => {
                if (!r.active) {
                    suspended++;
                    return false;
                }
                return true;
            });
            const requests = { reqs: 0, errs: 0 };
            const resolved = await resolveProfiles(
                agent,
                active.map((r) => r.did),
                requests
            );
            reqs += requests.reqs;
            const lastErrors = errors;
            errors += requests.errs;
            if (errors != lastErrors) {
                console.log(chalk.red("Quitting due to error. Inspect and resume manually."));
                process.exit(-1);
            }
            appendJsonLine(
                "profiles.jsonl",
                [...resolved.entries()]
                    .map((e) => e[1])
                    .map((p) => {
                        return {
                            pds,
                            did: p.did,
                            handle: p.handle,
                            displayName: p.displayName,
                            createdAt: p.createdAt,
                            indexedAt: p.indexedAt,
                            description: p.description,
                            followers: p.followersCount,
                            following: p.followsCount,
                            posts: p.postsCount,
                        };
                    })
            );
            cursor = resp.data.cursor;
            if (cursor) {
                fs.writeFileSync("profiles-cursor.json", JSON.stringify({ cursor, repos, suspended, errors, reqs, pdsIndex }, null, 2), "utf-8");
            }
            const took = (performance.now() - start) / 1000;
            console.log(
                chalk.gray(
                    `Fetched ${repos} repos, ${suspended} suspended, ${errors} errors, ${(resp.data.repos.length / took).toFixed(0)} repos / sec, ${(
                        (requests.reqs + 1) /
                        took
                    ).toFixed(0)} reqs / sec`
                )
            );
        } while (cursor);
        cursor = undefined;
    }
    console.log(chalk.red("Done"));
}

main();
