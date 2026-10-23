/** Every `src/checks/<module name>.ts` by module name; the build and the test config make it. */
declare module 'virtual:module-checks' {
  const checks: ReadonlyMap<string, import('./module-check.ts').ModuleCheck>;
  export default checks;
}
