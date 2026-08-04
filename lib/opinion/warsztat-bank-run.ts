// KROK 4 DZIEDZINY BANKOWEJ — wykonanie warsztatu dowodowego.
//
// DLACZEGO POZA TRASĄ:
// Krok czyta akta, woła model i zapisuje pięć subanaliz. W trasie dało się go
// uruchomić wyłącznie z przeglądarki po zalogowaniu, więc każda weryfikacja na
// realnych aktach wymagała odtwarzania tej logiki w skrypcie — a odtworzona kopia
// rozjeżdża się z oryginałem przy pierwszej poprawce. Tutaj oba wywołania (trasa
// i skrypt) idą tym samym kodem; różnią się tylko klientem Supabase.
//
// PODZIAŁ PRACY, TAKI SAM JAK W DZIEDZINIE MANIPULACJI:
// model CZYTA dokumenty i wyodrębnia fakty (data, organ, ustalenie, karta akt);
// zestawienie z przepisem robi KOD, na datowanym katalogu z lib/domain/prawo-bankowe.
// Gdyby kwalifikację prawną zostawić modelowi, opinia powoływałaby CRR do decyzji
// z 2008 r. — dokładnie ten błąd, przed którym chroni datowanie katalogu.
import Anthropic from "@anthropic-ai/sdk";
import { klientLLM } from "@/lib/llm/klient";
import type { SupabaseClient } from "@supabase/supabase-js";

import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { tekstZPliku } from "@/lib/intake/office";
import { keywordWindows, pdfText, pdfTextStron } from "@/lib/intake/pdf";
import {
  SYSTEM_MEDIA,
  SYSTEM_SEKTOR,
  czyKomunikatUrzedowy,
  type MiaraSektora,
  type Publikacja,
  type Zdarzenie,
  wierszeMetodykiZrzeszajacego,
  zbudujMedia,
  zbudujOtoczeniePrawne,
  zbudujProcedury,
  zbudujSektor,
} from "@/lib/opinion/warsztat-bank";

const TYPY_PROCEDURY = ["PROTOKOL_KOMITETU", "UCHWALA_WEWNETRZNA", "AUDYT_WEWNETRZNY", "KORESPONDENCJA_WEWN"];
const TYPY_LIMITY = ["METODYKA_LIMITOW"];
const TYPY_MEDIA = ["PRASA"];
// Skalę sektora czytamy WYŁĄCZNIE z raportów banku centralnego kraju kontrahenta.
// Raporty KNF opisują sektor POLSKI — wzięte tutaj podstawiłyby cudzą gospodarkę
// pod tezę o kraju kontrahenta, co jest błędem trudnym do wychwycenia w tekście.
const TYPY_SEKTOR = ["RAPORT_BANK_CENTRALNY"];
const MAX_ZN_DOK = 24000;
// Ile DOKUMENTÓW wchodzi do jednego modułu. Przed rozbiciem skanów było ich
// kilkanaście i limit 12 nie bolał; po rozbiciu jeden skan daje kilkanaście
// pozycji, więc ten sam limit odcinał większość akt — i robił to milcząco.
const MAX_DOKUMENTOW = 60;
// Ile tekstu w ogóle wyciągamy z pliku, zanim wybierzemy z niego fragmenty.
const MAX_ZN_PLIK = 400_000;

// Frazy, wokół których wycinamy okna w DŁUGICH dokumentach. Raport stabilności
// finansowej banku centralnego ma ~297 000 znaków, a jego początek to spis treści —
// wzięcie „pierwszych 24 000" dawało modelowi wyłącznie spis treści i moduł zwracał
// pustkę, choć dane były w środku dokumentu.
const FRAZY: Record<string, RegExp> = {
  PROCEDURY: /uchwał|protok[oó]ł|posiedzeni|komitet|zarząd|audyt|ryzyk|zaangażowan/i,
  LIMITY: /limit|zaangażowan|fundusz|krotnoś|ekspozycj/i,
  SEKTOR: /GDP|PKB|banking sector|sektor bank|total assets|aktywa sektora|reserves|rezerw/i,
};

type Limit = { plik: string; okres: string; podstawa: string; kwota: string; termin?: string };

const SYSTEM_PROCEDURY =
  "Jesteś asystentem biegłego sądowego z zakresu bankowości. Otrzymujesz fragmenty dokumentów " +
  "wewnętrznych banku z akt sprawy karnej (protokoły komitetów, uchwały zarządu o kompetencjach, " +
  "ustalenia audytu wewnętrznego, korespondencja departamentów). Wyodrębnij DATOWANE ZDARZENIA " +
  "procesu decyzyjnego: date (YYYY-MM-DD), organ (np. 'Komitet Zarządzania Aktywami i Pasywami', " +
  "'Zarząd Banku', 'Departament Ryzyka Finansowego', 'audyt wewnętrzny'), ustalenie (1–3 zdania: co " +
  "postanowiono, zatwierdzono, zgłoszono lub stwierdzono — z kwotami i numerami uchwał, jeśli są), " +
  "oraz osoby wymienione z imienia i nazwiska (osoby: tablica; pusta, gdy brak). " +
  "ZASADY BEZWZGLĘDNE: (1) wyłącznie na podstawie treści — nie zmyślaj dat, kwot, nazwisk ani " +
  "numerów; czego nie ma, pomiń. (2) NIE OCENIAJ, czy postępowanie było prawidłowe — ocena należy " +
  "do biegłego, a kwalifikacja czynu do organu. Opisujesz, co dokument stwierdza. " +
  '(3) Zwróć WYŁĄCZNIE JSON: {"zdarzenia":[{"plik":"","data":"YYYY-MM-DD","organ":"","ustalenie":"","osoby":[]}]}';

const SYSTEM_LIMITY =
  "Jesteś asystentem biegłego sądowego z zakresu bankowości. Otrzymujesz fragmenty metodyki " +
  "wyznaczania limitów zaangażowania banku. Wyodrębnij obowiązujące LIMITY: okres (np. 'III kw. 2008'), " +
  "podstawa wyznaczenia (np. '2,5-krotność funduszy własnych'), kwota (dokładnie jak w dokumencie, " +
  "np. '272 mln zł'), termin zaangażowania (termin: np. 'do 1 dnia', 'do 3 miesięcy', 'do 1 roku'). " +
  "ZASADY: (1) przepisuj wartości dosłownie z dokumentu, nie przeliczaj i nie zaokrąglaj. " +
  "(2) nie oceniaj adekwatności limitu — to zadanie biegłego. " +
  '(3) Zwróć WYŁĄCZNIE JSON: {"limity":[{"plik":"","okres":"","podstawa":"","kwota":"","termin":""}]}';


export type WynikWarsztatu = {
  ok: true;
  zdarzen: number;
  zdarzenPoDecyzji: number;
  publikacji: number;
  publikacjiPoZdarzeniu: number;
  miarSektora: number;
  przepisowWlasciwych: number;
  limitow: number;
  dokumentow: number;
  bezOcr: string[];
  zastapioneOcr: number;
  skrocone: string[];
  /** Ekstrakcje, które się nie powiodły — brak pozycji NIE znaczy braku w aktach. */
  awarie: string[];
  anachronicznych: number;
};

/** Wykonuje Krok 4 dla sprawy bankowej. `dzien` pusty = bez zestawienia z regulacją. */
export async function wykonajWarsztatBankowy(
  supabase: SupabaseClient,
  id: string,
  dzien: string,
): Promise<WynikWarsztatu> {
  const { data: docs } = await supabase
    .from("documents")
    // `opis` i `karta_start` doszły dla dwóch filtrów opisowych: komunikatów urzędowych
    // (rozdział mediów) i metodyki zrzeszającego (rozdział limitów) — oba rozpoznają
    // dokument po opisie, bo typ ma wtedy inne przeznaczenie.
    .select("id,rel_path,doc_type,storage_path,warstwa_tekstu,strona_od,strona_do,plik_zrodlowy,opis,karta_start")
    .eq("case_id", id);
  const wszystkie = docs ?? [];

  // Skan bez OCR jest pustym plikiem. Ale ORYGINAŁ skanu, którego wersja po OCR
  // jest już w aktach, NIE jest luką — jego treść została odczytana z bliźniaka.
  // Mieszanie tych dwóch przypadków w jednym komunikacie sugerowało utratę treści,
  // której nie było; biegły musi wiedzieć, co realnie wypadło z analizy.
  const nazwaPliku = (rp: string) => (rp.split("/").pop() ?? rp).normalize("NFC");
  const poOcr = new Set(
    wszystkie.filter((d) => d.warstwa_tekstu === "ocr").map((d) => nazwaPliku(d.rel_path)),
  );
  const istotne = wszystkie.filter(
    (d) => [...TYPY_PROCEDURY, ...TYPY_LIMITY].includes(d.doc_type) && d.warstwa_tekstu === "brak",
  );
  // Nieczytelne i BEZ odpowiednika po OCR — to jest prawdziwa luka dowodowa.
  const bezOcr = istotne
    .filter((d) => !poOcr.has(nazwaPliku(d.rel_path).replace(/\.pdf$/i, ".ocr.pdf")))
    .map((d) => nazwaPliku(d.rel_path));
  // Oryginały skanów, których treść weszła do analizy przez wersję po OCR.
  const zastapioneOcr = istotne.length - bezOcr.length;

  // Dokumenty, z których model dostał tylko WYCINEK — do jawnego zaraportowania.
  const skrocone: string[] = [];

  // Bufory plików trzymamy między dokumentami: jeden skan mieści kilkanaście
  // dokumentów akt, więc bez tego pobieralibyśmy ten sam plik kilkanaście razy.
  const bufory = new Map<string, ArrayBuffer | null>();
  async function bufor(sciezka: string): Promise<ArrayBuffer | null> {
    if (!bufory.has(sciezka)) {
      const { data: blob } = await supabase.storage.from("case-files").download(sciezka);
      bufory.set(sciezka, blob ? await blob.arrayBuffer() : null);
    }
    return bufory.get(sciezka) ?? null;
  }

  /**
   * Plik, z którego czytamy treść dokumentu.
   *
   * Fragment skanu wskazuje `storage_path` ORYGINAŁU, a oryginał skanu nie ma
   * warstwy tekstowej — czytany wprost daje zero znaków. Treść jest w bliźniaku
   * po OCR, a numeracja stron między nimi się zgadza (sprawdzone na skanie
   * SKM_…11470: str. 1–2 to uchwała, str. 3–6 jej załącznik, zgodnie z opisami).
   */
  function zrodloTekstu(d: (typeof wszystkie)[number]): string | null {
    if (d.warstwa_tekstu !== "brak" && !d.strona_od) return d.storage_path ?? null;
    const rodzic = wszystkie.find((x) => x.id === d.plik_zrodlowy) ?? d;
    const rdzen = (rodzic.rel_path.split("/").pop() ?? "").replace(/\.pdf$/i, "");
    const poOcrVariant = wszystkie.find(
      (x) => (x.rel_path.split("/").pop() ?? "").startsWith(rdzen)
        && x.rel_path.includes(".ocr.")
        && x.storage_path,
    );
    return poOcrVariant?.storage_path ?? d.storage_path ?? null;
  }

  /** Dokumenty pominięte przez limit — nazwane wprost, bo cichy odsiew to luka dowodowa. */
  const pominieteLimitem: string[] = [];

  /**
   * Rdzenie nazw plików ROZBITYCH na dokumenty.
   *
   * ⚠️ Rodzic i jego fragmenty niosą TĘ SAMĄ treść. Skan SKM_…11470 wchodził do
   * modułu dwa razy: raz jako wariant `.ocr.pdf` (99 735 znaków ucięte do 24 000
   * oknami wokół fraz) i drugi raz jako dwanaście kompletnych dokumentów. Podwaja
   * to materiał i zjada budżet promptu — a wersja ucięta jest w dodatku gorsza.
   *
   * Wykluczamy po RDZENIU NAZWY, nie po `plik_zrodlowy`: ten wskazuje surowy skan
   * bez warstwy tekstowej, podczas gdy dubluje treść osobny wiersz `.ocr.pdf`,
   * który rodzicem formalnie nie jest (22 takie wiersze obok 20 rozbitych plików).
   */
  const rdzenieRozbite = new Set(
    wszystkie
      .filter((d) => d.strona_od && d.plik_zrodlowy)
      .map((d) => wszystkie.find((x) => x.id === d.plik_zrodlowy))
      .filter(Boolean)
      .map((r) => (r!.rel_path.split("/").pop() ?? "").replace(/\.pdf$/i, "")),
  );
  const zastapionyFragmentami = (d: (typeof wszystkie)[number]) =>
    !d.strona_od
    && [...rdzenieRozbite].some((r) => r && (d.rel_path.split("/").pop() ?? "").startsWith(r));

  async function tekstyDla(
    typy: string[],
    frazy?: RegExp,
    /** Dodatkowy warunek OR — dokument spoza `typy`, który MA wejść (np. komunikat urzędowy do mediów). */
    dodatkowo?: (d: (typeof wszystkie)[number]) => boolean,
  ): Promise<{ plik: string; tekst: string }[]> {
    const wybrane = wszystkie.filter(
      (d) => (typy.includes(d.doc_type) || dodatkowo?.(d) === true)
        && d.storage_path && (d.warstwa_tekstu !== "brak" || d.strona_od)
        && !zastapionyFragmentami(d),
    );
    // Po rozbiciu skanów na dokumenty (migracja 0017) jeden skan daje kilkanaście
    // pozycji, więc limit 12 odcinał większość materiału — i robił to po cichu.
    const brane = wybrane.slice(0, MAX_DOKUMENTOW);
    if (wybrane.length > brane.length)
      pominieteLimitem.push(
        `${typy.join("/")}: ${wybrane.length - brane.length} z ${wybrane.length} dokumentów poza limitem ${MAX_DOKUMENTOW}`,
      );
    const out: { plik: string; tekst: string }[] = [];
    for (const d of brane) {
      const sciezka = zrodloTekstu(d);
      if (!sciezka) continue;
      const buf = await bufor(sciezka);
      if (!buf) continue;
      const nazwa = d.rel_path.split("/").pop() ?? d.rel_path;
      // .docx i .xlsx to archiwa ZIP — `blob.text()` dawał na nich binarne śmieci.
      // Przez to wypadły KWOTY LIMITÓW: 254 i 272 mln zł są w arkuszu, nie w PDF.
      //
      // ⚠️ LIMIT PODAJEMY JAWNIE. Domyślny `pdfText(buf)` czyta 6 000 znaków — dwie
      // strony. Trasa cięła dopiero na 24 000, więc wyglądało, że czyta cały plik,
      // a naprawdę brała 2% raportu banku centralnego i jedną trzecią protokołów.
      // FRAGMENT SKANU czytamy po ZAKRESIE STRON — całą jego treść, bez okien.
      // Wcześniej czytany był cały plik i wycinane z niego okna wokół fraz: przy
      // skanie 99 735 znaków model dostawał 24% treści WYBRANEJ PRZEZ WYSZUKIWANIE
      // zamiast 100% treści właściwego dokumentu. To różnica między ustaleniem
      // „w aktach tego nie ma" a „nie doczytaliśmy do końca".
      const pelny = d.strona_od
        ? await pdfTextStron(buf, d.strona_od, d.strona_do ?? d.strona_od, MAX_ZN_DOK).catch(() => "")
        : /\.pdf$/i.test(nazwa)
          ? await pdfText(buf, MAX_ZN_PLIK).catch(() => "")
          : await tekstZPliku(nazwa, buf);
      if (pelny.trim().length <= 200) continue;
      // Dokument dłuższy niż budżet promptu: zamiast ucinać początek (w raportach
      // to spis treści), wycinamy okna wokół fraz właściwych dla modułu.
      let tekst = pelny;
      if (pelny.length > MAX_ZN_DOK) {
        tekst = frazy
          ? keywordWindows(pelny, frazy, 700, MAX_ZN_DOK)
          : pelny.slice(0, MAX_ZN_DOK);
        skrocone.push(`${nazwa} (${pelny.length} zn. → ${tekst.length} zn.)`);
      }
      out.push({ plik: nazwa, tekst });
    }
    return out;
  }

  const client = klientLLM("warsztat-bank", { sprawa: id });
  // Niepowodzenia ekstrakcji — MUSZĄ być widoczne, patrz niżej.
  const awarie: string[] = [];

  async function wyodrebnij<T>(
    system: string,
    dok: { plik: string; tekst: string }[],
    klucz: string,
    etykieta: string,
  ): Promise<T[]> {
    if (!dok.length) return [];
    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      // Chronologia procesu decyzyjnego potrafi mieć kilkadziesiąt zdarzeń po kilka
      // zdań każde. Przy 8000 odpowiedź urywała się w połowie JSON-a.
      max_tokens: 16000,
      system,
      messages: [
        {
          role: "user",
          content: dok.map((d) => `### PLIK: ${d.plik}\n${d.tekst}`).join("\n\n"),
        },
      ],
    });
    const txt = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    // ⚠️ URWANA ODPOWIEDŹ TO NIE JEST „BRAK USTALEŃ".
    // Wcześniej `catch { return [] }` zrównywał trzy różne rzeczy: model nic nie
    // znalazł, model urwał się na limicie tokenów, model zwrócił coś niebędącego
    // JSON-em. Moduł zapisywał wtedy „nie odtworzono zdarzeń — brak czytelnych
    // dokumentów w aktach", czyli twierdzenie NIEPRAWDZIWE o zawartości akt,
    // w rozdziale, który idzie do prokuratora.
    if (msg.stop_reason === "max_tokens")
      awarie.push(
        `${etykieta}: odpowiedź modelu urwała się na limicie długości — ustalenia są NIEPEŁNE. ` +
          "Nie traktuj braku pozycji jako braku w aktach.",
      );
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) {
      awarie.push(`${etykieta}: nie rozpoznano odpowiedzi modelu jako danych — ekstrakcja nie doszła do skutku.`);
      return [];
    }
    try {
      return (JSON.parse(m[0])[klucz] ?? []) as T[];
    } catch {
      awarie.push(
        `${etykieta}: odpowiedź modelu jest niekompletna (${txt.length} zn.) i nie daje się odczytać — ` +
          "ekstrakcja nie doszła do skutku. Uruchom krok ponownie.",
      );
      return [];
    }
  }

  const [dokProc, dokLim, dokMedia, dokSektor] = await Promise.all([
    tekstyDla(TYPY_PROCEDURY, FRAZY.PROCEDURY),
    tekstyDla(TYPY_LIMITY, FRAZY.LIMITY),
    // Rozdział nazywa się „Publikacje prasowe i KOMUNIKATY" — komunikaty KNF
    // o zarządzie komisarycznym i zawieszeniu oraz raporty bieżące emitenta leżą
    // w aktach pod typami nadzorczymi i upadłościowymi, nie pod PRASA.
    tekstyDla(TYPY_MEDIA, undefined, (d) => czyKomunikatUrzedowy(d.doc_type, d.opis)),
    tekstyDla(TYPY_SEKTOR, FRAZY.SEKTOR),
  ]);
  const [zdarzenia, limity, publikacje, miary] = await Promise.all([
    wyodrebnij<Zdarzenie>(SYSTEM_PROCEDURY, dokProc, "zdarzenia", "Proces decyzyjny"),
    wyodrebnij<Limit>(SYSTEM_LIMITY, dokLim, "limity", "Metodyka limitów"),
    wyodrebnij<Publikacja>(SYSTEM_MEDIA, dokMedia, "publikacje", "Publikacje prasowe"),
    wyodrebnij<MiaraSektora>(SYSTEM_SEKTOR, dokSektor, "miary", "Skala sektora"),
  ]);
  zdarzenia.sort((a, b) => String(a.data).localeCompare(String(b.data)));

  // ZESTAWIENIE Z PRZEPISEM — deterministyczne, na datowanym katalogu.
  const wlasciwe = dzien ? przepisyNaDzien(dzien) : [];
  const anachroniczne = dzien ? przepisyAnachroniczne(dzien) : [];

  // Proza rozdziałów zredagowanych wcześniej — do zachowania przy ponownym przeliczeniu.
  const { data: istniejace } = await supabase
    .from("subanalyses")
    .select("kind,body_md")
    .eq("case_id", id);
  const prozaWg = new Map((istniejace ?? []).map((s) => [s.kind as string, (s.body_md as string) ?? ""]));

  const zapisz = async (kind: string, title: string, chapter_no: string, data: unknown, findings: string[]) => {
    // Skrócenie dokumentu dopisujemy do UWAG każdego modułu, a nie tylko do odpowiedzi
    // HTTP: `uwagi` idą do promptu redakcji, więc model dowie się, że opisuje wycinek,
    // a nie całość. Milczące ucięcie czytałoby się jak komplet materiału.
    const uwagi = [
      ...(((data as { uwagi?: string[] }).uwagi ?? []) as string[]),
      ...awarie,
      ...(skrocone.length
        ? [
            "Dokumenty dłuższe niż budżet analizy odczytano fragmentami — wybrano fragmenty wokół fraz " +
              `właściwych dla modułu, nie początek pliku: ${skrocone.join("; ")}.`,
          ]
        : []),
      // Cichy odsiew limitem jest gorszy od jawnej luki: rozdział twierdziłby, że
      // czegoś w aktach nie ma, podczas gdy dokument istniał, tylko go nie wzięto.
      ...(pominieteLimitem.length
        ? [
            "Część dokumentów nie weszła do analizy z powodu limitu liczby dokumentów na moduł — " +
              `ustalenia negatywne tego modułu NIE obejmują całości akt: ${pominieteLimitem.join("; ")}.`,
          ]
        : []),
    ];
    await supabase.from("subanalyses").upsert(
      {
        case_id: id,
        kind,
        title,
        chapter_no,
        status: "szkic",
        // ⚠️ NIE KASUJEMY PROZY. Upsert z pustym `body_md` przy każdym ponownym
        // uruchomieniu kroku niszczył zredagowany rozdział — biegły tracił tekst
        // bez ostrzeżenia. Zaznaczamy natomiast, że proza opisuje WCZEŚNIEJSZY
        // odczyt: tekst opisujący nieaktualne liczby jest gorszy niż jego brak,
        // bo wygląda na aktualny.
        body_md: prozaWg.get(kind) ?? "",
        // `awarie` osobnym polem, nie tylko w `uwagi`: panel i audytor muszą odróżnić
        // „ekstrakcja się nie udała" od „w aktach tego nie ma".
        data: {
          ...(data as object),
          findings,
          ...(uwagi.length ? { uwagi } : {}),
          ...(awarie.length ? { awarie } : {}),
          ...((prozaWg.get(kind) ?? "").trim() ? { proza_sprzed_przeliczenia: true } : {}),
        },
      },
      { onConflict: "case_id,kind" },
    );
  };

  const proc = zbudujProcedury(zdarzenia, dzien, {
    bezOcr,
    zastapioneOcr,
    przepisy: wlasciwe.filter((p) => p.moduly.includes("procedury")).map((p) => `${p.ref} — ${p.zakres}`),
  });
  await zapisz("procedury", "Proces decyzyjny i dokumenty wewnętrzne", "V", proc.data, [
    ...proc.findings,
    `Materiał: ${dokProc.length} dokumentów wewnętrznych.`,
  ]);

  // Metodyka DRUGIEJ strony relacji zrzeszeniowej — deterministycznie z metadanych.
  // Rozdział o metodyce, który jej nie wymienia, twierdzi nieprawdę o zawartości akt.
  const zrzeszajacy = wierszeMetodykiZrzeszajacego(wszystkie);
  const tabelaLimitow = {
    caption: "Tabela. Limity zaangażowania wg metodyki banku",
    head: ["Okres", "Termin", "Podstawa wyznaczenia", "Kwota", "Źródło"],
    rows: limity.map((l) => [l.okres, l.termin ?? "", l.podstawa, l.kwota, l.plik]),
  };
  await zapisz(
    "limity",
    "Metodyka limitów i koncentracja zaangażowania",
    "V",
    {
      table: tabelaLimitow,
      tables: [
        tabelaLimitow,
        ...(zrzeszajacy.length
          ? [{
              caption:
                "Tabela. Zasady i metodyka monitorowania stosowane przez bank zrzeszający (dokumenty w aktach)",
              head: ["Karta akt", "Dokument", "Plik"],
              rows: zrzeszajacy,
            }]
          : []),
      ],
      dzienZdarzenia: dzien || null,
      przepisy: wlasciwe.filter((p) => p.moduly.includes("limity")).map((p) => `${p.ref} — ${p.zakres}`),
      anachroniczne: anachroniczne.filter((p) => p.moduly.includes("limity")).map((p) => `${p.ref} (od ${p.od})`),
    },
    [
      ...(limity.length
        ? [`Odczytano ${limity.length} pozycji limitów z metodyki banku.`]
        : ["Metodyki limitów zaangażowania samego banku w aktach nie ma — pozycja pozostaje do zamówienia."]),
      ...(zrzeszajacy.length
        ? [
            `W aktach są natomiast zasady monitorowania i metodyka oceny sytuacji zrzeszonych banków stosowane przez bank zrzeszający (${zrzeszajacy.length} dokumentów, ${zrzeszajacy[0][0]}–${zrzeszajacy[zrzeszajacy.length - 1][0]}) — ocena koncentracji zaangażowań jest możliwa od strony monitoringu zrzeszającego.`,
          ]
        : []),
    ],
  );

  // Składanie rozdziałów jest w lib/opinion/warsztat-bank.ts — tam ma testy.
  // Najważniejszy z nich (podział publikacji po dacie zdarzenia) rozstrzyga o tym,
  // czy opinia nie popełni wnioskowania wstecznego, więc nie może siedzieć w trasie,
  // której nie da się uruchomić bez serwera i zalogowania.
  const media = zbudujMedia(publikacje, dzien);
  const sektor = zbudujSektor(miary, dokSektor.length, dzien);
  const prawne = zbudujOtoczeniePrawne(wlasciwe, anachroniczne, dzien);
  await zapisz("media", "Publikacje prasowe i komunikaty", "V", media.data, media.findings);
  await zapisz(
    "ekspozycja_sektor",
    "Skala sektora bankowego wobec gospodarki",
    "V",
    sektor.data,
    sektor.findings,
  );
  await zapisz(
    "otoczenie_prawne",
    "Otoczenie prawne i standardy identyfikacji ryzyka",
    "V",
    prawne.data,
    prawne.findings,
  );

  return {
    ok: true as const,
    zdarzen: (proc.data.tables as { rows: string[][] }[])[0].rows.length,
    zdarzenPoDecyzji: proc.data.poZdarzeniu as number,
    publikacji: (media.data.tables as { rows: string[][] }[])[0].rows.length,
    publikacjiPoZdarzeniu: media.data.poZdarzeniu as number,
    miarSektora: (sektor.data.table as { rows: string[][] }).rows.length,
    przepisowWlasciwych: wlasciwe.length,
    limitow: limity.length,
    dokumentow: dokProc.length + dokLim.length,
    bezOcr,
    zastapioneOcr,
    skrocone,
    awarie,
    anachronicznych: anachroniczne.length,
  };
}
