/** Alamat server EDUVERSE dari /eduverse-config.js (kosong = origin halaman ini). */
declare global {
  interface Window {
    EDUVERSE_CONFIG?: { server?: string };
  }
}
export const SERVER_URL = (window.EDUVERSE_CONFIG?.server ?? '').replace(/\/+$/, '');
export const SERVER_LABEL = SERVER_URL || location.origin;
