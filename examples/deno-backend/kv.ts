
const kv = await Deno.openKv()

const prefs = {
    username: "ada",
    theme: "dark",
    language: "en-US"
}
await kv.set(["preferences", "ada"], prefs)
const pref = await kv.get(["preferences", "ada"])
console.log(JSON.stringify(pref, null, 2))