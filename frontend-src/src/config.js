// The iac lane's build-time setting. api.js is owned by the fixhelp lane.
// The published index contains a versioned `document` path for each passage.
export const publishedDataBase = import.meta.env.VITE_PUBLISHED_DATA_BASE || null
export const contentAssetBase = import.meta.env.VITE_CONTENT_ASSET_BASE || null
