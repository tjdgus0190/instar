/// <reference types="vite/client" />
declare const __SITE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_GUMROAD_URL?: string;
  readonly VITE_GA4_ID?: string;
  readonly VITE_CF_BEACON_TOKEN?: string;
}
