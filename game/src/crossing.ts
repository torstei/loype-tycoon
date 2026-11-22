import { CrossingOption } from "./tracks";

const kr = (n: number) => `${n.toLocaleString("nb-NO")} kr`;

export interface CrossingQuestion {
  title: string;
  lead: string;
  options: CrossingOption[];
}

/**
 * Ask how a track should get across a road or the railway, Railroad Tycoon style. Keys 1–3
 * pick an option and Escape cancels; the game's own key handling is held off while it is open.
 */
export function askCrossing(
  question: CrossingQuestion,
  groundCost: number,
  budget: number,
  choose: (option: CrossingOption) => void,
  cancel: () => void,
) {
  const panel = document.getElementById("crossing")!;
  const { options, title, lead } = question;
  panel.innerHTML = `
    <div class="card">
      <h3>${title}</h3>
      <p class="lead">${lead}</p>
      ${options
        .map((o, i) => {
          const total = groundCost + o.price;
          const short = total > budget;
          return `<button data-i="${i}" ${short ? "disabled" : ""}>
            <span class="key">${i + 1}</span>
            <span class="what"><strong>${o.name}</strong><br><small>${o.note}</small></span>
            <span class="price ${short ? "short" : ""}">${kr(total)}</span>
          </button>`;
        })
        .join("")}
      <button data-i="-1" class="cancel"><span class="key">Esc</span><span class="what">Avbryt</span></button>
    </div>`;
  panel.hidden = false;

  const close = () => {
    panel.hidden = true;
    panel.removeEventListener("click", onClick);
    window.removeEventListener("keydown", onKey, true);
  };
  const pick = (i: number) => {
    const option = options[i];
    if (option && groundCost + option.price <= budget) {
      close();
      choose(option);
    }
  };
  const onClick = (e: MouseEvent) => {
    const button = (e.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    const i = Number(button.dataset.i);
    if (i < 0) {
      close();
      cancel();
    } else {
      pick(i);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.code === "Escape") {
      close();
      cancel();
    } else if (/^(Digit|Numpad)[1-9]$/.test(e.code)) {
      pick(Number(e.code.slice(-1)) - 1);
    }
  };
  panel.addEventListener("click", onClick);
  window.addEventListener("keydown", onKey, true);
}
