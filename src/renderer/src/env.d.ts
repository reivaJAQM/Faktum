/// <reference types="vite/client" />
import type { FaktumApi } from '../../shared/types';

declare global {
  interface Window {
    faktum: FaktumApi;
  }
}

export {};
