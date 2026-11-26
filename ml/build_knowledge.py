"""Build the assistant's knowledge base and a TF-IDF retrieval index.

Outputs:
  data/drug_knowledge.json         human readable source documents
  backend/artifacts/rag_index.joblib   vectorizer + matrix for the API
  backend/artifacts/rag_browser.json   doc vectors + idf for in-browser search
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from domain import CATEGORIES, OPERATIONS  # noqa: E402

ARTIFACTS = ROOT / "backend" / "artifacts"


def build_docs() -> list[dict]:
    docs = []
    for atc, m in CATEGORIES.items():
        # drug names are repeated so a query naming a drug ranks its group first
        names = ", ".join(m["examples"])
        text = (
            f"{m['name']} ({atc}). {m['group']}. "
            f"Common drugs: {names}. Includes {names}. "
            f"Uses: {m['uses']} Seasonality: {m['seasonality']} "
            f"Storage: {m['storage']} Cautions: {m['cautions']}"
        )
        docs.append({
            "id": f"atc-{atc}", "atc": atc, "title": f"{m['name']} ({atc})",
            "category": atc, "kind": "drug_group", "text": text,
            "examples": m["examples"],
        })
    for op in OPERATIONS:
        docs.append({
            "id": op["id"], "atc": None, "title": op["title"],
            "category": None, "kind": "operations", "text": op["text"],
        })
    return docs


TOKEN = re.compile(r"[a-z]{2,}")


def main() -> None:
    docs = build_docs()
    corpus = [d["text"] for d in docs]

    vec = TfidfVectorizer(lowercase=True, stop_words="english",
                          ngram_range=(1, 2), min_df=1, sublinear_tf=True)
    matrix = vec.fit_transform(corpus)
    joblib.dump({"vectorizer": vec, "matrix": matrix, "docs": docs},
                ARTIFACTS / "rag_index.joblib")

    # browser export: per-doc sparse tf-idf and the idf vocabulary
    vocab = vec.vocabulary_
    inv_vocab = {i: t for t, i in vocab.items()}
    idf = {inv_vocab[i]: round(float(w), 5) for i, w in enumerate(vec.idf_)}
    doc_vecs = []
    for r, d in enumerate(docs):
        row = matrix.getrow(r)
        weights = {inv_vocab[j]: round(float(v), 5)
                   for j, v in zip(row.indices, row.data)}
        doc_vecs.append({"id": d["id"], "title": d["title"], "atc": d["atc"],
                         "kind": d["kind"], "text": d["text"], "weights": weights})

    (ARTIFACTS / "rag_browser.json").write_text(json.dumps(
        {"idf": idf, "ngram": 2, "docs": doc_vecs}))

    (ROOT / "data" / "drug_knowledge.json").write_text(json.dumps(
        {"source": "Curated general pharmacy reference for the eight ATC groups "
                    "in the sales dataset, plus platform operations notes.",
         "documents": docs}, indent=2))
    print(f"knowledge docs: {len(docs)}  vocab: {len(vocab)}")


if __name__ == "__main__":
    main()
