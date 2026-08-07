/**
 * Okres badany sprawy — JEDNO źródło dla wszystkich rozdziałów liczbowych.
 *
 * ⚠️ POWÓD ISTNIENIA. Każdy skrypt rozdziału brał okno skądinąd: IV.1 z całego
 * zakresu metryk, IV.4/IV.5/IV.6 z ręcznych flag `--od/--do`. Dla ZASTAL dało to
 * dwie różne fazy wzrostowe CSY w jednej opinii — +1175 % (od 4.12.2017, pierwsza
 * sesja w metrykach) w rozdziale IV.1 i +920 % (od 11.12.2017, data z postanowienia)
 * w IV.5. Obie liczby były poprawnie policzone; sprzeczne było wejście.
 *
 * Okres badany pochodzi z POSTANOWIENIA i biegły wpisuje go w konfiguracji kroku 4.
 * Zakres metryk zależy od tego, jaki plik akurat policzono — nie jest ustaleniem.
 */
export type Okres = { od: string; do: string; zrodlo: "konfiguracja" | "flagi" };

type Sub = { kind: string; data?: Record<string, unknown> | null };

/**
 * Zwraca okres badany z konfiguracji kroku 4 albo z jawnych flag skryptu.
 * Rzuca wyjątkiem, gdy nie ma żadnego z nich — cichy brak okna oznaczałby
 * rozdział policzony na przypadkowym zakresie danych.
 */
export function okresBadany(subs: Sub[], nadpisanie?: { od?: string | null; do?: string | null }): Okres {
  if (nadpisanie?.od && nadpisanie?.do) return { od: nadpisanie.od, do: nadpisanie.do, zrodlo: "flagi" };
  const cfg = (subs.find((s) => s.kind === "ekofin_dane")?.data as { config?: { odBadany?: string; doBadany?: string } } | null)?.config;
  const od = nadpisanie?.od ?? cfg?.odBadany ?? null;
  const doD = nadpisanie?.do ?? cfg?.doBadany ?? null;
  if (!od || !doD)
    throw new Error(
      "brak okresu badanego — uzupełnij daty z postanowienia w konfiguracji kroku 4 " +
        "(ekofin_dane.config.odBadany/doBadany) albo podaj --od i --do",
    );
  return { od, do: doD, zrodlo: nadpisanie?.od || nadpisanie?.do ? "flagi" : "konfiguracja" };
}

/** Filtr sesji po oknie; metryki bez daty (agregaty całego okresu) przechodzą. */
export function wOknie(o: Okres): (d?: string | null) => boolean {
  return (d) => !d || (d >= o.od && d <= o.do);
}

/** Zdanie do ustaleń rozdziału — czytelnik musi wiedzieć, jaki odcinek liczono. */
export function opisOkresu(o: Okres): string {
  return (
    `Wszystkie wielkości liczbowe rozdziału odnoszą się do okresu ${o.od}–${o.do}` +
    (o.zrodlo === "konfiguracja"
      ? " (okres badany wskazany w postanowieniu, zapisany w konfiguracji kroku 4)."
      : " (okno podane ręcznie przy uruchomieniu — sprawdź zgodność z postanowieniem).")
  );
}
