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
