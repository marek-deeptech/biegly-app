"""Identyfikacja beneficjenta rzeczywistego i przynależności do Grupy.

Dwa zadania:
1. Mapowanie konta (Biuro/DM + Konto) -> nazwa właściciela. Arkusz zleceń nie
   zawiera nazwy właściciela, więc budujemy mapę z arkusza transakcji, gdzie
   każda strona ma parę (DM, KONTO, ACCTOWNR).
2. Kanonizacja właściciela do podmiotu z Grupy po fragmencie nazwy — co
   normalizuje warianty powiernicze (np. "Bank Pekao ... | Joyfix Ltd") do
   beneficjenta rzeczywistego (joyfix).
"""
from __future__ import annotations

from collections import Counter, defaultdict

from .settings import GROUP_FRAGMENTS


def norm_acct(value) -> str:
    """Normalizuje numer konta/biura: string bez wiodących zer."""
    if value is None:
        return ""
    return str(value).strip().lstrip("0")


def canonical_group(owner: str | None, fragments: list[str] | None = None) -> str | None:
    """Zwraca fragment-kanon podmiotu z Grupy albo None, jeśli spoza Grupy.

    `fragments` = definicja Grupy danej sprawy (per-sprawa). Gdy None — domyślnie
    GROUP_FRAGMENTS z settings (zachowanie wsteczne dla HubTech).
    """
    if not owner:
        return None
    frags = GROUP_FRAGMENTS if fragments is None else fragments
    low = owner.lower()
    for fragment in frags:
        if fragment in low:
            return fragment
    return None


def is_group(owner: str | None, fragments: list[str] | None = None) -> bool:
    return canonical_group(owner, fragments) is not None


def build_account_owner_map(transactions: list[dict]) -> dict[tuple[str, str], str]:
    """Buduje mapę (DM, KONTO) -> najczęstsza nazwa właściciela z transakcji."""
    votes: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for row in transactions:
        key_b = (norm_acct(row.get("DM_B")), norm_acct(row.get("KONTO_B")))
        votes[key_b][row.get("ACCTOWNR_POPRAWIONY_B")] += 1
        key_s = (norm_acct(row.get("DM_S")), norm_acct(row.get("KONTO_S")))
        votes[key_s][row.get("ACCTOWNR_POPRAWIONY_S")] += 1
    return {key: counter.most_common(1)[0][0] for key, counter in votes.items()}
