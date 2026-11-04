// Screens people look at carry only words for the child or teacher using them. Everything in the packaged demo
// (VITE_SHOWCASE) and every theme counts; the review screen and the plain development app keep their working notes.
import { computed } from 'vue'
import { route } from './router'

export const SHOWCASE = import.meta.env?.VITE_SHOWCASE === '1'
export const presenting = computed(() => SHOWCASE || route.value.name === 'look')
