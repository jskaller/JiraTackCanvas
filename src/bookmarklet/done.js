const FLASH_MS = 400;
const HOLD_MS = 1500;
const FADE_MS = 300;

export function playDoneAnimation({ pinEl, cardEl, onComplete }) {
  if (pinEl) {
    pinEl.classList.add('jiratack-pin-done-flash');
  }
  if (cardEl) {
    cardEl.classList.add('jiratack-ticket-done-flash');
  }

  window.setTimeout(() => {
    if (pinEl) {
      pinEl.classList.remove('jiratack-pin-done-flash');
      pinEl.classList.add('jiratack-pin-done');
      pinEl.classList.add('jiratack-pin-fade');
    }
    if (cardEl) {
      cardEl.classList.remove('jiratack-ticket-done-flash');
      cardEl.classList.add('jiratack-ticket-done');
      cardEl.classList.add('jiratack-ticket-fade');
    }

    window.setTimeout(() => {
      if (pinEl) {
        pinEl.style.display = 'none';
      }
      if (onComplete) onComplete();
    }, FADE_MS);
  }, FLASH_MS + HOLD_MS);
}
