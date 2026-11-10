/// <reference types="vite/client" />
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

/** Set at build time in vite.config.ts. */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;
/** "" on the main site; a name ("print") for a test copy, which keeps its own autosave. */
declare const __APP_CHANNEL__: string;
