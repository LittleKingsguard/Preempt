import { loadLibraryData } from "./setupLibrary.js";

async function run() {
  try {
    const adminUser = { username: 'rarasey@outlook.com', id: 'rarasey@outlook.com', is_admin: true };
    await loadLibraryData(adminUser);
    console.log("Library loaded successfully!");
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
run();
