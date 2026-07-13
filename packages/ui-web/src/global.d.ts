// Lets this package's components import their own plain CSS files. Consuming
// apps (Next.js portals) resolve the import through their bundler; this
// ambient declaration only exists so `tsc --noEmit` in this package does not
// error on an import type it cannot otherwise resolve.
declare module "*.css";
