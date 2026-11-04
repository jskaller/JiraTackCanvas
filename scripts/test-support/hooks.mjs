/**
 * Resolver-test hooks: map the Forge platform SDKs onto in-memory stubs.
 *
 * The dashboard resolvers and the web triggers are the layer where the canvas
 * identity bugs lived, and until now they had no tests at all because they
 * import `@forge/api` and `@forge/kvs`. Node's module hooks let them run in a
 * plain process against deterministic fakes.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@forge/api') {
    return { url: new URL('./stubs/forge-api.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === '@forge/kvs') {
    return { url: new URL('./stubs/forge-kvs.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
