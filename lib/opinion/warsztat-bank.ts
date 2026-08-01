// Składanie subanaliz warsztatu bankowego z faktów wyodrębnionych z dokumentów.
//
// DLACZEGO OSOBNO OD TRASY:
// Trasa robi dwie rzeczy — czyta dokumenty modelem i składa z nich rozdziały. Ta druga
// część jest miejscem, w którym mieszka najpoważniejsze ryzyko merytoryczne (podział
// publikacji na dostępne i późniejsze niż oceniane zdarzenie), a w trasie była
// niesprawdzalna bez postawienia serwera i zalogowania się. Tutaj jest czystą funkcją
// i ma testy.
import type { Przepis } from "@/lib/domain/prawo-bankowe";

export type Publikacja = { plik: string; data: string; tytul: string; zrodlo: string; teza: string };
export type MiaraSektora = {
  plik: string;
  miara: string;
  wartosc: string;
  naDzien: string;
  kraj: string;
  strona?: string;
};

// Prompty wyodrębniania — tutaj, a nie w trasie, żeby dało się je uruchomić
// i sprawdzić na realnych aktach bez stawiania serwera i logowania.
export const SYSTEM_MEDIA =
  "Jesteś asystentem biegłego sądowego. Otrzymujesz artykuły prasowe z akt sprawy karnej. " +
  "Wyodrębnij PUBLIKACJE: data publikacji (YYYY-MM-DD; gdy w tekście jest tylko miesiąc, użyj " +
  "pierwszego dnia miesiąca i zaznacz to w tezie), tytuł, źródło (tytuł gazety lub serwisu), " +
  "teza (2–4 zdania: co publikacja stwierdzała o sytuacji banku, sektora lub kraju). " +
  "ZASADY BEZWZGLĘDNE: (1) referuj TREŚĆ publikacji, nie oceniaj jej trafności i nie rozstrzygaj, " +
  "czy autor miał rację — to nie jest zadanie biegłego. (2) Nie wnioskuj z publikacji o tym, co bank " +
  "wiedział; artykuł dowodzi wyłącznie tego, że informacja była publicznie dostępna. " +
  "(3) Bez daty publikacji artykuł jest bezużyteczny dowodowo — gdy daty nie ma w tekście, wpisz " +
  'pusty ciąg zamiast zgadywać. (4) Zwróć WYŁĄCZNIE JSON: {"publikacje":[{"plik":"","data":"","tytul":"","zrodlo":"","teza":""}]}';

export const SYSTEM_SEKTOR =
  "Jesteś asystentem biegłego sądowego z zakresu bankowości. Otrzymujesz raporty banku centralnego. " +
  "Wyodrębnij MIARY SKALI SEKTORA BANKOWEGO wobec gospodarki: miara (np. 'aktywa sektora bankowego " +
  "do PKB', 'rezerwy walutowe banku centralnego', 'zobowiązania zagraniczne banków'), wartość " +
  "(dokładnie jak w dokumencie, z jednostką), naDzien (YYYY-MM-DD albo sam rok), KRAJ, którego miara " +
  "dotyczy, oraz strona dokumentu, jeśli da się ustalić. " +
  "ZASADY BEZWZGLĘDNE: (1) kraj podaj ZAWSZE — miara sektora jednego kraju podstawiona pod inny byłaby " +
  "błędem nie do wykrycia w gotowym tekście. (2) przepisuj wartości dosłownie, nie przeliczaj. " +
  "(3) nie wyciągaj wniosków o zdolności państwa do wsparcia banków — podajesz wyłącznie miary. " +
  '(4) Zwróć WYŁĄCZNIE JSON: {"miary":[{"plik":"","miara":"","wartosc":"","naDzien":"","kraj":"","strona":""}]}';

export type Zdarzenie = { plik: string; data: string; organ: string; ustalenie: string; osoby?: string[] };
export type Tabela = { caption: string; head: string[]; rows: string[][] };
export type Subanaliza = { data: Record<string, unknown>; findings: string[] };

const GLOWA_PRASA = ["Data", "Tytuł", "Źródło", "Teza publikacji", "Plik"];

function wierszePrasy(xs: Publikacja[]): string[][] {
  return xs.map((x) => [x.data, x.tytul, x.zrodlo, x.teza, x.plik]);
}

/**
 * Rozdział „Publikacje prasowe" — z twardym podziałem po dacie zdarzenia.
 *
 * ⚠️ TO JEST SEDNO TEGO MODUŁU, NIE PORZĄDEK ALFABETYCZNY.
 * Artykuł z 6.10.2008 opisuje upadek Glitnira. Powołany na poparcie tezy o sygnałach
 * dostępnych 11.09.2008 byłby wnioskowaniem wstecznym — zarzutem podważającym całą
 * opinię, bo ocenia się wiedzę dostępną W DNIU DECYZJI, a nie wiedzę późniejszą.
 * Publikacji późniejszych NIE usuwamy (opisują skutki i biegły ma je widzieć), ale
 * trafiają do osobnej tabeli, której podpis wprost zakazuje takiego użycia.
 */
export function zbudujMedia(publikacje: Publikacja[], dzien: string): Subanaliza {
  // Ten sam artykuł bywa w aktach dwa razy: jako ponumerowany załącznik i jako luźna
  // kopia. Policzony dwukrotnie zawyżałby obraz materiału prasowego — w opinii „trzy
  // publikacje" zamiast dwóch to twierdzenie o stanie akt, nie drobiazg redakcyjny.
  const klucz = (x: Publikacja) => `${x.data}|${x.tytul.trim().toLowerCase()}`;
  const wgKlucza = new Map<string, Publikacja & { kopie: string[] }>();
  for (const x of publikacje) {
    const k = klucz(x);
    const byl = wgKlucza.get(k);
    if (byl) byl.kopie.push(x.plik);
    else wgKlucza.set(k, { ...x, kopie: [x.plik] });
  }
  const duplikaty = [...wgKlucza.values()].filter((x) => x.kopie.length > 1);
  const posortowane = [...wgKlucza.values()]
    .map((x) => ({ ...x, plik: x.kopie.join("; ") }))
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const przed = dzien ? posortowane.filter((x) => x.data && x.data <= dzien) : posortowane;
  const po = dzien ? posortowane.filter((x) => x.data && x.data > dzien) : [];
  const bezDaty = posortowane.filter((x) => !x.data);

  const glowna: Tabela = {
    caption: dzien
      ? `Tabela. Publikacje prasowe dostępne przed dniem ${dzien}`
      : "Tabela. Publikacje prasowe w aktach",
    head: GLOWA_PRASA,
    rows: wierszePrasy(przed),
  };
  const tables: Tabela[] = [glowna];
  if (po.length)
    tables.push({
      caption:
        `Tabela. Publikacje PÓŹNIEJSZE niż oceniane zdarzenie (${dzien}) — nie stanowią podstawy ` +
        "oceny stanu wiedzy z dnia decyzji",
      head: GLOWA_PRASA,
      rows: wierszePrasy(po),
    });

  const findings: string[] = [];
  if (dzien)
    findings.push(
      przed.length
        ? `Przed dniem ${dzien} w aktach są ${przed.length} publikacje prasowe dotyczące sytuacji ` +
            "kontrahenta lub jego kraju; ich treść była powszechnie dostępna."
        : `W aktach nie ma publikacji prasowych z okresu poprzedzającego dzień ${dzien}.`,
    );
  else
    findings.push(
      "Nie podano daty ocenianego zdarzenia — publikacji nie podzielono na wcześniejsze i późniejsze, " +
        "więc nie da się z nich wnioskować o stanie wiedzy z dnia decyzji.",
    );
  if (po.length)
    findings.push(
      `${po.length} publikacji pochodzi z okresu PO ocenianym zdarzeniu — mogą opisywać jego skutki, ` +
        "ale nie stan wiedzy dostępnej w dniu decyzji.",
    );
  if (bezDaty.length)
    findings.push(
      `${bezDaty.length} publikacji bez ustalonej daty — dowodowo nieprzydatne bez uzupełnienia daty.`,
    );
  if (duplikaty.length)
    findings.push(
      `${duplikaty.length} publikacji występuje w aktach w więcej niż jednym pliku (m.in. ` +
        duplikaty
          .slice(0, 2)
          .map((x) => `„${x.tytul}" w ${x.kopie.length} plikach`)
          .join("; ") +
        ") — policzono je jako jedną publikację.",
    );

  return {
    data: {
      table: glowna,
      tables,
      dzienZdarzenia: dzien || null,
      poZdarzeniu: po.length,
      bezDaty: bezDaty.map((x) => x.plik),
    },
    findings,
  };
}

/**
 * Rozdział „Skala sektora bankowego wobec gospodarki".
 *
 * Kraj przy każdej mierze jest obowiązkowy: relacja aktywów sektora do PKB podstawiona
 * z innego państwa jest błędem niewykrywalnym w gotowym tekście, bo liczba wygląda
 * równie wiarygodnie. Miary bez wskazanego kraju odkładamy do osobnego wykazu.
 */
export function zbudujSektor(miary: MiaraSektora[], zrodel: number, dzien: string): Subanaliza {
  const zKrajem = miary.filter((m) => (m.kraj ?? "").trim());
  const bezKraju = miary.filter((m) => !(m.kraj ?? "").trim());
  const findings: string[] = [];
  if (zKrajem.length) {
    findings.push(
      `Odczytano ${zKrajem.length} miar skali sektora bankowego z ${zrodel} raportów banku centralnego.`,
    );
    const kraje = [...new Set(zKrajem.map((m) => m.kraj.trim()))];
    if (kraje.length > 1)
      findings.push(
        `Miary dotyczą różnych państw (${kraje.join(", ")}) — przy każdej wskazano kraj, bo miara ` +
          "sektora jednego państwa nie może być podstawą wniosku o innym.",
      );
  } else if (zrodel > 0) {
    // ⚠️ TE DWA STANY TO NIE TO SAMO. „Nie ma raportów" jest ustaleniem o aktach;
    // „raporty są, ale nic z nich nie odczytano" jest ustaleniem o naszej analizie
    // i wskazuje biegłemu, gdzie szukać ręcznie. Zlanie ich w jeden komunikat
    // stwierdzałoby nieprawdę o zawartości akt.
    findings.push(
      `W aktach są ${zrodel} raporty banku centralnego, ale nie odczytano z nich żadnej miary skali ` +
        "sektora bankowego. Dane mogą być w tabelach lub na wykresach, których ekstrakcja nie obejmuje — " +
        "wymagają odczytu ręcznego przed powołaniem w opinii.",
    );
  } else {
    findings.push(
      "W aktach nie ma raportów banku centralnego, z których dałoby się odczytać relację aktywów " +
        "sektora bankowego do PKB. Teza o granicy wsparcia publicznego wymaga wskazania źródła tej relacji.",
    );
  }
  if (bezKraju.length)
    findings.push(
      `${bezKraju.length} miar odczytano bez wskazania państwa — nie weszły do tabeli, bo miara ` +
        "sektora bez kraju nie jest ustaleniem.",
    );

  return {
    data: {
      table: {
        caption: "Tabela. Miary skali sektora bankowego kraju kontrahenta",
        head: ["Kraj", "Miara", "Wartość", "Na dzień", "Źródło"],
        rows: zKrajem.map((m) => [
          m.kraj,
          m.miara,
          m.wartosc,
          m.naDzien,
          [m.plik, m.strona].filter(Boolean).join(", "),
        ]),
      },
      bezKraju: bezKraju.map((m) => m.miara),
      dzienZdarzenia: dzien || null,
    },
    findings,
  };
}

/**
 * Rozdział „Otoczenie prawne" — w całości z DATOWANEGO katalogu, bez modelu.
 *
 * Dobór przepisu nie jest zadaniem do wnioskowania, tylko odczytem z katalogu po dacie.
 * Zostawiony modelowi dałby CRR do decyzji z 2008 r.; tutaj jest to niemożliwe, bo
 * katalog zna daty wejścia w życie i uchylenia, a przepisy późniejsze wchodzą do
 * osobnej tabeli z zakazem powoływania.
 */
export function zbudujOtoczeniePrawne(
  wlasciwe: Przepis[],
  anachroniczne: Przepis[],
  dzien: string,
): Subanaliza {
  const glowna: Tabela = {
    caption: dzien
      ? `Tabela. Przepisy obowiązujące w dniu ${dzien}`
      : "Tabela. Przepisy — bez daty zdarzenia nie ustalono stanu prawnego",
    head: ["Przepis", "Akt prawny", "Zakres", "Obowiązuje od", "Obowiązuje do"],
    rows: dzien ? wlasciwe.map((p) => [p.ref, p.akt, p.zakres, p.od, p.do ?? "nadal"]) : [],
  };
  const tables: Tabela[] = [glowna];
  if (dzien && anachroniczne.length)
    tables.push({
      caption:
        `Tabela. Przepisy, które weszły w życie PO dniu ${dzien} — nie stanowią podstawy oceny ` +
        "ocenianego zachowania",
      head: ["Przepis", "Akt prawny", "Zakres", "Obowiązuje od"],
      rows: anachroniczne.map((p) => [p.ref, p.akt, p.zakres, p.od]),
    });

  const findings: string[] = [];
  if (!dzien) {
    findings.push(
      "Nie podano daty ocenianego zdarzenia, więc stanu prawnego nie ustalono. Bez daty nie da się " +
        "rozstrzygnąć, które przepisy obowiązywały — a ocena według przepisu późniejszego byłaby wadliwa.",
    );
  } else {
    findings.push(
      `W dniu ${dzien} obowiązywało ${wlasciwe.length} przepisów właściwych dla oceny procesu ` +
        "identyfikacji i pomiaru ryzyka kredytowego.",
    );
    if (anachroniczne.length)
      findings.push(
        `${anachroniczne.length} aktów powoływanych w sprawach bankowych weszło w życie dopiero po ` +
          `${dzien} — powołanie ich do oceny tego zdarzenia byłoby błędem merytorycznym (m.in. ` +
          anachroniczne
            .slice(0, 3)
            .map((p) => `${p.ref} od ${p.od}`)
            .join("; ") +
          ").",
      );
  }

  return {
    data: {
      table: glowna,
      tables,
      dzienZdarzenia: dzien || null,
      przepisy: dzien ? wlasciwe.map((p) => `${p.ref} — ${p.zakres}`) : [],
      anachroniczne: dzien ? anachroniczne.map((p) => `${p.ref} (od ${p.od})`) : [],
    },
    findings,
  };
}

const GLOWA_PROC = ["Data", "Organ", "Ustalenie", "Osoby", "Źródło"];

/**
 * Rozdział „Proces decyzyjny" — z podziałem po dacie zdarzenia, jak publikacje prasowe.
 *
 * ⚠️ TU RYZYKO JEST WIĘKSZE NIŻ PRZY PRASIE, nie mniejsze.
 * Chronologia czyta się jak JEDEN ciągły proces decyzyjny, więc zdarzenie z 2012 r.
 * — spór z syndykiem kontrahenta, ustalenia audytu spisane cztery lata później —
 * wygląda w tabeli tak samo jak uchwała sprzed decyzji. W aktach MBR takich zdarzeń
 * jest 17 z 36. Wnioskowanie z nich o tym, co bank wiedział 11.09.2008, jest
 * wnioskowaniem wstecznym.
 *
 * Zdarzeń późniejszych NIE usuwamy: dokumentują, co bank zrobił, gdy się dowiedział,
 * i to jest istotne dla oceny procesu. Idą do osobnej tabeli, której podpis wyznacza
 * granicę dopuszczalnego użycia.
 */
export function zbudujProcedury(
  zdarzenia: Zdarzenie[],
  dzien: string,
  dodatkowe: Record<string, unknown> = {},
): Subanaliza {
  const posortowane = [...zdarzenia].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const wiersze = (xs: Zdarzenie[]) =>
    xs.map((z) => [z.data, z.organ, z.ustalenie, (z.osoby ?? []).join(", "), z.plik]);
  const przed = dzien ? posortowane.filter((z) => z.data && z.data <= dzien) : posortowane;
  const po = dzien ? posortowane.filter((z) => z.data && z.data > dzien) : [];

  const glowna: Tabela = {
    caption: dzien
      ? `Tabela. Chronologia procesu decyzyjnego do dnia ${dzien}`
      : "Tabela. Chronologia procesu decyzyjnego",
    head: GLOWA_PROC,
    rows: wiersze(przed),
  };
  const tables: Tabela[] = [glowna];
  if (po.length)
    tables.push({
      caption:
        `Tabela. Zdarzenia PO dniu ${dzien} — dokumentują przebieg zdarzeń po ocenianej decyzji ` +
        "i nie stanowią podstawy oceny stanu wiedzy z dnia jej podjęcia",
      head: GLOWA_PROC,
      rows: wiersze(po),
    });

  const findings: string[] = [];
  if (przed.length)
    findings.push(
      `Odtworzono ${przed.length} datowanych zdarzeń procesu decyzyjnego poprzedzających ` +
        `${dzien || "oceniane zdarzenie"}.`,
    );
  else
    findings.push("Nie odtworzono zdarzeń — brak czytelnych dokumentów wewnętrznych w aktach.");
  if (po.length)
    findings.push(
      `${po.length} zdarzeń pochodzi z okresu PO ocenianej decyzji — opisują jej następstwa ` +
        "i reakcję banku, ale nie stan wiedzy z dnia jej podjęcia.",
    );

  return { data: { table: glowna, tables, dzienZdarzenia: dzien || null, poZdarzeniu: po.length, ...dodatkowe }, findings };
}
