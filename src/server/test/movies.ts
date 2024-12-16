import { getScriptText } from "../scripts";

async function main() {
    const text = await getScriptText("babylon");
    console.log(text);
}

main();
