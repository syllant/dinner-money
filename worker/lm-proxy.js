/**
 * DinnerMoney — LunchMoney CORS proxy
 * Deploy as a Cloudflare Worker (free tier: 100k req/day).
 * This worker only forwards requests to dev.lunchmoney.app.
 * It adds CORS headers so the browser SPA can call it directly.
 * No data is logged or stored.
 */

const TARGET = 'https://dev.lunchmoney.app'

export default {
  async fetch(request) {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      })
    }

    const url = new URL(request.url)
    const targetUrl = TARGET + url.pathname + url.search

    const proxied = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    })

    const response = await fetch(proxied)
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        ...corsHeaders(),
      },
    })
    return newResponse
  },
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}
