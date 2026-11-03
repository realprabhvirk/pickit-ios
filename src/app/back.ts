/**
 * Back navigation through the History API. Every screen, sheet, menu and alert that opens
 * pushes an entry, so the Safari back swipe (and Android-style back on desktop) closes the top
 * layer instead of leaving the app. Closing from the UI pops our entry to keep history in step.
 */
interface Entry {
  id: number;
  close: () => void;
}

const stack: Entry[] = [];
let seq = 0;
let ignorePops = 0;
let installed = false;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  history.replaceState({ pk: 0 }, '');
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    const top = stack.pop();
    top?.close();
  });
}

/**
 * Register an open layer. `close` runs if the user navigates back. Call the returned function
 * when the layer closes by any other means.
 */
export function pushBack(close: () => void): () => void {
  install();
  const id = ++seq;
  stack.push({ id, close });
  history.pushState({ pk: id }, '');
  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i < 0) return;
    const wasTop = i === stack.length - 1;
    stack.splice(i, 1);
    if (wasTop) {
      ignorePops++;
      history.back();
    }
  };
}

export const backDepth = () => stack.length;
