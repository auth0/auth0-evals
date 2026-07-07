export interface MockState {
  has(key: string): boolean;
  set(key: string): void;
  clear(key: string): void;
}

export interface HandlerContext {
  method: string;
  path: string;
  payload: string;
  state: MockState;
}

export type RouteVerb = 'create' | 'set' | 'reflect' | 'static' | 'handler';

export interface RouteDef {
  match: string;
  verb: RouteVerb;
  state?: string;
  body?: unknown | string;
  present?: unknown | string;
  absent?: unknown | string;
  handler?: string;
}

export interface RouteManifest {
  surface: string;
  consumedBy?: string[];
  routes: RouteDef[];
}

export interface EngineConfig {
  binName: string;
  stripPrefixes: string[];
  manifestDirs: string[];
  stateDir: string;
}
