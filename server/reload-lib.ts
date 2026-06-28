import { loadLibraryData } from "./src/utils/setupLibrary.js";
import { User } from "./src/models/user.js";
import { pgUserSource } from "./src/sources/userSource.js";

async function run() {
  const admin = await User.getByUsername(pgUserSource, "rarasey@outlook.com");
  await loadLibraryData(admin);
  console.log("Library reloaded!");
  process.exit(0);
}
run();
