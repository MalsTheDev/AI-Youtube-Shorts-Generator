"""Local LLM backend — OpenAI or Gemini, selected by LLM_PROVIDER."""
from ..config import (
    GEMINI_MODEL,
    LLM_PROVIDER,
    OPENAI_MODEL,
    require_gemini_key,
    require_openai_key,
)


def call_openai_llm(prompt: str) -> str:
    """OpenAI Chat Completions backend used by --mode local."""
    try:
        from openai import OpenAI  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "openai is required for --mode local. Install it with:\n"
            "    pip install -r requirements-local.txt"
        ) from e

    client = OpenAI(api_key=require_openai_key())
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=0.7,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content or ""


def call_gemini_llm(prompt: str) -> str:
    """Gemini backend used by --mode local with multi-model fallback and retry."""
    try:
        from google import genai  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "google-genai is required for LLM_PROVIDER=gemini. Install it with:\n"
            "    pip install -r requirements-local.txt"
        ) from e

    import time
    client = genai.Client(api_key=require_gemini_key())

    candidate_models = [
        GEMINI_MODEL,
        "gemini-flash-latest",
        "gemini-3.5-flash-lite",
        "gemini-3.5-flash",
    ]
    seen = set()
    models_to_try = [m for m in candidate_models if m and not (m in seen or seen.add(m))]

    last_error = None
    for model_name in models_to_try:
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config={
                        "temperature": 0.2,
                        "response_mime_type": "application/json",
                        "max_output_tokens": 8192,
                    },
                )
                if response and response.text:
                    return response.text
            except Exception as e:
                err_str = str(e)
                last_error = e
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "503" in err_str:
                    print(f"[llm/gemini] Model {model_name} rate limit on attempt {attempt + 1}. Trying fallback...", flush=True)
                    time.sleep(2 * (attempt + 1))
                else:
                    print(f"[llm/gemini] Model {model_name} error: {e}. Trying fallback model...", flush=True)
                    break

    raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")


def call_local_llm(prompt: str) -> str:
    """Dispatch to the configured local LLM provider."""
    provider = (LLM_PROVIDER or "openai").strip().lower()
    if provider == "openai":
        return call_openai_llm(prompt)
    if provider == "gemini":
        return call_gemini_llm(prompt)
    raise RuntimeError(
        f"Unknown LLM_PROVIDER={provider!r}. Use 'openai' or 'gemini'."
    )
