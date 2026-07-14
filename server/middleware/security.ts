export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin'
  })
  if (event.path.startsWith('/api/v1/')) {
    setResponseHeader(event, 'cache-control', 'no-store, private')
  }
})
