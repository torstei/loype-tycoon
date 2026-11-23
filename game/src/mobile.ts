const TRY_ANYWAY = "loype-tycoon:try-anyway";

/** A phone or tablet with only a touchscreen: no mouse, trackpad or pen to point with. */
export function touchOnly(): boolean {
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

/**
 * The game needs a mouse and a keyboard. On a touch-only device, say so before loading the map,
 * offer to send the link on to a computer, and let the curious carry on anyway.
 */
export function waitForTouchChoice(): Promise<void> {
  try {
    if (!touchOnly() || sessionStorage.getItem(TRY_ANYWAY)) {
      return Promise.resolve();
    }
  } catch {
    if (!touchOnly()) {
      return Promise.resolve();
    }
  }
  document.getElementById("loading")?.setAttribute("hidden", "");
  const url = location.href.split(/[?#]/)[0];
  const box = document.createElement("div");
  box.id = "touch-notice";
  box.innerHTML = `
    <div class="card">
      <div class="icon">⛷🚜</div>
      <h1>Løype Tycoon trenger en datamaskin</h1>
      <p>Foreløpig, i hvert fall. Løypene dras med musa, og tråkkemannskapet styres med tastaturet.
        Det går dessverre ikke på mobil eller nettbrett ennå.</p>
      <p>Gamle Gunnar står i garasjen og venter. Åpne spillet på en PC eller Mac:</p>
      <p class="url">${url.replace(/^https?:\/\//, "")}</p>
      <div class="actions">
        ${"share" in navigator ? `<button data-touch="share">Send lenken til deg selv</button>` : ""}
        <button data-touch="copy">Kopier lenken</button>
      </div>
      <div class="anyway">
        <p>Vil du prøve likevel? Det blir frustrerende og smertefullt, og det kommer trolig til å ødelegge skiene dine.</p>
        <button data-touch="anyway">Prøv likevel, på eget ansvar</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  return new Promise((resolve) => {
    box.addEventListener("click", async (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      const action = button?.dataset.touch;
      if (action === "anyway") {
        try {
          sessionStorage.setItem(TRY_ANYWAY, "1");
        } catch {
          // Without session storage the question comes back on the next reload; no harm done.
        }
        box.remove();
        document.getElementById("loading")?.removeAttribute("hidden");
        resolve();
      } else if (action === "share") {
        try {
          await navigator.share({ title: "Løype Tycoon", text: "Løype Tycoon — åpnes på PC eller Mac", url });
        } catch {
          // The player closed the share sheet.
        }
      } else if (action === "copy" && button) {
        try {
          await navigator.clipboard.writeText(url);
          button.textContent = "Kopiert!";
        } catch {
          button.textContent = "Kunne ikke kopiere";
        }
      }
    });
  });
}
