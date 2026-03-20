import { registerPlugin } from '@capacitor/core';
const ScreenOrientation = registerPlugin('ScreenOrientation', {
    web: () => import('./web.js').then(m => new m.ScreenOrientationWeb()),
});
export * from './definitions.js';
export { ScreenOrientation };
//# sourceMappingURL=index.js.map