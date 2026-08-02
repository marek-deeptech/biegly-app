// Klasyfikacja dokumentów sprawy Z TREŚCI — dla akt, w których nazwy plików nic nie mówią.
//
// UŻYCIE:
//   npx tsx scripts/klasyfikuj_tresc.ts <nazwa sprawy>            # raport, bez zapisu
//   npx tsx scripts/klasyfikuj_tresc.ts <nazwa sprawy> --zapisz
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(process.env.HOME ?? "", "biegly-app");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { docTypesDla, typyDziedzinowe, typyKlasyfikacji } from "@/lib/intake/classify";
import { pdfText } from "@/lib/intake/pdf";
import {
  buildKlasyfikacjaPrompt,
  przefiltruj,
  type WejscieKlasyfikacji,
  type WynikKlasyfikacji,
} from "@/lib/intake/klasyfikacja-tresci";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SPRAWA = process.argv[2];
const ZAPISZ = process.argv.includes("--zapisz");
// Domyślnie ruszamy tylko nierozpoznane — ponowne pytanie o dokument już opisany
// kosztuje tyle samo, co pierwsze. `--wszystkie` służy uzupełnieniu OPISÓW w sprawach
// sklasyfikowanych, zanim kolumna `opis` istniała.
const WSZYSTKIE = process.argv.includes("--wszystkie");
const ZNAKOW = 6000;   // początek dokumentu wystarcza — rozpoznajemy nagłówek, nie treść
const W_PACZCE = 5;

/**
 * Ponowienie po BŁĘDZIE SIECI. Przebieg na kilkudziesięciu skanach to kilkanaście
 * minut pobierania z Storage i odpytywania modelu; jedno `ECONNRESET` przerywało
 * całość PRZED fazą zapisu, więc praca modelu szła w całości do kosza, a skrypt
 * kończył się śladem stosu wyglądającym jak błąd programu, nie zerwane łącze.
 */
async function ponow<T>(co: string, fn: () => Promise<T>, prob = 3): Promise<T> {
  let ostatni: unknown;
  for (let i = 1; i <= prob; i++) {
    try {
      return await fn();
    } catch (e) {
      ostatni = e;
      console.log(`   ⟳ ${co}: próba ${i}/${prob} nieudana (${(e as Error).message}) — ponawiam`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw ostatni;
}

async function main() {
  const { data: sprawy } = await sb.from("cases").select("id,name,typ,tryb").ilike("name", `%${SPRAWA}%`);
  if (!sprawy?.length) throw new Error(`Nie znaleziono sprawy: ${SPRAWA}`);
  const c = sprawy[0];
  const TYPY = docTypesDla(c.typ);           // pełny katalog — do etykiet i zapisu
  const TYPY_MODELU = typyKlasyfikacji(c.typ); // węższy — bez kodów obcych dziedzinie
  const { data: docs } = await sb
    .from("documents")
    .select("id,rel_path,doc_type,storage_path,warstwa_tekstu")
    .eq("case_id", c.id);

  // Klasyfikujemy wyłącznie to, co ma treść. Oryginał skanu dostanie typ swojego
  // bliźniaka po OCR — to ten sam dokument, a zostawiony jako UNKNOWN zaśmiecałby
  // listę i psuł raport kompletności.
  const doCzytania = (docs ?? []).filter(
    (d) => d.storage_path && d.warstwa_tekstu !== "brak" && (WSZYSTKIE || d.doc_type === "UNKNOWN"),
  );
  console.log(`${c.name}: ${docs?.length} dokumentów, do klasyfikacji ${doCzytania.length}`);

  const wejscia: WejscieKlasyfikacji[] = [];
  for (const d of doCzytania) {
    const nazwaPliku = d.rel_path.split("/").pop()!;
    const { data: blob } = await ponow(nazwaPliku, () =>
      sb.storage.from("case-files").download(d.storage_path!),
    );
    if (!blob) continue;
    const tekst = await pdfText(await blob.arrayBuffer(), ZNAKOW).catch(() => "");
    if (tekst.trim().length < 80) {
      console.log(`   ⚠ ${d.rel_path.split("/").pop()}: po OCR wciąż < 80 znaków — pomijam`);
      continue;
    }
    wejscia.push({ id: d.id, nazwa: nazwaPliku, tekst });
  }

  const ai = new Anthropic();
  const wyniki: WynikKlasyfikacji[] = [];
  for (let i = 0; i < wejscia.length; i += W_PACZCE) {
    const paczka = wejscia.slice(i, i + W_PACZCE);
    const p = buildKlasyfikacjaPrompt(TYPY_MODELU, paczka, { dziedzinowe: typyDziedzinowe(c.typ), tryb: c.tryb });
    const msg = await ponow(`paczka ${i / W_PACZCE + 1}`, () => ai.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      system: p.system,
      messages: [{ role: "user", content: p.user }],
    }));
    if (msg.stop_reason === "max_tokens") {
      console.log(`   ⚠ paczka ${i / W_PACZCE + 1}: odpowiedź urwana — pomijam, uruchom ponownie`);
      continue;
    }
    const txt = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) { console.log(`   ⚠ paczka ${i / W_PACZCE + 1}: nie rozpoznano odpowiedzi`); continue; }
    wyniki.push(...((JSON.parse(m[0]).wyniki ?? []) as WynikKlasyfikacji[]));
    console.log(`   … ${Math.min(i + W_PACZCE, wejscia.length)}/${wejscia.length}`);
  }

  const { przyjete, odrzucone } = przefiltruj(wyniki, TYPY_MODELU);
  const nazwa = (id: string) => (docs ?? []).find((d) => d.id === id)?.rel_path.split("/").pop() ?? id;
  console.log(`\n═══ ROZPOZNANE (${przyjete.length}) ═══`);
  for (const w of przyjete)
    console.log(`  ${w.typ.padEnd(24)} ${(w.pewnosc ?? 0).toFixed(2)}  ${w.opis?.slice(0, 76)}\n      ← ${nazwa(w.id)}${w.data ? ` · ${w.data}` : ""}${w.karta ? ` · k. ${w.karta}` : ""}`);
  if (odrzucone.length) {
    console.log(`\n═══ NIEROZPOZNANE (${odrzucone.length}) — zostają do ręcznej oceny ═══`);
    for (const o of odrzucone) console.log(`  ${nazwa(o.id)}: ${o.powod}`);
  }

  if (!ZAPISZ) { console.log("\ntryb raportu — uruchom z --zapisz"); return; }

  // Kolumna `opis` przychodzi migracją 0013 i bywa jeszcze nieuruchomiona. Sprawdzamy
  // to RAZ, zamiast pozwolić, żeby każdy update cicho padał na nieznanej kolumnie.
  const { error: brakOpisu } = await sb.from("documents").select("opis").limit(1);
  const zOpisem = !brakOpisu;
  if (!zOpisem)
    console.log("\n⚠ kolumna `opis` nie istnieje (migracja 0013 nieuruchomiona) — zapisuję sam typ.");

  // Zapis + przeniesienie typu na oryginał skanu (X.pdf ↔ X.ocr.pdf).
  const wgNazwy = new Map((docs ?? []).map((d) => [d.rel_path.split("/").pop()!, d]));
  let zapisane = 0, blizniakow = 0;
  const bledy: string[] = [];
  const zapisz = async (id: string, pola: Record<string, unknown>) => {
    // ⚠️ BŁĄD ZAPISU MUSI BYĆ WIDOCZNY. supabase-js NIE RZUCA wyjątku — zwraca `error`.
    // Bez tego sprawdzenia skrypt wypisał „✓ zapisano 28 klasyfikacji", podczas gdy
    // każdy update padł na nieistniejącej kolumnie i wszystkie 64 dokumenty zostały
    // UNKNOWN. Komunikat sukcesu przy zerowym skutku jest gorszy niż jawny błąd.
    const { error } = await sb.from("documents").update(pola).eq("id", id);
    if (error) { bledy.push(`${nazwa(id)}: ${error.message}`); return false; }
    return true;
  };
  for (const w of przyjete) {
    const t = TYPY[w.typ];
    const pola: Record<string, unknown> = { doc_type: w.typ };
    if (t.provenance === "wejście" || t.provenance === "wyjście") pola.provenance = t.provenance;
    if (zOpisem && w.opis) pola.opis = w.opis;
    if (w.karta) pola.karta_start = w.karta;
    if (!(await zapisz(w.id, pola))) continue;
    zapisane++;
    const n = nazwa(w.id);
    const oryginal = n.endsWith(".ocr.pdf") ? wgNazwy.get(n.replace(/\.ocr\.pdf$/i, ".pdf")) : null;
    if (oryginal && (WSZYSTKIE || oryginal.doc_type === "UNKNOWN") && (await zapisz(oryginal.id, pola))) blizniakow++;
  }
  if (bledy.length) {
    console.log(`\n✗ NIE ZAPISANO ${bledy.length} — klasyfikacja NIE weszła do bazy:`);
    for (const b of bledy.slice(0, 5)) console.log(`   ${b}`);
    process.exitCode = 1;
  }
  console.log(`\n${zapisane ? "✓" : "✗"} zapisano ${zapisane} klasyfikacji (+ ${blizniakow} oryginałów skanów)`);
}
main();
