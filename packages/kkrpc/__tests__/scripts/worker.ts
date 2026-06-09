import { expose } from "../../mod.ts"
import { workerSelfTransport } from "../../worker.ts"
import { apiMethods, type API } from "./api.ts"

expose<API, API>(apiMethods, workerSelfTransport())

// const randInt1 = Math.floor(Math.random() * 100)
// const randInt2 = Math.floor(Math.random() * 100)
// api.add(randInt1, randInt2)
