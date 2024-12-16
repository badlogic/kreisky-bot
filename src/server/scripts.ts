import { load } from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { TextItem } from "pdfjs-dist/types/src/display/api";

interface Variables {
    relationId: null | string[];
    search: string;
    offset: number;
    limit: number;
    type: null | string[];
    orderBy: string;
}

interface PDFExtractResult {
    pdfUrl?: string;
    error?: string;
}

export async function fetchScriptPDF(scriptUrl: string): Promise<PDFExtractResult> {
    try {
        const response = await fetch(scriptUrl);
        const html = await response.text();
        const $ = load(html);

        // Try to find PDF URL from button first
        const pdfUrl = $("a.js-button-read").attr("href") || $("#scriptViewer").attr("data-file");

        if (pdfUrl) {
            return { pdfUrl };
        }

        return { error: "PDF URL not found in the HTML" };
    } catch (error) {
        return { error: `Failed to fetch script page: ${error}` };
    }
}

export async function searchAndGetPDF(searchTerm: string): Promise<PDFExtractResult> {
    try {
        // First, search for the script
        const variables: Variables = {
            relationId: null,
            search: searchTerm,
            offset: 0,
            limit: 31,
            type: null,
            orderBy: "score",
        };

        const searchResponse = await fetch("https://www.scriptslug.com/gql", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                operationName: "GetScripts",
                variables,
                query: `query GetScripts($search: String, $relationId: [QueryArgument] = null, $offset: Int, $limit: Int, $type: [String], $orderBy: String) {
          scriptsEntries(
            comingSoon: false
            search: $search
            relatedTo: $relationId
            type: $type
            offset: $offset
            limit: $limit
            orderBy: $orderBy
          ) {
            ... on film_Entry {
              title
              uri
              scriptTitle
              year
              dateUpdated @formatDateTime(format: "YmdHis")
              typeHandle
              __typename
            }
          }
        }`,
            }),
        });

        const searchData = await searchResponse.json();

        if (searchData.errors) {
            return { error: `GraphQL Error: ${searchData.errors[0].message}` };
        }

        if (!searchData.data?.scriptsEntries?.[0]?.uri) {
            return { error: "No scripts found" };
        }

        // Get the first result's URI and fetch its page
        const scriptUrl = `https://www.scriptslug.com/${searchData.data.scriptsEntries[0].uri}`;
        return await fetchScriptPDF(scriptUrl);
    } catch (error) {
        return { error: `Failed to search for script: ${error}` };
    }
}

export async function getScriptText(search: string) {
    const movies = await searchAndGetPDF(search);
    const task = await getDocument(movies.pdfUrl);
    const doc = await task.promise;

    let text = "";
    for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const content = page.getTextContent();
        text += (await content).items.map((item) => (item as TextItem).str).join(" ");
    }
    return text;
}
