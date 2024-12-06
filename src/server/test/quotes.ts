import * as cheerio from "cheerio";
import * as fs from "fs";

interface Quote {
    text: string;
    tags: string[];
    url: string;
}

async function scrapeQuotes(pageNumber: number): Promise<Quote[]> {
    try {
        const url = `https://www.zitate.eu/autor/dr-bruno-kreisky-zitate?page=${pageNumber}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const quotes: Quote[] = [];

        $("li.col-md-12").each((_, element) => {
            const quoteElement = $(element);
            const text = quoteElement.find(".zitate-list-text").text().trim();
            const url = quoteElement.find("a").first().attr("href") || "";
            const tags: string[] = [];

            quoteElement.find(".zitat-details .list-icons li a").each((_, tagElement) => {
                const tag = $(tagElement).text().trim();
                if (tag) {
                    tags.push(tag);
                }
            });

            if (text) {
                quotes.push({ text, tags, url });
            }
        });

        return quotes;
    } catch (error) {
        console.error(`Error scraping page ${pageNumber}:`, error);
        return [];
    }
}

async function getAllQuotes(): Promise<Quote[]> {
    const allQuotes: Quote[] = [];
    const totalPages = 10;

    for (let page = 1; page <= totalPages; page++) {
        console.log(`Scraping page ${page}...`);
        const quotes = await scrapeQuotes(page);
        allQuotes.push(...quotes);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return allQuotes;
}

getAllQuotes()
    .then((quotes) => {
        console.log(`Total quotes scraped: ${quotes.length}`);
        fs.writeFileSync("images/kreisky-quotes.json", JSON.stringify(quotes, null, 2), "utf-8");
    })
    .catch((error) => {
        console.error("Error:", error);
    });
