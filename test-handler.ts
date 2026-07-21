import { Node } from './src/core/Node.js';
import { Handler } from './src/core/Handler.js';

const node = new Node({
  type: "div",
  handlers: { afterAssembly: { name: 'afterAssembly', event: 'afterAssembly', body: "nonExistentObject.throwError()" } }
});

console.log("handler is instance of Handler:", node.handlers['afterAssembly'] instanceof Handler);
console.log("handler.execute:", typeof node.handlers['afterAssembly'].execute);
try {
  node.executeHandlers("afterAssembly", {});
} catch (e) {
  console.log("caught in global:", e);
}
