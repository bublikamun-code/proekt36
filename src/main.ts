import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/cyrillic-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/cyrillic-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/cyrillic-700.css'
import '@fontsource/manrope/latin-800.css'
import '@fontsource/manrope/cyrillic-800.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/cyrillic-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/cyrillic-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/ibm-plex-mono/cyrillic-600.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { registerServiceWorker } from './services/serviceWorker'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')

// After the mount, never before: the worker is a convenience on top of an app that already runs,
// and a registration that throws during start-up would take the application down with it.
void registerServiceWorker()
