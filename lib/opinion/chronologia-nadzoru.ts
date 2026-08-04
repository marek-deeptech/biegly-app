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
 * Zdarzenie dopisane przez `scripts/zdarzenia_pism.py` — z kotwicą identyfikującą.
 *
 * DLACZEGO OSOBNY BYT: ekstrakcja modelowa z pism procesowych gubi pojedyncze,
 * rozstrzygające fakty (ocena NIK o sygnale ostrzegawczym, wniosek KNF do KNA,
 * opinie rewidentów bez zastrzeżeń) — w sprawie SK Banku z 119 zdarzeń żadne nie
 * niosło tych trzech. Skrypt dopisuje je deterministycznie, po kotwicach tekstowych
 * zweryfikowanych w aktach, a `kotwica` czyni scalenie idempotentnym: ponowny bieg
 * skryptu ani ponowna ekstrakcja modelowa nie zdublują wiersza.
 */
export type ZdarzenieUzupelniajace = ZdarzenieNadzorcze & { kotwica: string };

/**
 * Scala zdarzenia uzupełniające ze zdarzeniami z ekstrakcji modelowej.
 *
 * Dedup dwustopniowy: (1) po `kotwica` między samymi uzupełniającymi (ponowny bieg
 * skryptu), (2) wobec ekstrakcji — po dniu i początku treści, bo model mógł już
 * wyodrębnić to samo zdarzenie własnymi słowami o identycznym początku cytatu.
 */
export function scalUzupelniajace(
  zdarzenia: ZdarzenieNadzorcze[],
  uzupelniajace: ZdarzenieUzupelniajace[],
): ZdarzenieNadzorcze[] {
  const znane = new Set(
    zdarzenia.map((z) => `${z.data}|${z.opis.toLowerCase().replace(/\s+/g, " ").slice(0, 60)}`),
  );
  const out = [...zdarzenia];
  const wziete = new Set<string>();
  for (const u of uzupelniajace) {
    if (wziete.has(u.kotwica)) continue;
    wziete.add(u.kotwica);
    const klucz = `${u.data}|${u.opis.toLowerCase().replace(/\s+/g, " ").slice(0, 60)}`;
    if (znane.has(klucz)) continue;
    znane.add(klucz);
    out.push({ data: u.data, organ: u.organ, opis: u.opis, plik: u.plik });
  }
  return out;
}

/**
 * KOTWICE ZDARZEŃ KLUCZOWYCH — promocja z tabeli działań do `findings`.
 *
 * ⚠️ POWÓD ISTNIENIA: do rejestru wniosków (materialWnioskow) wchodzą WYŁĄCZNIE
 * `findings` modułów, nie wiersze tabel. Strata brutto 56,7 mln zł stwierdzona
 * inspekcją i odrzucony program naprawczy siedziały w 119 wierszach tabeli działań
 * — i wnioski odpowiadały na pytania organu, nie wiedząc o nich. Promocja jest
 * deterministyczna (regex po treści zdarzenia), więc przeżywa każdy ponowny bieg.
 */
const KOTWICE_KLUCZOWE: { re: RegExp; ile: number }[] = [
  // wynik inspekcji: strata po doklasyfikowaniu należności i dotworzeniu rezerw
  { re: /strat\w*\s+brutto|56[,.]7\s*mln/i, ile: 1 },
  // oś programu naprawczego: termin, złożenie, odrzucenie
  { re: /program\w*\s+(postępowania\s+)?naprawcz/i, ile: 2 },
  // dostępność RWEF: co pokazywał i kiedy powstawał
  { re: /RWEF/i, ile: 2 },
  // ⚠️ separatorem nie może być [^.] — daty „30.09.2015 r." tną dopasowanie kropkami.
  { re: /(analiz\w+\s+kwartaln\w+|KOBRA)[^§]{0,120}nie\s+(został\w?|był\w?)\s+sporządz/i, ile: 1 },
  // ujawnienie niewypłacalności przez zarząd komisaryczny (raport bieżący emitenta)
  { re: /raport\w*\s+bieżąc\w*\s+nr\s*7\/2015|głęboko\s+ujemne\s+fundusze/i, ile: 1 },
  // badania rewidentów: opinie bez zastrzeżeń i wniosek dyscyplinarny do KNA
  { re: /bez\s+zastrzeżeń|nie\s+zawierał\w*\s+zastrzeżeń/i, ile: 1 },
  { re: /Nadzoru\s+Audytowego|dyscyplinarn/i, ile: 1 },
  // ocena NIK: sygnał ostrzegawczy widoczny wcześniej, niż zareagował nadzór
  { re: /sygnał\w*\s+ostrzegawcz|trzy\s+kwartały\s+wcześniej/i, ile: 1 },
  { re: /zawieszeni\w+\s+działalnoś/i, ile: 1 },
];
const MAKS_PROMOWANYCH = 10;

/**
 * Skrót treści zdarzenia do rejestru — na granicy słowa, z wielokropkiem.
 *
 * ⚠️ SKRÓT MUSI OBJĄĆ KOTWICĘ. Zdarzenie o inspekcji zaczyna się od trzech linijek
 * przebiegu, a strata 56,7 mln zł pada w czwartej — proste „pierwsze 260 znaków”
 * ucinało treść PRZED liczbą, przez którą zdarzenie w ogóle awansowało. Rejestr
 * wniosków dostawał wtedy wiersz o inspekcji bez jej wyniku i wnioski nie miały
 * skąd wziąć kwoty. Gdy dopasowanie leży poza oknem, doklejamy fragment wokół niego.
 */
function skrot(s: string, kotwica?: RegExp, maks = 260): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= maks) return t;
  const naGranicy = (x: string) => x.slice(0, Math.max(x.lastIndexOf(" "), x.length - 30));
  const poczatek = naGranicy(t.slice(0, maks));
  const m = kotwica ? t.match(kotwica) : null;
  if (!m || (m.index ?? 0) + m[0].length <= poczatek.length) return `${poczatek}…`;
  const od = Math.max(poczatek.length, (m.index ?? 0) - 60);
  const okno = t.slice(od, (m.index ?? 0) + m[0].length + 120);
  return `${poczatek} […] ${naGranicy(okno)}…`;
}

export function ustaleniaKluczowe(zdarzenia: ZdarzenieNadzorcze[]): string[] {
  const posort = [...zdarzenia].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const out: string[] = [];
  const uzyte = new Set<ZdarzenieNadzorcze>();
  for (const { re, ile } of KOTWICE_KLUCZOWE) {
    const pasujace = posort.filter((z) => !uzyte.has(z) && re.test(z.opis));
    // pierwszy i ostatni chronologicznie — początek i rozstrzygnięcie wątku
    const wybrane = ile >= 2 && pasujace.length > 1 ? [pasujace[0], pasujace[pasujace.length - 1]] : pasujace.slice(0, 1);
    for (const z of wybrane) {
      uzyte.add(z);
      out.push(`Zdarzenie kluczowe (${z.data}, ${z.organ}): ${skrot(z.opis, re)}`);
      if (out.length >= MAKS_PROMOWANYCH) return out;
    }
  }
  return out;
}

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
// Zapis POLSKI — to tekst opinii dla sądu, a nie wydruk techniczny. Kropka
// dziesiętna była też źródłem fałszywych alarmów recenzenta, który (jak reszta
// aplikacji) rozpoznaje liczby po przecinku.
const pl = (v: number) => v.toFixed(2).replace(".", ",");
const proc = (v?: number | null) => (v == null ? "—" : `${pl(v)} %`);

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
        (u != null ? `; udział kredytów z utratą wartości wynosił wówczas ${pl(u)}%` : "") +
        (najswiezszy.wsp_wyplacalnosci_pct != null
          ? `, a wykazany współczynnik wypłacalności ${pl(najswiezszy.wsp_wyplacalnosci_pct)}%`
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
        trend.map((x) => `${x.d} — ${pl(x.u!)}%`).join("; ") +
        ".",
    );
  if (po.length)
    findings.push(
      `${po.length} okresów pochodzi z czasu PO ocenianym zdarzeniu — pokazują jego następstwa, ` +
        "ale nie stan wiedzy z dnia jego zajścia.",
    );
  // Zdarzenia kluczowe idą do findings, bo tylko findings dojeżdżają do rejestru
  // wniosków — wiersze tabeli działań są dla wniosków niewidzialne (patrz komentarz
  // przy KOTWICE_KLUCZOWE).
  findings.push(...ustaleniaKluczowe(zdarzenia));

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
