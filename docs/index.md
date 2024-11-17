---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "kkRPC"
  text: "Documentation"
  tagline: RPC Everything
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Source Code
      link: https://github.com/kunkunsh/kkrpc

features:
  - title: HTTP
    details: Call API over HTTP like calling local functions (similar to tRPC)
  - title: WebSocket
    details: Call API over WebSocket (with callback support and bidirectional)
  - title: Web Worker
    details: Bidirectional communication between Web Worker and main thread
  - title: iframe
    details: Bidirectional communication between iframe and parent page
  - title: stdio
    details: IPC over stdio between JavaScript/TypeScript processes (e.g. Node.js/Deno/Bun)
