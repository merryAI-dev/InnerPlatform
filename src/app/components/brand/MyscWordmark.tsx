export function MyscWordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-flex items-center ${className}`.trim()}>
      <svg viewBox="0 0 72 72" className="h-6 w-6 md:h-7 md:w-7" role="img" aria-label="MYSC">
        <circle cx="21" cy="19" r="10.5" fill="#61b7d7" />
        <path
          d="M28.4 39.7c4.8 10.6 15.8 16.8 26.8 15.2-4.8 5.6-11.8 8.8-19.4 8.8-13.9 0-25.3-10.6-26.6-24.3l19.2 0.3Z"
          fill="#61b7d7"
        />
      </svg>
    </div>
  );
}
