import type { CookieHandler, CookieSerializeOptions } from '@auth0/auth0-server-js';
import type { StoreOptions } from '../types.js';

export class ExpressCookieHandler implements CookieHandler<StoreOptions> {
  setCookie(name: string, value: string, options?: CookieSerializeOptions, storeOptions?: StoreOptions): void {
    if (!storeOptions) {
      throw new Error('StoreOptions not provided');
    }

    // The SDK gives maxAge in seconds; Express expects milliseconds.
    const maxAge = options?.maxAge != null ? options.maxAge * 1000 : undefined;

    storeOptions.response.cookie(name, value, { ...options, maxAge });
  }

  getCookie(name: string, storeOptions?: StoreOptions): string | undefined {
    if (!storeOptions) {
      throw new Error('StoreOptions not provided');
    }

    return storeOptions.request.cookies[name];
  }

  getCookies(storeOptions?: StoreOptions): Record<string, string> {
    if (!storeOptions) {
      throw new Error('StoreOptions not provided');
    }

    return storeOptions.request.cookies;
  }

  deleteCookie(name: string, storeOptions?: StoreOptions, options?: CookieSerializeOptions): void {
    if (!storeOptions) {
      throw new Error('StoreOptions not provided');
    }

    storeOptions.response.clearCookie(name, options);
  }
}
