---
title: Chrome Extension RPC
description: Complete guide to Chrome extension communication using kkrpc
---

# Chrome Extension RPC

This guide demonstrates how to implement robust bidirectional communication between Chrome extension background scripts and content scripts using kkrpc.

kkrpc provides two approaches for Chrome extensions:
- **Basic adapters**: Simple message-based communication
- **Enhanced adapters**: Port-based communication with advanced features

## Features

### Basic Chrome Adapters
- Simple message-based communication
- Lightweight implementation
- Good for basic use cases

### Enhanced Chrome Adapters  
- **Port-based communication** for better connection management
- **Automatic reconnection** when connections are lost
- **Message queuing** during disconnections
- **Enhanced error handling** and logging
- **Type-safe RPC calls** with full TypeScript support
- **Bidirectional communication** between background and content scripts

## Installation

```bash
npm install kkrpc
```

## API Definition

First, define your RPC interface types:

```typescript
// types.ts
export interface BackgroundAPI {
  executeInMainWorld: (code: string) => Promise<{ success: boolean; error?: string }>
  togglePopup: () => Promise<void>
  getExtensionInfo: () => Promise<{ version: string; name: string }>
}

export interface ContentAPI {
  getPageInfo: () => Promise<{ title: string; url: string; domain: string }>
  manipulateDOM: (selector: string, action: 'click' | 'highlight' | 'remove') => Promise<boolean>
  isPageReady: () => Promise<boolean>
}
```

## Basic Implementation

### Background Script (Basic)

```typescript
// background-basic.ts
import { ChromeBackgroundIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

// Store RPC channels for each tab
const rpcChannels = new Map<number, RPCChannel<BackgroundAPI, ContentAPI>>()

const backgroundAPI: BackgroundAPI = {
  async executeInMainWorld(code: string) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]
    
    if (!currentTab?.id) {
      return { success: false, error: "No active tab found" }
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        world: 'MAIN',
        func: (codeToExecute: string) => eval(codeToExecute),
        args: [code]
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  },

  async getExtensionInfo() {
    const manifest = chrome.runtime.getManifest()
    return { version: manifest.version, name: manifest.name }
  },

  async togglePopup() {
    console.log("Toggle popup requested")
  }
}

// Listen for tab connections
chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.tab?.id) {
    const tabId = port.sender.tab.id
    const io = new ChromeBackgroundIO(tabId)
    const rpc = new RPCChannel(io, { expose: backgroundAPI })
    rpcChannels.set(tabId, rpc)

    port.onDisconnect.addListener(() => {
      rpcChannels.delete(tabId)
    })
  }
})
```

### Content Script (Basic)

```typescript
// content-basic.ts
import { ChromeContentIO, RPCChannel } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const contentAPI: ContentAPI = {
  async getPageInfo() {
    return {
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname
    }
  },

  async manipulateDOM(selector: string, action: 'click' | 'highlight' | 'remove') {
    const elements = document.querySelectorAll(selector)
    if (elements.length === 0) return false

    elements.forEach(element => {
      switch (action) {
        case 'click': (element as HTMLElement).click(); break
        case 'highlight':
          (element as HTMLElement).style.backgroundColor = 'yellow'
          (element as HTMLElement).style.border = '2px solid red'
          break
        case 'remove': element.remove(); break
      }
    })
    return true
  },

  async isPageReady() {
    return document.readyState === 'complete'
  }
}

const io = new ChromeContentIO()
const rpc = new RPCChannel<ContentAPI, BackgroundAPI>(io, {
  expose: contentAPI
})

// Get API from background script
const backgroundAPI = rpc.getAPI()

// Example usage
async function executeCode() {
  const result = await backgroundAPI.executeInMainWorld(`
    console.log("Hello from main world!")
    console.log("Page URL:", window.location.href)
  `)
  console.log("Execution result:", result)
}
```

## Enhanced Implementation (Recommended)

### Background Script (Enhanced)

```typescript
// background-enhanced.ts
import { EnhancedChromeBackgroundIO, RPCChannel, setupBackgroundRPC } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const backgroundAPI: BackgroundAPI = {
  async executeInMainWorld(code: string): Promise<{ success: boolean; error?: string }> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]
    
    if (!currentTab?.id) {
      return { success: false, error: "No active tab found" }
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        world: 'MAIN',
        func: (codeToExecute: string) => {
          try {
            eval(codeToExecute)
          } catch (error) {
            console.error('Error executing in main world:', error)
          }
        },
        args: [code]
      })
      
      return { success: true }
    } catch (error) {
      console.error('Background script execution failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  },

  async togglePopup(): Promise<void> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]
    
    if (currentTab?.id) {
      console.log("Toggle popup requested via RPC")
    }
  },

  async getExtensionInfo(): Promise<{ version: string; name: string }> {
    const manifest = chrome.runtime.getManifest()
    return {
      version: manifest.version,
      name: manifest.name
    }
  }
}

// Option 1: Manual setup with enhanced adapters
const rpcChannels = new Map<number, RPCChannel<BackgroundAPI, ContentAPI>>()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "kkrpc-channel" && port.sender?.tab?.id) {
    const tabId = port.sender.tab.id
    console.log(`Setting up RPC channel for tab ${tabId}`)
    
    const io = new EnhancedChromeBackgroundIO(port)
    const rpc = new RPCChannel<BackgroundAPI, ContentAPI>(io, { 
      expose: backgroundAPI 
    })
    
    rpcChannels.set(tabId, rpc)

    port.onDisconnect.addListener(() => {
      console.log(`Cleaning up RPC channel for tab ${tabId}`)
      rpcChannels.delete(tabId)
      io.destroy()
    })
  }
})

// Option 2: Using utility function (simpler)
// const rpcChannels = setupBackgroundRPC<BackgroundAPI, ContentAPI>(backgroundAPI)
```

### Content Script (Enhanced)

```typescript
// content-enhanced.ts
import { EnhancedChromeContentIO, RPCChannel, setupContentRPC } from "kkrpc/chrome-extension"
import type { BackgroundAPI, ContentAPI } from "./types"

const contentAPI: ContentAPI = {
  async getPageInfo() {
    return {
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname
    }
  },

  async manipulateDOM(selector: string, action: 'click' | 'highlight' | 'remove'): Promise<boolean> {
    try {
      const elements = document.querySelectorAll(selector)
      
      if (elements.length === 0) {
        return false
      }

      elements.forEach(element => {
        switch (action) {
          case 'click':
            (element as HTMLElement).click()
            break
          case 'highlight':
            (element as HTMLElement).style.backgroundColor = 'yellow'
            (element as HTMLElement).style.border = '2px solid red'
            break
          case 'remove':
            element.remove()
            break
        }
      })

      return true
    } catch (error) {
      console.error('DOM manipulation failed:', error)
      return false
    }
  },

  async isPageReady(): Promise<boolean> {
    return document.readyState === 'complete'
  }
}

// Option 1: Manual setup with enhanced adapters
let rpcChannel: RPCChannel<ContentAPI, BackgroundAPI> | null = null
let backgroundAPI: BackgroundAPI | null = null

async function initializeRPC(): Promise<BackgroundAPI> {
  if (backgroundAPI) {
    return backgroundAPI
  }

  try {
    const io = new EnhancedChromeContentIO()
    rpcChannel = new RPCChannel<ContentAPI, BackgroundAPI>(io, { 
      expose: contentAPI 
    })
    
    backgroundAPI = rpcChannel.getAPI()
    
    console.log("RPC connection established with background script")
    return backgroundAPI
  } catch (error) {
    console.error("Failed to initialize RPC connection:", error)
    throw error
  }
}

// Initialize RPC connection
initializeRPC().then(() => {
  console.log('[Content] RPC connection established')
}).catch((error) => {
  console.error('[Content] Failed to establish RPC connection:', error)
})

// Option 2: Using utility function (simpler)
/*
async function initRPCSimple() {
  const { rpc, backgroundAPI } = await setupContentRPC<ContentAPI, BackgroundAPI>(contentAPI)
  
  // Now you can use backgroundAPI
  const info = await backgroundAPI.getExtensionInfo()
  console.log(`Extension: ${info.name} v${info.version}`)
  
  return backgroundAPI
}
*/
```

## Usage Examples

### Execute Code in Main World

```typescript
// In content script
import { getBackgroundAPI } from "./content-enhanced"

async function executeCodeInPage() {
  try {
    const backgroundAPI = await getBackgroundAPI()
    
    const result = await backgroundAPI.executeInMainWorld(`
      console.log("Hello from main world!")
      console.log("Page title:", document.title)
      console.log("Current URL:", window.location.href)
    `)
    
    if (result.success) {
      console.log("Code executed successfully")
    } else {
      console.error("Execution failed:", result.error)
    }
  } catch (error) {
    console.error("RPC call failed:", error)
  }
}

async function getExtensionInfo() {
  try {
    const backgroundAPI = await getBackgroundAPI()
    const info = await backgroundAPI.getExtensionInfo()
    
    console.log(`Extension: ${info.name} v${info.version}`)
  } catch (error) {
    console.error("Failed to get extension info:", error)
  }
}
```

### Background Script Calling Content Script

```typescript
// In background script
async function getPageInfoFromTab(tabId: number) {
  const rpc = rpcChannels.get(tabId)
  if (rpc) {
    const contentAPI = rpc.getAPI()
    const pageInfo = await contentAPI.getPageInfo()
    console.log("Page info:", pageInfo)
    
    // Manipulate DOM
    const success = await contentAPI.manipulateDOM('h1', 'highlight')
    console.log("DOM manipulation success:", success)
  }
}
```

## Manifest V3 Configuration

Ensure your `manifest.json` includes the necessary permissions:

```json
{
  "manifest_version": 3,
  "permissions": [
    "scripting",
    "activeTab"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://*/*"],
      "js": ["content.js"]
    }
  ]
}
```

## Error Handling

### Connection Failures
```typescript
try {
  const backgroundAPI = await initializeRPC()
  const result = await backgroundAPI.executeInMainWorld(code)
} catch (error) {
  console.error("RPC call failed:", error)
  // Fallback to legacy method or show error to user
}
```

### Enhanced Adapters Features
- **Automatic reconnection** on connection loss
- **Message queuing** during disconnections
- **Enhanced logging** for debugging
- **Proper cleanup** on tab close

## Multi-Component Communication Examples

### All Extension Components

The Tamper Kunkun extension demonstrates comprehensive RPC communication between all Chrome extension components:

#### Component Communication Matrix

| From → To | Background | Content | Popup | Side Panel | Options |
|-----------|------------|---------|-------|------------|---------|
| **Background** | ✅ Internal | ✅ Direct | ✅ Direct | ✅ Direct | ✅ Direct |
| **Content** | ✅ Direct | ✅ Broadcast | ⚠️ Via Background | ⚠️ Via Background | ❌ Not Common |
| **Popup** | ✅ Direct | ⚠️ Via Background | ✅ Internal | ⚠️ Via Background | ⚠️ Via Background |
| **Side Panel** | ✅ Direct | ⚠️ Via Background | ⚠️ Via Background | ✅ Internal | ⚠️ Via Background |
| **Options** | ✅ Direct | ❌ Not Common | ⚠️ Via Background | ⚠️ Via Background | ✅ Internal |

### Universal Chrome Extension RPC

For complex multi-component communication, use the Universal Chrome IO adapter:

```typescript
import { UniversalChromeIO, setupComponentRPC } from "kkrpc/chrome-extension"

// Background to Popup
const popupChannels = setupComponentRPC('background', 'popup', backgroundAPI)

// Side Panel to Background  
const { rpc, remoteAPI } = setupComponentRPC('sidepanel', 'background', sidePanelAPI)

// Multi-component setup for background
const channels = setupMultiComponentRPC(backgroundAPI, ['popup', 'sidepanel', 'content', 'options'])
```

### Cross-Component Proxy Communication

For components that can't directly communicate (e.g., popup to content), use the background as a proxy:

```typescript
// Background script - proxy handler
async function proxyPopupToContent(tabId: number, method: string, args: any[]) {
  const contentChannel = contentRPCChannels.get(tabId)
  if (!contentChannel) {
    throw new Error(`No content script found for tab ${tabId}`)
  }
  
  const contentAPI = contentChannel.getAPI()
  
  switch (method) {
    case 'highlightElements':
      return await contentAPI.manipulateDOM(args[0], 'highlight')
    case 'getFormData':
      return await contentAPI.getPageInfo()
    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

// Extended background API
const extendedBackgroundAPI = {
  ...backgroundAPI,
  async proxyToContent(tabId: number, method: string, args: any[]) {
    return await proxyPopupToContent(tabId, method, args)
  }
}
```

### Broadcast Communication

Broadcast messages to all connected components:

```typescript
// Background script broadcaster
class ExtensionBroadcaster {
  async broadcastToAll(message: string, data?: any) {
    const promises: Promise<void>[] = []

    // Broadcast to all component types
    for (const [componentType, channelMap] of Object.entries(this.channels)) {
      for (const [connectionId, channel] of channelMap) {
        promises.push(
          this.sendToComponent(componentType, channel, message, data)
            .catch(error => console.error(`Broadcast failed to ${componentType}:${connectionId}`, error))
        )
      }
    }

    await Promise.allSettled(promises)
  }
}
```

## Comparison

| Feature | Basic Adapters | Enhanced Adapters | Universal Adapters |
|---------|----------------|-------------------|-------------------|
| Connection Type | Message passing | Port-based | Port-based |
| Reconnection | Manual | Automatic | Automatic |
| Error Handling | Basic | Comprehensive | Comprehensive |
| Message Queuing | No | Yes | Yes |
| Tab Isolation | Manual | Automatic | Automatic |
| Cleanup | Manual | Automatic | Automatic |
| Logging | Minimal | Enhanced | Enhanced |
| Multi-Component | No | Limited | Full Support |
| Proxy Support | No | No | Yes |
| Broadcasting | No | No | Yes |

## Best Practices

1. **Use Enhanced Adapters** for production applications
2. **Define clear API interfaces** with TypeScript
3. **Handle connection failures** gracefully
4. **Test reconnection scenarios** after extension reload
5. **Use proper error handling** for RPC calls
6. **Clean up resources** when tabs close

## Debugging

### Console Logs
Enhanced adapters include built-in logging:
```typescript
console.log("[EnhancedChromeContentIO] Connection established")
console.log("[EnhancedChromeBackgroundIO] Message received")
```

### Extension DevTools
- **Content Script Console**: F12 → Console (on the web page)
- **Background Script Console**: chrome://extensions → Developer mode → Inspect views: service worker

## Performance Considerations

- Port-based communication has lower overhead than message passing
- Message queuing prevents data loss during disconnections
- Automatic cleanup prevents memory leaks
- Each tab maintains its own connection for optimal isolation