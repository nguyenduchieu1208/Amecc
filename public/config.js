// Set this to the deployed Cloudflare Worker URL. This value is public by design.
const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.AMECC_CONFIG = {
  apiBaseUrl: localHost ? window.location.origin : 'https://amecc-api.hieuleo1208.workers.dev',
};
