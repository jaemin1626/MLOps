(function initializeApiClient(global) {
  'use strict';

  function getConnectionHelpers() {
    return global.MLOps?.connectionStore || {
      appendConnectionQuery: (url) => url,
      withConnectionBody: (body, url) => body,
    };
  }

  function shouldAttachConnectionId(url, method) {
    if (method === 'POST' && (url.startsWith('/api/connections') || url.includes('/api/connections/'))) {
      return false;
    }
    return true;
  }

  async function request(url, options = {}) {
    const connectionStore = getConnectionHelpers();
    const method = String(options.method || 'GET').toUpperCase();
    const resolvedUrl = shouldAttachConnectionId(url, method)
      ? connectionStore.appendConnectionQuery(url)
      : url;
    const response = await fetch(resolvedUrl, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === 'object' && payload.error ? payload.error : `HTTP ${response.status}`;
      const error = new Error(message);
      if (typeof payload === 'object' && payload) {
        if (payload.logText) error.logText = payload.logText;
        if (payload.logs) error.logs = payload.logs;
        if (payload.status) error.status = payload.status;
      }
      throw error;
    }
    return payload;
  }

  const api = {
    get: (url) => request(url),
    post: (url, data, options = {}) => {
      const connectionStore = getConnectionHelpers();
      const payload = shouldAttachConnectionId(url, 'POST')
        ? connectionStore.withConnectionBody(data)
        : (data && typeof data === 'object' ? { ...data } : data);
      return request(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        ...options,
      });
    },
    openEventStream(url, handlers = {}) {
      const connectionStore = getConnectionHelpers();
      const source = new EventSource(connectionStore.appendConnectionQuery(url));
      source.addEventListener('log', (event) => handlers.onLog?.(JSON.parse(event.data)));
      source.onerror = (error) => handlers.onError?.(error);
      source.onopen = () => handlers.onOpen?.();
      return source;
    },
  };

  global.MLOps = global.MLOps || {};
  global.MLOps.api = api;
})(window);
