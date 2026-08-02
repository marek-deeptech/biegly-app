// Moduł „Chronologia nadzorcza" — wskaźniki banku w czasie wraz z działaniami nadzoru.
//
// KIEDY JEST POTRZEBNY
// Gdy pytanie brzmi „W JAKIM CZASIE" zamiast „czy w dniu X". W sprawie SK Banku
// (II C 595/23) teza dowodowa żąda ustalenia, kiedy pozwani mogli rozsądnie uznać, że
// bank nie ma stabilnej sytuacji finansowej — a odpowiedzią jest oś czasu, nie stan
// na jeden dzień.
//
// DLACZEGO NIE WYSTARCZY MODUŁ `sprawozdania`
// Tamten czyta sprawozdanie finansowe: kolumny są datami. Tutaj źródłem jest narracja
// nadzorcza — harmonogram działań, wystąpienie pokontrolne, korespondencja — w której
// daty siedzą w zdaniach, a tabele są wplecione między akapity i po OCR mają pomieszane
// kolumny. Odczyt robi model; liczy i sprawdza `engine/chronologia.py`.
import type { Tabela } from "./warsztat-bank";

export type OkresNadzorczy = {
  dzien: string;
  /** Fragment narracji, z którego wynika data — bez niego nie da się sprawdzić przypisania. */
  kontekst: string;
  suma_bilansowa?: number;
  portfel_kredytowy?: number;
  portfel_utrata?: number;
  udzial_utrata_pct?: number;
  depozyty?: number;
  fundusze_wlasne?: number;
  wsp_wyplacalnosci_pct?: number;
  wynik_finansowy?: number;
  /** Jednostka kwot W TYM dokumencie — „zł”, „tys. zł”, „mln zł”. */
  jednostka?: string;
  plik?: string;
};

/** Mnożnik do złotych. Nierozpoznana jednostka daje null — wtedy okres jest oznaczany, nie zgadywany. */
export function mnoznik(jednostka?: string): number | null {
  const j = (jednostka ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!j || /^(zł|pln)$/.test(j)) return j ? 1 : null;
  if (/tys/.test(j)) return 1_000;
  if (/mln|milion/.test(j)) return 1_000_000;
  if (/mld|miliard/.test(j)) return 1_000_000_000;
  return null;
}

const POLA_KWOTOWE = [
  "suma_bilansowa",
  "portfel_kredytowy",
  "portfel_utrata",
  "depozyty",
  "fundusze_wlasne",
  "wynik_finansowy",
] as const;

/**
 * Sprowadzenie kwot do ZŁOTYCH.
 *
 * ⚠️ BEZ TEGO TABELA MIESZA SKALE. Harmonogram UKNF podaje kwoty w tysiącach złotych,
 * a pisma procesowe w złotych — model przepisuje jedne i drugie wiernie, zgodnie
 * z regułą „nie przeliczaj". W jednej kolumnie stają wtedy obok siebie 1 578 i
 * 3 828 641 288: różnica miliona razy, wyglądająca jak eksplozja sumy bilansowej.
 * Przeliczenie jest OBLICZENIEM, więc robi je kod, a nie model.
 */
export function doZlotych(okresy: OkresNadzorczy[]): { okresy: OkresNadzorczy[]; uwagi: string[] } {
  const uwagi: string[] = [];
  const out = okresy.map((o) => {
    const m = mnoznik(o.jednostka);
    const maKwoty = POLA_KWOTOWE.some((k) => o[k] != null);
    if (!maKwoty) return o;
    if (m == null) {
      uwagi.push(
        `${o.dzien}: nie podano jednostki kwot (${o.plik ?? "?"}) — wartości zostawiono bez przeliczenia; ` +
          "porównanie z innymi okresami może wprowadzać w błąd.",
      );
      return o;
    }
    if (m === 1) return o;
    const kopia = { ...o };
    for (const k of POLA_KWOTOWE) if (kopia[k] != null) kopia[k] = kopia[k]! * m;
    return kopia;
  });
  return { okresy: out, uwagi };
}

/**
 * Skok skali między sąsiednimi okresami — resztkowy sygnał pomieszanych jednostek.
 *
 * Suma bilansowa banku nie rośnie stukrotnie w kwartał. Taki skok znaczy, że jeden
 * z okresów jest w innej jednostce, mimo deklaracji — i jest to jedyny sygnał, jaki
 * zostaje po tym, jak przeliczenie już się odbyło.
 */
export function skokiSkali(okresy: OkresNadzorczy[]): string[] {
  const uwagi: string[] = [];
  const posort = [...okresy].sort((a, b) => a.dzien.localeCompare(b.dzien));
  for (const pole of POLA_KWOTOWE) {
    const punkty = posort
      .map((o) => ({ d: o.dzien, v: o[pole] }))
      .filter((x): x is { d: string; v: number } => typeof x.v === "number" && x.v !== 0);
    for (const [a, b] of punkty.map((x, i) => [x, punkty[i + 1]] as const).filter(([, y]) => y)) {
      const iloraz = Math.abs(b.v / a.v);
      if (iloraz > 100 || iloraz < 0.01)
        uwagi.push(
          `${a.d} → ${b.d}: „${pole.replace(/_/g, " ")}” zmienia się ${iloraz > 1 ? iloraz.toFixed(0) + "-krotnie" : "do " + (100 * iloraz).toFixed(1) + "%"} ` +
            "— to skala nieosiągalna dla banku w jednym okresie; najpewniej jeden z okresów jest w innej jednostce.",
        );
    }
  }
  return uwagi;
}

export type ZdarzenieNadzorcze = { data: string; organ: string; opis: string; plik?: string };

/**
 * Wspólna preambuła — WIĄŻE EKSTRAKCJĘ Z JEDNYM PODMIOTEM.
 *
 * ⚠️ BEZ TEGO MODUŁ ZBIERA CUDZE ZDARZENIA. W aktach SK Banku leży sprawozdanie Komisji
 * Nadzoru Audytowego za 2009 r. — o nadzorze nad biegłymi rewidentami, bez żadnego związku
 * z bankiem. Przeszło filtr słów kluczowych („nadzór", „inspekcja") i wniosło jedenaście
 * zdarzeń o posiedzeniach EGAOB w Brukseli i powołaniu Komisji Egzaminacyjnej. W gotowej
 * chronologii wyglądałyby jak działania nadzorcze wobec badanego banku.
 */
function preambula(podmiot: string[]): string {
  return (
    "BADANY PODMIOT: " + podmiot.join(" / ") + ". " +
    "Wyodrębniaj WYŁĄCZNIE okresy i zdarzenia dotyczące TEGO podmiotu — jego sytuacji finansowej, " +
    "nadzoru nad nim albo czynności jego organów. Zdarzenia dotyczące innych instytucji, sektora " +
    "jako całości albo spraw organizacyjnych organu nadzoru POMIŃ, choćby dokument je opisywał. " +
    "Przy wątpliwości, czy zdarzenie dotyczy badanego podmiotu — pomiń je. "
  );
}

const ZASADY_WSPOLNE =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz dokumenty nadzorcze i procesowe. ";

export function systemOkresy(podmiot: string[]): string {
  return (
    ZASADY_WSPOLNE + preambula(podmiot) +
    "Wyodrębnij OKRESY — stan wskaźników podmiotu na dzień sprawozdawczy. " +
    "ZASADY BEZWZGLĘDNE: " +
  "(1) Liczby przepisuj DOSŁOWNIE. Nie przeliczaj, nie zaokrąglaj, nie uzupełniaj brakujących pozycji. " +
  "(2) Tabele bywają WPLECIONE W NARRACJĘ i po OCR mają pomieszane kolumny — zwykle są dwie: stan bazowy " +
  "i stan omawianego okresu. NIE ŁĄCZ wartości z różnych tabel w jeden okres; przy wątpliwości pomiń pozycję. " +
  "(3) Datę okresu ustal z narracji otaczającej tabelę i ZAWSZE podaj `kontekst` — dosłowny fragment " +
  "10–20 słów, z którego ta data wynika. Bez możliwości wskazania takiego fragmentu POMIŃ cały okres. " +
  "(4) Podajesz wartości WYKAZANE przez bank albo przez nadzór, nie rzeczywiste; jeśli dokument mówi, że " +
  "wartość była kwestionowana, zapisz to w zdarzeniach, a liczbę zostaw taką, jaka widnieje. " +
    "(5) Kwoty podawaj W JEDNOSTCE DOKUMENTU i zapisz ją w polu `jednostka` (np. „tys. zł”). " +
    "Nie przeliczaj na złote — przeliczenie jest obliczeniem, a te robi silnik. " +
    '(6) Zwróć WYŁĄCZNIE JSON: {"jednostka":"","okresy":[{"dzien":"YYYY-MM-DD","kontekst":"",' +
    '"suma_bilansowa":0,"portfel_kredytowy":0,"portfel_utrata":0,"udzial_utrata_pct":0,"depozyty":0,' +
    '"fundusze_wlasne":0,"wsp_wyplacalnosci_pct":0,"wynik_finansowy":0}]}. Pola nieobecne pomiń.'
  );
}

export function systemZdarzenia(podmiot: string[]): string {
  return (
    ZASADY_WSPOLNE + preambula(podmiot) +
    "Wyodrębnij ZDARZENIA — datowane działania nadzoru, banku zrzeszającego albo organów podmiotu " +
    "oraz ustalenia z ich przebiegu (inspekcje, zalecenia, oceny nadzorcze, decyzje). " +
    "ZASADY BEZWZGLĘDNE: (1) referuj USTALENIA dokumentu, nie oceniaj ich trafności ani nie " +
    "rozstrzygaj, czy nadzór zareagował właściwie. (2) Data musi wynikać z dokumentu; bez daty " +
    "pomiń zdarzenie. (3) `organ` to ten, kto działał. " +
    '(4) Zwróć WYŁĄCZNIE JSON: {"zdarzenia":[{"data":"YYYY-MM-DD","organ":"","opis":""}]}.'
  );
}

const GLOWA = [
  "Dzień",
  "Suma bilansowa",
  "Portfel kredytowy",
  "z utratą wartości",
  "Udział (policzony)",
  "Depozyty",
  "Fundusze własne",
  "Wsp. wypłacalności",
  "Wynik finansowy",
  "Źródło",
];

const kwota = (v?: number) =>
  v == null ? "—" : v.toLocaleString("pl-PL", { maximumFractionDigits: 0 }).replace(/ /g, " ");
const proc = (v?: number | null) => (v == null ? "—" : `${v.toFixed(2)} %`);

/** Udział POLICZONY, nie przepisany — moment przekroczenia progu jest ustaleniem. */
export function udzialPoliczony(o: OkresNadzorczy): number | null {
  if (o.portfel_kredytowy && o.portfel_utrata != null)
    return Math.round((10000 * o.portfel_utrata) / o.portfel_kredytowy) / 100;
  return o.udzial_utrata_pct ?? null;
}

export type WynikChronologii = { data: Record<string, unknown>; findings: string[] };

/**
 * Rozdział „Chronologia nadzorcza".
 *
 * `dzienZdarzenia` wyznacza granicę: okresy późniejsze trafiają do OSOBNEJ tabeli.
 * To ta sama zasada co przy publikacjach prasowych i procesie decyzyjnym — dane
 * z okresu po ocenianym zdarzeniu opisują jego następstwa, a nie stan wiedzy z jego dnia.
 */
export function zbudujChronologie(
  okresy: OkresNadzorczy[],
  zdarzenia: ZdarzenieNadzorcze[],
  dzien: string,
  zastrzezenia: string[] = [],
): WynikChronologii {
  const wiersz = (o: OkresNadzorczy) => [
    o.dzien,
    kwota(o.suma_bilansowa),
    kwota(o.portfel_kredytowy),
    kwota(o.portfel_utrata),
    proc(udzialPoliczony(o)),
    kwota(o.depozyty),
    kwota(o.fundusze_wlasne),
    proc(o.wsp_wyplacalnosci_pct),
    kwota(o.wynik_finansowy),
    o.plik ?? "—",
  ];
  const posort = [...okresy].sort((a, b) => a.dzien.localeCompare(b.dzien));
  const przed = dzien ? posort.filter((o) => o.dzien <= dzien) : posort;
  const po = dzien ? posort.filter((o) => o.dzien > dzien) : [];

  const glowna: Tabela = {
    caption: dzien
      ? `Tabela. Wskaźniki banku wykazane w okresach do dnia ${dzien} (w jednostce dokumentu źródłowego)`
      : "Tabela. Wskaźniki banku w kolejnych okresach sprawozdawczych",
    head: GLOWA,
    rows: przed.map(wiersz),
  };
  const tables: Tabela[] = [glowna];
  if (po.length)
    tables.push({
      caption:
        `Tabela. Okresy PÓŹNIEJSZE niż ${dzien} — opisują następstwa ocenianego zdarzenia ` +
        "i nie stanowią podstawy ustalenia stanu wiedzy z jego dnia",
      head: GLOWA,
      rows: po.map(wiersz),
    });
  if (zdarzenia.length) {
    const zPos = [...zdarzenia].sort((a, b) => String(a.data).localeCompare(String(b.data)));
    tables.push({
      caption: "Tabela. Działania nadzorcze i ustalenia z ich przebiegu",
      head: ["Data", "Organ", "Ustalenie", "Źródło"],
      rows: zPos.map((z) => [z.data, z.organ, z.opis, z.plik ?? "—"]),
    });
  }

  const findings: string[] = [];
  const najswiezszy = przed[przed.length - 1];
  if (dzien && najswiezszy) {
    const zwloka = Math.round(
      (Date.parse(dzien) - Date.parse(najswiezszy.dzien)) / 86_400_000,
    );
    const u = udzialPoliczony(najswiezszy);
    findings.push(
      `Najświeższe dane dostępne na ${dzien} pochodzą z ${najswiezszy.dzien} (${zwloka} dni wcześniej)` +
        (u != null ? `; udział kredytów z utratą wartości wynosił wówczas ${u.toFixed(2)}%` : "") +
        (najswiezszy.wsp_wyplacalnosci_pct != null
          ? `, a wykazany współczynnik wypłacalności ${najswiezszy.wsp_wyplacalnosci_pct.toFixed(2)}%`
          : "") +
        ".",
    );
  } else if (dzien) {
    findings.push(
      `Brak okresu sprawozdawczego poprzedzającego ${dzien} — na podstawie tego materiału nie da się ` +
        "ustalić, jakimi danymi dysponowano w tym dniu.",
    );
  }
  // Trend udziału kredytów z utratą wartości — to on odpowiada na pytanie „od kiedy".
  const trend = posort.map((o) => ({ d: o.dzien, u: udzialPoliczony(o) })).filter((x) => x.u != null);
  if (trend.length >= 2)
    findings.push(
      "Udział kredytów z utratą wartości w kolejnych okresach: " +
        trend.map((x) => `${x.d} — ${x.u!.toFixed(2)}%`).join("; ") +
        ".",
    );
  if (po.length)
    findings.push(
      `${po.length} okresów pochodzi z czasu PO ocenianym zdarzeniu — pokazują jego następstwa, ` +
        "ale nie stan wiedzy z dnia jego zajścia.",
    );

  return {
    data: {
      table: glowna,
      tables,
      dzienZdarzenia: dzien || null,
      poZdarzeniu: po.length,
      okresow: okresy.length,
      zastrzezenia,
    },
    findings,
  };
}
