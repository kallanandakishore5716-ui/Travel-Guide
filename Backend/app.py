from flask import Flask, jsonify, request
from flask_cors import CORS
from google import genai
from google.genai import errors as genai_errors
import requests
import base64
import os
import time


def _load_dotenv():
    """Load KEY=VALUE pairs from the project-root .env file if present.

    Existing environment variables always win (Render sets them in the
    dashboard), so this only helps local development. No extra dependency.
    """
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    if not os.path.isfile(env_path):
        return
    with open(env_path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

# Secrets come only from environment variables - never hardcode them here.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")

_missing = [name for name, value in (("GEMINI_API_KEY", GEMINI_API_KEY), ("MURF_API_KEY", MURF_API_KEY)) if not value]
if _missing:
    raise RuntimeError(
        f"Missing required environment variable(s): {', '.join(_missing)}. "
        "Set them in the environment (see .env.example for local development)."
    )

# Origins allowed to call this API (CORS). Default covers local development
# (file:// pages send the literal origin "null"); the production origin is set
# via FRONTEND_ORIGINS, e.g. FRONTEND_ORIGINS=https://your-project.vercel.app
_default_origins = ",".join([
    "null",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
])
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app = Flask(__name__)
CORS(app, origins=CORS_ORIGINS)

client = genai.Client(api_key=GEMINI_API_KEY)

PROMPTS = {
    "Summary": """
You are a professional tourist guide.
Provide a high-level overview of "{place}" in {language}.

Focus on:
- The historical significance
- Why the place is famous
- Key architectural or cultural highlights

Keep the explanation concise, engaging, and easy to follow.
Avoid excessive details and dates.
Limit the response to around 200 words.

Respond ONLY in {language}.
""",

    "Detailed": """
You are a professional tourist guide.
Provide a detailed and immersive explanation of "{place}" in {language}.

Cover:
- Historical background and timeline
- Architectural design and unique features
- Cultural importance and notable events
- Interesting facts and visitor insights

Explain concepts clearly and in a storytelling manner.
Include relevant details and examples to create a rich experience.
Limit the response to around 400 words.

Respond ONLY in {language}.
"""
}

def generate_speech(text, voice_id, locale):
    url = "https://global.api.murf.ai/v1/speech/stream"
    headers = {
        "api-key": MURF_API_KEY,
        "Content-Type": "application/json"
    }
    data = {
    "voice_id": voice_id,
    "text": text,
    "locale": locale,
    "model": "FALCON",
    "format": "MP3",
    "sampleRate": 24000,
    "channelType": "MONO"
    }

    response = requests.post(url, headers=headers, json=data, timeout=60)

    if response.status_code != 200:
        raise RuntimeError(f"Murf API error {response.status_code}: {response.text}")

    audio_bytes = response.content

    if not audio_bytes:
        raise RuntimeError("Murf API returned empty audio")

    return audio_bytes


TRANSIENT_GEMINI_CODES = {429, 500, 502, 503}


def generate_description(place, answer_type, language):
    prompt = PROMPTS[answer_type].format(place=place, language=language)
    last_error = None
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=prompt
            )
            text = response.text if response else None
            if text and text.strip():
                return text.strip()
            last_error = "Gemini returned an empty response"
        except genai_errors.APIError as error:
            if error.code not in TRANSIENT_GEMINI_CODES:
                raise RuntimeError(f"Gemini API error {error.code}: {error.message}") from error
            last_error = f"Gemini API error {error.code}: {error.message}"
        if attempt < 2:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Gemini API unavailable: {last_error}")

REQUIRED_FIELDS = ("place", "answerType", "language", "voiceId", "locale")

@app.route("/generate-audio-guide", methods=["POST"])
def generate_audio_guide():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    missing = [field for field in REQUIRED_FIELDS if not data.get(field)]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

    if data["answerType"] not in PROMPTS:
        return jsonify({"error": f"answerType must be one of: {', '.join(PROMPTS)}"}), 400

    try:
        text_description = generate_description(
            data["place"], data["answerType"], data["language"]
        )
        audio_bytes = generate_speech(
            text_description, data["voiceId"], data["locale"]
        )
    except Exception as error:
        return jsonify({"error": str(error)}), 502

    encoded_audio = base64.b64encode(audio_bytes).decode("utf-8")

    return jsonify({
        "description": text_description,
        "audioBase64": encoded_audio
    })

@app.errorhandler(RuntimeError)
def handle_error(error):
    return jsonify({"error": str(error)}), 502


@app.errorhandler(404)
def handle_not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def handle_method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def handle_internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    # Render supplies PORT; 5000 is the local fallback.
    # Debug is off unless FLASK_DEBUG=1 is set explicitly for local development.
    _debug = os.getenv("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=_debug)