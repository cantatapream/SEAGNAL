import { registerPlugin } from '@capacitor/core';
const App = registerPlugin('App', {
    web: () => import('./web.js').then(m => new m.AppWeb()),
});
export * from './definitions.js';
export { App };
//# sourceMappingURL=index.js.map