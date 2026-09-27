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
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 127.0.0.1:8787 is the local AI proxy; blob: and data: carry glTF textures.
  "connect-src 'self' http://127.0.0.1:8787 data: blob:",
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

export default defineConfig({
  plugins: [vue(), contentSecurityPolicy()],
})
