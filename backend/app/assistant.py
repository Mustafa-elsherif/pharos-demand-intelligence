"""Grounded multilingual drug-information assistant.

Retrieval augmented: a TF-IDF index over the curated knowledge base selects the
most relevant documents, and the answer is generated only from them. Gemini is
used when a key is configured; otherwise a local extractive fallback keeps the
assistant working offline. Guardrails refuse personal dosing and diagnosis.
"""
from __future__ import annotations

import re

import joblib
from sklearn.metrics.pairwise import cosine_similarity

from . import config

# Requests we must not answer: personal dosing, diagnosis, interactions advice.
_UNSAFE = re.compile(
    r"\b(how much|what dose|how many (pills|tablets)|should i take|can i take|"
    r"is it safe for me|i (feel|have|took)|my (symptom|pain|dose|child)|overdos|"
    r"mix with|combine with|interact)", re.I)

_SAFETY = {
    "en": ("I can share general information about these medicine groups, but I "
           "cannot advise on personal doses, diagnoses or whether medicines are "
           "safe for you. Please speak to a pharmacist or doctor for that."),
    "ar": ("يمكنني تقديم معلومات عامة عن هذه المجموعات الدوائية، لكن لا يمكنني "
           "تقديم نصائح حول الجرعات الشخصية أو التشخيص. يرجى مراجعة الصيدلي أو الطبيب."),
    "fr": ("Je peux donner des informations generales sur ces groupes de "
           "medicaments, mais pas de conseils sur les doses personnelles ou le "
           "diagnostic. Consultez un pharmacien ou un medecin."),
    "es": ("Puedo dar informacion general sobre estos grupos de medicamentos, "
           "pero no sobre dosis personales o diagnosticos. Consulte a un "
           "farmaceutico o medico."),
    "de": ("Ich kann allgemeine Informationen zu diesen Arzneimittelgruppen "
           "geben, aber keine Ratschlage zu persoenlichen Dosen oder Diagnosen. "
           "Bitte wenden Sie sich an eine Apotheke oder einen Arzt."),
}

_FALLBACK_INTRO = {
    "en": "Here is what the knowledge base says:",
    "ar": "إليك ما تقوله قاعدة المعرفة:",
    "fr": "Voici ce que dit la base de connaissances :",
    "es": "Esto es lo que dice la base de conocimiento:",
    "de": "Das sagt die Wissensdatenbank:",
}

_NO_MATCH = {
    "en": ("I can only help with the eight drug groups in this pharmacy's "
           "catalogue (NSAIDs, analgesics, anxiolytics, sedatives, airway drugs "
           "and antihistamines) and how the platform works."),
    "ar": "يمكنني المساعدة فقط في مجموعات الأدوية الثماني في هذا الكتالوج وكيفية عمل المنصة.",
    "fr": "Je peux seulement aider sur les huit groupes de medicaments du catalogue et le fonctionnement de la plateforme.",
    "es": "Solo puedo ayudar con los ocho grupos de medicamentos del catalogo y como funciona la plataforma.",
    "de": "Ich kann nur zu den acht Arzneimittelgruppen des Katalogs und zur Funktionsweise der Plattform helfen.",
}


def detect_language(text: str) -> str:
    """Best effort language code. Uses langdetect when available."""
    if re.search(r"[؀-ۿ]", text):
        return "ar"
    try:
        from langdetect import detect  # type: ignore
        code = detect(text)
        return code.split("-")[0]
    except Exception:
        pass
    low = f" {text.lower()} "
    hints = {
        "fr": [" le ", " la ", " les ", " pour ", " avec ", " est ", "quoi", "comment"],
        "es": [" el ", " la ", " los ", " para ", " con ", " que ", "como", "cuales"],
        "de": [" der ", " die ", " das ", " und ", " fuer ", " ist ", " wie "],
    }
    for lang, words in hints.items():
        if sum(w in low for w in words) >= 2:
            return lang
    return "en"


class Assistant:
    def __init__(self) -> None:
        bundle = joblib.load(config.ARTIFACTS / "rag_index.joblib")
        self.vec = bundle["vectorizer"]
        self.matrix = bundle["matrix"]
        self.docs = bundle["docs"]
        self._gemini = None
        if config.GEMINI_API_KEY:
            try:
                import google.generativeai as genai
                genai.configure(api_key=config.GEMINI_API_KEY)
                self._gemini = genai.GenerativeModel(config.GEMINI_MODEL)
            except Exception:
                self._gemini = None

    def retrieve(self, query: str):
        q = self.vec.transform([query])
        sims = cosine_similarity(q, self.matrix)[0]
        order = sims.argsort()[::-1][: config.RAG_TOP_K]
        hits = [(self.docs[i], float(sims[i])) for i in order
                if sims[i] >= config.RAG_MIN_SCORE]
        return hits

    def answer(self, message: str) -> dict:
        lang = detect_language(message)
        sources: list[dict] = []

        if _UNSAFE.search(message):
            return {"answer": _SAFETY.get(lang, _SAFETY["en"]), "sources": [],
                    "language": lang, "engine": "guardrail", "grounded": False}

        hits = self.retrieve(message)
        if not hits:
            return {"answer": _NO_MATCH.get(lang, _NO_MATCH["en"]), "sources": [],
                    "language": lang, "engine": "retrieval", "grounded": False}

        sources = [{"id": d["id"], "title": d["title"], "score": round(s, 3)}
                   for d, s in hits]
        context = "\n\n".join(f"[{d['title']}] {d['text']}" for d, _ in hits)

        if self._gemini is not None:
            try:
                answer = self._gemini_answer(message, context, lang)
                return {"answer": answer, "sources": sources, "language": lang,
                        "engine": "gemini", "grounded": True}
            except Exception:
                pass  # fall through to local

        return {"answer": self._local_answer(hits, lang), "sources": sources,
                "language": lang, "engine": "local", "grounded": True}

    def _gemini_answer(self, message: str, context: str, lang: str) -> str:
        prompt = (
            "You are a pharmacy information assistant. Answer using ONLY the "
            "context below. If the context does not cover it, say so. Do not give "
            "personal dosing or diagnosis. Keep it to a few plain sentences and "
            f"reply in the same language as the question (detected: {lang}). "
            "Do not use em dashes.\n\n"
            f"Context:\n{context}\n\nQuestion: {message}"
        )
        resp = self._gemini.generate_content(prompt)
        return (resp.text or "").strip()

    @staticmethod
    def _local_answer(hits, lang: str) -> str:
        intro = _FALLBACK_INTRO.get(lang, _FALLBACK_INTRO["en"])
        body = "\n\n".join(f"{d['title']}: {d['text']}" for d, _ in hits[:2])
        return f"{intro}\n\n{body}"
