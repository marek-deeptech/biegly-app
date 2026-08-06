// REJESTR MATERIAŁÓW BRAKUJĄCYCH DO ROZDZIAŁU IV (dziedzina GPW).
//
// PO CO: rozdział IV powstaje z siedmiu modułów, a każdy z nich stoi na innym
// materiale. Bez jednego miejsca, w którym widać „czego jeszcze nie ma i do czego
// to potrzebne", braki wychodzą dopiero przy montażu opinii — albo nie wychodzą
// wcale i rozdział milczy o tym, że czegoś nie zbadano.
//
// ⚠️ REJESTR JEST WYLICZANY, NIE PISANY RĘCZNIE. Lista wpisana raz w prozę
// dezaktualizuje się przy pierwszym ingeście i zaczyna kłamać o stanie akt.
// Tutaj każdy wpis ma WARUNEK — znika sam, gdy materiał trafi do sprawy.
//
// Każdy brak mówi trzy rzeczy, których biegły potrzebuje do decyzji: co dokładnie
// jest potrzebne, DO CZEGO w opinii (która tabela/wykres/ustalenie) i SKĄD to wziąć
// wraz z tym, kto ma to dostarczyć — sąd/organ czy sam biegły ze źródeł publicznych.

export type KtoDostarcza = "biegły (źródła publiczne)" | "organ / strony" | "biegły albo organ";

export type Brak = {
  podrozdzial: string;
  czego: string;
  /** Element opinii, który bez tego nie powstanie. */
  doCzego: string;
  skad: string;
  kto: KtoDostarcza;
};

export type WejscieBrakow = {
  /** kind → dane subanalizy (mogą być puste). */
  subanalizy: Map<string, Record<string, unknown> | null>;
  /** doc_type → liczba dokumentów w aktach. */
  licznikTypow: Record<string, number>;
  /** Klucze metryk obecnych w sprawie (do sprawdzenia, czy technika była liczona). */
  klucze: Set<string>;
  /** Instrumenty sprawy (np. ["CSY", "RSY"]) — do braków per emitent. */
  instrumenty: string[];
};

const lista = (d: Record<string, unknown> | null | undefined, k: string): string[] =>
  Array.isArray(d?.[k]) ? (d![k] as unknown[]).map(String).filter(Boolean) : [];

/**
 * Składa rejestr braków rozdziału IV ze stanu sprawy.
 *
 * Wpisy pochodzą z dwóch źródeł: (1) rejestrów `doPozyskania` prowadzonych przez
 * moduły (krok 4 wie, których notowań mu brakuje), (2) katalogu warunkowego niżej —
 * wymogów, których żaden moduł nie zgłasza, bo bez materiału w ogóle nie startuje.
 */
export function zbudujBrakiIV(w: WejscieBrakow): { braki: Brak[]; pokrycie: { gotowe: number; wszystkie: number } } {
  const braki: Brak[] = [];
  const sub = (k: string) => w.subanalizy.get(k) ?? null;
  const ma = (typ: string) => (w.licznikTypow[typ] ?? 0) > 0;
  const maMetryke = (pfx: string) => [...w.klucze].some((k) => k.startsWith(pfx));

  // ── IV.1 — z rejestru kroku 4 (moduł sam wie, czego mu brak) ───────────────
  for (const d of lista(sub("ekofin_dane"), "doPozyskania")) {
    const notowania = /notowania dzienne/i.test(d);
    braki.push({
      podrozdzial: "IV.1",
      czego: d.split("(")[0].trim(),
      doCzego: notowania
        ? "kontrast obrotu od debiutu i wykres pełnej historii kursu (Wykres 1 wzorca)"
        : /porównawcz/i.test(d)
          ? "wykres porównawczy emitent vs mediana branży (=100) i tabela indeksu"
          : /wskaźniki portali/i.test(d)
            ? "tabela wskaźników wartości rynkowej (C/Z, C/WK, C/P, EV/P) z medianą branży"
            : "tabela dynamiki pozycji sprawozdawczych",
      skad: d.includes("stooq") || d.includes("NewConnect")
        ? "stooq.pl (spółki notowane) albo archiwum notowań GPW/NewConnect (spółki wykluczone z obrotu)"
        : "stooq.pl / stockwatch.pl / biznesradar.pl",
      kto: "biegły (źródła publiczne)",
    });
  }
  if (!ma("SPRAWOZDANIE_FIN"))
    braki.push({
      podrozdzial: "IV.1",
      czego: "sprawozdania finansowe emitentów za okres badany i okres porównawczy",
      doCzego: "test falsyfikacji: czy dynamika kursu ma oparcie w fundamentach",
      skad: "raporty okresowe emitentów (espiebi.pap.pl — załączniki) albo akta sprawy",
      kto: "biegły albo organ",
    });

  // ── IV.2 ───────────────────────────────────────────────────────────────────
  if (!sub("espi_events"))
    braki.push({
      podrozdzial: "IV.2",
      czego: "rejestr raportów bieżących i okresowych ESPI/EBI emitentów za okres badany",
      doCzego: "zestawienie raportów (tabele wzorca nr 6–7) i ocena wydźwięku informacyjnego",
      skad: "espiebi.pap.pl — wyszukiwarka po nazwie spółki i zakresie dat",
      kto: "biegły (źródła publiczne)",
    });

  // ── IV.3–IV.6 — techniki: materiał transakcyjny ───────────────────────────
  if (!ma("DANE_UTP") && !ma("DANE_TREM"))
    braki.push({
      podrozdzial: "IV.3–IV.6",
      czego: "arkusz transakcji i zleceń (UTP/TREM) za okres objęty postanowieniem",
      doCzego: "wszystkie tabele aktywności Grupy oraz detektory wash/IMO/layering",
      skad: "GPW / UKNF — załączniki zawiadomienia albo wystąpienie organu",
      kto: "organ / strony",
    });
  else if (!maMetryke("cancel_"))
    braki.push({
      podrozdzial: "IV.6",
      czego: "arkusz ZLECEŃ (nie tylko transakcji) — z czasem złożenia, modyfikacji i anulowania",
      doCzego: "relacja wolumenu anulowanego do złożonego per podmiot (tabele wzorca nr 38–40)",
      skad: "GPW / UKNF — pełne dane zleceń sesyjnych",
      kto: "organ / strony",
    });

  // ── IV.7 ───────────────────────────────────────────────────────────────────
  if (!ma("DANE_IP"))
    braki.push({
      podrozdzial: "IV.7",
      czego: "logi adresów IP logowań do rachunków maklerskich",
      doCzego: "wykres powiązań przez wspólne adresy IP (Wykres 5 wzorca)",
      skad: "domy maklerskie — na żądanie organu",
      kto: "organ / strony",
    });
  if (!ma("KRS_REJESTR"))
    braki.push({
      podrozdzial: "IV.7",
      czego: "odpisy KRS podmiotów z Grupy (pełne, z historią organów)",
      doCzego: "macierz powiązań osobowych i kapitałowych",
      skad: "API Ministerstwa Sprawiedliwości (api-krs.ms.gov.pl) — odpisy pełne",
      kto: "biegły (źródła publiczne)",
    });

  // ── wstęp rozdziału IV — luki oznaczone w prozie ──────────────────────────
  for (const l of lista(sub("proza_iv"), "lukiOtwarte"))
    braki.push({
      podrozdzial: "IV (wstęp)",
      czego: l,
      doCzego: "wstęp rozdziału IV — opis przedmiotu obrotu i reżimu notowań",
      skad: "uchwały Zarządu GPW oraz dokumenty informacyjne emitentów",
      kto: "biegły albo organ",
    });

  const wszystkie = 7;
  const gotowe = ["IV.1", "IV.2", "IV.3", "IV.4", "IV.5", "IV.6", "IV.7"].filter(
    (p) => !braki.some((b) => b.podrozdzial.startsWith(p)),
  ).length;
  return { braki, pokrycie: { gotowe, wszystkie } };
}

/** Tabela rejestru do rozdziału i do panelu — jeden układ kolumn w obu miejscach. */
export function tabelaBrakow(braki: Brak[]) {
  return {
    caption: "Tabela. Materiały brakujące do rozdziału IV — co, do czego i skąd",
    head: ["Podrozdział", "Czego brakuje", "Do czego potrzebne", "Skąd pozyskać", "Kto dostarcza"],
    rows: braki.map((b) => [b.podrozdzial, b.czego, b.doCzego, b.skad, b.kto]),
  };
}
