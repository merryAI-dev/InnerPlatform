import { useEffect, useMemo, useState } from 'react';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ROULETTE_DIGITS = Array.from({ length: 4 }, () => DIGITS).flat();

function normalizeAmountText(value: string | number) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    return Math.trunc(value).toLocaleString('ko-KR');
  }
  return value;
}

export function RollingAmount({
  value,
  className = '',
  digitClassName = '',
}: {
  value: string | number;
  className?: string;
  digitClassName?: string;
}) {
  const text = normalizeAmountText(value);
  const [rolled, setRolled] = useState(false);

  useEffect(() => {
    setRolled(false);
    const frame = window.requestAnimationFrame(() => setRolled(true));
    return () => window.cancelAnimationFrame(frame);
  }, [text]);

  const chars = useMemo(() => text.split(''), [text]);

  return (
    <span className={`inline-flex items-center justify-end whitespace-nowrap tabular-nums ${className}`} aria-label={text}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-center justify-end">
        {chars.map((char, index) => {
          if (!/\d/.test(char)) {
            return (
              <span key={`${char}-${index}`} className="inline-block">
                {char}
              </span>
            );
          }
          const digit = Number(char);
          const orderFromRight = chars.length - index;
          const targetSlot = 20 + digit;
          return (
            <span
              key={`digit-${orderFromRight}`}
              className={`relative inline-block h-[1em] w-[0.62em] overflow-hidden align-[-0.1em] ${digitClassName}`}
            >
              <span
                className="absolute left-0 top-0 flex flex-col transition-transform ease-out motion-reduce:transition-none"
                style={{
                  transform: `translateY(-${rolled ? targetSlot : 0}em)`,
                  transitionDuration: `${520 + Math.min(orderFromRight, 8) * 54}ms`,
                  transitionDelay: `${Math.min(orderFromRight, 8) * 18}ms`,
                }}
              >
                {ROULETTE_DIGITS.map((candidate, slot) => (
                  <span key={`${candidate}-${slot}`} className="block h-[1em] leading-[1em]">
                    {candidate}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
