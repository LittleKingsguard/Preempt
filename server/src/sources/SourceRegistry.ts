export type SourceType = 'content' | 'template' | 'component' | 'handler' | 'user' | string;

export interface SourceAdapter {
  [key: string]: any;
}

/**
 * Registry for pluggable data access source adapters.
 * Allows overriding standard PostgreSQL source implementations with custom microservice,
 * local file system, or JSON mock providers.
 */
export class SourceRegistry {
  private static sources: Map<string, SourceAdapter> = new Map();
  private static defaultSources: Map<SourceType, SourceAdapter> = new Map();

  private static getKey(type: SourceType, name?: string): string {
    return name ? `${type}:${name}` : type;
  }

  /**
   * Registers a custom source adapter by type and name.
   *
   * @param type Source category (e.g. 'content', 'template', 'component', 'handler').
   * @param name Specific variant/adapter identifier.
   * @param adapter Adapter object implementing the source interface.
   */
  public static registerSource(type: SourceType, name: string, adapter: SourceAdapter): void {
    const key = SourceRegistry.getKey(type, name);
    SourceRegistry.sources.set(key, adapter);
  }

  /**
   * Sets the default source adapter for a given source type.
   *
   * @param type Source category type.
   * @param adapter Default adapter object.
   */
  public static setDefaultSource(type: SourceType, adapter: SourceAdapter): void {
    SourceRegistry.defaultSources.set(type, adapter);
  }

  /**
   * Retrieves a registered source adapter by type and optional name.
   * Falls back to default adapter if named adapter is not found.
   *
   * @param type Source category type.
   * @param name Optional adapter name key.
   * @returns Target SourceAdapter or undefined.
   */
  public static getSource<T = SourceAdapter>(type: SourceType, name?: string): T | undefined {
    if (name) {
      const key = SourceRegistry.getKey(type, name);
      const custom = SourceRegistry.sources.get(key);
      if (custom) return custom as T;
    }
    return SourceRegistry.defaultSources.get(type) as T | undefined;
  }

  /**
   * Clears all registered custom and default source adapters.
   */
  public static clear(): void {
    SourceRegistry.sources.clear();
    SourceRegistry.defaultSources.clear();
  }
}
