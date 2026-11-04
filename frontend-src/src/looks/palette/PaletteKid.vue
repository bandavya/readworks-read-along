<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { store } from '../../api'
import KidView from '../../views/KidView.vue'
import './palette-kid.css'

defineProps({ id: String })

const tints = { yellow: '#f9f2a4', red: '#ffe3e8', green: '#d9f2d9', purple: '#f1ddf8', blue: '#dceaff' }
const tint = tints[store.get('paletteHighlight', 'yellow')] || tints.yellow

let panelObserver

function syncWordCardSetting() {
  const options = document.querySelector('.kv-panel .kv-reading-options')
  const source = document.querySelector('.palette-kid .kv-auto-setting input')
  if (!options || !source) return
  let button = options.querySelector('.palette-auto-words')
  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'kv-option palette-auto-words'
    button.addEventListener('click', () => {
      const checkbox = document.querySelector('.palette-kid .kv-auto-setting input')
      checkbox?.click()
      syncWordCardSetting()
    })
    options.append(button)
  }
  button.setAttribute('aria-pressed', String(source.checked))
  const label = `Show word cards as they're read: ${source.checked ? 'On' : 'Off'}`
  if (button.textContent !== label) button.textContent = label
}

onMounted(() => {
  document.body.classList.add('palette-kid-active')
  document.addEventListener('click', onLink, true)
  panelObserver = new MutationObserver(syncWordCardSetting)
  panelObserver.observe(document.body, { childList: true, subtree: true })
  syncWordCardSetting()
})
onBeforeUnmount(() => {
  panelObserver?.disconnect()
  document.body.classList.remove('palette-kid-active')
  document.removeEventListener('click', onLink, true)
})

function onLink(e) {
  const link = e.target.closest?.('a[href]')
  if (!link) return
  if (link.getAttribute('href') === '#/') {
    e.preventDefault()
    window.location.hash = '#/look/palette/'
  } else if (link.getAttribute('href').startsWith('#/p/')) {
    e.preventDefault()
    window.location.hash = link.getAttribute('href').replace('#/p/', '#/look/palette/p/')
  }
}
</script>

<template>
  <div class="palette-kid" :style="{ '--palette-kid-highlight': tint }">
    <KidView :id="id" />
    </div>
</template>
