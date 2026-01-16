# kkrpc - PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-16T20:16:00Z
**Commit:** 852e61d
**Branch:** main

## OVERVIEW

TypeScript-first RPC library with bidirectional communication across Node.js, Deno, Bun, Browser, and Tauri. Supports 15+ transport protocols with full type safety and zero-copy transferable objects.

## STRUCTURE

```
kkrpc/
├── packages/kkrpc/           # 核心库 (main library)
│   ├── src/                  # 源代码
│   │   ├── channel.ts         # RPCChannel 核心
│   │   ├── interface.ts       # IoInterface 抽象
│   │   ├── adapters/         # 传输适配器 (15 adapters)
│   │   ├── transfer*.ts       # Transferable 对象支持
│   │   └── serialization.ts  # JSON/superjson 序列化
│   ├── __tests__/            # Bun 测试套件 (15 tests)
│   ├── __deno_tests__/       # Deno 回归测试
│   ├── mod.ts                # 主入口 (Node/Deno/Bun)
│   ├── browser-mod.ts        # 浏览器入口
│   └── dist/                # 构建输出 (不编辑)
├── packages/demo-api/         # 示例 API 实现
├── examples/                # 10+ 使用示例
├── docs/                    # 文档站点
└── package.json              # pnpm workspace 配置
```

## WHERE TO LOOK

| Task        | Location                         | Notes                                      |
| ----------- | -------------------------------- | ------------------------------------------ |
| 核心实现    | `packages/kkrpc/src/`            | channel.ts, interface.ts, serialization.ts |
| 传输适配器  | `packages/kkrpc/src/adapters/`   | 15 种协议适配器                            |
| 测试代码    | `packages/kkrpc/__tests__/`      | Bun 测试，覆盖所有适配器                   |
| Deno 兼容性 | `packages/kkrpc/__deno_tests__/` | Deno 回归测试                              |
| 使用示例    | `examples/`                      | HTTP, WebSocket, Worker, Chrome Extension  |
| 构建配置    | `turbo.json`, `tsdown.config.ts` | Turbo + tsdown 构建系统                    |

## CODE MAP

| Symbol                | Type      | Location             | Role                |
| --------------------- | --------- | -------------------- | ------------------- |
| RPCChannel            | Class     | src/channel.ts       | 双向 RPC 通道核心   |
| IoInterface           | Interface | src/interface.ts     | 传输层抽象接口      |
| IoCapabilities        | Interface | src/interface.ts     | 适配器能力声明      |
| serialize/deserialize | Function  | src/serialization.ts | 消息序列化          |
| transfer()            | Function  | src/transfer.ts      | 标记 zero-copy 对象 |
| NodeIo                | Class     | adapters/node.ts     | Node.js stdio       |
| DenoIo                | Class     | adapters/deno.ts     | Deno stdio          |
| WorkerParentIO        | Class     | adapters/worker.ts   | Web Worker 父端     |
| WorkerChildIO         | Class     | adapters/worker.ts   | Web Worker 子端     |

## CONVENTIONS

### 代码风格

- **文件命名**: TypeScript 文件用 kebab-case (如 `stdio-rpc.ts`)
- **导出命名**: 类/接口用 PascalCase (`RPCChannel`), 函数用 camelCase (`generateUUID`)
- **注释风格**: 中英混合，术语用英文，解释用中文
- **格式化**: Prettier 配置：tabs, 100 字符宽度, 无分号, 自动排序导入

### 模块组织

- 共享类型在 `packages/kkrpc/src/*.ts`
- 适配器辅助代码在 `src/adapters/<transport>/`
- 测试固件在 `__tests__/fixtures/`
- 测试脚本在 `__tests__/scripts/`

### 构建系统

- **pnpm workspaces**: 管理多包项目
- **Turbo**: 统一构建流水线 (`pnpm dev/build/test`)
- **tsdown**: TypeScript 到 ES 模块构建 (ESM + CJS 双输出)
- **Typedoc**: API 文档生成到 `docs/`

### 测试策略

- **主要测试**: Bun 测试运行器 (`bun test __tests__ --coverage`)
- **跨运行时**: Deno 回归测试 (`deno test -R __deno_tests__`)
- **无 Mock**: 真实 client/server 设置，不使用 mock
- **双向测试**: 双端暴露和消费 API
- **压力测试**: 高并发操作 (5000+ 调用)

## ANTI-PATTERNS (THIS PROJECT)

- ❌ **不要编辑** `dist/` 目录内容 - 构建生成，自动覆盖
- ❌ **不要编辑** `docs/` 目录内容 - Typedoc 自动生成
- ❌ **不要使用** `@ts-ignore`, `@ts-expect-error`, `as any` - 禁止类型抑制
- ❌ **浏览器不要导入** Node.js 特定代码 (如 `node:buffer`) - 使用 `browser-mod.ts` 入口

## UNIQUE STYLES

### 多入口点策略

主包导出 9 个不同入口：

- `.` - 核心模块
- `./browser` - 浏览器专用
- `./http` - HTTP 适配器
- `./deno` - Deno 适配器
- `./chrome-extension` - Chrome 扩展
- `./socketio`, `./rabbitmq`, `./kafka`, `./redis-streams` - 消息队列适配器

### 适配器能力声明

每个适配器声明其传输能力：

```typescript
capabilities: IoCapabilities = {
	structuredClone: true, // 支持 IoMessage 对象
	transfer: true, // 支持 zero-copy
	transferTypes: ["ArrayBuffer", "MessagePort"]
}
```

### 消息队列为空处理

大多数适配器使用消息队列模式：

```typescript
private messageQueue: string[] = []
private resolveRead: ((value: string | null) => void) | null = null
```

### 销毁信号模式

7 个适配器使用 `DESTROY_SIGNAL = "__DESTROY__"` 优雅关闭：

- Worker, iframe, Chrome extension, WebSocket, Socket.IO, Hono, Elysia

## COMMANDS

```bash
# 依赖安装
pnpm install

# 开发模式 (Turbo watch)
pnpm dev

# 构建 (tsdown + Typedoc)
pnpm build

# 测试 (Bun)
pnpm test
pnpm --filter kkrpc test -- --watch

# Deno 测试
pnpm --filter kkrpc test:deno

# 代码质量
pnpm lint
pnpm format

# 版本管理 (Changesets)
pnpm changeset
```

## NOTES

### 跨运行时兼容性

- **stdio**: Node.js ↔ Deno ↔ Bun 进程间通信
- **Web Workers**: 浏览器 + Deno 原生支持
- **HTTP/WebSocket**: 所有运行时
- **消息队列**: RabbitMQ/Redis/Kafka (所有运行时)

### 序列化格式

- **superjson** (默认): 支持 Date, Map, Set, BigInt, Uint8Array
- **json**: 向后兼容，基础类型
- **自动检测**: 接收端自动识别格式

### Transferable 对象性能

- **40-100x 速度提升**: 大数据 (>1MB) 使用零拷贝
- **支持类型**: ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas
- **自动降级**: 非可传输传输自动回退到复制

### 浏览器导入

```typescript
// 浏览器环境使用专用入口
import { RPCChannel } from "kkrpc/browser"

// 服务端使用主入口
import { RPCChannel } from "kkrpc"
```

### 构建产物

- **dist/**: ESM + CJS + .d.ts 类型定义
- **docs/**: Typedoc 生成的 API 文档
- **不要提交**: 这些目录在 .gitignore 中
