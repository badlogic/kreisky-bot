import TTLCache from "@isaacs/ttlcache";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

export interface PostRecord {
    $type: "app.bsky.feed.post";
    langs?: string[];
    reply?: {
        parent: { cid: string; uri: string };
        root: { cid: string; uri: string };
    };
    text: string;
}

export interface FollowRecord {
    $type: "app.bsky.graph.follow";
    subject: string;
}

export interface LikeRecord {
    $type: "app.bsky.feed.like";
    subject: {
        cid: string;
        uri: string;
    };
}

export interface BlockRecord {
    $type: "app.bsky.graph.block";
    subject: string;
}

export interface RepostRecord {
    $type: "app.bsky.feed.repost";
    subject: {
        cid: string;
        uri: string;
    };
}

export interface CommitEvent {
    did: string;
    kind: string;
    time_us: number;
    commit: {
        cid: string;
        rev: string;
        collection: string;
        rkey: string;
    } & {
        operation: "create";
        record: { createdAt: string } & (PostRecord | FollowRecord);
    };
}

export interface JetstreamMessage {
    kind: "commit" | "account" | "identity";
}

export class JetstreamBrowser {
    socket?: WebSocket;
    errorCb: () => void = () => {};
    commitCb: (data: any) => void = () => {};

    onError(cb: () => void) {
        this.errorCb = cb;
    }

    onCommit(cb: (data: CommitEvent) => void) {
        this.commitCb = cb;
    }

    start(collections: string[] = []) {
        const url = `wss://jetstream1.us-east.bsky.network/subscribe?${
            collections.length > 0 ? collections.map((c) => "wantedCollections=" + c).join("&") + "" : ""
        }`;
        this.socket = new WebSocket(url);
        this.socket.onerror = () => this.errorCb();
        this.socket.onmessage = (ev) => {
            const msg = JSON.parse(ev.data) as JetstreamMessage;
            if (msg.kind == "commit") this.commitCb(msg);
        };
    }
}

@customElement("frequent-posters")
export class FrequentPosters extends LitElement {
    accounts = new TTLCache<string, { url: string; posts: number; lastText: string; trackingStart: number }>({ max: 10000, ttl: 60000 });
    lastUpdate = performance.now();
    constructor() {
        super();
        const jetstream = new JetstreamBrowser();
        jetstream.onError(() => console.error("ERROR"));
        jetstream.onCommit((data) => {
            if (data.commit.operation != "create") return;
            const record = data.commit.record;
            if (record.$type != "app.bsky.feed.post") return;

            const account = this.accounts.get(data.did) ?? {
                url: `https://bsky.app/profile/${data.did}`,
                posts: 0,
                lastText: record.text,
                trackingStart: performance.now(),
            };
            this.accounts.set(data.did, { ...account, posts: account.posts + 1, lastText: record.text });
            if (performance.now() - this.lastUpdate > 1000) {
                this.requestUpdate();
            }
        });
        jetstream.start(["app.bsky.feed.post"]);
    }

    protected createRenderRoot() {
        return this;
    }

    render() {
        this.lastUpdate = performance.now();
        const sorted = [...this.accounts.entries()];
        sorted.sort((a, b) => b[1].posts - a[1].posts);
        return html`<div class="mx-auto w-full h-full max-w-[600px] flex flex-col p-8 gap-4">
            <h1 class="mx-auto text-3xl">Twitter Sync or Bot?</h1>
            <div class="text-gray-600">
                Let's detect potential bots by tracking rapid posting patterns. Here's how it works: When an account makes their first post after you
                load the page, we start watching them. If they post again within 60 seconds, they stay on our watch list. If they don't post within 60
                seconds, they're removed.
            </div>
            <div class="text-gray-600">
                If accounts stay on this list for a long time, it means they're posting very frequently - potentially too frequently to be human.
            </div>
            <div class="text-gray-600">Some possible explanations:</div>
            <ul class="text-gray-600 space-y-2 list-disc pl-5">
                <li class="leading-relaxed">They are synching their Twitter feed to Bluesky.</li>
                <li class="leading-relaxed">They have composed a long thread and posted it all at once.</li>
                <li class="leading-relaxed">...</li>
                <li class="leading-relaxed">They are a bot.</li>
            </ul>
            <div class="text-gray-600">Click on the blue links to view the account. Check both their "Posts" and "Replies" tab.</div>
            <span class="text-red-400 font-bold">Caution: some of these may be NSFW/NSFL!</span>
            <div class="text-lg"><span class="font-bold">${sorted.length}</span> accounts have posted in the past 60 seconds</div>
            ${sorted
                .filter((a) => a[0] != "did:plc:xnqqfsdaptlj57lnhc2br4tl")
                .slice(0, 200)
                .map((a) => {
                    const trackedSince = (performance.now() - a[1].trackingStart) / 1000;
                    return html`<div class="flex flex-col border border-gray-300 rounded-lg shadow-md p-8">
                        <a href="${a[1].url}" target="_blank" class="text-blue-500">${a[0]}</a>
                        <div class="text-gray-500">
                            <div>Listed for <span class="text-black font-bold">${trackedSince.toFixed(0)}</span> seconds</div>
                            <div><span class="text-black font-bold">${a[1].posts}</span> posts since listed</div>
                            <div><span class="text-black font-bold">${(a[1].posts / (trackedSince / 60)).toFixed(0)}</span> posts / minute</div>
                        </div>
                        <span class="font-bold">Last post</span>
                        <div class="break-words text-gray-600">${a[1].lastText}</div>
                    </div>`;
                })}
        </div>`;
    }
}
