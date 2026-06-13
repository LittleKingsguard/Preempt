import { Content } from "./src/models/content.js";
import { pgContentSource } from "./src/sources/contentSource.js";
import { pgTemplateSource } from "./src/sources/templateSource.js";

async function run() {
  const res = await Content.getWithTemplate(pgContentSource, pgTemplateSource, 1, null, null, null, null);
  console.log(JSON.stringify(res, null, 2));
}
run().catch(console.error);
