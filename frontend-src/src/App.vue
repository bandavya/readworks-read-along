<script setup>
import { route } from './router'
import Library from './views/Library.vue'
import Passage from './views/Passage.vue'
import KidView from './views/KidView.vue'
import Focus from './views/Focus.vue'
import Review from './views/Review.vue'
import Holds from './views/Holds.vue'
import Listen from './views/Listen.vue'
import Compare from './views/Compare.vue'
import Experiments from './views/Experiments.vue'
import Feedback from './components/Feedback.vue'
import ThemeBar from './components/ThemeBar.vue'
import { SHOWCASE } from './presenting'
import { defineAsyncComponent, h, computed } from 'vue'
import { linkSettings } from './linkSettings'
const LookShell = defineAsyncComponent({
  loader: () => import('./looks/index.js'),
  delay: 0,
  loadingComponent: { render: () => h('p', { role: 'status', 'aria-live': 'polite' }, 'Opening…') },
  errorComponent: { render: () => h('div', { role: 'alert' }, [
    h('p', 'This look could not open.'),
    h('button', { type: 'button', style: { minWidth: '44px', minHeight: '44px' }, onClick: () => window.location.reload() }, 'Try again'),
  ]) },
})
import TryText from './views/TryText.vue'
import TeacherClass from './dataKit/classroom/TeacherClass.vue'
import TeacherDemo from './teacherDemo/TeacherDemo.vue'
import './teacherDemo/reader.css'
import StudentPick from './dataKit/classroom/StudentPick.vue'
import { readingAs, needsPick, notMe } from './dataKit/classroom/classLink'
import { PUBLIC_SAMPLE } from './mode'
import BuddyHost from './character/BuddyHost.js'
import { BUDDY_UI, buddyChoice } from './character/buddies.js'
const demoRoute = computed(() => route.value.name === 'classDemo' || (['passage', 'kid'].includes(route.value.name) ? linkSettings().demo : route.value.name === 'review' && window.location.hash.includes('td=1')))
const showPick = computed(() => needsPick.value && !demoRoute.value)
</script>

<template>
  <ThemeBar v-if="!demoRoute && !PUBLIC_SAMPLE && (SHOWCASE || route.name === 'look' || route.name === 'looks')" />
  <aside v-if="!SHOWCASE && route.name !== 'kid' && route.name !== 'classDemo' && !demoRoute && (PUBLIC_SAMPLE || (route.name !== 'look' && route.name !== 'looks'))" class="banner" aria-label="About this prototype">{{ PUBLIC_SAMPLE ? 'Sound Along public sample · silent reading prototype' : 'Prototype for ReadWorks · not the live site · private' }}</aside>
  <p v-if="!demoRoute && readingAs && !needsPick && route.id === readingAs.passageId" class="reading-as">Reading as {{ readingAs.name }}. Your teacher can see that you opened this, how much audio played, and which tools you used, but not which words. <button type="button" @click="notMe">Not you?</button></p>
  <StudentPick v-if="showPick" />
  <TryText v-else-if="PUBLIC_SAMPLE && route.name === 'try'" />
  <LookShell v-else-if="!PUBLIC_SAMPLE && (route.name === 'look' || route.name === 'looks')" :key="`${route.look}:${route.screen}:${route.id}`" :route="route" />
  <Library v-else-if="route.name === 'library'" />
  <TeacherDemo v-else-if="route.name === 'classDemo'" :key="route.person" :person="route.person" />
  <TeacherClass v-else-if="route.name === 'teacherClass'" :key="route.id" :id="route.id" />
  <KidView v-else-if="route.name === 'kid'" :key="route.id" :id="route.id" />
  <Focus v-else-if="route.name === 'focus'" :key="route.id" :id="route.id" />
  <Review v-else-if="route.name === 'review'" :key="route.id" :id="route.id" />
  <Holds v-else-if="route.name === 'holds'" :key="`${route.all}:${route.id}:${route.voice}`" :id="route.id" :voice="route.voice" :all="route.all" />
  <Listen v-else-if="route.name === 'listen'" />
  <Compare v-else-if="route.name === 'compare'" :key="route.id" :id="route.id" />
  <Experiments v-else-if="route.name === 'experiments'" />
  <Passage v-else-if="route.name === 'passage'" :key="route.id" :id="route.id" />
  <BuddyHost v-if="BUDDY_UI && buddyChoice && !PUBLIC_SAMPLE && !demoRoute" />
  <Feedback v-if="!demoRoute && (SHOWCASE || (route.name !== 'look' && route.name !== 'looks' && route.name !== 'holds' && route.name !== 'classDemo'))" :pill="!SHOWCASE" />
</template>
