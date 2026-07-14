import { registerPlugin } from '@capacitor/core';
const Browser = registerPlugin('Browser', {
    web: () => import('./web.js').then(m => new m.BrowserWeb()),
});
export * from './definitions.js';
export { Browser };
//# sourceMappingURL=index.js.map