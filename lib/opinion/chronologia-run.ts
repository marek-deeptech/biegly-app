// Wykonanie modułu „Chronologia nadzorcza" — odczyt dokumentów nadzorczych i zapis rozdziału.
//
// PODZIAŁ PRACY, TAKI SAM JAK W POZOSTAŁYCH MODUŁACH BANKOWYCH:
// model CZYTA narrację i wyodrębnia okresy oraz zdarzenia; ARYTMETYKĘ I KONTROLE robi
// `engine/chronologia.py` — udział liczony z ilorazu, wykrycie wiersza złożonego z dwóch
// tabel, ustalenie najświeższych danych dostępnych w dniu zdarzenia.
//
// Kontrolę spójności powtarzamy tutaj w TS zamiast wołać Pythona: to kilkanaście linii
// arytmetyki, a wywołanie funkcji serverless z trasy Next.js kosztowałoby drugi przeskok
// sieciowy i drugi slot na planie Hobby. Reguła jest jedna i ma testy po obu stronach.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { keywordWindows, pdfText } from "@/lib/intake/pdf";

import {
  doZlotych,
  skokiSkali,
  systemOkresy,
  systemZdarzenia,
  udzialPoliczony,
  zbudujChronologie,
  type OkresNadzorczy,
  type ZdarzenieNadzorcze,
} from "./chronologia-nadzoru";

/** Typy dokumentów, w których bywa chronologia nadzorcza. */
const TYPY = ["NADZOR_KNF", "KORESPONDENCJA", "PISMO_PROCESOWE"];
const FRAZY =
  /harmonogram|inspekcj|współczynnik wypłacaln|fundusze własne|suma bilansow|RWEF|utrat[ąa] wartoś|BION|zalecen/i;
const MAX_ZN_DOK = 90_000;
const MAX_ZN_PLIK = 400_000;
/** Rozbieżność udziału większa niż ten próg = wiersz złożony z dwóch tabel (p.p.). */
const TOLERANCJA_PP = 0.15;

/** Kontrola spójności okresu — bliźniacza do `sprawdz_okresy` w engine/chronologia.py. */
export function sprawdzOkresy(okresy: OkresNadzorczy[]): string[] {
  const uwagi: string[] = [];
  for (const o of okresy) {
    if (o.portfel_kredytowy && o.portfel_utrata != null && o.udzial_utrata_pct != null) {
      const policzony = (100 * o.portfel_utrata) / o.portfel_kredytowy;
      if (Math.abs(policzony - o.udzial_utrata_pct) > TOLERANCJA_PP)
        uwagi.push(
          `${o.dzien}: udział kredytów z utratą wartości nie zgadza się z ilorazem — ` +
            `${o.portfel_utrata.toLocaleString("pl-PL")} / ${o.portfel_kredytowy.toLocaleString("pl-PL")} = ` +
            `${policzony.toFixed(2)}%, a dokument podaje ${o.udzial_utrata_pct.toFixed(2)}%. Wartość pochodzi ` +
            "prawdopodobnie z tabeli sąsiedniego okresu — zweryfikuj w oryginale.",
        );
    }
    if (o.portfel_utrata != null && o.portfel_kredytowy && o.portfel_utrata > o.portfel_kredytowy)
      uwagi.push(`${o.dzien}: portfel z utratą wartości przewyższa cały portfel kredytowy.`);
    if (o.depozyty && o.suma_bilansowa && o.depozyty > o.suma_bilansowa)
      uwagi.push(`${o.dzien}: depozyty przewyższają sumę bilansową.`);
    if (!(o.kontekst ?? "").trim())
      uwagi.push(
        `${o.dzien}: brak fragmentu narracji, z którego wynika data — nie da się sprawdzić przypisania okresu.`,
      );
  }
  return uwagi;
}

export type WynikBiegu = {
  ok: boolean;
  okresow: number;
  zdarzen: number;
  dokumentow: number;
  zastrzezenia: string[];
  skrocone: string[];
  /** Dokumenty odrzucone, bo nie dotyczą badanego podmiotu. */
  pominiete: string[];
  powod?: string;
};

/**
 * Okresy odczytane Z OBRAZU strony (scripts/tabele_z_obrazu.py).
 *
 * ⚠️ TO JEST LEPSZE ŹRÓDŁO NIŻ TEKST PO OCR. OCR spłaszcza tabelę do potoku słów
 * i gubi przynależność liczby do kolumny; model czytający obraz widzi linie tabeli
 * i nagłówki. Na harmonogramie UKNF odczyt z tekstu dał 7 okresów z pięcioma
 * zastrzeżeniami, a odczyt z obrazu — 8 okresów z jednym, i to wskazującym
 * rozbieżność w SAMYM dokumencie.
 */
export type TabelaZObrazu = {
  strona: number;
  jednostka?: string;
  kolumny: string[];
  wiersze: { etykieta: string; wartosci: string[] }[];
};

// ⚠️ NIE UŻYWAĆ `\w` DO POLSKICH ETYKIET. `\w` to [A-Za-z0-9_] i nie obejmuje „ą”,
// przez co wzorzec „utrat\w*\s+wartoś” nie łapał „utratą wartości”. Wiersz z udziałem
// nie był rozpoznawany, pole `udzial_utrata_pct` zostawało puste — a kontrola
// porównująca udział podany z policzonym MILCZAŁA z braku danych. Zero zastrzeżeń
// wyglądało wtedy jak czysty wynik, choć jedna kontrola w ogóle się nie wykonała.
// Wiersz ilorazowy MUSI być sprawdzany pierwszy: zawiera te same słowa co wiersz
// kwotowy i inaczej zostałby dopasowany do niego.
const ETYKIETY: [RegExp, keyof OkresNadzorczy][] = [
  [/suma\s+bilansow/i, "suma_bilansowa"],
  [/utrat[^/]*\/\s*portfel/i, "udzial_utrata_pct"],
  [/portfel\s+kredytowy\s+z\s+utrat/i, "portfel_utrata"],
  [/portfel\s+kredytowy/i, "portfel_kredytowy"],
  [/depozyt/i, "depozyty"],
  [/fundusze\s+własne/i, "fundusze_wlasne"],
  [/wsp[óo]łczynnik\s+wypłacaln|łączny\s+wsp[óo]łczynnik/i, "wsp_wyplacalnosci_pct"],
  [/wynik\s+finansow/i, "wynik_finansowy"],
];

/** „1.578.168" → 1578168, „6,39%" → 6.39. Zapis polski: kropka to tysiące. */
function liczba(s: string): number | undefined {
  const t = String(s).replace(/%/g, "").replace(/[\s ]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** „31.12.2012" → „2012-12-31". */
function isoData(s: string): string | null {
  const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export function okresyZTabel(tabele: TabelaZObrazu[]): OkresNadzorczy[] {
  const wgDnia = new Map<string, OkresNadzorczy>();
  // Jednostka bywa w przypisie tylko pod pierwszą tabelą, a obowiązuje dla wszystkich.
  // `find` po PRAWDZIWOŚCI, nie po istnieniu pola: model zwraca `""` dla tabel bez
  // przypisu, a `??` pustego łańcucha nie łapie — jednostka nie propagowała się
  // i połowa okresów zostawała w tysiącach obok drugiej połowy w złotych.
  const jednostkaDok = tabele.map((t) => t.jednostka).find((j) => (j ?? "").trim());
  for (const t of tabele) {
    t.kolumny.forEach((kol, i) => {
      const dzien = isoData(kol);
      if (!dzien) return;
      const o: OkresNadzorczy =
        wgDnia.get(dzien) ?? {
          dzien,
          kontekst: `tabela na str. ${t.strona}, nagłówek kolumny „${kol}”`,
          jednostka: (t.jednostka ?? "").trim() || jednostkaDok,
          plik: `str. ${t.strona}`,
        };
      for (const w of t.wiersze) {
        const para = ETYKIETY.find(([re]) => re.test(w.etykieta));
        if (!para) continue;
        const v = liczba(w.wartosci[i] ?? "");
        // Pierwsze trafienie wygrywa: ta sama kolumna powtarza się jako „bazowa"
        // w kolejnych tabelach i wartości muszą być zgodne, a nie nadpisywane.
        if (v != null && o[para[1]] == null) Object.assign(o, { [para[1]]: v });
      }
      wgDnia.set(dzien, o);
    });
  }
  return [...wgDnia.values()].sort((a, b) => a.dzien.localeCompare(b.dzien));
}

export async function wykonajChronologie(
  sb: SupabaseClient,
  id: string,
  dzien: string,
  /**
   * Nazwy i skróty BADANEGO PODMIOTU — wymagane.
   *
   * ⚠️ FAIL-LOUD, tak jak roster Grupy w dziedzinie manipulacji. Bez związania
   * ekstrakcji z podmiotem moduł zebrał zdarzenia ze sprawozdania Komisji Nadzoru
   * Audytowego za 2009 r. — o posiedzeniach EGAOB w Brukseli — i wstawił je do
   * chronologii nadzorczej banku jak własne.
   */
  podmiot: string[],
  /** Tabele odczytane z obrazu — gdy podane, zastępują ekstrakcję okresów z tekstu. */
  tabele?: TabelaZObrazu[],
): Promise<WynikBiegu> {
  const nazwy = podmiot.map((x) => x.trim()).filter(Boolean);
  if (!nazwy.length)
    throw new Error(
      "Nie podano nazwy badanego podmiotu. Bez niej moduł zbiera zdarzenia dotyczące innych " +
        "instytucji opisanych w aktach.",
    );
  const { data: caseRow } = await sb.from("cases").select("*").eq("id", id).single();
  if (!caseRow) throw new Error("Nie znaleziono sprawy.");
  if (caseRow.typ !== "ryzyko_bankowe")
    throw new Error("Chronologia nadzorcza dotyczy spraw o ryzyko bankowe.");

  const { data: docs } = await sb
    .from("documents")
    .select("rel_path,doc_type,storage_path,warstwa_tekstu")
    .eq("case_id", id);
  const wybrane = (docs ?? []).filter(
    (d) => TYPY.includes(d.doc_type) && d.storage_path && d.warstwa_tekstu !== "brak",
  );

  const skrocone: string[] = [];
  const pominiete: string[] = [];
  const dokumenty: { plik: string; tekst: string }[] = [];
  for (const d of wybrane.slice(0, 12)) {
    const { data: blob } = await sb.storage.from("case-files").download(d.storage_path!);
    if (!blob) continue;
    const nazwa = d.rel_path.split("/").pop() ?? d.rel_path;
    const pelny = await pdfText(await blob.arrayBuffer(), MAX_ZN_PLIK).catch(() => "");
    if (pelny.trim().length <= 200) continue;
    // Chronologia siedzi w środku pism procesowych na kilkaset tysięcy znaków —
    // początek pliku to strona tytułowa i lista pełnomocników.
    let tekst = pelny;
    if (pelny.length > MAX_ZN_DOK) {
      tekst = keywordWindows(pelny, FRAZY, 900, MAX_ZN_DOK);
      skrocone.push(`${nazwa} (${pelny.length} zn. → ${tekst.length} zn.)`);
    }
    // Dokument musi dotyczyć BADANEGO PODMIOTU, nie tylko zawierać słowa o nadzorze.
    const oPodmiocie = nazwy.some((n) => pelny.toLowerCase().includes(n.toLowerCase()));
    if (!oPodmiocie) {
      pominiete.push(nazwa);
      continue;
    }
    if (FRAZY.test(tekst)) dokumenty.push({ plik: nazwa, tekst });
  }
  if (!dokumenty.length)
    return { ok: false, okresow: 0, zdarzen: 0, dokumentow: 0, zastrzezenia: [], skrocone, pominiete,
             powod: "W aktach nie ma dokumentów nadzorczych dotyczących badanego podmiotu." };

  const okresy: OkresNadzorczy[] = [];
  const zdarzenia: ZdarzenieNadzorcze[] = [];
  const ai = new Anthropic();

  /** Jedno wywołanie = jeden rodzaj ustaleń. Wspólne dzieliło budżet tokenów: przy
   *  136 zdarzeniach na tabelę okresów zostawało tyle, że wypadały z niej wskaźniki. */
  async function czytaj<T>(system: string, plik: string, tekst: string, klucz: string): Promise<T[]> {
    const msg = await ai.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 12000,
      system,
      messages: [{ role: "user", content: `### PLIK: ${plik}\n${tekst}` }],
    });
    if (msg.stop_reason === "max_tokens") {
      skrocone.push(`${plik}: odpowiedź modelu (${klucz}) urwana — ustalenia z tego pliku są NIEPEŁNE.`);
      return [];
    }
    const txt = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try {
      const p = JSON.parse(m[0]);
      // `jednostka` przychodzi RAZ na dokument — dopinamy ją do każdego okresu,
      // bo przeliczenie odbywa się per wiersz i musi wiedzieć, z czego przelicza.
      return ((p[klucz] ?? []) as T[]).map((x) => ({ ...x, plik, ...(p.jednostka ? { jednostka: p.jednostka } : {}) }));
    } catch {
      skrocone.push(`${plik}: odpowiedzi modelu (${klucz}) nie dało się odczytać jako danych.`);
      return [];
    }
  }

  const zObrazu = tabele?.length ? okresyZTabel(tabele) : null;
  for (const d of dokumenty) {
    const zadania: Promise<unknown>[] = [
      czytaj<ZdarzenieNadzorcze>(systemZdarzenia(nazwy), d.plik, d.tekst, "zdarzenia").then((z) =>
        zdarzenia.push(...z),
      ),
    ];
    // Okresy czytamy z tekstu TYLKO wtedy, gdy nie ma odczytu z obrazu — tamten jest
    // wiarygodniejszy i mieszanie obu źródeł dałoby dwa warianty tego samego okresu.
    if (!zObrazu)
      zadania.push(
        czytaj<OkresNadzorczy>(systemOkresy(nazwy), d.plik, d.tekst, "okresy").then((o) => okresy.push(...o)),
      );
    await Promise.all(zadania);
  }
  if (zObrazu) okresy.push(...zObrazu);

  // Ten sam okres bywa opisany w kilku pismach, każde referuje inne wskaźniki —
  // scalamy POLE PO POLU. Wybór jednego „bogatszego" wpisu gubił dane: tabela wychodziła
  // uboższa niż ręczny odczyt z tego samego dokumentu.
  const KWOTY = ["suma_bilansowa","portfel_kredytowy","portfel_utrata","depozyty","fundusze_wlasne","wynik_finansowy"] as const;
  const POLA = [...KWOTY, "udzial_utrata_pct", "wsp_wyplacalnosci_pct"] as const;
  const wgDnia = new Map<string, OkresNadzorczy>();
  for (const o of doZlotych(okresy).okresy) {
    const cel = wgDnia.get(o.dzien);
    if (!cel) { wgDnia.set(o.dzien, { ...o }); continue; }
    for (const k of POLA) if (cel[k] == null && o[k] != null) Object.assign(cel, { [k]: o[k] });
    if (!cel.kontekst?.trim() && o.kontekst?.trim()) cel.kontekst = o.kontekst;
  }
  const unikalne = [...wgDnia.values()];
  const zastrzezenia = [
    ...doZlotych(okresy).uwagi,
    ...sprawdzOkresy(unikalne),
    ...skokiSkali(unikalne),
  ];

  const w = zbudujChronologie(unikalne, zdarzenia, dzien, zastrzezenia);
  await sb.from("subanalyses").upsert(
    {
      case_id: id,
      kind: "chronologia_nadzoru",
      chapter_no: "V",
      title: "Chronologia nadzorcza i wskaźniki banku w czasie",
      status: "szkic",
      body_md: "",
      data: {
        ...w.data,
        findings: w.findings,
        ...(skrocone.length ? { uwagi: skrocone } : {}),
        zrodla: dokumenty.map((d) => ({ plik: d.plik })),
        podmiot: nazwy,
      },
    },
    { onConflict: "case_id,kind" },
  );
  return {
    ok: true,
    okresow: unikalne.length,
    zdarzen: zdarzenia.length,
    dokumentow: dokumenty.length,
    zastrzezenia,
    skrocone,
    pominiete,
  };
}

/** Udział policzony — reeksport, żeby raporty CLI nie sięgały do dwóch modułów. */
export { udzialPoliczony };
