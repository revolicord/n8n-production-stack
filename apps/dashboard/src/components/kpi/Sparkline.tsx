interface SparklineProps {
  data: number[];
}

export function Sparkline({ data }: SparklineProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 140;
  const height = 22;
  const step = width / Math.max(data.length - 1, 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="mt-1.5"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label="Sparkline"
      role="img"
    >
      <polyline points={points} fill="none" stroke="#14b8a6" strokeWidth={1.5} />
    </svg>
  );
}
