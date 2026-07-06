"""
bge-m3 embedding client + cosine similarity for the MCP prose-authoring layer.

Embeddings back the semantic search (search_modules/roles/playbooks) and the generation
cache (see authoring.py, models EmbeddedBlock / AuthoringCacheEntry). Storage is a plain
JSON list[float]; similarity is brute-force cosine in Python — no pgvector (see plan).

The endpoint is an OpenAI-compatible embedding server (llama.cpp serving bge-m3):
POST {AWX_EMBED_URL}/v1/embeddings  {"model": ..., "input": [texts]}  → {"data": [{"embedding": [...]}]}
Everything here fails soft: any error returns None so callers fall back to lexical search.
"""
import math
import os

import httpx

EMBED_URL = os.environ.get("AWX_EMBED_URL", "https://llamacpp03.ippen.media/embed").rstrip("/")
EMBED_MODEL = os.environ.get("AWX_EMBED_MODEL", "bge-m3")
EMBED_TOKEN = os.environ.get("AWX_EMBED_TOKEN", "")
EMBED_TIMEOUT = float(os.environ.get("AWX_EMBED_TIMEOUT", "20"))


def embed(texts):
    """Embed a list of strings → list[list[float]] in input order, or None on any failure.

    Returns None (not an exception) so every caller degrades gracefully to lexical search.
    """
    if not texts:
        return []
    headers = {"Authorization": f"Bearer {EMBED_TOKEN}"} if EMBED_TOKEN else {}
    try:
        resp = httpx.post(
            f"{EMBED_URL}/v1/embeddings",
            json={"model": EMBED_MODEL, "input": list(texts)},
            headers=headers,
            timeout=EMBED_TIMEOUT,
        )
        resp.raise_for_status()
        rows = resp.json()["data"]
        return [row["embedding"] for row in rows]
    except Exception:
        return None


def embed_one(text):
    """Embed a single string → list[float] or None."""
    vecs = embed([text])
    return vecs[0] if vecs else None


def cosine(a, b):
    """Cosine similarity of two equal-length vectors; 0.0 if either is empty/zero/mismatched."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def rank(query_vec, candidates, top_k):
    """Rank (id, vector) candidates by cosine to query_vec. Returns [(id, score)] best-first.

    candidates: iterable of (identifier, vector). top_k caps the result length.
    """
    scored = [(ident, cosine(query_vec, vec)) for ident, vec in candidates]
    scored.sort(key=lambda t: -t[1])
    return scored[: max(1, top_k)]
