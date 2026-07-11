export function Sparkline({
  data,
  height = 28,
  color = 'currentColor',
}: {
  data: number[];
  height?: number;
  color?: string;
}) {
  if (data.length < 2) {
    return (
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2="100" y2={height / 2} stroke={color} strokeOpacity={0.2} strokeWidth={1.5} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = 100 / (data.length - 1);

  const points = data
    .map((value, i) => {
      const x = i * stepX;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
