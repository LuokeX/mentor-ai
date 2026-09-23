export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    // microphone 放开给自身源：首页助手的语音输入需要 getUserMedia（仅 HTTPS 或 localhost 下可用）
    'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
    'cross-origin-opener-policy': 'same-origin'
  })
  if (event.path.startsWith('/api/v1/')) {
    setResponseHeader(event, 'cache-control', 'no-store, private')
  }
})
