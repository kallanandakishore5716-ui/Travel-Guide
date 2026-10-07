// --- Constants ---
const VOICES = {
  English: { Male: "Matthew", Female: "Alicia" },
  Hindi: { Male: "Aman", Female: "Namrita" },
  Tamil: { Male: "Murali", Female: "Abirami" },
  Telugu: { Male: "Zion", Female: "Josie" }
};

const LOCALES = {
  English: "en-US",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Telugu: "te-IN"
};


// --- State ---
const state = {
  place: '',
  image: '',
  length: 'Summary',
  voice: 'Male'
};
let generatedAudioSrc = '';

// --- DOM Elements ---
const cardsContainer = document.querySelector('.cards');
const experiencePanel = document.getElementById('experience');
const previewTitle = document.getElementById('previewTitle');
const audioSection = document.getElementById('audioSection');
const audioPlayer = document.getElementById('audioPlayer');
const transcriptText = document.getElementById('scriptText');
const generateButton = document.getElementById('generateBtn');
const languageSelect = document.getElementById('selectLanguage');
const closeButton = document.getElementById('closeExperience');
const searchPreviewCard = document.getElementById('searchPreviewCard');
const searchPreviewImage = document.getElementById('searchPreviewImage');
const searchPreviewTitle = document.getElementById('searchPreviewTitle');
const transcriptToggle = document.getElementById('transcriptToggle');
const transcriptContent = document.getElementById('transcriptContent');
const transcriptArrow = document.getElementById('transcriptArrow');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchBtn');
const searchPreviewImageWrap = document.getElementById('searchPreviewImageWrap');

// --- Functions ---

function selectDestination(place, image, clickedCard = null) {
  state.place = place;
  state.image = image;

  // Update UI content
  previewTitle.textContent = place;
  cardsContainer.classList.add('faded');

  // Reset previous states
  document.querySelectorAll('.place-card').forEach(card => card.classList.remove('active'));
  searchPreviewCard.classList.add('hidden');

  // Handle Card Visibility
  if (clickedCard) {
    clickedCard.classList.add('active');
  } else {
    // If it's a search result, show the preview card
    if (image) {
      searchPreviewImage.src = image;
      searchPreviewImage.classList.remove('hidden');
      searchPreviewImageWrap.classList.remove('hidden');
    } else {
      searchPreviewImage.removeAttribute('src');
      searchPreviewImage.classList.add('hidden');
      searchPreviewImageWrap.classList.add('hidden');
    }
    searchPreviewTitle.textContent = place;
    searchPreviewCard.classList.remove('hidden');
    searchPreviewCard.classList.add('active');
  }

  // Reset Audio Panel
  generatedAudioSrc = '';
  audioSection.classList.add('hidden');
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  transcriptText.textContent = '';
  generateButton.textContent = 'Generate Audio Guide';
  generateButton.disabled = false;

  // Show Panel with animation
  experiencePanel.classList.remove('hidden');
  setTimeout(() => {
    experiencePanel.classList.add('visible');
  }, 10);
}

function deselectDestination() {
  experiencePanel.classList.remove('visible');

  // Wait for animation to finish before hiding
  setTimeout(() => {
    experiencePanel.classList.add('hidden');
    cardsContainer.classList.remove('faded');
    searchPreviewCard.classList.add('hidden');
    document.querySelectorAll('.place-card').forEach(card => card.classList.remove('active'));
  }, 300);
}

// --- Event Listeners ---

// Close Button
closeButton.addEventListener('click', deselectDestination);

// Card Clicks
document.querySelectorAll('.place-card:not(.search-preview-card)').forEach(card => {
  card.addEventListener('click', () => {
    selectDestination(card.dataset.place, card.dataset.image, card);
  });
});

// Search
function runSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    alert('Please enter a destination to search.');
    return;
  }

  const queryLower = query.toLowerCase();
  const matchedCard = Array.from(
    document.querySelectorAll('.place-card:not(.search-preview-card)')
  ).find(card => (card.dataset.place || '').toLowerCase().includes(queryLower));

  const place = matchedCard ? matchedCard.dataset.place : query;
  const image = matchedCard ? matchedCard.dataset.image : '';
  selectDestination(place, image, null);
}

searchButton.addEventListener('click', runSearch);
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') runSearch();
});

// Option Toggles (History Type)
const lengthButtons = document.querySelectorAll('[data-group="length"] button');
lengthButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    lengthButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.length = btn.dataset.value;
  });
});

// Option Toggles (Voice Gender)
const voiceButtons = document.querySelectorAll('[data-group="voice"] button');
voiceButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    voiceButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.voice = btn.dataset.value;
  });
});


// Generate Audio guide button Logic

// --- Backend API base URL ---
// Local development (localhost or opening index.html directly) -> local Flask.
// Production (deployed site) -> Render backend. Replace the placeholder below
// with your real Render URL after creating the service, e.g.
// https://travel-guide-api.onrender.com
const RENDER_BACKEND_URL = 'https://YOUR-RENDER-BACKEND.onrender.com';

const _hostname = window.location.hostname;
const _isLocal = _hostname === '' || _hostname === 'localhost' || _hostname === '127.0.0.1';
const API_BASE_URL = _isLocal ? 'http://127.0.0.1:5000' : RENDER_BACKEND_URL;
const GENERATE_AUDIO_GUIDE_API_URL = `${API_BASE_URL}/generate-audio-guide`;

generateButton.addEventListener('click', async () => {
  if (generatedAudioSrc) {
    audioPlayer.play().catch(err => console.error(err));
    return;
  }

  generateButton.disabled = true;
  generateButton.textContent = '⏳ Generating Audio...';

  try {
    const selectedLanguage = languageSelect.value;
    const selectedVoice = state.voice;

    const response = await fetch(GENERATE_AUDIO_GUIDE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: state.place,
        answerType: state.length,
        language: selectedLanguage,
        voiceId: VOICES[selectedLanguage][selectedVoice],
        locale: LOCALES[selectedLanguage]
      })
    });

    if (!response.ok) {
      let message = 'Generation failed.';
      try {
        const errorBody = await response.json();
        if (errorBody && errorBody.error) message = errorBody.error;
      } catch (parseErr) { /* non-JSON error response */ }
      const error = new Error(message);
      error.fromServer = true;
      throw error;
    }

    const data = await response.json();

    // Update UI with Result
    transcriptText.textContent = data.description;
    audioSection.classList.remove('hidden');

    if (data.audioBase64) {
      generatedAudioSrc = `data:audio/mp3;base64,${data.audioBase64}`;
      audioPlayer.src = generatedAudioSrc;
      audioPlayer.load();
      audioPlayer.classList.remove('hidden');
      generateButton.textContent = 'Listen to Audio';
      generateButton.disabled = false;
    } else {
      audioPlayer.classList.add('hidden');
      generateButton.textContent = 'Generate Audio Guide';
      generateButton.disabled = false;
    }

  } catch (err) {
    console.error(err);
    alert(err && err.fromServer
      ? err.message
      : 'Generation failed. Please check your connection.');
    generateButton.textContent = 'Generate Audio Guide';
    generateButton.disabled = false;
  }
});

// Transcript Toggle
transcriptToggle.addEventListener('click', () => {
  transcriptContent.classList.toggle('hidden');
  transcriptArrow.classList.toggle('rotate-180');
});
