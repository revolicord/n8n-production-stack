interface PillProps {
  label: string;
  tone?: 'teal' | 'warning' | 'danger' | 'info';
}

const TONE_CLASSES: Record<string, string> = {
  teal: 'bg-qc-teal700/15 text-qc-teal50',
  warning: 'bg-yellow-500/15 text-yellow-400',
  danger: 'bg-red-500/15 text-qc-danger',
  info: 'bg-blue-500/15 text-qc-info',
};

export function Pill({ label, tone = 'teal' }: PillProps) {
  const cls = TONE_CLASSES[tone] ?? TONE_CLASSES.teal;
  return (
    <span
      className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}
