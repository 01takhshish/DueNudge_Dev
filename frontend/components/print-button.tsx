'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium hover:bg-ink-100"
    >
      Print / save as PDF
    </button>
  );
}
