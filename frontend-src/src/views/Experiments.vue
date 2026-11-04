<script setup>
// One calm list of every test and option, for the team. Not linked from a kid screen.
// The list lives in public/experiments.json, so it stays out of the public sample export and can change without a code edit.
import { ref, onMounted } from 'vue'

const groups = ref(null)
const failed = ref(false)
const external = (href) => /^https:/.test(href || '')

onMounted(async () => {
  document.title = 'Experiments · Sound Along prototype'
  try {
    const res = await fetch(new URL('experiments.json', new URL(import.meta.env.BASE_URL, document.baseURI)).href)
    if (!res.ok) throw new Error(String(res.status))
    groups.value = (await res.json()).groups
  } catch {
    failed.value = true
  }
})
</script>

<template>
  <main class="xp">
    <h1>Experiments</h1>
    <p class="xp-lead">Everything we're testing, and the question each one answers. Nothing here has been tried with children.</p>
    <p v-if="failed" role="alert">The list didn't load. Try reloading the page.</p>
    <p v-else-if="!groups" role="status">Loading…</p>
    <section v-for="g in groups" :key="g.title" class="xp-group">
      <h2>{{ g.title }}</h2>
      <p v-if="g.note" class="xp-note">{{ g.note }}</p>
      <ul>
        <li v-for="x in g.items" :key="x.name">
          <a v-if="x.href" :href="x.href" :target="external(x.href) ? '_blank' : undefined" :rel="external(x.href) ? 'noopener' : undefined">{{ x.name }}</a>
          <span v-else class="xp-name">{{ x.name }}</span>
          <span class="xp-q">{{ x.question }}</span>
          <span v-if="x.status" class="xp-status">{{ x.status }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.xp { max-width: 680px; margin: 0 auto; padding-block: 20px 72px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); color: inherit; line-height: 1.5; }
.xp h1 { font-size: 1.6rem; margin: 0 0 6px; }
.xp h2 { font-size: 1.02rem; margin: 26px 0 2px; }
.xp-lead, .xp-note, .xp-status { color: var(--muted, #576b78); }
.xp-lead { margin: 0; }
.xp-note { margin: 0; font-size: 0.9rem; }
.xp ul { list-style: none; margin: 6px 0 0; padding: 0; }
.xp li { display: flex; flex-direction: column; padding: 10px 0; border-top: 1px solid var(--line, #dcdee0); min-width: 0; }
.xp li a, .xp-name { font-weight: 600; }
.xp li a { align-self: flex-start; min-height: 44px; display: inline-flex; align-items: center; color: var(--teal, #007693); overflow-wrap: anywhere; }
.xp-name { min-height: 28px; display: inline-flex; align-items: center; }
.xp-q { max-width: 60ch; }
.xp-status { font-size: 0.88rem; margin-top: 2px; }
</style>
