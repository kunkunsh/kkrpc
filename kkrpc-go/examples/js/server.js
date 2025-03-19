// This is a Node.js server that will be called by the Go client
// It implements the API that the Go client expects

// Import kkrpc (Node.js users would npm install kkrpc first)
// For this example, we can't actually import it, but this is how it would be used
// const { NodeIo, RPCChannel } = require('kkrpc');

// Simulated implementation of kkrpc for the example
class NodeIo {
  constructor(stdin, stdout) {
    this.stdin = stdin || process.stdin;
    this.stdout = stdout || process.stdout;
    this.name = "node-io";
    this.stdinBuffer = "";
    
    // Set up stdin to receive data
    this.stdin.on('data', (data) => {
      this.stdinBuffer += data.toString();
      this.processBuffer();
    });
  }
  
  processBuffer() {
    const lines = this.stdinBuffer.split('\n');
    if (lines.length > 1) {
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (line && line.startsWith('{')) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse JSON:', error);
          }
        }
      }
      this.stdinBuffer = lines[lines.length - 1];
    }
  }
  
  async handleMessage(message) {
    if (message.type === 'request') {
      const { id, method, args } = message;
      
      // Find the method on the API
      const methodParts = method.split('.');
      let target = api;
      
      // Traverse the method path
      for (let i = 0; i < methodParts.length - 1; i++) {
        target = target[methodParts[i]];
        if (!target) {
          this.sendError(id, `Method path ${method} not found at ${methodParts[i]}`);
          return;
        }
      }
      
      const finalMethod = methodParts[methodParts.length - 1];
      const targetMethod = target[finalMethod];
      
      if (typeof targetMethod !== 'function') {
        this.sendError(id, `Method ${method} is not a function`);
        return;
      }
      
      // Process callback arguments
      const processedArgs = args.map(arg => {
        if (typeof arg === 'string' && arg.startsWith('__callback__')) {
          const callbackId = arg.slice(12);
          return (...callbackArgs) => {
            this.invokeCallback(callbackId, callbackArgs);
          };
        }
        return arg;
      });
      
      try {
        // Call the method and get the result
        const result = await targetMethod.apply(target, processedArgs);
        this.sendResponse(id, result);
      } catch (error) {
        this.sendError(id, error.message || error.toString());
      }
    } else if (message.type === 'callback') {
      const { method: callbackId, args } = message;
      const callback = callbacks[callbackId];
      if (callback) {
        callback(...args);
      } else {
        console.error(`Callback with id ${callbackId} not found`);
      }
    }
  }
  
  sendResponse(id, result) {
    const response = {
      id,
      method: "",
      args: { result },
      type: "response"
    };
    this.stdout.write(JSON.stringify(response) + '\n');
  }
  
  sendError(id, error) {
    const response = {
      id,
      method: "",
      args: { error },
      type: "response"
    };
    this.stdout.write(JSON.stringify(response) + '\n');
  }
  
  invokeCallback(callbackId, args) {
    const message = {
      id: generateUUID(),
      method: callbackId,
      args,
      type: "callback"
    };
    this.stdout.write(JSON.stringify(message) + '\n');
  }
  
  async read() {
    // This would be used by RPCChannel but we're handling it directly
    return new Promise((resolve) => {
      this.stdin.once('data', (data) => {
        resolve(data);
      });
    });
  }
  
  async write(data) {
    return new Promise((resolve, reject) => {
      this.stdout.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Store callbacks for later invocation
const callbacks = {};

// Define the API implementation
const api = {
  // Add two numbers and return their sum
  add: (a, b) => {
    console.log(`JavaScript add called with ${a}, ${b}`);
    return a + b;
  },
  
  // Echo a message back to the caller
  echo: (message) => {
    console.log(`JavaScript echo called with ${message}`);
    return message;
  },
  
  // Return a data object
  getData: () => {
    console.log('JavaScript getData called');
    return {
      message: "Hello from JavaScript!",
      timestamp: new Date().toISOString(),
      random: Math.random()
    };
  },
  
  // Demonstrate callback functionality
  withCallback: (callback) => {
    console.log('JavaScript withCallback called');
    setTimeout(() => {
      callback("Hello from JavaScript callback!");
    }, 500);
    return true;
  }
};

// Create an IO interface for Node.js
const io = new NodeIo();

// This is how the real RPCChannel would be created:
// const rpc = new RPCChannel(io, { expose: api });

// Starting message
console.log('JavaScript server started and ready to receive RPC calls from Go'); 