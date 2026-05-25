interface LetterBadgeProps {
  letter: 'A' | 'MS' | 'B' | 'C' | 'D';
}

export function LetterBadge({ letter }: LetterBadgeProps) {
  return (
    <span className="text-[9.5px] font-medium text-qc-teal500 bg-qc-teal700/15 px-1.5 py-0.5 rounded">
      {letter}
    </span>
  );
}
