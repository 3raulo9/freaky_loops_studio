import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './animations.css'
import { vHint } from './components/toolbar/hintBus.js'
import { pingHost } from './desktop/ipc.js'

createApp(App)
  .directive('hint', vHint)
  .mount('#app')

// Desktop (WebView2) bridge handshake; safe no-op in a plain browser.
pingHost()
