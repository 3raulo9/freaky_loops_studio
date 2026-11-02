import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './animations.css'
import { vHint } from './components/toolbar/hintBus.js'
import { pingHost } from './desktop/ipc.js'
import { useStudio } from './store/studio.js'

createApp(App)
  .directive('hint', vHint)
  .mount('#app')

// Desktop (native host) bridge handshake; safe no-op in a plain browser.
pingHost()

// Dev-only handle for poking the store from the console / automated UI checks.
if (import.meta.env.DEV) window.__studio = useStudio()
