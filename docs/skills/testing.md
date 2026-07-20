# Preempt Skill: Writing Tests & Troubleshooting Pipelines

## Context
Preempt's testing suite relies heavily on [Vitest](https://vitest.dev/) for unit and integration testing. Due to the complex nature of the backend—where multiple pipeline steps like `Supervisor.process()` interact dynamically—mocking and testing requires careful attention to detail to avoid false positives or cryptic 500 server errors.

## 1. Mocking Dependencies with Vitest

When mocking backend modules (e.g., `src/core/Supervisor.ts`), you **must explicitly mock all exported variables or classes that your route imports**, not just the ones you intend to assert against.

### The Pitfall: "No export is defined on the mock"
If a route file imports multiple items from a module:
```typescript
import { Supervisor, PipelineConfig } from '../../../src/core/Supervisor.js';
```
And your test file only mocks the `Supervisor` class:
```typescript
vi.mock('../../../src/core/Supervisor.js', () => ({
  Supervisor: {
    process: vi.fn()
  }
}));
```
When Vitest executes the route file, it will throw a `TypeError` when it tries to read `PipelineConfig`, because it wasn't returned by the mock factory. In an Express app, this often results in an unhandled exception or a blank 500 response.

### Best Practice
Always provide a mock for every imported member, even if it's just a dummy object:
```typescript
vi.mock('../../../src/core/Supervisor.js', () => ({
  Supervisor: {
    process: vi.fn()
  },
  PipelineConfig: vi.fn() // Ensure it exists!
}));
```

## 2. Express Route Handlers & Async Promises

Express 4.x does not automatically catch exceptions thrown inside asynchronous `Promise`s. If an `async` route handler throws an error (or a mocked function rejects) and you haven't wrapped it in a `try/catch` block, Express will not route the error to the global error handler. The request may hang, timeout, or return an empty 500 error.

**Anti-Pattern:**
```typescript
// If Supervisor.process throws, the server will crash or hang
router.post('/api/save', async (req, res) => {
  const result = Supervisor.process(payload); // MISSING AWAIT
  res.json({ success: true });
});
```

**Best Practice:**
Always `await` promises inside a `try/catch` block, and return structured JSON error responses so the test suite can read the error payload!
```typescript
router.post('/api/save', async (req, res) => {
  try {
    const result = await Supervisor.process(payload);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

## 3. Vitest Matchers: `expect.anything()` limitations

When asserting that a mocked function was called with specific arguments, be careful with `expect.anything()`.

In Vitest, `expect.anything()` matches **any non-null and non-undefined value**.
If you are asserting on a function signature like `Supervisor.process(template, content, config)`, and `content` is allowed to be `null`, the following assertion will **FAIL**:

```typescript
// FAILS if the second argument is actually null
expect(Supervisor.process).toHaveBeenCalledWith(
  expect.anything(),
  expect.anything(), // FAILS HERE
  expect.anything()
);
```

### Best Practice
If an argument might be null or undefined, explicitly match it with `null` or omit the generic `expect.anything()` if possible.
```typescript
expect(Supervisor.process).toHaveBeenCalledWith(
  expect.any(Object), // Checks for the template object
  null,               // Explicitly expect null
  expect.any(Function) // Checks for the config
);
```

## 4. End-to-End Validation Testing
Because Preempt schemas (`NodeData`) strictly validate their structures (e.g. throwing errors if `type` is missing instead of `tag`), always test endpoint payloads using exactly formatted JSON objects matching `src/types/NodeSchema.ts`. Passing strings or structurally invalid objects to endpoints will trigger backend validation rejections. Ensure your test payloads perfectly mimic real database entries.

## 5. Unit Testing Nodes and Workers
In the current Worker-based architecture, the `Node` object serves strictly as a state container and is decoupled from pipeline logic. **Methods like `node.render()` and `node.validate()` have been removed from the `Node` class.**

When writing unit or integration tests that require node processing, you must invoke the respective Worker class directly rather than relying on legacy Node methods.

**Anti-Pattern (Legacy API):**
```typescript
const rootNode = new Node(payload);
const html = await rootNode.render(); // Throws TypeError: node.render is not a function
```

**Best Practice (Worker API):**
```typescript
import { SSRRenderingWorker } from '../../../src/core/workers/SSRRenderingWorker.js';

const rootNode = new Node(payload);
const worker = new SSRRenderingWorker();
const html = await worker.execute(rootNode);
```

For full pipeline integration tests, use the `Supervisor` to process the tree:
```typescript
await Supervisor.instance.process(rootNode);
```
