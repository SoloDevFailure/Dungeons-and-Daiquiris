'use strict';
// Keep direct file:// use working. Installation and offline caching require HTTPS.
if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .catch(error => console.warn('Offline cache unavailable:', error.message));
  });
}
