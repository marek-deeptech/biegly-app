# Biegły GPW

Aplikacja wspierająca biegłego sądowego (Krzysztof Michrowski) w analizie manipulacji
instrumentami finansowymi na GPW i przygotowaniu opinii dla prokuratury i sądu.

Zasada nadrzędna: **liczy kod, nie model językowy.** Wskaźniki manipulacji są wyznaczane
deterministycznie i zwalidowane co do grosza wobec realnych opinii; LLM jedynie opisuje
i interpretuje policzone liczby.

## Stack

- **Next.js** (App Router) na Vercel — interfejs i lekkie API.
- **Funkcje Python** (`/api`) — zwalidowany silnik (`engine`/`intake`/`validate`).
- **Supabase** (region UE) — Postgres + Storage (`case-files`) + Auth, RLS deny-by-default.

## Moduły Pythona (rdzeń, zwalidowany)

- `engine/` — deterministyczne wskaźniki (wash-trades, OWG, anulacje). 5 złotych liczb HubTech.
- `intake/` — klasyfikacja dokumentów + checklista kanonu (99% / 92% pokrycia).
- `validate/` — walidator wejścia QA #1 (integralność plików + spójność danych UTP).
- `tests/` — 7 testów regresyjnych: `python -m pytest`.

## Rozwój lokalny

```bash
npm install
npm run dev            # front Next.js na http://localhost:3000
```

Zmienne środowiskowe: skopiuj `.env.example` → `.env.local` (klucze Supabase, region UE).
Dane akt są poufne i **nie** trafiają do repozytorium (patrz `.gitignore`).
