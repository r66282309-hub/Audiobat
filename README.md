# Audiobat Web

Struttura GitHub-ready per pubblicazione su GitHub Pages.

File principali:

- `index.html` — struttura della pagina
- `styles.css` — grafica/interfaccia
- `app.js` — logica audio, spettrogramma, Auto-ID, Supabase

Carica tutti i file nella stessa cartella del repository. GitHub Pages userà `index.html` come pagina principale.

Nota: l’app usa una anon public key Supabase embedded in `app.js`; è normale per il client web, ma le policy RLS della tabella devono restare correttamente impostate.
