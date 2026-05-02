const PERSISTED_STORE_KEYS = ["mcd-trains-cache-v2"]

export function resetPersistedAppStores() {
  if (typeof window === "undefined") {
    return
  }

  try {
    for (const key of PERSISTED_STORE_KEYS) {
      window.localStorage.removeItem(key)
    }
  } catch (error) {
    console.error("[app-reset] failed to clear persisted stores", error)
  }
}
