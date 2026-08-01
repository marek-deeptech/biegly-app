// SKŁADANIE OPINII DZIEDZINY BANKOWEJ — osobny builder, nie gałąź w buildOpinion.
//
// DLACZEGO OSOBNY:
// Numeracja i role rozdziałów różnią się co do struktury, nie tylko etykiety.
// W opinii o manipulację przedmiot i podstawa prawna są jednym rozdziałem I,
// a wnioski stoją w II. W opinii bankowej przedmiot to I, podstawa prawna II,
// wnioski III — i dochodzą trzy rozdziały końcowe (załączniki, spis tabel,
// spis wykresów) zamiast jednego zbiorczego.
//
// Wstawienie tego jako warunków w buildOpinion oznaczałoby, że każda przyszła
// zmiana w opinii bankowej dotyka kodu składającego opinie o manipulacji —
// a te są używane w trzech toczących się sprawach. Rozdzielenie kosztuje
// powtórzenie kilku bloków i kupuje pewność, że jedna dziedzina nie ruszy drugiej.
import { packDla } from "@/lib/domain";
import { przepisyNaDzien } from "@/lib/domain/prawo-bankowe";

import { chapterFromStored, type Chapter, type Doc, type Metric, type Opinion, type StoredSub } from "./build";
import { chartSvg } from "./charts";
import { wykresyBankowe } from "./charts-bank";

/** Moduły rozdziału V w kolejności, w jakiej występują w opinii wzorcowej (MBR, A–L). */
const MODULY_V: { kind: string; litera: string; tytul: string }[] = [
  { kind: "makro", litera: "A", tytul: "Otoczenie makroekonomiczne" },
  { kind: "media", litera: "B", tytul: "Publikacje prasowe i komunikaty" },
  { kind: "ekspozycja_sektor", litera: "C", tytul: "Skala sektora bankowego wobec gospodarki" },
  { kind: "sygnaly_rynkowe", litera: "D", tytul: "Sygnały rynkowe: CDS i ratingi" },
  { kind: "sprawozdania", litera: "E", tytul: "Analiza sprawozdań finansowych kontrahenta" },
  { kind: "wskazniki_bank", litera: "F", tytul: "Współczynniki kapitałowe i sytuacja finansowa w czasie" },
  { kind: "limity", litera: "G", tytul: "Metodyka limitów i koncentracja zaangażowania" },
  { kind: "procedury", litera: "H", tytul: "Proces decyzyjny i dokumenty wewnętrzne" },
  { kind: "otoczenie_prawne", litera: "I", tytul: "Otoczenie prawne i standardy identyfikacji ryzyka" },
];

export function buildOpinionBank(
  caseRow: { name: string; signature: string | null; typ?: string | null },
  metrics: Metric[],
  documents: Doc[],
  stored: StoredSub[] = [],
  /** Data ocenianego zdarzenia — wyznacza stan prawny w rozdziale II. */
  dzienZdarzenia?: string | null,
): Opinion {
  const pakiet = packDla(caseRow.typ ?? "ryzyko_bankowe");
  const byKind = new Map(stored.map((s) => [s.kind, s] as const));
  const inputDocs = documents.filter((d) => d.provenance !== "wyjście");

  const pytania =
    ((stored.find((s) => s.kind === "pytania_organu")?.data as { questions?: string[] } | undefined)?.questions ?? [])
      .map((q) => String(q).trim())
      .filter(Boolean);

  // Podstawa prawna z DATOWANEGO katalogu. Brak daty → nie zgadujemy stanu prawnego;
  // rozdział zostaje do uzupełnienia, bo powołanie przepisu z niewłaściwego okresu
  // jest gorsze niż jawna luka.
  const przepisy = dzienZdarzenia ? przepisyNaDzien(dzienZdarzenia) : [];
  const legalBasis = przepisy.map((p) => `${p.ref} — ${p.akt}`);

  const pusty = (no: string, title: string, powod: string): Chapter => ({
    no,
    title,
    status: "todo",
    paras: [{ text: powod, conf: "review" }],
  });

  // ── V. ANALIZA — moduły obecne w aktach, ponumerowane literami jak we wzorcu ──
  const moduly: Chapter[] = [];
  let i = 0;
  for (const m of MODULY_V) {
    const s = byKind.get(m.kind);
    if (!s) continue;
    moduly.push(chapterFromStored(s, `V.${MODULY_V[i]?.litera ?? m.litera}`, m.tytul));
    i++;
  }
  // Renumeracja liter po odsianiu nieobecnych modułów — inaczej opinia miałaby
  // A, C, F zamiast A, B, C.
  moduly.forEach((c, n) => {
    c.no = `V.${String.fromCharCode(65 + n)}`;
  });

  // WYKRESY — rzut policzonych serii na osie, generowany tu, a nie przez model.
  // Szereg 33 punktów w tabeli jest nieczytelny; spadek indeksu o 55% widać
  // dopiero na osi. SVG powstaje od razu, żeby eksport do DOCX i PDF miał co
  // rasteryzować, zamiast zostawiać puste miejsce „wykres do wstawienia".
  for (const w of wykresyBankowe(stored, dzienZdarzenia)) {
    const rozdzial = moduly.find((c) => byKind.get(w.kind) && c.title === MODULY_V.find((m) => m.kind === w.kind)?.tytul);
    if (!rozdzial) continue;
    rozdzial.placeholders = [
      ...(rozdzial.placeholders ?? []),
      { kind: "wykres", name: w.name, label: w.spec.title, chart: w.spec, svg: chartSvg(w.spec) },
    ];
  }

  const chapters: Chapter[] = [
    {
      no: "I",
      title: "Przedmiot opinii",
      status: pytania.length ? "draft" : "todo",
      paras: pytania.length
        ? [
            { text: "Przedmiotem opinii jest udzielenie odpowiedzi na pytanie organu:", conf: "grounded" },
            ...pytania.map((q) => ({ text: q, conf: "grounded" as const })),
          ]
        : [{ text: "Brak pytań organu w aktach — uzupełnij Krok 1 (postanowienie o powołaniu biegłego).", conf: "review" }],
    },
    {
      no: "II",
      title: "Podstawa prawna opinii",
      status: legalBasis.length ? "draft" : "todo",
      paras: legalBasis.length
        ? legalBasis.map((t) => ({ text: t, conf: "grounded" as const }))
        : [
            {
              text:
                "Podaj datę ocenianego zdarzenia w Kroku 4 — stan prawny zmieniał się w czasie " +
                "(CRR i CRD obowiązują dopiero od 2014 r.), więc podstawa prawna musi wynikać z daty czynu.",
              conf: "review",
            },
          ],
    },
    byKind.has("wnioski")
      ? chapterFromStored(byKind.get("wnioski")!, "III", "Wnioski")
      : pusty("III", "Wnioski", "Wnioski powstają po ukończeniu analizy — rozdział V."),
    byKind.has("proza_iii")
      ? chapterFromStored(byKind.get("proza_iii")!, "IV", "Wstęp")
      : pusty("IV", "Wstęp", "Rozdział do wygenerowania (Krok 5)."),
    {
      no: "V",
      title: "Analiza",
      status: moduly.length ? "draft" : "todo",
      paras: moduly.length
        ? [{ text: `Analiza obejmuje ${moduly.length} modułów wynikających z materiału dowodowego.`, conf: "grounded" }]
        : [{ text: "Brak modułów analizy — wykonaj Krok 3 (wskaźniki) i Krok 4 (warsztat).", conf: "review" }],
    },
    ...moduly,
    {
      no: "VI",
      title: "Załączniki",
      status: "draft",
      paras: [],
      evidence: inputDocs.map((d) => d.rel_path.split("/").pop() ?? d.rel_path).slice(0, 400),
    },
    {
      no: "VII",
      title: "Spis tabel",
      status: "draft",
      paras: moduly
        .flatMap((c) => [c.table, ...(c.tables ?? [])])
        .filter(Boolean)
        .map((t, n) => ({ text: `Tabela ${n + 1}. ${t?.caption ?? ""}`.trim(), conf: "grounded" as const })),
    },
    {
      no: "VIII",
      title: "Spis wykresów",
      status: "draft",
      paras: moduly
        .flatMap((c) => c.placeholders ?? [])
        .map((p, n) => ({ text: `Wykres ${n + 1}. ${p.label ?? p.name}`.trim(), conf: "grounded" as const })),
    },
  ];

  // Kontrola zgodności ze szkieletem dziedziny — gdyby ktoś dodał rozdział główny
  // w pakiecie, a zapomniał tutaj, opinia po cichu odbiegłaby od wzorca biegłego.
  const zeSzkieletu = pakiet.szkielet.map((r) => r.no);
  const glowne = chapters.filter((c) => !c.no.includes(".")).map((c) => c.no);
  if (zeSzkieletu.join(",") !== glowne.join(",")) {
    chapters.push({
      no: "—",
      title: "Uwaga techniczna",
      status: "todo",
      paras: [
        {
          text: `Szkielet pakietu dziedzinowego (${zeSzkieletu.join(", ")}) nie zgadza się ze złożoną opinią (${glowne.join(", ")}).`,
          conf: "review",
        },
      ],
    });
  }

  return {
    caseName: caseRow.name,
    signature: caseRow.signature,
    expert: "Krzysztof Michrowski",
    generatedAt: new Date().toISOString().slice(0, 10),
    legalBasis,
    chapters,
  };
}
