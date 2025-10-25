import React, { useState, useEffect } from 'react';
import { RPCChannel } from 'kkrpc/browser';
import { WorkerParentIO } from 'kkrpc/browser';
import {
  isTransferable,
  analyzeTransferability,
  extractTransferables,
  createTransferableWrapper,
  transfer
} from 'kkrpc/browser';
import './App.css';

interface Metrics {
  [key: string]: string | number;
}

interface DemoResult {
  processed?: boolean;
  originalSize?: number;
  checksum?: number;
  count?: number;
  results?: any[];
  transferableCount?: number;
  transferableTypes?: string[];
  metrics?: any;
  environmentSupport?: any;
  receivedArgs?: number;
  transferablesFound?: number;
  args?: any[];
  // New properties for transfer explanations
  transferExplanation?: string;
  bufferSizeReceived?: string;
  isTransferSuccessful?: boolean;
  allBuffersTransferred?: boolean;
  bufferSizes?: number[];
  transferredBufferCount?: number;
}

function App() {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [rpc, setRpc] = useState<RPCChannel<any, any> | null>(null);
  const [status, setStatus] = useState<string>('Initializing...');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error'>('info');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const initializeDemo = () => {
      try {
        const newWorker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        const io = new WorkerParentIO(newWorker);
        const newRpc = new RPCChannel(io);
        
        setWorker(newWorker);
        setRpc(newRpc);
        setStatus('Worker initialized successfully');
        setStatusType('success');
        setIsReady(true);
      } catch (error) {
        setStatus(`Failed to initialize worker: ${(error as Error).message}`);
        setStatusType('error');
        console.error('Worker initialization error:', error);
      }
    };

    initializeDemo();

    return () => {
      if (worker) {
        worker.terminate();
      }
    };
  }, []);

  const appendOutput = (output: string, elementId: string) => {
    const element = document.getElementById(elementId) as HTMLTextAreaElement;
    if (element) {
      element.value += output + '\n';
      element.scrollTop = element.scrollHeight;
      console.log(`Output to ${elementId}:`, output); // Debug log
    } else {
      console.error(`Element with id ${elementId} not found`);
    }
  };

  const clearOutput = (elementId: string) => {
    const element = document.getElementById(elementId) as HTMLTextAreaElement;
    if (element) {
      element.value = '';
    }
  };

  const updateMetrics = (elementId: string, metrics: Metrics) => {
    const container = document.getElementById(elementId);
    if (container) {
      container.innerHTML = '';
      
      Object.entries(metrics).forEach(([key, value]) => {
        const card = document.createElement('div');
        card.className = 'metric-card';
        card.innerHTML = `
          <div class="metric-value">${value}</div>
          <div class="metric-label">${key}</div>
        `;
        container.appendChild(card);
      });
    }
  };

  // Demo 1: Large buffer processing
  const processLargeBuffer = async () => {
    if (!rpc) return;
    
    clearOutput('bufferOutput');
    appendOutput('bufferOutput', 'Creating 1MB buffer...');
    
    const largeBuffer = new ArrayBuffer(1024 * 1024);
    const view = new Uint8Array(largeBuffer);
    
    // Fill with test data
    for (let i = 0; i < view.length; i++) {
      view[i] = i % 256;
    }
    
    appendOutput('bufferOutput', `Buffer created: ${largeBuffer.byteLength} bytes`);
    appendOutput('bufferOutput', `Buffer is transferable: ${isTransferable(largeBuffer)}`);
    
    const metrics = analyzeTransferability({ buffer: largeBuffer });
    updateMetrics('bufferMetrics', {
      'Buffer Size': `${(largeBuffer.byteLength / 1024).toFixed(1)} KB`,
      'Transfer Ratio': `${(metrics.transferRatio * 100).toFixed(1)}%`,
      'Est. Savings': `${(metrics.estimatedMemorySavings / 1024).toFixed(1)} KB`
    });
    
    try {
      appendOutput('bufferOutput', 'Sending buffer to worker...');
      const startTime = performance.now();
      
      const result = await rpc.getAPI().processLargeBuffer(
        transfer(largeBuffer, [largeBuffer]), 
        {
          type: 'test-data',
          timestamp: Date.now()
        }
      ) as DemoResult;
      
      const endTime = performance.now();
      
      appendOutput('bufferOutput', `Processing completed in ${(endTime - startTime).toFixed(2)}ms`);
      appendOutput('bufferOutput', `Original size: ${result.originalSize} bytes`);
      appendOutput('bufferOutput', `Checksum: ${result.checksum}`);
      appendOutput('bufferOutput', `Buffer size after transfer: ${largeBuffer.byteLength} bytes`);
      
      // Show worker's transfer explanation
      if (result.transferExplanation) {
        appendOutput('bufferOutput', `\nWorker Feedback: ${result.transferExplanation}`);
      }
      
      // Show transfer indicator
      const indicator = document.getElementById('bufferTransferIndicator');
      if (indicator) {
        indicator.style.display = 'block';
        setTimeout(() => {
          indicator.style.display = 'none';
        }, 5000);
      }
      
      // Add explanatory text about buffer size
      if (largeBuffer.byteLength === 0) {
        appendOutput('bufferOutput', '✅ SUCCESS: Buffer size is 0 bytes - this confirms the transfer worked correctly!');
        appendOutput('bufferOutput', '   The buffer ownership has been moved to the worker (zero-copy transfer).');
      } else {
        appendOutput('bufferOutput', '⚠️  WARNING: Buffer still contains data - transfer may not have worked as expected.');
      }
      
      updateMetrics('bufferMetrics', {
        'Buffer Size': `${(largeBuffer.byteLength / 1024).toFixed(1)} KB`,
        'Transfer Ratio': `${(metrics.transferRatio * 100).toFixed(1)}%`,
        'Est. Savings': `${(metrics.estimatedMemorySavings / 1024).toFixed(1)} KB`,
        'Process Time': `${(endTime - startTime).toFixed(2)}ms`
      });
    } catch (error) {
      appendOutput('bufferOutput', `Error: ${(error as Error).message}`);
      console.error('Buffer processing error:', error);
    }
  };

  // Demo 2: Batch processing
  const processBatch = async () => {
    if (!rpc) return;
    
    clearOutput('batchOutput');
    appendOutput('batchOutput', 'Creating batch of buffers...');
    
    const buffers = Array.from({ length: 5 }, (_, i) => {
      const buffer = new ArrayBuffer(1024 * (i + 1));
      const view = new Uint8Array(buffer);
      view.fill(i + 1);
      return buffer;
    });
    
    const operations = ['sum', 'average', 'minmax', 'sum', 'average'];
    const totalSize = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    
    appendOutput('batchOutput', `Created ${buffers.length} buffers, total size: ${totalSize} bytes`);
    
    try {
      appendOutput('batchOutput', 'Sending batch to worker...');
      const startTime = performance.now();
      
      const batchResult = await rpc.getAPI().processBatch(
        transfer(buffers, buffers), 
        operations
      ) as DemoResult;
      
      const endTime = performance.now();
      
      appendOutput('batchOutput', `Batch processed in ${(endTime - startTime).toFixed(2)}ms`);
      appendOutput('batchOutput', `Processed ${batchResult.count} buffers`);
      
      // Show worker's transfer explanation
      if (batchResult.transferExplanation) {
        appendOutput('batchOutput', `\nWorker Feedback: ${batchResult.transferExplanation}`);
      }
      
      // Check if all buffers were transferred (should all be 0 bytes)
      const allTransferred = buffers.every(buf => buf.byteLength === 0);
      if (allTransferred) {
        appendOutput('batchOutput', '✅ SUCCESS: All buffers transferred correctly (all show 0 bytes)');
        appendOutput('batchOutput', '   This confirms zero-copy transfer worked for the entire batch.');
        
        // Show transfer indicator
        const indicator = document.getElementById('batchTransferIndicator');
        if (indicator) {
          indicator.style.display = 'block';
          setTimeout(() => {
            indicator.style.display = 'none';
          }, 5000);
        }
      } else {
        appendOutput('batchOutput', '⚠️  WARNING: Some buffers may not have transferred correctly.');
      }
      
      batchResult.results?.forEach((result, index) => {
        appendOutput('batchOutput', `  Buffer ${index + 1}: ${JSON.stringify(result)}`);
      });
      
      updateMetrics('batchMetrics', {
        'Buffers': buffers.length,
        'Total Size': `${(totalSize / 1024).toFixed(1)} KB`,
        'Process Time': `${(endTime - startTime).toFixed(2)}ms`
      });
    } catch (error) {
      appendOutput('batchOutput', `Error: ${(error as Error).message}`);
      console.error('Batch processing error:', error);
    }
  };

  // Demo 3: Transferable analysis
  const analyzeTransferablesDemo = async () => {
    if (!rpc) return;
    
    clearOutput('analyzeOutput');
    appendOutput('analyzeOutput', 'Creating transferable wrapper...');
    
    const wrapperBuffer = new ArrayBuffer(2048);
    const wrapper = createTransferableWrapper(
      { data: 'wrapped data', size: wrapperBuffer.byteLength },
      [wrapperBuffer]
    );
    
    appendOutput('analyzeOutput', 'Analyzing transferability...');
    
    try {
      const wrapperResult = await rpc.getAPI().analyzeData(wrapper) as DemoResult;
      
      appendOutput('analyzeOutput', `Transferables found: ${wrapperResult.transferableCount}`);
      appendOutput('analyzeOutput', `Transferable types: ${wrapperResult.transferableTypes?.join(', ')}`);
      appendOutput('analyzeOutput', `Environment support: ${JSON.stringify(wrapperResult.environmentSupport)}`);
      
      updateMetrics('analyzeMetrics', {
        'Transferables': wrapperResult.transferableCount || 0,
        'Total Objects': wrapperResult.metrics?.totalObjects || 0,
        'Transfer Ratio': `${((wrapperResult.metrics?.transferRatio || 0) * 100).toFixed(1)}%`
      });
    } catch (error) {
      appendOutput('analyzeOutput', `Error: ${(error as Error).message}`);
      console.error('Analysis error:', error);
    }
  };

  // Demo 4: Mixed data transfer
  const transferMixedData = async () => {
    if (!rpc) return;
    
    clearOutput('mixedOutput');
    appendOutput('mixedOutput', 'Creating mixed data...');
    
    const mixedData = {
      transferableBuffer: new ArrayBuffer(512),
      regularString: 'This is a regular string',
      regularNumber: 42,
      regularObject: { nested: { value: 'test' } },
      anotherBuffer: new ArrayBuffer(256)
    };
    
    // Fill buffers with test data
    const mixedView1 = new Uint8Array(mixedData.transferableBuffer);
    mixedView1.fill(128);
    const mixedView2 = new Uint8Array(mixedData.anotherBuffer);
    mixedView2.fill(64);
    
    const mixedMetrics = analyzeTransferability(mixedData);
    appendOutput('mixedOutput', `Total objects: ${mixedMetrics.totalObjects}`);
    appendOutput('mixedOutput', `Transferable objects: ${mixedMetrics.transferableObjects}`);
    appendOutput('mixedOutput', `Transfer ratio: ${(mixedMetrics.transferRatio * 100).toFixed(1)}%`);
    
    try {
      appendOutput('mixedOutput', 'Sending mixed data to worker...');
      
      const mixedResult = await rpc.getAPI().echoTransferables(
        transfer(mixedData.transferableBuffer, [mixedData.transferableBuffer]),
        mixedData.regularString,
        mixedData.regularNumber,
        mixedData.regularObject,
        transfer(mixedData.anotherBuffer, [mixedData.anotherBuffer])
      ) as DemoResult;
      
      appendOutput('mixedOutput', `Received args: ${mixedResult.receivedArgs}`);
      appendOutput('mixedOutput', `Transferables found: ${mixedResult.transferablesFound}`);
      
      // Show worker's transfer explanation
      if (mixedResult.transferExplanation) {
        appendOutput('mixedOutput', `\nWorker Feedback: ${mixedResult.transferExplanation}`);
      }
      
      // Check if transferable buffers were correctly transferred (should be 0 bytes)
      const buffersTransferred = mixedData.transferableBuffer.byteLength === 0 &&
                                mixedData.anotherBuffer.byteLength === 0;
      
      if (buffersTransferred) {
        appendOutput('mixedOutput', '✅ SUCCESS: Transferable buffers correctly show 0 bytes');
        appendOutput('mixedOutput', '   Regular objects were copied normally (as expected).');
        
        // Show transfer indicator
        const indicator = document.getElementById('mixedTransferIndicator');
        if (indicator) {
          indicator.style.display = 'block';
          setTimeout(() => {
            indicator.style.display = 'none';
          }, 5000);
        }
      } else {
        appendOutput('mixedOutput', '⚠️  WARNING: Transferable buffers may not have transferred correctly.');
      }
      
      mixedResult.args?.forEach((arg, index) => {
        appendOutput('mixedOutput', `  Arg ${index + 1}: ${arg.type} - ${arg.constructor || 'N/A'}${arg.wasTransferred ? ' (✅ transferred)' : ''}`);
      });
      
      updateMetrics('mixedMetrics', {
        'Total Args': mixedResult.receivedArgs || 0,
        'Transferables': mixedResult.transferablesFound || 0,
        'Transfer Ratio': `${(mixedMetrics.transferRatio * 100).toFixed(1)}%`
      });
    } catch (error) {
      appendOutput('mixedOutput', `Error: ${(error as Error).message}`);
      console.error('Mixed data error:', error);
    }
  };

  // Demo 5: Performance comparison
  const runPerformanceTest = async () => {
    if (!rpc) return;
    
    clearOutput('perfOutput');
    appendOutput('perfOutput', 'Running performance test...');
    
    const sizes = [1024, 10240, 102400, 1024000]; // 1KB, 10KB, 100KB, 1MB
    const results: { size: number; time: number }[] = [];
    
    for (const size of sizes) {
      appendOutput('perfOutput', `Testing ${(size / 1024).toFixed(1)}KB buffer...`);
      
      const perfBuffer = new ArrayBuffer(size);
      const perfView = new Uint8Array(perfBuffer);
      perfView.fill(Math.random() * 256);
      
      const startTime = performance.now();
      
      try {
        await rpc.getAPI().processLargeBuffer(
          transfer(perfBuffer, [perfBuffer]), 
          { size }
        );
        
        const endTime = performance.now();
        const time = endTime - startTime;
        
        results.push({ size, time });
        appendOutput('perfOutput', `  Size: ${(size / 1024).toFixed(1)}KB, Time: ${time.toFixed(2)}ms`);
      } catch (error) {
        appendOutput('perfOutput', `  Error: ${(error as Error).message}`);
      }
    }
    
    appendOutput('perfOutput', '\nPerformance Summary:');
    results.forEach(result => {
      const throughput = (result.size / 1024) / (result.time / 1000); // KB/s
      appendOutput('perfOutput', `  ${(result.size / 1024).toFixed(1)}KB: ${result.time.toFixed(2)}ms (${throughput.toFixed(1)} KB/s)`);
    });
  };

  // Run all tests and aggregate results
  const runAllTests = async () => {
    if (!rpc) return;
    
    clearOutput('allTestsOutput');
    appendOutput('allTestsOutput', 'Running all tests...');
    
    const testResults: any = {
      timestamp: new Date().toISOString(),
      tests: {}
    };
    
    try {
      // Test 1: Large Buffer Processing
      appendOutput('\n1. Testing Large Buffer Processing...', 'allTestsOutput');
      const largeBuffer = new ArrayBuffer(1024 * 1024);
      const view = new Uint8Array(largeBuffer);
      for (let i = 0; i < view.length; i++) {
        view[i] = i % 256;
      }
      
      const bufferStartTime = performance.now();
      const bufferResult = await rpc.getAPI().processLargeBuffer(
        transfer(largeBuffer, [largeBuffer]),
        { type: 'test-data', timestamp: Date.now() }
      ) as DemoResult;
      const bufferEndTime = performance.now();
      
      testResults.tests.largeBuffer = {
        status: 'success',
        originalSize: bufferResult.originalSize,
        checksum: bufferResult.checksum,
        processingTime: bufferEndTime - bufferStartTime,
        bufferSizeAfterTransfer: largeBuffer.byteLength
      };
      appendOutput(`✓ Large buffer test completed in ${(bufferEndTime - bufferStartTime).toFixed(2)}ms`, 'allTestsOutput');
      
      // Test 2: Batch Processing
      appendOutput('\n2. Testing Batch Processing...', 'allTestsOutput');
      const buffers = Array.from({ length: 5 }, (_, i) => {
        const buffer = new ArrayBuffer(1024 * (i + 1));
        const view = new Uint8Array(buffer);
        view.fill(i + 1);
        return buffer;
      });
      const operations = ['sum', 'average', 'minmax', 'sum', 'average'];
      
      const batchStartTime = performance.now();
      const batchResult = await rpc.getAPI().processBatch(
        transfer(buffers, buffers),
        operations
      ) as DemoResult;
      const batchEndTime = performance.now();
      
      testResults.tests.batch = {
        status: 'success',
        count: batchResult.count,
        results: batchResult.results,
        processingTime: batchEndTime - batchStartTime
      };
      appendOutput(`✓ Batch processing test completed in ${(batchEndTime - batchStartTime).toFixed(2)}ms`, 'allTestsOutput');
      
      // Test 3: Transferable Analysis
      appendOutput('\n3. Testing Transferable Analysis...', 'allTestsOutput');
      const wrapperBuffer = new ArrayBuffer(2048);
      const wrapper = createTransferableWrapper(
        { data: 'wrapped data', size: wrapperBuffer.byteLength },
        [wrapperBuffer]
      );
      
      const analysisStartTime = performance.now();
      const wrapperResult = await rpc.getAPI().analyzeData(wrapper) as DemoResult;
      const analysisEndTime = performance.now();
      
      testResults.tests.analysis = {
        status: 'success',
        transferableCount: wrapperResult.transferableCount,
        transferableTypes: wrapperResult.transferableTypes,
        environmentSupport: wrapperResult.environmentSupport,
        processingTime: analysisEndTime - analysisStartTime
      };
      appendOutput(`✓ Transferable analysis test completed in ${(analysisEndTime - analysisStartTime).toFixed(2)}ms`, 'allTestsOutput');
      
      // Test 4: Mixed Data Transfer
      appendOutput('\n4. Testing Mixed Data Transfer...', 'allTestsOutput');
      const mixedData = {
        transferableBuffer: new ArrayBuffer(512),
        regularString: 'This is a regular string',
        regularNumber: 42,
        regularObject: { nested: { value: 'test' } },
        anotherBuffer: new ArrayBuffer(256)
      };
      
      const mixedView1 = new Uint8Array(mixedData.transferableBuffer);
      mixedView1.fill(128);
      const mixedView2 = new Uint8Array(mixedData.anotherBuffer);
      mixedView2.fill(64);
      
      const mixedStartTime = performance.now();
      const mixedResult = await rpc.getAPI().echoTransferables(
        transfer(mixedData.transferableBuffer, [mixedData.transferableBuffer]),
        mixedData.regularString,
        mixedData.regularNumber,
        mixedData.regularObject,
        transfer(mixedData.anotherBuffer, [mixedData.anotherBuffer])
      ) as DemoResult;
      const mixedEndTime = performance.now();
      
      testResults.tests.mixed = {
        status: 'success',
        receivedArgs: mixedResult.receivedArgs,
        transferablesFound: mixedResult.transferablesFound,
        args: mixedResult.args,
        processingTime: mixedEndTime - mixedStartTime
      };
      appendOutput(`✓ Mixed data transfer test completed in ${(mixedEndTime - mixedStartTime).toFixed(2)}ms`, 'allTestsOutput');
      
      // Test 5: Performance Test
      appendOutput('\n5. Running Performance Test...', 'allTestsOutput');
      const sizes = [1024, 10240, 102400, 1024000]; // 1KB, 10KB, 100KB, 1MB
      const perfResults: { size: number; time: number }[] = [];
      
      for (const size of sizes) {
        const perfBuffer = new ArrayBuffer(size);
        const perfView = new Uint8Array(perfBuffer);
        perfView.fill(Math.random() * 256);
        
        const startTime = performance.now();
        await rpc.getAPI().processLargeBuffer(
          transfer(perfBuffer, [perfBuffer]),
          { size }
        );
        const endTime = performance.now();
        const time = endTime - startTime;
        
        perfResults.push({ size, time });
      }
      
      testResults.tests.performance = {
        status: 'success',
        results: perfResults,
        summary: perfResults.map(result => ({
          size: result.size,
          time: result.time,
          throughput: (result.size / 1024) / (result.time / 1000) // KB/s
        }))
      };
      appendOutput(`✓ Performance test completed`, 'allTestsOutput');
      
      // Overall summary
      const totalTests = Object.keys(testResults.tests).length;
      const successfulTests = Object.values(testResults.tests).filter((test: any) => test.status === 'success').length;
      
      testResults.summary = {
        totalTests,
        successfulTests,
        failedTests: totalTests - successfulTests,
        successRate: (successfulTests / totalTests) * 100
      };
      
      appendOutput(`\n\n=== ALL TESTS COMPLETED ===`, 'allTestsOutput');
      appendOutput(`Total Tests: ${totalTests}`, 'allTestsOutput');
      appendOutput(`Successful: ${successfulTests}`, 'allTestsOutput');
      appendOutput(`Failed: ${totalTests - successfulTests}`, 'allTestsOutput');
      appendOutput(`Success Rate: ${((successfulTests / totalTests) * 100).toFixed(1)}%`, 'allTestsOutput');
      appendOutput(`\n=== AGGREGATED RESULTS (JSON) ===`, 'allTestsOutput');
      appendOutput(JSON.stringify(testResults, null, 2), 'allTestsOutput');
      
    } catch (error) {
      appendOutput(`Error during tests: ${(error as Error).message}`, 'allTestsOutput');
      if (error && typeof error === 'object') {
        appendOutput(`Error details: ${JSON.stringify(error, null, 2)}`, 'allTestsOutput');
      }
      testResults.error = (error as Error).message;
    }
  };

  return (
    <div className="App">
      <div className="container">
        <h1>kkrpc Transferable Objects Demo</h1>
        <p>This demo showcases use of Transferable Objects with kkrpc for efficient zero-copy data transfers between main thread and web workers.</p>
        
        <div className={`status ${statusType}`} id="status">
          {status}
        </div>
      </div>

      <div className="container">
        <h2>Understanding Transferable Objects</h2>
        <div className="info-section">
          <h3>What are Transferable Objects?</h3>
          <p>
            Transferable Objects are a special type of object in JavaScript that can be <strong>transferred</strong> from one context to another
            (e.g., from main thread to a Web Worker) with <strong>zero-copy</strong> semantics. This means the data is moved rather than copied,
            resulting in significant performance improvements for large data transfers.
          </p>
          
          <h3>How Transfer Works</h3>
          <p>
            When an object is transferred:
          </p>
          <ul>
            <li><strong>Ownership is transferred</strong>: The original context loses access to the object</li>
            <li><strong>Buffer becomes empty</strong>: The original ArrayBuffer's byteLength becomes 0</li>
            <li><strong>No data copying</strong>: The underlying memory is directly transferred to the new context</li>
            <li><strong>Performance gain</strong>: Eliminates the cost of copying large amounts of data</li>
          </ul>
          
          <div className="transfer-visualization">
            <h3>Transfer Visualization</h3>
            <div className="transfer-diagram">
              <div className="transfer-step">
                <h4>Before Transfer</h4>
                <div className="buffer-state">
                  <div className="buffer-full">Main Thread: [████████████] (1MB)</div>
                  <div className="buffer-empty">Worker: [          ] (0MB)</div>
                </div>
              </div>
              <div className="transfer-arrow">→ TRANSFER →</div>
              <div className="transfer-step">
                <h4>After Transfer</h4>
                <div className="buffer-state">
                  <div className="buffer-empty">Main Thread: [          ] (0MB) ← <em>This is expected!</em></div>
                  <div className="buffer-full">Worker: [████████████] (1MB)</div>
                </div>
              </div>
            </div>
          </div>
          
          <h3>Common Transferable Objects</h3>
          <ul>
            <li><strong>ArrayBuffer</strong>: The most commonly transferred object</li>
            <li><strong>MessagePort</strong>: For communication between contexts</li>
            <li><strong>ImageBitmap</strong>: For efficient image transfers</li>
            <li><strong>OffscreenCanvas</strong>: For rendering operations</li>
          </ul>
          
          <div className="note-box">
            <h4>⚠️ Important Note</h4>
            <p>
              When you see a buffer size of 0 bytes after transfer, <strong>this is the correct and expected behavior</strong>!
              It indicates that the transfer was successful and the buffer's ownership has been moved to the worker.
            </p>
          </div>
        </div>
      </div>

      <div className="container">
        <h2>Run All Tests</h2>
        <div className="demo-section">
          <p>Run all tests at once and get aggregated results in JSON format for easy sharing.</p>
          <button onClick={runAllTests} disabled={!isReady}>
            Run All Tests
          </button>
          <div className="metrics" id="allTestsMetrics"></div>
          <textarea className="output" id="allTestsOutput" readOnly style={{ fontFamily: 'monospace' }} />
        </div>
      </div>

      <div className="container">
        <h2>1. Large Buffer Processing</h2>
        <div className="demo-section">
          <p>Process a 1MB buffer using transferable objects for zero-copy transfer.</p>
          <div className="transfer-note">
            <strong>💡 Key Insight:</strong> After transfer, the buffer size will show 0 bytes - this is expected behavior!
            The buffer ownership has been moved to the worker, eliminating the need for data copying.
          </div>
          <button onClick={processLargeBuffer} disabled={!isReady}>
            Process Large Buffer
          </button>
          <div className="metrics" id="bufferMetrics"></div>
          <div className="transfer-indicator" id="bufferTransferIndicator" style={{ display: 'none' }}>
            <span className="transfer-success">✅ Transfer Successful!</span>
            <span className="transfer-explanation">Buffer size is now 0 bytes (ownership transferred to worker)</span>
          </div>
          <textarea className="output" id="bufferOutput" readOnly />
        </div>
      </div>

      <div className="container">
        <h2>2. Batch Processing</h2>
        <div className="demo-section">
          <p>Process multiple buffers in a single operation.</p>
          <div className="transfer-note">
            <strong>💡 Key Insight:</strong> All buffers in the batch will show 0 bytes after transfer,
            but the worker will receive the full data and process it efficiently.
          </div>
          <button onClick={processBatch} disabled={!isReady}>
            Process Batch
          </button>
          <div className="metrics" id="batchMetrics"></div>
          <div className="transfer-indicator" id="batchTransferIndicator" style={{ display: 'none' }}>
            <span className="transfer-success">✅ Batch Transfer Successful!</span>
            <span className="transfer-explanation">All buffers transferred with zero-copy semantics</span>
          </div>
          <textarea className="output" id="batchOutput" readOnly />
        </div>
      </div>

      <div className="container">
        <h2>3. Transferable Analysis</h2>
        <div className="demo-section">
          <p>Analyze data for transferability and extract transferable objects.</p>
          <div className="transfer-note">
            <strong>💡 Key Insight:</strong> This demo shows how to identify which objects can be transferred
            and estimates the memory savings from using transferable objects.
          </div>
          <button onClick={analyzeTransferablesDemo} disabled={!isReady}>
            Analyze Transferables
          </button>
          <div className="metrics" id="analyzeMetrics"></div>
          <textarea className="output" id="analyzeOutput" readOnly />
        </div>
      </div>

      <div className="container">
        <h2>4. Mixed Data Transfer</h2>
        <div className="demo-section">
          <p>Transfer mixed data containing both transferable and regular objects.</p>
          <div className="transfer-note">
            <strong>💡 Key Insight:</strong> Only the ArrayBuffers are transferred (becoming 0 bytes),
            while regular objects are copied normally. This demonstrates selective transfer optimization.
          </div>
          <button onClick={transferMixedData} disabled={!isReady}>
            Transfer Mixed Data
          </button>
          <div className="metrics" id="mixedMetrics"></div>
          <div className="transfer-indicator" id="mixedTransferIndicator" style={{ display: 'none' }}>
            <span className="transfer-success">✅ Mixed Transfer Complete!</span>
            <span className="transfer-explanation">Transferable objects moved, regular objects copied</span>
          </div>
          <textarea className="output" id="mixedOutput" readOnly />
        </div>
      </div>

      <div className="container">
        <h2>5. Performance Comparison</h2>
        <div className="demo-section">
          <p>Compare performance with different buffer sizes.</p>
          <div className="transfer-note">
            <strong>💡 Key Insight:</strong> Larger buffers show more significant performance benefits
            from transferable objects due to the avoided copy overhead.
          </div>
          <button onClick={runPerformanceTest} disabled={!isReady}>
            Run Performance Test
          </button>
          <textarea className="output" id="perfOutput" readOnly />
        </div>
      </div>
    </div>
  );
}

export default App;
