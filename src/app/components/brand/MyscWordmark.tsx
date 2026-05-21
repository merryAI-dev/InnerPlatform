type MyscWordmarkTone = 'light' | 'onDark' | 'white';

type MyscWordmarkSize = 'sm' | 'md' | 'lg';

const WORDMARK_SRC: Record<MyscWordmarkTone, string> = {
  light: '/brand/myscube-logo-light.png',
  onDark: '/brand/myscube-logo-on-dark.png',
  white: '/brand/myscube-logo-white.png',
};

const WORDMARK_SIZE_CLASS: Record<MyscWordmarkSize, string> = {
  sm: 'h-5',
  md: 'h-7',
  lg: 'h-10',
};

export function MyscWordmark({
  className = '',
  imageClassName = '',
  tone = 'light',
  size = 'md',
}: {
  className?: string;
  imageClassName?: string;
  tone?: MyscWordmarkTone;
  size?: MyscWordmarkSize;
}) {
  return (
    <div className={`inline-flex items-center ${className}`.trim()}>
      <img
        src={WORDMARK_SRC[tone]}
        alt="MYSCube"
        width={1356}
        height={395}
        className={`${WORDMARK_SIZE_CLASS[size]} w-auto select-none object-contain ${imageClassName}`.trim()}
        draggable={false}
      />
    </div>
  );
}
