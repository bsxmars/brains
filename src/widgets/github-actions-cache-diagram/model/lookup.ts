export interface CacheEntry { key: string; version: string; created: number }
export interface CacheMatch { entry: CacheEntry | null; exact: boolean; via: 'key' | 'key-prefix' | 'restore-key' | 'miss' }
export function loadCacheLookup(code: string): (entries: CacheEntry[], key: string, restoreKeys: string[], version: string) => CacheMatch {
  return new Function(`${code}\nreturn findCache;`)() as ReturnType<typeof loadCacheLookup>;
}
