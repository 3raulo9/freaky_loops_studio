import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { vHint } from './components/toolbar/hintBus.js'

createApp(App)
  .directive('hint', vHint)
  .mount('#app')
