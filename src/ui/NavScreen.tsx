import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Button } from './Button';

interface NavScreenProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  trailing?: ComponentChildren;
  children: ComponentChildren;
  grouped?: boolean;
  id?: string;
}

/**
 * A pushed list screen: Large Title that collapses into the bar as you scroll, glass back
 * button, and the iOS 26 scroll edge effect where content passes under the bar.
 */
export function NavScreen({ title, onBack, backLabel = 'Back', trailing, children, grouped = true, id }: NavScreenProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const large = useRef<HTMLHeadingElement>(null);
  const small = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current!;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = el.scrollTop;
      const lt = large.current!;
      const fade = Math.min(1, Math.max(0, (y - 26) / 14));
      small.current!.style.opacity = String(fade);
      lt.style.opacity = String(1 - Math.min(1, Math.max(0, (y - 18) / 18)));
      // Pulling down past the top grows the title a little, as in UIKit.
      lt.style.transform = y < 0 ? `scale(${1 + Math.min(0.1, -y / 700)})` : '';
      edge.current!.classList.toggle('on', y > 4);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div class={`screen${grouped ? ' grouped' : ''}`} id={id} role="region" aria-label={title}>
      <div ref={scroller} class="scroll">
        <div class="nav-scroll-top" />
        <h1 ref={large} class="large-title t-large-title">
          {title}
        </h1>
        {children}
        <div style={{ height: 'calc(var(--safe-bottom) + 24px)' }} />
      </div>
      <div ref={edge} class="scroll-edge" style={{ '--edge-bg': grouped ? 'var(--grouped-bg)' : 'var(--bg)' }} />
      <div class="status-scrim on-light" />
      <header class="navbar">
        {onBack && (
          <div class="navbar-leading">
            <Button icon="chevron-left" aria={backLabel} circle onClick={onBack} />
          </div>
        )}
        <div ref={small} class="navbar-title" aria-hidden="true">
          {title}
        </div>
        {trailing && <div class="navbar-trailing">{trailing}</div>}
      </header>
    </div>
  );
}
