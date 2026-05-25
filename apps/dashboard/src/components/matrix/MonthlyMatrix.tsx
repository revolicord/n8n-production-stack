'use client';

import { MONTH_LABELS_ES, fmtNumber, fmtPct } from '@/lib/format';
import type { MonthlySeries } from '@/types';
import Link from 'next/link';
import { useState } from 'react';

interface MonthlyMatrixProps {
  series: MonthlySeries;
}

export function MonthlyMatrix({ series }: MonthlyMatrixProps) {
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const countRows = [
    { key: 'a', label: 'A', counts: series.months.map((m) => m.counts.a), total: series.totals.a },
    {
      key: 'ms',
      label: 'MS',
      counts: series.months.map((m) => m.counts.ms),
      total: series.totals.ms,
    },
    { key: 'b', label: 'B', counts: series.months.map((m) => m.counts.b), total: series.totals.b },
    { key: 'c', label: 'C', counts: series.months.map((m) => m.counts.c), total: series.totals.c },
    { key: 'd', label: 'D', counts: series.months.map((m) => m.counts.d), total: series.totals.d },
  ];

  const ratioRows = [
    {
      key: 'msr',
      label: 'MSR',
      values: series.months.map((m) => m.ratios.msr),
      avg: series.avgRatios.msr,
    },
    {
      key: 'prr',
      label: 'PRR',
      values: series.months.map((m) => m.ratios.prr),
      avg: series.avgRatios.prr,
    },
    {
      key: 'csr',
      label: 'CSR',
      values: series.months.map((m) => m.ratios.csr),
      avg: series.avgRatios.csr,
    },
    {
      key: 'abr',
      label: 'ABR',
      values: series.months.map((m) => m.ratios.abr),
      avg: series.avgRatios.abr,
    },
  ];

  function cellCls(col: number, row: string) {
    return [
      'px-1.5 py-1.5 text-right text-[11px] border-b border-qc-surface2 transition-colors',
      hoveredCol === col || hoveredRow === row ? 'bg-qc-teal500/[0.05] text-white' : '',
    ].join(' ');
  }

  return (
    <div className="bg-qc-surface border border-qc-border rounded-lg px-3 py-2.5 overflow-x-auto">
      <table className="w-full border-collapse text-[11px] min-w-[700px]">
        <thead>
          <tr>
            <th className="text-left px-1.5 py-1.5 text-qc-textSubtle font-medium text-[10.5px] uppercase tracking-wider">
              &nbsp;
            </th>
            {MONTH_LABELS_ES.map((m) => (
              <th
                key={m}
                className="text-right px-1.5 py-1.5 text-qc-textSubtle font-medium text-[10.5px] uppercase tracking-wider"
              >
                {m}
              </th>
            ))}
            <th className="text-right px-1.5 py-1.5 bg-qc-teal700/10 text-qc-teal50 font-medium text-[10.5px] uppercase tracking-wider">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {countRows.map((r) => (
            <tr
              key={r.key}
              onMouseEnter={() => setHoveredRow(r.key)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              <td className="text-left px-1.5 py-1.5 text-qc-textMuted font-medium">{r.label}</td>
              {r.counts.map((v, col) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: position is stable
                  key={col}
                  onMouseEnter={() => setHoveredCol(col)}
                  onMouseLeave={() => setHoveredCol(null)}
                  className={cellCls(col, r.key)}
                >
                  <Link
                    href={`/month/${series.year}/${String(col + 1).padStart(2, '0')}`}
                    className="block w-full text-right"
                  >
                    {v > 0 ? fmtNumber(v) : '—'}
                  </Link>
                </td>
              ))}
              <td className="text-right px-1.5 py-1.5 bg-qc-teal700/10 text-qc-teal50 font-medium">
                {fmtNumber(r.total)}
              </td>
            </tr>
          ))}

          {ratioRows.map((r, idx) => (
            <tr key={r.key} className={idx === 0 ? 'border-t border-qc-border' : ''}>
              <td className="text-left px-1.5 py-1.5 text-qc-textMuted font-medium">{r.label}</td>
              {r.values.map((v, col) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: position is stable
                  key={col}
                  onMouseEnter={() => setHoveredCol(col)}
                  onMouseLeave={() => setHoveredCol(null)}
                  className={`${cellCls(col, r.key)} text-qc-textMuted cursor-pointer`}
                >
                  <Link
                    href={`/month/${series.year}/${String(col + 1).padStart(2, '0')}`}
                    className="block w-full text-right"
                  >
                    {fmtPct(v, 0)}
                  </Link>
                </td>
              ))}
              <td className="text-right px-1.5 py-1.5 bg-qc-teal700/10 text-qc-teal50 font-medium">
                {fmtPct(r.avg, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
