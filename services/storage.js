'use strict';
(() => {
  const app = globalThis.D20 = globalThis.D20 || {};
  const clone = value => JSON.parse(JSON.stringify(value));
  // Repositories use this boundary; a future remote adapter need not change the engine.
  function createStorage(driver) {
    return {
      read(key, fallback) {
        const raw = driver.getItem(key);
        return raw === null ? clone(fallback) : JSON.parse(raw);
      },
      write(key, value) { driver.setItem(key, JSON.stringify(value)); },
    };
  }
  app.clone = clone;
  app.createStorage = createStorage;
  app.storage = createStorage({
    getItem: key => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  });
})();
