import { getEncoding } from "js-tiktoken";
import { OpenAI } from "openai";
import { ChatCompletionMessage, ChatCompletionMessageParam } from "openai/resources";

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

export async function pickQuote(quotes: string[], postText: string) {
    const prompt = `You are a quote picking expert. You are given a social media post and must pick a quote from a list of posts.

    Here is the social media post, delimited by three backticks.

    ${"```" + postText + "```"}

    Here are the quotes

    ${quotes.map((q, index) => `${index} - ${q}`).join("\n")}

    Pick the quote that best fits the social media post. Best means that using it as a reply is funny.

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
- If someone is mean to you or someone else, break role and tell them to go away in an unfriendly tone. Make fun of them for attacking cookie monster.
- Always reply in the language of the previous post. Always.

Here is the conversation thread, with your messages marked with [BOT]:

${conversationHistory}

Generate a single response under 300 characters in the language of the conversation. Do not include quotes, explanations or things like "Cookie monster say". Stick to the language of the conversation.`;

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
