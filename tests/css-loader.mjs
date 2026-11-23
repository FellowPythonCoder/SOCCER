// Node loader hook: lets the integration test import main.js, which imports
// its stylesheet through Vite. CSS is stubbed out.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default {};' };
  }
  return nextLoad(url, context);
}
