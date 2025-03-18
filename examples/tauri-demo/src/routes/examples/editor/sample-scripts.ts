export const sampleScripts = {
	deno: `// Deno Example
// Demonstrates Deno's built-in APIs and permissions
async function runDenoExample() {
  try {
    // Get system hostname
    const hostname = Deno.hostname();
    console.log("Current hostname:", hostname);

    // Show runtime info
    console.log("Deno version:", Deno.version);
    console.log("V8 version:", Deno.version.v8);

    const kv = await Deno.openKv();

    const prefs = {
        username: "ada",
        theme: "dark",
        language: "en-US"
    };
    await kv.set(["preferences", "ada"], prefs);
    const pref = await kv.get(["preferences", "ada"]);
    console.log(JSON.stringify(pref, null, 2));

  } catch (error) {
    console.error("Error:", error.message);
  }
}
runDenoExample();`,

	bun: `// Bun Example
// Demonstrates Bun's SQLite integration
import { Database } from "bun:sqlite";

// Create an in-memory database
const db = new Database(":memory:");

// Create a table
db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");

// Insert some data
db.run("INSERT INTO users (name, age) VALUES (?, ?)", ["Alice", 25]);
db.run("INSERT INTO users (name, age) VALUES (?, ?)", ["Bob", 30]);

// Query the data
const query = db.query("SELECT * FROM users WHERE age > ?");
const results = query.all(20);
console.log("Users over 20:", results);

// Simple aggregation
const avgAge = db.query("SELECT AVG(age) as average_age FROM users").get();
console.log("Average age:", avgAge.average_age);`,

	node: `// Node.js Example
// Demonstrates Node.js built-in modules
const { cpus, totalmem, platform } = require('os');
const { performance } = require('perf_hooks');
const { createHash } = require('crypto');

// System information using node:os
console.log('Platform:', platform());
console.log('CPU cores:', cpus().length);
console.log('Total memory:', Math.round(totalmem() / (1024 * 1024 * 1024)), 'GB');

// Performance measurement
const start = performance.now();
const iterations = 1000000;
let counter = 0;
for (let i = 0; i < iterations; i++) {
  counter++;
}
const end = performance.now();
console.log(\`Performed \${iterations} iterations in \${(end - start).toFixed(2)}ms\`);

// Cryptography example
const hash = createHash('sha256');
hash.update('Hello World');
console.log('SHA256 hash:', hash.digest('hex'));

// Process information
console.log('Node version:', process.version);
console.log('Process ID:', process.pid);
console.log('Current working directory:', process.cwd());`
}
