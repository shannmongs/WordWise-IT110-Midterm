==============================================================
 WORDWISE - Dictionary App
 IT 110 Midterm Project
 Caraga State University - College of Computing and Information Sciences
==============================================================


1. GROUP NAME AND MEMBERS
--------------------------------------------------------------
Group Name : Lexicode

Members and roles:
  1. Krishanen A. Mongaya - [ HTML & Structure ]
  2. Jorel Kent E. Laurente - [CSS STYLE & Layout]
  3. Leajane Escobilla - [JavaScript & API]

(Every member contributed code to the project.)


2. ABOUT THE PROJECT
--------------------------------------------------------------
WordWise is a single-page dictionary web app. The user types an
English word and the app fetches its meaning from a public API and
shows it on the page without reloading.

What the app shows for each word:
  - the word and its phonetic spelling
  - definitions grouped by part of speech (noun, verb, ...)
  - example sentences
  - clickable synonyms (click one to search it)
  - a link to the source of the information

Extra features (beyond the basic requirements):
  - Pronunciation: plays the API's audio recording, and falls back
    to the browser's built-in text-to-speech if there is no recording
  - Search history (last 10 words, saved in the browser)
  - Favorites list (heart button, saved in the browser)
  - Dark / light mode toggle with a smooth transition (remembered)
  - Loading spinner while the word is being fetched
  - Press Enter to search, "/" to jump to the search box
  - Open a word straight from the address:  app.html?word=hello
  - Backup data source if the main API is down or slow
  - Responsive layout for phones, tablets and desktops


3. API USED
--------------------------------------------------------------
Name          : Free Dictionary API
Documentation : https://dictionaryapi.dev
Primary API   : https://api.dictionaryapi.dev/api/v2/entries/en/
Backup API    : https://en.wiktionary.org/api/rest_v1/page/definition/


4. FILES
--------------------------------------------------------------
  index.html     Group portfolio page (team, project, member profiles)
  app.html       The WordWise dictionary app
  styles.css     Styling for the app (colors, layout, light/dark themes)
  script.js      JavaScript: API calls, error handling, history,
                 favorites, audio, theme switch
  images/        Background pictures used by the app
                 (background-dark.jpg and background-light.jpg)
  README.txt     This file


5. ERROR HANDLING
--------------------------------------------------------------
The app shows a friendly message instead of crashing when:
  - the input is empty or contains numbers/symbols
  - the word is not found in the dictionary
  - there is no internet connection
  - a request takes too long (more than 6 seconds per source)
  - the API returns a server error
    ("Could not fetch data. Please try again.")


6. NOTES
--------------------------------------------------------------
  - Search history, favorites and the chosen theme are stored in the
    browser (localStorage) on the visitor's own device only.
  - The pronunciation button uses the browser's text-to-speech when
    there is no audio recording, so the voice depends on the device.
  - Word data belongs to its original sources (Wiktionary and the
    Free Dictionary API) and is shown here for educational use.
