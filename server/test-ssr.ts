import { Content } from "./src/models/content.js";
import { pgContentSource } from "./src/sources/contentSource.js";

async function run() {
  const res = await Content.getWithTemplate(pgContentSource, 1, null, null, null, null);
  console.log(JSON.stringify(res, null, 2));
}
run().catch(console.error);
