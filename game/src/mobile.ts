const TIPS_SEEN = "loype-tycoon:touch-tips-seen";

/** A phone or tablet with only a touchscreen: no mouse, trackpad or pen to point with. */
export function touchOnly(): boolean {
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

/** The first time the game opens on a touchscreen, show the three things a finger needs to know. */
export function showTouchTips() {
  try {
    if (!touchOnly() || localStorage.getItem(TIPS_SEEN)) {
      return;
    }
  } catch {
    if (!touchOnly()) {
      return;
    }
  }
  const box = document.createElement("div");
  box.id = "touch-tips";
  box.innerHTML = `
    <div class="card">
      <h1>Slik spiller du på mobil</h1>
      <ul>
        <li>Trykk der løypa skal gå, sjekk planen og trykk <strong>Lag løype</strong>.</li>
        <li>Én finger flytter kartet, to fingre zoomer.</li>
        <li><strong>⛷▴</strong> nederst bytter verktøy, og <strong>↶</strong> angrer.</li>
      </ul>
      <p class="note">Spillet er laget for datamaskin først, så noe er fortsatt enklere med mus og tastatur.</p>
      <button>Sett i gang</button>
    </div>`;
  box.querySelector("button")!.addEventListener("click", () => {
    try {
      localStorage.setItem(TIPS_SEEN, "1");
    } catch {
      // Shown again next time; no harm done.
    }
    box.remove();
  });
  document.body.appendChild(box);
}
