import { SourceRegistry } from "./SourceRegistry.js";
import { pgComponentSource } from "./componentSource.js";
import { pgContentSource } from "./contentSource.js";
import { pgTemplateSource } from "./templateSource.js";
import { pgHandlerSource } from "./handlerSource.js";
import { pgUserSource } from "./userSource.js";

// Register default PostgreSQL sources into SourceRegistry
SourceRegistry.setDefaultSource("component", pgComponentSource);
SourceRegistry.setDefaultSource("content", pgContentSource);
SourceRegistry.setDefaultSource("template", pgTemplateSource);
SourceRegistry.setDefaultSource("handler", pgHandlerSource);
SourceRegistry.setDefaultSource("user", pgUserSource);

export { SourceRegistry };
export type { SourceType, SourceAdapter } from "./SourceRegistry.js";
