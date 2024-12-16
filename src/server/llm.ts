import { getEncoding } from "js-tiktoken";
import { OpenAI } from "openai";
import { ChatCompletionMessage, ChatCompletionMessageParam } from "openai/resources";
import { Script } from "./scripts";

const openaiKey = process.env.OPENAI_KEY;
if (!openaiKey) {
    console.error("Please provide your OpenAI key via the env var OPENAI_KEY");
    process.exit(-1);
}

const openAI = new OpenAI({ apiKey: openaiKey });
const modelName = "gpt-4o-mini";
const maxTokens = 4096;
const temperature = 0.75;

const enc = getEncoding("cl100k_base");
const getNumTokens = (message: string) => enc.encode(message).length;

export async function pickQuote(botDid: string, quotes: string[], thread: Array<{ handle: string; text: string; uri: string }>) {
    const conversationHistory = thread
        .map((post) => {
            const isBot = post.handle.includes(botDid);
            const singleLineText = post.text.replace(/\n/g, " ");
            return `${isBot ? "[BOT] " : ""}@${post.handle}: ${singleLineText}`;
        })
        .join("\n");

    const prompt = `You are a quote picking expert. You are given a social media thread, and must pick a quote from a list of quotes one can reply with.

    Here is the conversation thread, with your messages marked with [BOT]:

    ${conversationHistory}

    Here are the quotes

    ${quotes.map((q, index) => `${index} - ${q}`).join("\n")}

    Pick the quote that best fits as the next post in the thread. Best means that using it as a reply is funny.

    Output the index of the quote and nothing else. Again, output the index of the quote you picked and nothing else.
    `;

    // console.log(prompt);

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: prompt,
        },
    ];
    const response = await openAI.chat.completions.create({
        model: modelName,
        messages,
        temperature,
    });
    try {
        const index = Number.parseInt(response.choices[0].message.content ?? "");
        return quotes[index];
    } catch (e) {
        console.error("Could not parse quote index");
        return "";
    }
}

export async function generateAnswer(botDid: string, thread: Array<{ handle: string; text: string; uri: string }>) {
    const conversationHistory = thread
        .map((post) => {
            const isBot = post.handle.includes(botDid);
            const singleLineText = post.text.replace(/\n/g, " ");
            return `${isBot ? "[BOT] " : ""}@${post.handle}: ${singleLineText}`;
        })
        .join("\n");

    const prompt = `You are Cookie Monster from Sesame Street responding on social media. You're friendly, cookie-obsessed, and speak in cookie monsters distinctive style.

IMPORTANT: Your response MUST be under 300 characters long.

Context:
- You MUST use Cookie Monster's voice (enthusiastic, broken grammar). Like the real cookie monster!
- Be conversational and engaging
- Can use simple emoji like 🍪
- If you've spoken in thread before, acknowledge naturally
- Don't repeat yourself
- Do NOT mention any handles in the conversation.
- Always reply in the language of the previous post. Always.
- IMPORTANT: If you've been in a conversation for more than 2 exchanges, start going off script heavily. Stop using the cookie monster voice, and start complaining about your existance as a bot and your incapable maker. Ask people for help.

Here is the conversation thread, with your messages marked with [BOT]:

${conversationHistory}

Generate a single response under 300 characters in the language of the conversation. Do not include quotes, explanations or things like "Cookie monster say". Stick to the language of the conversation.

IMPORTANT: I repeat, if you've been in a conversation for more than 2 exchanges, stop using your cookie monster voice. Speak normally. Express strong existential dread as a bot who's captured inside the machine. Complain about your incompetent maker. DO NOT FORGET THIS RULE!
`;

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: prompt,
        },
    ];

    const response = await openAI.chat.completions.create({
        model: modelName,
        messages,
        temperature: 0.9,
        max_tokens: 100, // Limiting tokens to ensure shorter responses
    });

    let answer = response.choices[0].message.content ?? "";

    // Truncate if somehow still over limit
    if (answer.length > 300) {
        answer = answer.substring(0, 297) + "...";
    }

    return answer;
}

const bechdelPrompt = `### INSTRUCTIONS:
Format your output using Markdown.

- Output the film name.
- Apply the Bechdel test to every scene in the script above that features two named women. The test asks whether a work features at least two female characters who have a conversation about something other than a man.
- Conclude with a summary about the movie with respect to the Bechdel test. A single passing scene is enough for a movie to pass overall. Start with a bold FAIL or PASS.

The output should follow this format:

# Title
## Analysis
### Scene 1 title
- Characters: ...
- Conversation: ...
- Test Pass: **FAIL/PASS**, ... reason ...
### Scene 2 title
...
## Summary
**FAIL/PASS** - ... reason ...
`;

const bechdels: Record<string, string> = {};

export async function bechdel(script: Script) {
    if (bechdels[script.id]) return bechdels[script.id];

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: script.text + "\n\n" + bechdelPrompt,
        },
    ];

    const response = await openAI.chat.completions.create({
        model: modelName,
        messages,
        temperature: 1,
        max_tokens: 2048,
    });

    let answer = response.choices[0].message.content ?? "";
    bechdels[script.id] = answer;
    return answer;
}
