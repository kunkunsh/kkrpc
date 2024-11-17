import type { DestroyableIoInterface } from "../interface.ts"

interface HTTPClientOptions {
    url: string
    headers?: Record<string, string>
}

/**
 * HTTP Client implementation of IoInterface
 */
export class HTTPClientIO implements DestroyableIoInterface {
    name = "http-client-io"
    private destroyed = false
    private messageQueue: string[] = []
    private resolveRead: ((value: string | null) => void) | null = null

    constructor(private options: HTTPClientOptions) {}

    async read(): Promise<string | null> {
        if (this.destroyed) return null

        if (this.messageQueue.length > 0) {
            return this.messageQueue.shift() ?? null
        }

        return new Promise((resolve) => {
            this.resolveRead = resolve
        })
    }

    async write(data: string): Promise<void> {
        if (this.destroyed) return

        try {
            const response = await fetch(this.options.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.options.headers
                },
                body: data
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const responseText = await response.text()
            
            if (this.resolveRead) {
                this.resolveRead(responseText)
                this.resolveRead = null
            } else {
                this.messageQueue.push(responseText)
            }
        } catch (error) {
            console.error('HTTP request failed:', error)
            if (this.resolveRead) {
                this.resolveRead(null)
                this.resolveRead = null
            }
        }
    }

    destroy(): void {
        this.destroyed = true
        if (this.resolveRead) {
            this.resolveRead(null)
            this.resolveRead = null
        }
    }

    signalDestroy(): void {
        this.destroy()
    }
}

/**
 * HTTP Server implementation of IoInterface
 */
export class HTTPServerIO implements DestroyableIoInterface {
    name = "http-server-io"
    private messageQueue: string[] = []
    private resolveRead: ((value: string | null) => void) | null = null
    private destroyed = false

    constructor() {}

    async read(): Promise<string | null> {
        if (this.destroyed) return null

        if (this.messageQueue.length > 0) {
            return this.messageQueue.shift() ?? null
        }

        return new Promise((resolve) => {
            this.resolveRead = resolve
        })
    }

    async write(data: string): Promise<void> {
        if (this.destroyed) return
        
        if (this.resolveResponse) {
            this.resolveResponse(new Response(data, {
                headers: { 'Content-Type': 'application/json' }
            }))
            this.resolveResponse = null
        }
    }

    destroy(): void {
        this.destroyed = true
        if (this.resolveRead) {
            this.resolveRead(null)
            this.resolveRead = null
        }
    }

    signalDestroy(): void {
        this.destroy()
    }

    private resolveResponse: ((response: Response) => void) | null = null

    async handleRequest(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 })
        }

        try {
            const message = await request.text()
            
            if (this.resolveRead) {
                this.resolveRead(message)
                this.resolveRead = null
            } else {
                this.messageQueue.push(message)
            }

            return new Promise((resolve) => {
                this.resolveResponse = resolve
            })
        } catch (error) {
            console.error('RPC processing error:', error)
            return new Response('Internal server error', { status: 500 })
        }
    }
} 