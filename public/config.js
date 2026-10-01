// Supabase publishable keys are designed to be used by the public browser client.
const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.AMECC_CONFIG = {
  apiBaseUrl: localHost ? window.location.origin : 'https://ymewopsgearpdsvzyaxb.supabase.co/functions/v1/amecc-api',
  apiKey: localHost ? '' : 'sb_publishable_bfmlGNRuphcSb_mIFqeA8Q_p9xBBdL9',
};
