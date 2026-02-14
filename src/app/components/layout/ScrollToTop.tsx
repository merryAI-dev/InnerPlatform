import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronUp } from 'lucide-react';

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const scrollElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.querySelector('main');
    if (!el) return;
    scrollElRef.current = el as HTMLElement;

    const handleScroll = () => {
      setVisible(el.scrollTop > 400);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollElRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <button
      onClick={scrollToTop}
      aria-label="맨 위로 스크롤"
      className="fixed bottom-14 right-5 z-40 w-9 h-9 rounded-xl bg-card border border-border/60 shadow-lg shadow-black/5 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 hover:shadow-primary/10 transition-all duration-300 group"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.9)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <ChevronUp className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform duration-200" />
    </button>
  );
}
