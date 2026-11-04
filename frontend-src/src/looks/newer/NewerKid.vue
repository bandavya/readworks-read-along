<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import KidView from '../../views/KidView.vue'
import './newer-kid.css'

defineProps({ id: String })

onMounted(() => document.body.classList.add('newer-kid-active'))
onBeforeUnmount(() => document.body.classList.remove('newer-kid-active'))
function onLink(e) {
  const link = e.target.closest?.('a[href="#/"]')
  if (!link) return
  e.preventDefault()
  window.location.hash = '#/look/newer/'
}
</script>

<template>
  <div class="newer-kid" @click.capture="onLink">
    <KidView :id="id" />
    </div>
</template>
