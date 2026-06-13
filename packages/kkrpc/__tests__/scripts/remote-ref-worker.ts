/**
 * Worker fixture for remote-reference tests.
 *
 * The regular stable worker fixture uses the default slim core. This fixture
 * intentionally imports `kkrpc/remote-refs` and returns an explicitly proxied
 * function so worker transport tests exercise request/response remote refs.
 * @module
 */

import { expose, proxy } from "../../src/entries/remote-refs.ts"
import { workerSelfTransport } from "../../src/entries/worker.ts"

const api = {
	getGreeter: async () => proxy((name: string) => `hello ${name}`)
}

expose(api, workerSelfTransport())
