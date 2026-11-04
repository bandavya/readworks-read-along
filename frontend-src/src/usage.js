// This app's one instance of the data kit (src/dataKit). Readers import record and trackPlayback from here.
import { DATA_OPTIONS } from './dataKit/options.js'
import { createUsage } from './dataKit/usage.js'

export const usage = createUsage({ options: DATA_OPTIONS, limit: import.meta.env?.VITE_DATA_OPTIONS })
export const { record, trackPlayback } = usage
