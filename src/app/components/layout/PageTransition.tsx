import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

/**
 * Subtle page transition wrapper
 * Fades in content on route change with a minimal upward slide
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [animKey, setAnimKey] = useState(location.pathname);
  const [phase, setPhase] = useState<'enter' | 'idle'>('enter');

  useEffect(() => {
    setAnimKey(location.pathname);
    setPhase('enter');
    const timer = requestAnimationFrame(() => {
      // Force reflow, then transition to idle
      requestAnimationFrame(() => {
        setPhase('idle');
      });
    });
    return () => cancelAnimationFrame(timer);
  }, [location.pathname]);

  return (
    <div
      key={animKey}
      style={{
        opacity: phase === 'enter' ? 0 : 1,
        transform: phase === 'enter' ? 'translateY(6px)' : 'translateY(0)',
        transition: 'opacity 220ms ease-out, transform 220ms ease-out',
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}
