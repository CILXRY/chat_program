/// <reference types="astro/client" />

import type { User } from './lib/types';

declare global {
  namespace App {
    interface Locals {
      user: User | null;
    }
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_STUN_URL?: string;
  readonly PUBLIC_TURN_URL?: string;
  readonly PUBLIC_TURN_USERNAME?: string;
  readonly PUBLIC_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
