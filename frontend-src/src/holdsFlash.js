// Two small things that must survive the switch from one take to the next (each take is a new screen).
import { ref } from 'vue'

// A one-line message for the next screen ("Published.").
export const flash = ref('')
// Holds the person left for later in this sitting, as "<id>.<voice>", so the queue does not offer them again straight away.
export const skipped = new Set()
