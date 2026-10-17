import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

/**
 * The production policy. The app has no XSS sinks today — no `v-html`, no `innerHTML`, no `eval`,
 * no CDN, no web fonts — so this is a second layer rather than a fix for a known hole. It is
 * applied at build time only, because the same tag would block Vite's dev-time HMR preamble.
 *
 * `style-src-attr` carries the inline `style` attributes the 2D board needs to position its
 * geometry; the older `style-src` keeps `unsafe-inline` as the fallback for browsers that do not
 * know the more specific directive. Scripts get no such allowance.
 *
 * `frame-ancestors` and `form-action` are ignored inside a `<meta>` tag — they belong in response
 * headers, which this project does not control. Section 11 of the runbook lists them.
 *
 * The AI proxy is reached over the same origin (`/ai`, proxied by the dev server below or by
 * nginx in the container), so no outbound host is listed here — the policy never allows a
 * visitor's loopback, whether or not the proxy is running.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // The offline worker is a same-origin script, and without this directive the default of
  // `default-src 'self'` would cover it too — but stating it means a future `worker-src blob:`
  // can never be added by accident, which is the usual way a service worker turns into a hole.
  "worker-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Same origin only; blob: and data: carry glTF textures.
  "connect-src 'self' data: blob:",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'panel36-content-security-policy',
  apply: 'build',
  transformIndexHtml(html) {
    return {
      html,
      tags: [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      }],
    }
  },
})

/**
 * Static hosts without rewrite rules (GitHub Pages) answer a deep link with the 404 document.
 * A copy of the entry as 404.html boots the whole app right on the requested URL, and the
 * router — which reads the real location — lands the user where they asked to be.
 */
const spaFallback = (): Plugin => ({
  name: 'panel36-spa-fallback',
  apply: 'build',
  generateBundle(_options, bundle) {
    if (!process.env.VITE_PUBLIC_BASE) return
    const index = bundle['index.html']
    if (index && index.type === 'asset') this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
  },
})

export default defineConfig({
  // The container and the dev server serve the app from the root; GitHub Pages serves it
  // from a repository subdirectory, and a pages build sets VITE_PUBLIC_BASE to that path.
  base: process.env.VITE_PUBLIC_BASE || '/',
  plugins: [vue(), contentSecurityPolicy(), spaFallback()],
  server: {
    // Explicit IPv4 + fixed port: Playwright's webServer polls 127.0.0.1:5173, and a
    // wildcard/::1-only listener used to make it time out on some machines.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The assistant path the browser already uses in the container: `npm run ai` keeps
    // listening on its own port, the page just talks to /ai and never learns where it goes.
    proxy: {
      '/ai': {
        target: `http://127.0.0.1:${process.env.VITE_AI_PROXY_PORT || 8787}`,
        rewrite: (path) => path.replace(/^\/ai/, ''),
      },
    },
  },
})
