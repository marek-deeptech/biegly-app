"use client";

// Wspólne prymitywy UI: Spinner (profesjonalny preloader) + Button (warianty pasujące
// do dotychczasowego wyglądu apki, z hover/active/focus, blokadą i zamianą etykiety na
// czas akcji). Używać wszędzie tam, gdzie klik uruchamia operację (generowanie pliku,
// liczenie, zapis) — `loading` włącza spinner + `loadingLabel`.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Ładowanie"
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

// Pełnoszerokościowy pasek postępu (nieokreślony) — do sekcji, które renderują wynik
// dłuższej operacji (np. generowanie raportu). Subtelny, „profesjonalny".
export function ProgressBar({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-inksoft" role="status" aria-live="polite">
      <Spinner className="h-3 w-3" />
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-ink/50" />
      </div>
      {label && <span className="shrink-0">{label}</span>}
    </div>
  );
}

type Variant = "primary" | "outline" | "success" | "successSolid" | "danger" | "ghost";
type Size = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 uppercase tracking-wider transition-all duration-150 select-none " +
  "disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30";
const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-xs",
};
const VARIANTS: Record<Variant, string> = {
  primary: "border border-ink bg-ink text-paper hover:opacity-90 active:opacity-80",
  outline: "border border-ink text-ink hover:bg-ink hover:text-paper active:opacity-80",
  success: "border border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white active:opacity-80",
  successSolid: "border border-emerald-600 bg-emerald-600 text-white hover:opacity-90 active:opacity-80",
  danger: "border border-clay text-clay hover:bg-clay hover:text-paper active:opacity-80",
  ghost: "text-ink hover:bg-ink/[0.06] active:bg-ink/[0.1]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingLabel?: ReactNode;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner />}
      <span>{loading ? loadingLabel ?? children : children}</span>
    </button>
  );
}
