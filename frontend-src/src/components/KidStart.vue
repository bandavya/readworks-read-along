<script setup>
// Start screen: two huge picture buttons. Nothing a child must read (the small labels are for the grown-up).
defineProps({ title: String, needTap: Boolean, hasVoice: Boolean })
defineEmits(['choose'])
</script>

<template>
  <section class="kv-start" aria-label="Choose how to read">
    <p class="kv-start-title">{{ title }}</p>
    <div class="kv-choices">
      <button v-if="hasVoice" type="button" class="kv-choice kv-listen" aria-label="Read to me" @click="$emit('choose', 'listen')">
        <svg viewBox="0 0 24 24" class="kv-choice-icon" aria-hidden="true">
          <path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z" />
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.2 8.8a4.6 4.6 0 0 1 0 6.4M17.8 6.2a8.2 8.2 0 0 1 0 11.6M20.4 3.6a11.8 11.8 0 0 1 0 16.8" />
        </svg>
        <span class="kv-choice-label">Read to me</span>
      </button>
      <button type="button" class="kv-choice kv-self" aria-label="Read on my own" @click="$emit('choose', 'self')">
        <svg viewBox="0 0 24 24" class="kv-choice-icon" aria-hidden="true">
          <path fill="currentColor" d="M2.4 5.2C5.6 3.6 9 3.9 11.2 5.9v13.4C9 17.5 5.6 17.3 2.4 18.9z" />
          <path fill="currentColor" d="M21.6 5.2C18.4 3.6 15 3.9 12.8 5.9v13.4c2.2-1.8 5.6-2 8.8-.4z" />
        </svg>
        <span class="kv-choice-label">Read on my own</span>
      </button>
    </div>
  </section>
</template>
