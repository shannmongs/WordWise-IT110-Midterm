/* =====================================================================
   script.js  -  WordWise (Dictionary Application)
   IT 110 Midterm Project

   MAIN API    : Free Dictionary API
                 https://dictionaryapi.dev/
                 GET https://api.dictionaryapi.dev/api/v2/entries/en/<word>

   BACKUP API  : Wiktionary REST API (used automatically if the main API
                 is down, slow, or blocked)
                 https://en.wiktionary.org/api/rest_v1/
                 GET https://en.wiktionary.org/api/rest_v1/page/definition/<word>

   FILE MAP (sections in this file)
     1. Settings
     2. Page elements
     3. Small helpers (storage, validation, text cleaning)
     4. Talking to the APIs (fetch + normalize + fallback)
     5. Screen states (welcome / loading / error / results)
     6. Showing a dictionary entry
     7. Audio pronunciation          <-- CHANGED (merged old sections 7 and 12)
     8. History and favorites
     9. Searching (the main flow)
    10. Events (form, clicks, buttons)
    11. Light / dark theme
    12. Start-up
   ===================================================================== */

"use strict";

/* =====================================================================
   1. SETTINGS
   ===================================================================== */
const PRIMARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const BACKUP_API = "https://en.wiktionary.org/api/rest_v1/page/definition/";
const TIMEOUT_MS = 7000;          // stop waiting for an API after 7 seconds

const HISTORY_KEY = "wordwise-history";
const FAVORITES_KEY = "wordwise-favorites";
const THEME_KEY = "wordwise-theme";   // same key the inline script in <head> reads

const MAX_HISTORY = 10;
const MAX_DEFINITIONS = 5;        // definitions shown per part of speech
const MAX_SYNONYMS = 8;

/* =====================================================================
   2. PAGE ELEMENTS
   Every id below exists in app.html.
   ===================================================================== */
const $ = (id) => document.getElementById(id);

// search
const searchForm = $("search-form");
const wordInput = $("word-input");
const clearInputBtn = $("clear-input");
const searchBtn = $("search-btn");

// screen states
const welcomeBox = $("welcome");
const loadingBox = $("loading");
const errorBox = $("error-message");
const errorText = $("error-text");
const resultsBox = $("results");

// result card
const resultWord = $("result-word");
const resultPhonetic = $("result-phonetic");
const audioBtn = $("audio-btn");
const audioPlayer = $("audio-player");
const favoriteBtn = $("favorite-btn");
const meaningsContainer = $("meanings-container");
const sourceLink = $("source-link");

// sidebar
const historyList = $("history-list");
const historyEmpty = $("history-empty");
const clearHistoryBtn = $("clear-history");
const favoritesList = $("favorites-list");
const favoritesEmpty = $("favorites-empty");
const clearFavoritesBtn = $("clear-favorites");

// theme
const themeToggle = $("theme-toggle");

// <template> blocks (cloned to build the page)
const meaningTemplate = $("meaning-template");
const definitionTemplate = $("definition-template");
const chipTemplate = $("chip-template");
const listItemTemplate = $("list-item-template");

/* App state: what is on screen right now */
let currentWord = "";     // the word the user searched (lowercase)
let requestId = 0;        // counts searches so an old, slow reply can't overwrite a newer one

/* =====================================================================
   3. SMALL HELPERS
   ===================================================================== */

/* ---- localStorage (wrapped in try/catch: storage can be blocked) ---- */
function loadList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (error) {
    /* storage unavailable - the app still works, it just won't remember */
  }
}

/* ---- Input validation ----
   Returns { ok: true, word } or { ok: false, error: "message" } */
function validateWord(raw) {
  const word = raw.trim().toLowerCase();

  if (word === "") {
    return { ok: false, error: "Please type a word to search." };
  }
  if (/\s/.test(word)) {
    return { ok: false, error: "Please enter one word at a time (no spaces)." };
  }
  // must start with a letter; letters, apostrophes and hyphens allowed after
  if (!/^[a-z][a-z'-]*$/.test(word)) {
    return { ok: false, error: "Please use letters only (no numbers or symbols)." };
  }
  if (word.length > 40) {
    return { ok: false, error: "That word is too long. Please try a shorter one." };
  }
  return { ok: true, word };
}

/* ---- Wiktionary gives definitions as HTML; turn it into plain text ---- */
function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  // remove styles and nested sub-lists (they appear again as their own definitions)
  doc.querySelectorAll("style, link, ol, ul").forEach((node) => node.remove());
  return doc.body.textContent.replace(/\s+/g, " ").trim();
}

/* ---- A word that can be searched again (single word, letters only) ---- */
function isSearchable(word) {
  return /^[a-z][a-z'-]*$/i.test(word);
}

/* =====================================================================
   4. TALKING TO THE APIs
   The two APIs return different JSON. Each reply is converted
   ("normalized") into ONE shape so the display code only has to
   understand a single format:

   {
     word, phonetic, audio,
     meanings: [ { partOfSpeech, definitions:[{definition, example}],
                   synonyms:[...] } ],
     sourceUrl, sourceName
   }
   ===================================================================== */

/* fetch() with a time limit, so a dead or slow API can't freeze the app */
async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---- Helpers for the main API's JSON ---- */
function findAudioUrl(entry) {
  const item = (entry.phonetics || []).find((p) => p.audio);
  return item ? item.audio : "";
}

function findPhoneticText(entry) {
  if (entry.phonetic) return entry.phonetic;
  const item = (entry.phonetics || []).find((p) => p.text);
  return item ? item.text : "";
}

function collectSynonyms(meaning) {
  const all = new Set(meaning.synonyms || []);
  (meaning.definitions || []).forEach((d) => {
    (d.synonyms || []).forEach((w) => all.add(w));
  });
  return [...all].filter(isSearchable).slice(0, MAX_SYNONYMS);
}

/* ---- MAIN API ---- */
async function fetchFromPrimary(word) {
  const response = await fetchWithTimeout(PRIMARY_API + encodeURIComponent(word));

  if (response.status === 404) return null;            // the word really doesn't exist
  if (!response.ok) throw new Error("Main API status " + response.status);

  const data = await response.json();                   // JSON text -> JavaScript object
  if (!Array.isArray(data) || data.length === 0) return null;

  const entry = data[0];
  return {
    word: entry.word,
    phonetic: findPhoneticText(entry),
    audio: findAudioUrl(entry),
    meanings: (entry.meanings || []).map((m) => ({
      partOfSpeech: m.partOfSpeech,
      definitions: (m.definitions || []).map((d) => ({
        definition: d.definition,
        example: d.example || ""
      })),
      synonyms: collectSynonyms(m)
    })),
    sourceUrl: (entry.sourceUrls && entry.sourceUrls[0]) || "",
    sourceName: "Wiktionary"
  };
}

/* ---- BACKUP API ---- */
async function fetchFromBackup(word) {
  const response = await fetchWithTimeout(BACKUP_API + encodeURIComponent(word));

  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Backup API status " + response.status);

  const data = await response.json();
  const englishEntries = data.en || [];

  const meanings = englishEntries
    .map((e) => ({
      partOfSpeech: (e.partOfSpeech || "word").toLowerCase(),
      definitions: (e.definitions || [])
        .map((d) => ({
          definition: stripHtml(d.definition),
          example:
            d.parsedExamples && d.parsedExamples[0]
              ? stripHtml(d.parsedExamples[0].example)
              : ""
        }))
        .filter((d) => d.definition !== ""),
      synonyms: []
    }))
    .filter((m) => m.definitions.length > 0);

  if (meanings.length === 0) return null;

  return {
    word: word,
    phonetic: "",
    audio: "",
    meanings: meanings,
    sourceUrl: "https://en.wiktionary.org/wiki/" + encodeURIComponent(word),
    sourceName: "Wiktionary (backup source)"
  };
}

/* ---- Try the main API; if it FAILS (down / slow / blocked), use the backup.
        A 404 returns null instead of throwing, so a missing word does not
        trigger the backup. ---- */
async function lookupWord(word) {
  try {
    return await fetchFromPrimary(word);
  } catch (primaryError) {
    console.warn("Main API failed, trying backup:", primaryError);
    return await fetchFromBackup(word);       // throws if the backup fails too
  }
}

/* =====================================================================
   5. SCREEN STATES
   Only one of these is visible at a time:
   "welcome" | "loading" | "error" | "results"
   ===================================================================== */
function setState(state) {
  welcomeBox.hidden = state !== "welcome";
  loadingBox.hidden = state !== "loading";
  errorBox.hidden = state !== "error";
  resultsBox.hidden = state !== "results";
}

function showError(message) {
  errorText.textContent = message;
  setState("error");
}

/* The X button inside the search bar only shows when there is text */
function updateClearButton() {
  clearInputBtn.hidden = wordInput.value === "";
}

/* =====================================================================
   6. SHOWING A DICTIONARY ENTRY  (this is the "DOM update")
   textContent is used for all API data, so it is always treated as plain
   text and can never inject HTML into the page.
   ===================================================================== */
function renderEntry(entry) {
  resultWord.textContent = entry.word;
  resultPhonetic.textContent = entry.phonetic || "";    // CSS hides it when empty
  document.title = entry.word + " | WordWise";

  setupAudio(entry.audio);
  updateFavoriteButton();
  renderMeanings(entry.meanings);

  if (entry.sourceUrl) {
    sourceLink.href = entry.sourceUrl;
    sourceLink.textContent = entry.sourceName;
  }
}

function renderMeanings(meanings) {
  meaningsContainer.replaceChildren();        // clears the sample markup / old results

  meanings.forEach((meaning) => {
    // 1. clone the template (a fresh copy of the .meaning block)
    const block = meaningTemplate.content.cloneNode(true);

    // 2. part of speech badge (noun, verb, ...)
    block.querySelector(".meaning__pos").textContent = meaning.partOfSpeech;

    // 3. definitions
    const definitionList = block.querySelector(".definitions");
    meaning.definitions.slice(0, MAX_DEFINITIONS).forEach((def) => {
      const item = definitionTemplate.content.cloneNode(true);
      item.querySelector(".definition__text").textContent = def.definition;
      item.querySelector(".definition__example").textContent = def.example
        ? "\u201C" + def.example + "\u201D"     // curly quotes
        : "";                                    // empty -> CSS hides it
      definitionList.appendChild(item);
    });

    // 4. synonyms (only shown when there are some)
    if (meaning.synonyms.length > 0) {
      const synonymBox = block.querySelector(".synonyms");
      const chips = synonymBox.querySelector(".chips");
      synonymBox.hidden = false;

      meaning.synonyms.forEach((word) => {
        const chip = chipTemplate.content.cloneNode(true);
        const button = chip.querySelector(".chip");
        button.textContent = word;
        button.dataset.word = word;               // clicking it starts a new search
        chips.appendChild(chip);
      });
    }

    meaningsContainer.appendChild(block);
  });
}

/* =====================================================================
   7. AUDIO PRONUNCIATION

   Two ways to pronounce a word:
   1) the API's recorded audio file (preferred), or
   2) the browser's built-in text-to-speech (used when there is no
      recording, or the recording fails to load/play).
   ===================================================================== */
const SPEECH_SUPPORTED = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let playRequested = false;   // true while the user is waiting for a recording to start

function stopAudio() {
  playRequested = false;
  audioPlayer.pause();                                   // CHANGED: was els.audio
  if (SPEECH_SUPPORTED) window.speechSynthesis.cancel();
  audioBtn.classList.remove("is-playing");               // CHANGED: was els.audioBtn
}

/* CHANGED: setupAudio no longer disables the button when a word has no
   recording. Before, a disabled button could never reach the text-to-speech
   fallback, so those words stayed silent. */
function setupAudio(url) {
  stopAudio();

  if (url) {
    // CHANGED: the API sometimes gives "//ssl.gstatic.com/..." with no
    // "https:" in front, which can fail to load. This adds it when missing.
    audioPlayer.src = url.startsWith("//") ? "https:" + url : url;
  } else {
    audioPlayer.removeAttribute("src");
  }

  audioBtn.disabled = false;                             // always enabled
  audioBtn.title = "Play pronunciation";
}

function speakWord() {
  if (!SPEECH_SUPPORTED || !currentWord) {
    audioBtn.title = "Pronunciation is not supported in this browser";  // CHANGED: was els.audioBtn
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(currentWord);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  const voice = synth.getVoices().find((v) => /^en[-_]/i.test(v.lang));
  if (voice) utterance.voice = voice;
  utterance.onstart = () => audioBtn.classList.add("is-playing");     // CHANGED: was els.audioBtn
  utterance.onend = () => audioBtn.classList.remove("is-playing");    // CHANGED
  utterance.onerror = () => audioBtn.classList.remove("is-playing");  // CHANGED
  synth.speak(utterance);
}

async function playAudio() {
  stopAudio();
  if (!audioPlayer.getAttribute("src")) {   // no recording for this word (CHANGED: was els.audio)
    speakWord();
    return;
  }
  playRequested = true;
  try {
    audioPlayer.currentTime = 0;            // CHANGED: was els.audio
    await audioPlayer.play();               // CHANGED: was els.audio
  } catch (err) {
    console.warn("[WordWise] Recording could not be played, using text-to-speech.", err);
    playRequested = false;
    speakWord();
  }
}

/* CHANGED: ONE click listener only (the old section 7 listener was deleted,
   so the sound no longer tries to start twice). */
audioBtn.addEventListener("click", playAudio);
audioPlayer.addEventListener("playing", () => audioBtn.classList.add("is-playing"));
audioPlayer.addEventListener("ended", () => audioBtn.classList.remove("is-playing"));
audioPlayer.addEventListener("pause", () => audioBtn.classList.remove("is-playing"));
audioPlayer.addEventListener("error", () => {
  // The file failed to load after the user pressed play: speak instead.
  audioBtn.classList.remove("is-playing");
  if (playRequested && audioPlayer.getAttribute("src")) {
    playRequested = false;
    speakWord();
  }
});

/* CHANGED (new): Chrome loads its voice list late. This asks it to start
   loading the voices early so text-to-speech has a voice ready. */
if (SPEECH_SUPPORTED) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

/* =====================================================================
   8. HISTORY AND FAVORITES
   Both are lists of words saved in localStorage and drawn into the
   sidebar with the same template.
   ===================================================================== */
function renderWordList(listElement, emptyElement, words) {
  listElement.replaceChildren();
  emptyElement.hidden = words.length > 0;
  listElement.hidden = words.length === 0;

  words.forEach((word) => {
    const row = listItemTemplate.content.cloneNode(true);
    row.querySelector(".list__item").dataset.item = word;   // used by the remove button
    const wordButton = row.querySelector(".list__word");
    wordButton.textContent = word;
    wordButton.dataset.word = word;                          // click = search again
    row.querySelector(".list__remove").setAttribute("aria-label", "Remove " + word);
    listElement.appendChild(row);
  });
}

function renderHistory() {
  renderWordList(historyList, historyEmpty, loadList(HISTORY_KEY));
}

function renderFavorites() {
  renderWordList(favoritesList, favoritesEmpty, loadList(FAVORITES_KEY));
}

function addToHistory(word) {
  // newest first, no duplicates, limited length
  const updated = [word, ...loadList(HISTORY_KEY).filter((w) => w !== word)];
  saveList(HISTORY_KEY, updated.slice(0, MAX_HISTORY));
  renderHistory();
}

/* ---- Favorite (heart) button ---- */
function isFavorite(word) {
  return loadList(FAVORITES_KEY).includes(word);
}

function updateFavoriteButton() {
  const saved = currentWord !== "" && isFavorite(currentWord);
  favoriteBtn.setAttribute("aria-pressed", String(saved));      // CSS fills the heart
  const label = saved ? "Remove from favorites" : "Save to favorites";
  favoriteBtn.setAttribute("aria-label", label);
  favoriteBtn.title = label;
}

function toggleFavorite() {
  if (currentWord === "") return;
  const favorites = loadList(FAVORITES_KEY);

  if (favorites.includes(currentWord)) {
    saveList(FAVORITES_KEY, favorites.filter((w) => w !== currentWord));
  } else {
    saveList(FAVORITES_KEY, [currentWord, ...favorites]);
  }
  renderFavorites();
  updateFavoriteButton();
}

/* =====================================================================
   9. SEARCHING  (the main flow)

   validate -> loading -> lookupWord (API / backup) -> show result
                                  \-> any failure -> friendly error
   ===================================================================== */
async function search(rawWord) {
  wordInput.value = rawWord.trim();
  updateClearButton();

  // --- 1. validate the input (user input errors) ---
  const check = validateWord(rawWord);
  if (!check.ok) {
    showError(check.error);
    wordInput.focus();
    return;
  }
  const word = check.word;
  // --- 2. show the loading spinner ---
  const myRequest = ++requestId;      // remember which search this is
  searchBtn.disabled = true;
  setState("loading");

  // --- 3. ask the API ---
  try {
    const entry = await lookupWord(word);

    // a newer search started while we waited, so ignore this old reply
    if (myRequest !== requestId) return;

    if (!entry) {
      showError('We couldn\u2019t find "' + word + '". Check the spelling and try again.');
      return;
    }

    // --- 4. success: update the page ---
    currentWord = word;
    renderEntry(entry);
    addToHistory(word);
    setState("results");

    // on small screens, bring the result into view
    resultsBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    // --- 5. failure: no internet, API down, timeout, bad data ... ---
    if (myRequest !== requestId) return;
    console.error("Fetch error:", error);

    if (!navigator.onLine) {
      showError("You appear to be offline. Please check your internet connection and try again.");
    } else {
      showError("Could not fetch data. Please try again.");
    }
  } finally {
    if (myRequest === requestId) searchBtn.disabled = false;
  }
}

/* =====================================================================
   10. EVENTS
   ===================================================================== */

/* Pressing Enter or clicking Search submits the form.
   preventDefault() stops the page from reloading (this keeps it a
   single-page application). */
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  search(wordInput.value);
});

/* Show / hide the X button as the user types */
wordInput.addEventListener("input", updateClearButton);

/* X button: empty the box and go back to the start screen */
clearInputBtn.addEventListener("click", () => {
  wordInput.value = "";
  updateClearButton();
  requestId++;                       // cancel any search still in progress
  searchBtn.disabled = false;
  currentWord = "";
  stopAudio();                       // CHANGED (new): stop any sound when going back to the start screen
  document.title = "WordWise | Dictionary App";
  setState("welcome");
  wordInput.focus();
});

/* Heart button */
favoriteBtn.addEventListener("click", toggleFavorite);

/* Clear buttons in the sidebar */
clearHistoryBtn.addEventListener("click", () => {
  saveList(HISTORY_KEY, []);
  renderHistory();
});

clearFavoritesBtn.addEventListener("click", () => {
  saveList(FAVORITES_KEY, []);
  renderFavorites();
  updateFavoriteButton();
});

/* One click listener for the WHOLE page ("event delegation").
   It handles every button that is created later by JavaScript:
     - the small X on a history / favorites row  (.list__remove)
     - anything with a data-word="..." attribute (starter chips, synonym
       chips, history items, favorite items) -> starts a new search */
document.addEventListener("click", (event) => {
  // remove one word from History or Favorites
  const removeButton = event.target.closest(".list__remove");
  if (removeButton) {
    const row = removeButton.closest(".list__item");
    const word = row.dataset.item;

    if (row.closest("#history-list")) {
      saveList(HISTORY_KEY, loadList(HISTORY_KEY).filter((w) => w !== word));
      renderHistory();
    } else {
      saveList(FAVORITES_KEY, loadList(FAVORITES_KEY).filter((w) => w !== word));
      renderFavorites();
      updateFavoriteButton();
    }
    return;
  }

  // search a word from any clickable word
  const wordTrigger = event.target.closest("[data-word]");
  if (wordTrigger && wordTrigger.dataset.word) {
    search(wordTrigger.dataset.word);
  }
});

/* =====================================================================
   11. LIGHT / DARK THEME
   An inline script in <head> already restores the saved theme before the
   page paints. This part handles the toggle button.
   ===================================================================== */
themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next = current === "light" ? "dark" : "light";

  document.documentElement.dataset.theme = next;      // CSS swaps the colors
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {
    /* ignore - theme just won't be remembered */
  }
});

/* =====================================================================
   12. START-UP  (runs once when the page loads)
   CHANGED: the old "Pronunciation audio" section that used to sit above
   this was removed (it is now merged into section 7).
   ===================================================================== */
renderHistory();
renderFavorites();
setupAudio("");
updateFavoriteButton();
updateClearButton();
setState("welcome");