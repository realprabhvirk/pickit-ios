import type { VNode } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { popScreen, removeScreen, screens, type ScreenEntry, type ScreenName } from './nav';
import { isStandalone } from './env';
import { SpringValue, VelocityTracker, prefersReducedMotion, project, springAnimate, springs } from '../design/motion';
import { Picker } from '../screens/Picker';
import { Editor } from '../screens/Editor';
import { Settings } from '../screens/Settings';
import { About } from '../screens/About';
import { Offline } from '../screens/Offline';
import { Batch } from '../screens/Batch';

const RENDER: Record<ScreenName, () => VNode> = {
  picker: () => <Picker />,
  editor: () => <Editor />,
  settings: () => <Settings />,
  about: () => <About />,
  offline: () => <Offline />,
  batch: () => <Batch />,
};

const frames = new Map<number, HTMLDivElement>();
let popVelocity = 0;

/** The live screen under `key`, if any. */
function frameBelow(key: number): HTMLDivElement | undefined {
  const live = screens.value.filter((s) => !s.leaving || s.key === key);
  const i = live.findIndex((s) => s.key === key);
  return i > 0 ? frames.get(live[i - 1].key) : undefined;
}

/** Parallax for the screen underneath a push: it slides a third of the way and dims slightly. */
function placeBelow(below: HTMLDivElement | undefined, x: number, width: number) {
  if (!below) return;
  const progress = width ? 1 - x / width : 0;
  below.style.transform = progress > 0.001 ? `translate3d(${(-0.3 * width * progress).toFixed(2)}px,0,0)` : '';
  below.style.setProperty('--cover', (0.1 * progress).toFixed(3));
}

export function ScreenHost() {
  return (
    <>
      {screens.value.map((s, i) => (
        <ScreenFrame key={s.key} entry={s} index={i} />
      ))}
    </>
  );
}

function ScreenFrame({ entry, index }: { entry: ScreenEntry; index: number }) {
  const el = useRef<HTMLDivElement>(null);
  const x = useRef<SpringValue | null>(null);
  const width = () => el.current?.clientWidth || window.innerWidth;

  useLayoutEffect(() => {
    const node = el.current!;
    frames.set(entry.key, node);
    if (index === 0) return () => frames.delete(entry.key);

    if (entry.style === 'push') {
      const w = width();
      x.current = new SpringValue(w, (v) => {
        // At rest, no transform at all: text then renders at full sharpness.
        node.style.transform = Math.abs(v) < 0.01 ? '' : `translate3d(${v.toFixed(2)}px,0,0)`;
        placeBelow(frameBelow(entry.key), v, width());
      }, springs.smooth, 0.5);
      if (prefersReducedMotion()) {
        x.current.set(0);
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
      } else {
        x.current.set(w);
        x.current.animateTo(0, { params: springs.smooth });
      }
    } else {
      springAnimate(node, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'scale(1)' }], springs.smooth);
    }
    return () => {
      frames.delete(entry.key);
      x.current?.stop();
    };
  }, []);

  // Leaving: slide back out the way it came (or fade, for the editor), then unmount.
  useEffect(() => {
    if (!entry.leaving) return;
    const node = el.current!;
    // Photos stay open when the editor is left; the picker offers to go back to them.
    const done = () => removeScreen(entry.key);
    if (entry.style === 'push' && x.current) {
      const v = popVelocity;
      popVelocity = 0;
      if (prefersReducedMotion()) {
        placeBelow(frameBelow(entry.key), width(), width());
        node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.then(done, done);
      } else {
        x.current.animateTo(width(), { velocity: v, params: springs.smooth }).then(done);
      }
    } else {
      const below = frameBelow(entry.key);
      placeBelow(below, 1, 1);
      springAnimate(node, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.97)' }], { response: 0.3, damping: 1 }).finished.then(
        done,
        done,
      );
    }
  }, [entry.leaving]);

  // Interactive back swipe from the left edge for pushed screens. In a Safari tab the system
  // swipe already does this (through history), so only installed apps get our own.
  const edge = useRef<{ x0: number; t: VelocityTracker } | null>(null);
  const canSwipe = entry.style === 'push' && index > 0 && isStandalone();

  const onDown = (e: PointerEvent) => {
    if (!canSwipe || entry.leaving || !x.current) return;
    const r = el.current!.getBoundingClientRect();
    if (e.clientX - r.left > 24) return;
    el.current!.setPointerCapture(e.pointerId);
    x.current.stop();
    edge.current = { x0: e.clientX - x.current.value, t: new VelocityTracker() };
    edge.current.t.add(e.clientX, 0);
  };
  const onMove = (e: PointerEvent) => {
    const g = edge.current;
    if (!g || !x.current) return;
    x.current.set(Math.max(0, e.clientX - g.x0));
    g.t.add(e.clientX, 0);
  };
  const onUp = () => {
    const g = edge.current;
    edge.current = null;
    if (!g || !x.current) return;
    const v = g.t.velocity().x;
    const projected = x.current.value + project(v, 0.99);
    if (projected > width() / 2) {
      popVelocity = v;
      popScreen();
    } else {
      x.current.animateTo(0, { velocity: v, params: springs.smooth });
    }
  };

  return (
    <div
      ref={el}
      class={`screen-frame${entry.style === 'push' && index > 0 ? ' push' : ''}`}
      aria-hidden={entry.leaving ? 'true' : undefined}
      onPointerDownCapture={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {RENDER[entry.name]()}
    </div>
  );
}
