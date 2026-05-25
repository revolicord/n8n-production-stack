export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-qc-surface animate-pulse rounded ${className}`} aria-hidden="true" />;
}
