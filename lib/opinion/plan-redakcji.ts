// Plan Kroku 5 — co użytkownik generuje i redaguje, w kolejności rozdziałów opinii.
//
// DLACZEGO OSOBNO OD WIDOKU
// Widok opinii liczył plan WYŁĄCZNIE z katalogu GPW (`resolvePlan`), niezależnie od
// dziedziny sprawy. W sprawie bankowej dawało to listę rozdziałów o technikach
// manipulacji — „Generuj: IV.4 Wash trades", „Generuj: IV.6 Layering" — których nie ma
// czego generować, oraz numerację ze szkieletu GPW (Wnioski jako II, Wstęp jako III),
// podczas gdy opinia bankowa ma Wnioski w III, a Wstęp w IV. Biegły widział w Kroku 5
// plan cudzej sprawy.
//
// Tutaj plan wynika z DZIEDZINY i z tego, co realnie policzono w krokach 3–4.
import { MODULY_V } from "./build-bank";
import { resolvePlan, type IVKind } from "./chapters";

export type AkcjaKroku =
  | { typ: "generuj-iv"; kind: IVKind } // budowniczy GPW z danych silnika
  | { typ: "generuj-wnioski" }
  | { typ: "redaguj-proze"; rozdzial: "I" | "III" | "V" } // rozdziały miękkie
  | { typ: "rozwin-modul"; kind: string }; // moduł analizy → proza modelem

export type KrokRedakcji = {
  /** Numer rozdziału W OPINII — inny w każdej dziedzinie. */
  no: string;
  label: string;
  /** Rodzaj subanalizy, po którym sprawdzamy status zatwierdzenia. */
  kind: string;
  akcja: AkcjaKroku;
  /** Powód blokady; brak = krok dostępny. */
  blokada?: string;
  uwaga?: string;
};

/**
 * Plan dla dziedziny bankowej.
 *
 * Moduły rozdziału V POWSTAJĄ W KROKACH 3–4, nie tutaj — w Kroku 5 pozostaje im
 * nadanie prozy. Dlatego ich krok to „rozwiń", a nie „generuj”: przycisk „Generuj"
 * sugerowałby, że da się je zrobić bez odczytu sprawozdań i akt.
 */
function planBankowy(obecne: Set<string>, zatwierdzone: Set<string>): KrokRedakcji[] {
  const moduly = MODULY_V.filter((m) => obecne.has(m.kind));
  const kroki: KrokRedakcji[] = moduly.map((m, i) => ({
    no: `V.${String.fromCharCode(65 + i)}`,
    label: m.tytul,
    kind: m.kind,
    akcja: { typ: "rozwin-modul", kind: m.kind },
  }));

  const modulyGotowe = moduly.length > 0 && moduly.every((m) => zatwierdzone.has(m.kind));
  kroki.push({
    no: "III",
    label: "Wnioski",
    kind: "wnioski",
    akcja: { typ: "generuj-wnioski" },
    blokada: modulyGotowe ? undefined : "Najpierw zatwierdź rozdziały analizy (V)",
  });
  kroki.push({
    no: "IV",
    label: "Wstęp — ujęcie teoretyczne",
    kind: "proza_iii",
    akcja: { typ: "redaguj-proze", rozdzial: "III" },
    blokada: zatwierdzone.has("wnioski") ? undefined : "Najpierw zatwierdź Wnioski",
    uwaga: "Rozdział ogólny — aparat pojęciowy dla analizy, bez ustaleń tej sprawy.",
  });
  return kroki;
}

/** Plan dla dziedziny manipulacji — zachowanie sprzed rozdzielenia dziedzin. */
function planGpw(
  caseName: string,
  techniki: IVKind[] | null,
  zatwierdzone: Set<string>,
): KrokRedakcji[] {
  const plan = resolvePlan(caseName, techniki);
  const ivGotowe = plan.length > 0 && plan.every((p) => zatwierdzone.has(p.kind));
  const wnioskiGotowe = zatwierdzone.has("wnioski");
  return [
    ...plan.map((p) => ({
      no: p.no,
      label: p.title,
      kind: p.kind,
      akcja: { typ: "generuj-iv" as const, kind: p.kind },
    })),
    {
      no: "II",
      label: "Wnioski",
      kind: "wnioski",
      akcja: { typ: "generuj-wnioski" },
      blokada: ivGotowe ? undefined : "Najpierw zatwierdź wszystkie rozdziały IV",
    },
    {
      no: "III",
      label: "Wstęp — ujęcie teoretyczne",
      kind: "proza_iii",
      akcja: { typ: "redaguj-proze", rozdzial: "III" },
      blokada: wnioskiGotowe ? undefined : "Najpierw zatwierdź Wnioski",
      uwaga: "III powstaje też automatycznie z biblioteki prawnej — regeneracja modelem jest opcjonalna.",
    },
    {
      no: "V",
      label: "Podsumowanie",
      kind: "proza_v",
      akcja: { typ: "redaguj-proze", rozdzial: "V" },
      blokada: wnioskiGotowe ? undefined : "Najpierw zatwierdź Wnioski",
    },
  ];
}

/**
 * Krok już ZATWIERDZONY nie może być zablokowany.
 *
 * Blokady pilnują kolejności pracy, ale rozdział, który biegły zatwierdził, tę kolejność
 * ma już za sobą — pokazywanie go jako zablokowanego (bo warunek wstępny odblokował się
 * później albo zmienił) sugeruje, że coś jest nie tak z gotową pracą.
 */
function odblokujZatwierdzone(kroki: KrokRedakcji[], zatwierdzone: Set<string>): KrokRedakcji[] {
  return kroki.map((k) => (zatwierdzone.has(k.kind) ? { ...k, blokada: undefined } : k));
}

export function planRedakcji(args: {
  typ?: string | null;
  caseName: string;
  /** Rodzaje subanaliz obecnych w sprawie. */
  obecne: Iterable<string>;
  /** Rodzaje zatwierdzone przez biegłego. */
  zatwierdzone: Iterable<string>;
  /** Techniki wybrane w Kroku 4 — wyłącznie dziedzina GPW. */
  techniki?: IVKind[] | null;
}): KrokRedakcji[] {
  const obecne = new Set(args.obecne);
  const zatwierdzone = new Set(args.zatwierdzone);
  const kroki =
    args.typ === "ryzyko_bankowe"
      ? planBankowy(obecne, zatwierdzone)
      : planGpw(args.caseName, args.techniki ?? null, zatwierdzone);
  return odblokujZatwierdzone(kroki, zatwierdzone);
}
