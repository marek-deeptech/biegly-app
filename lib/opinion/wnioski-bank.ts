// Wnioski opinii bankowej — rozdział, który odpowiada na pytanie organu.
//
// DLACZEGO OSOBNY BUDOWNICZY, A NIE GAŁĄŹ W buildWnioskiSubanaliza:
// Wnioski GPW składają się z technik manipulacji, zdarzeń ESPI, powiązań KRS i zbieżności
// adresów IP. W sprawie o ryzyko kredytowe banku żadnej z tych rzeczy nie ma — jest
// kondycja kontrahenta, sygnały dostępne przed decyzją, proces decyzyjny i limity wobec
// regulacji z daty zdarzenia. Wspólny budowniczy z warunkami rozjechałby się przy
// pierwszej zmianie w którejkolwiek dziedzinie, a obie idą do sądu w toczących się sprawach.
//
// PODZIAŁ PRACY: tutaj powstaje MATERIAŁ (rejestr ustaleń z modułów, z podaniem źródła),
// model dopiero mapuje go na pytania organu i pisze prozę. Model nie liczy i nie dobiera
// przepisu — jedno i drugie przychodzi gotowe.
import { przepisyNaDzien } from "@/lib/domain/prawo-bankowe";

import type { StoredSub, SubResult } from "./build";

/** Moduły w kolejności, w jakiej ich ustalenia wchodzą do rejestru. */
const ZRODLA: { kind: string; etykieta: string }[] = [
  { kind: "makro", etykieta: "Otoczenie makroekonomiczne" },
  { kind: "media", etykieta: "Publikacje prasowe" },
  { kind: "ekspozycja_sektor", etykieta: "Skala sektora bankowego" },
  { kind: "sygnaly_rynkowe", etykieta: "Sygnały rynkowe (CDS, ratingi)" },
  { kind: "sprawozdania", etykieta: "Sprawozdania finansowe kontrahenta" },
  { kind: "wskazniki_bank", etykieta: "Współczynniki kapitałowe" },
  { kind: "limity", etykieta: "Metodyka limitów" },
  { kind: "procedury", etykieta: "Proces decyzyjny" },
  { kind: "otoczenie_prawne", etykieta: "Otoczenie prawne" },
];

/**
 * Sekcje szkieletu — NEUTRALNE TEMATYCZNIE, nie ponumerowane pytaniami.
 *
 * Tak samo jak w dziedzinie GPW: pytania prokuratora różnią się sprawa od sprawy, więc
 * zaszycie „Q1–Q4" wiązałoby szkielet z jedną sprawą. Model dostaje fakty pod hasłami
 * rzeczowymi i sam mapuje je na pytania z postanowienia w TEJ sprawie.
 */
const SEKCJE: { tytul: string; kinds: string[] }[] = [
  { tytul: "Kondycja finansowa kontrahenta przed dniem decyzji", kinds: ["sprawozdania", "wskazniki_bank"] },
  {
    tytul: "Informacje dostępne publicznie przed dniem decyzji",
    kinds: ["makro", "media", "ekspozycja_sektor", "sygnaly_rynkowe"],
  },
  { tytul: "Proces decyzyjny banku i jego udokumentowanie", kinds: ["procedury"] },
  { tytul: "Limity zaangażowania wobec regulacji z daty zdarzenia", kinds: ["limity", "otoczenie_prawne"] },
];

function danych(s: StoredSub | undefined): Record<string, unknown> {
  return (s?.data ?? {}) as Record<string, unknown>;
}
function lista(d: Record<string, unknown>, klucz: string): string[] {
  const v = d[klucz];
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

export type MaterialWnioskow = {
  /** Ustalenie → moduł, z którego pochodzi. Kolumna źródła jest obowiązkowa. */
  rejestr: { ustalenie: string; zrodlo: string }[];
  /** Czego w aktach NIE MA — ustalenie negatywne, nie milczenie. */
  braki: string[];
  /**
   * Odczyt NIEWIARYGODNY — wniosku nie wolno oprzeć na takiej wartości.
   * (bilans się nie domyka, składnik większy od całości, powielona kolumna)
   */
  zastrzezenia: string[];
  /**
   * Wartość doliczona z tożsamości — UŻYTECZNA, wymaga tylko ujawnienia pochodzenia.
   * Osobno od zastrzeżeń, bo zlane w jedną listę osłabiały się nawzajem: kilkanaście
   * rutynowych dopełnień topiło kilka realnych błędów odczytu.
   */
  dopelnienia: string[];
  /** Moduły pakietu, których w sprawie nie wykonano. */
  nieWykonane: string[];
  przepisy: string[];
};

/**
 * Materiał do Wniosków — zebrany z modułów, z zachowaniem źródła każdego ustalenia.
 *
 * ⚠️ ZASTRZEŻENIA IDĄ DO WNIOSKÓW, NIE ZOSTAJĄ W ROZDZIALE ANALIZY.
 * Gdy silnik zgłosił, że kolumna sprawozdania jest niewiarygodna, wniosek oparty na tej
 * liczbie jest wnioskiem błędnym — a to rozdział, który czyta prokurator i sąd. Uwagi
 * o jakości odczytu muszą dojechać aż tutaj, zamiast zostać w rozdziale, którego nikt
 * nie zestawi z wnioskiem.
 */
export function materialWnioskow(stored: StoredSub[], dzien: string | null): MaterialWnioskow {
  const wg = new Map(stored.map((s) => [s.kind, s] as const));
  const rejestr: { ustalenie: string; zrodlo: string }[] = [];
  const braki: string[] = [];
  const zastrzezenia: string[] = [];
  const dopelnienia: string[] = [];
  const nieWykonane: string[] = [];

  for (const { kind, etykieta } of ZRODLA) {
    const s = wg.get(kind);
    if (!s) {
      nieWykonane.push(etykieta);
      continue;
    }
    const d = danych(s);
    for (const f of lista(d, "findings")) rejestr.push({ ustalenie: f, zrodlo: etykieta });
    for (const b of lista(d, "braki")) braki.push(`${etykieta}: ${b}`);
    for (const z of lista(d, "zastrzezenia")) zastrzezenia.push(`${etykieta}: ${z}`);
    for (const u of lista(d, "uwagi")) dopelnienia.push(`${etykieta}: ${u}`);
  }

  return {
    rejestr,
    braki,
    zastrzezenia,
    dopelnienia,
    nieWykonane,
    przepisy: dzien ? przepisyNaDzien(dzien).map((p) => `${p.ref} — ${p.zakres}`) : [],
  };
}

/**
 * Subanaliza `wnioski` dziedziny bankowej — szkielet do redakcji plus rejestr ustaleń.
 *
 * Szkielet jest jawnie oznaczony jako materiał, a nie gotowy tekst: to model ma z niego
 * napisać wnioski odpowiadające na pytania organu, a biegły — zatwierdzić.
 */
export function buildWnioskiBank(
  pytania: string[],
  stored: StoredSub[],
  dzien: string | null,
): SubResult {
  const m = materialWnioskow(stored, dzien);
  const wg = new Map(stored.map((s) => [s.kind, s] as const));

  const linie: string[] = [];
  linie.push("## Materiał do wniosków (szkic — do redakcji prozą)");
  linie.push("");
  if (pytania.length) {
    linie.push("**Pytania organu, na które odpowiada opinia:**");
    pytania.forEach((q, n) => linie.push(`${n + 1}. ${q}`));
  } else {
    linie.push(
      "**Brak pytań organu w aktach.** Wnioski bez pytania organu nie mają adresata — uzupełnij " +
        "postanowienie o powołaniu biegłego (Krok 1).",
    );
  }
  linie.push("");
  linie.push(
    dzien
      ? `**Dzień ocenianego zdarzenia:** ${dzien}. Cała ocena odnosi się do stanu wiedzy i stanu prawnego z tego dnia.`
      : "**Nie podano dnia ocenianego zdarzenia** — bez niego nie da się ustalić ani stanu wiedzy, ani stanu prawnego.",
  );

  for (const sek of SEKCJE) {
    const ust = sek.kinds.flatMap((k) => {
      const s = wg.get(k);
      const et = ZRODLA.find((z) => z.kind === k)?.etykieta ?? k;
      return lista(danych(s), "findings").map((f) => `- ${f} _(${et})_`);
    });
    linie.push("", `### ${sek.tytul}`);
    if (ust.length) linie.push(...ust);
    else linie.push("- _Brak ustaleń — moduły tej sekcji nie zostały wykonane albo nie dały wyniku._");
  }

  if (m.braki.length) {
    linie.push("", "### Ustalenia negatywne — czego w aktach nie ma");
    linie.push(...m.braki.map((b) => `- ${b}`));
  }
  if (m.zastrzezenia.length) {
    linie.push("", "### Zastrzeżenia do wiarygodności odczytu");
    linie.push("_Wniosek NIE MOŻE opierać się na wartości objętej zastrzeżeniem — wymaga ona weryfikacji w oryginale._");
    linie.push(...m.zastrzezenia.map((u) => `- ${u}`));
  }
  if (m.dopelnienia.length) {
    linie.push("", "### Wartości doliczone z tożsamości");
    linie.push("_Wartości użyteczne; przy powołaniu należy ujawnić, że pochodzą z odejmowania, a nie z odczytu wprost._");
    linie.push(...m.dopelnienia.map((u) => `- ${u}`));
  }
  if (m.nieWykonane.length) {
    linie.push("", "### Moduły pakietu niewykonane w tej sprawie");
    linie.push(...m.nieWykonane.map((n) => `- ${n}`));
  }
  if (m.przepisy.length) {
    linie.push("", "### Stan prawny właściwy dla oceny");
    linie.push(...m.przepisy.map((p) => `- ${p}`));
  }

  return {
    kind: "wnioski",
    chapterNo: "III",
    title: "Wnioski",
    bodyMd: linie.join("\n"),
    data: {
      table: {
        caption: "Tabela. Rejestr ustaleń wraz ze wskazaniem modułu analizy, z którego pochodzą",
        head: ["Ustalenie", "Źródło ustalenia"],
        rows: m.rejestr.map((r) => [r.ustalenie, r.zrodlo]),
      },
      findings: m.rejestr.map((r) => r.ustalenie),
      legalRefs: m.przepisy,
    },
  };
}

const SYSTEM =
  "Jesteś biegłym sądowym z zakresu bankowości i finansów, piszesz rozdział WNIOSKI opinii " +
  "w sprawie karnej na zlecenie prokuratury. Piszesz rzeczowo, bezosobowo, w czasie przeszłym. " +
  "ZASADY BEZWZGLĘDNE: (1) NIE LICZYSZ i nie zmieniasz żadnej liczby — wszystkie wartości " +
  "przepisujesz dokładnie z podanych ustaleń. (2) NIE PRZESĄDZASZ o winie, zamiarze ani " +
  "kwalifikacji czynu — ustalasz fakty i oceniasz je wobec wymogu prawnego; kwalifikacja należy " +
  "do organu. (3) Oceniasz WYŁĄCZNIE stan wiedzy dostępny w dniu decyzji; powołanie się na to, " +
  "co wydarzyło się później, jest wnioskowaniem wstecznym i dyskwalifikuje wniosek. (4) Stan " +
  "prawny bierzesz z daty zdarzenia. (5) Ustalenia negatywne („w aktach nie ma…”) wypowiadasz " +
  "wprost — przemilczenie luki dowodowej jest wadą opinii, nie jej zaletą.";

export function buildBankWnioskiPrompt(inp: {
  caseName: string;
  signature: string | null;
  dzienZdarzenia: string | null;
  pytania: string[];
  material: MaterialWnioskow;
  /** Wzorzec stylu z opinii biegłego — jeśli korpus go ma. */
  wzorzec?: string | null;
}): { system: string; user: string } {
  const p: string[] = [];
  p.push(`Napisz rozdział „Wnioski" opinii biegłego w sprawie ${inp.caseName}${inp.signature ? ` (sygn. ${inp.signature})` : ""}.`);
  if (inp.dzienZdarzenia)
    p.push(
      `Dzień ocenianego zdarzenia: ${inp.dzienZdarzenia}. Cała ocena odnosi się do stanu wiedzy ` +
        "i stanu prawnego z TEGO dnia.",
    );
  if (inp.pytania.length)
    p.push(
      "Pytania organu — wnioski mają na nie ODPOWIEDZIEĆ, w tej kolejności, każde osobno:\n" +
        inp.pytania.map((q, n) => `${n + 1}. ${q}`).join("\n"),
    );
  else
    p.push(
      "W aktach nie ma pytań organu. Napisz wnioski jako uporządkowane ustalenia i zaznacz na " +
        "wstępie, że postanowienia o powołaniu biegłego wraz z pytaniami w aktach brak.",
    );

  p.push(
    "USTALENIA Z ANALIZY — wyłącznie z nich wolno budować wnioski. Przy każdym podano moduł, " +
      "z którego pochodzi:\n" +
      inp.material.rejestr.map((r) => `- ${r.ustalenie} [${r.zrodlo}]`).join("\n"),
  );
  if (inp.material.zastrzezenia.length)
    p.push(
      "ODCZYT NIEWIARYGODNY — wniosku NIE WOLNO oprzeć na tych wartościach. Jeśli któreś " +
        "ustalenie z nich korzysta, napisz wprost, że wymaga weryfikacji w oryginale " +
        "sprawozdania, i nie wyciągaj z niego wniosku:\n" +
        inp.material.zastrzezenia.map((u) => `- ${u}`).join("\n"),
    );
  if (inp.material.dopelnienia.length)
    p.push(
      "WARTOŚCI DOLICZONE Z TOŻSAMOŚCI — wolno ich używać, ale przy powołaniu ujawnij, że " +
        "pochodzą z odejmowania składników, a nie z odczytu wprost:\n" +
        inp.material.dopelnienia.map((u) => `- ${u}`).join("\n"),
    );
  if (inp.material.braki.length)
    p.push(
      "USTALENIA NEGATYWNE — wypowiedz je wprost jako granice opinii, nie pomijaj:\n" +
        inp.material.braki.map((b) => `- ${b}`).join("\n"),
    );
  if (inp.material.nieWykonane.length)
    p.push(
      "Moduły analizy niewykonane w tej sprawie — nie formułuj wniosków w ich zakresie:\n" +
        inp.material.nieWykonane.map((n) => `- ${n}`).join("\n"),
    );
  if (inp.material.przepisy.length)
    p.push(
      "Przepisy obowiązujące w dacie zdarzenia — powołuj wyłącznie te:\n" +
        inp.material.przepisy.map((x) => `- ${x}`).join("\n"),
    );
  if (inp.wzorzec)
    p.push(
      "Wzorzec stylu — fragment wniosków z opinii tego samego biegłego. Naśladuj sposób " +
        "formułowania i poziom ostrożności, NIE przenoś treści ani liczb:\n" +
        inp.wzorzec.slice(0, 3000),
    );

  p.push(
    "Struktura: (1) krótkie wprowadzenie — na jakiej podstawie sformułowano wnioski, " +
      (inp.pytania.length
        ? "(2) odpowiedź na każde pytanie organu osobno, z powołaniem ustaleń liczbowych, "
        : "(2) uporządkowane ustalenia, ") +
      "(3) zestawienie ustalonego stanu faktycznego z wymogiem prawnym obowiązującym w dacie " +
      "zdarzenia, (4) granice opinii — czego na podstawie akt ustalić nie można. " +
      "Objętość: 8–16 akapitów. Zwróć samą treść rozdziału, bez nagłówka.",
  );
  return { system: SYSTEM, user: p.join("\n\n") };
}
