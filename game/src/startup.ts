const RELOADED_AT = "loype-tycoon:reloaded-at";
/** A second failure this soon after reloading is a real problem, not a stale page: stop and say so. */
const RELOAD_GUARD_MS = 60_000;

/**
 * Each deploy replaces every file, and the game's code is split into fingerprinted pieces.
 * A browser still holding the previous version asks for pieces that are gone; a fresh load fixes it.
 */
function looksLikeStaleBuild(err: unknown): boolean {
  return /dynamically imported module|importing a module script failed|unable to preload|failed to fetch/i.test(String(err));
}

/** Reload the page, unless it was already reloaded for this a moment ago. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) {
      return false;
    }
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export function watchForStaleBuild() {
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadOnce()) {
      e.preventDefault();
    }
  });
}

export function showStartupError(err: unknown) {
  if (looksLikeStaleBuild(err) && reloadOnce()) {
    return;
  }
  document.getElementById("loading")?.remove();
  const box = document.createElement("div");
  box.id = "startup-error";
  box.innerHTML = `
    <div class="card">
      <div class="icon">🚜💨</div>
      <h1>Gamle Gunnar fikk ikke startet</h1>
      <p>Noe gikk galt da spillet skulle lastes. Ofte hjelper det å laste inn siden på nytt.</p>
      <button>Last inn på nytt</button>
      <p class="details"></p>
    </div>`;
  box.querySelector(".details")!.textContent = String(err);
  box.querySelector("button")!.addEventListener("click", () => location.reload());
  document.body.appendChild(box);
}
