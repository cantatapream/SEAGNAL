import { registerPlugin } from '@capacitor/core';
const Geolocation = registerPlugin('Geolocation', {});
export * from './definitions.js';
export { Geolocation };
