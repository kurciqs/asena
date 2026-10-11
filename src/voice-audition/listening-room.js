const container = document.querySelector('#generators');
const loadStatus = document.querySelector('#load-status');
const pauseAll = document.querySelector('#pause-all');
const players = [];
const favouriteKey = 'asena.voice-audition.favourites.v1';
let favourites = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(favouriteKey) || '[]');
  if (Array.isArray(saved)) favourites = new Set(saved);
} catch { /* Audition playback remains available when storage is unavailable. */ }

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function sourceLink(url, text) {
  const element = node('a', text);
  element.href = url;
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  return element;
}

function updatePauseButton() {
  pauseAll.disabled = !players.some(({ audio }) => !audio.paused && !audio.ended);
}

function pauseOthers(current) {
  for (const { audio } of players) if (audio !== current) audio.pause();
}

pauseAll.addEventListener('click', () => {
  pauseOthers(null);
  updatePauseButton();
});

function sampleCard(sample) {
  const card = node('article', null, 'sample');
  const top = node('div', null, 'sample-top');
  top.append(node('h3', sample.title));
  const favourite = node('button', '♡', 'favourite-button');
  favourite.type = 'button';
  favourite.setAttribute('aria-label', `Favourite ${sample.title}`);
  function updateFavourite() {
    const selected = favourites.has(sample.id);
    favourite.textContent = selected ? '♥' : '♡';
    favourite.setAttribute('aria-pressed', String(selected));
    card.classList.toggle('favourite', selected);
  }
  updateFavourite();
  favourite.addEventListener('click', () => {
    favourites.has(sample.id) ? favourites.delete(sample.id) : favourites.add(sample.id);
    updateFavourite();
    try { localStorage.setItem(favouriteKey, JSON.stringify([...favourites])); }
    catch { status.textContent = 'Favourite marked for this visit; browser storage is unavailable.'; }
  });
  top.append(favourite);
  card.append(top, node('p', sample.meta, 'meta'), node('p', sample.description, 'sample-description'));
  const audio = node('audio');
  audio.controls = true;
  audio.preload = 'none';
  audio.hidden = true;
  audio.setAttribute('aria-label', sample.title);
  // Assign the source only on the explicit Play action, including remote showcases.
  const play = node('button', 'Play sample', 'play');
  play.type = 'button';
  play.setAttribute('aria-label', `Play ${sample.title}`);
  const status = node('p', '', 'play-status');
  status.setAttribute('role', 'status');
  play.addEventListener('click', async () => {
    if (!audio.paused) { audio.pause(); return; }
    pauseOthers(audio);
    if (!audio.getAttribute('src')) audio.src = sample.audio;
    audio.hidden = false;
    status.textContent = 'Loading recording…';
    try { await audio.play(); }
    catch (error) {
      status.textContent = error.name === 'AbortError' && audio.paused
        ? 'Paused'
        : 'Could not play this clip. Try the source link or reload.';
    }
    updatePauseButton();
  });
  audio.addEventListener('play', () => {
    pauseOthers(audio);
    play.textContent = 'Pause';
    play.setAttribute('aria-label', `Pause ${sample.title}`);
    updatePauseButton();
  });
  audio.addEventListener('playing', () => { status.textContent = 'Playing recording'; });
  audio.addEventListener('waiting', () => { status.textContent = 'Buffering recording…'; });
  for (const event of ['pause', 'ended']) audio.addEventListener(event, () => {
    play.textContent = audio.ended ? 'Play again' : 'Play sample';
    play.setAttribute('aria-label', `Play ${sample.title}`);
    status.textContent = audio.ended ? 'Finished' : 'Paused';
    updatePauseButton();
  });
  audio.addEventListener('error', () => {
    status.textContent = 'Recording unavailable. Use the original source link.';
    play.textContent = 'Retry';
    audio.removeAttribute('src');
    updatePauseButton();
  });
  players.push({ audio });
  const actions = node('div', null, 'actions');
  actions.append(play, sourceLink(sample.source, 'Source ↗'));
  const transcript = node('details');
  transcript.append(node('summary', 'Words & voice notes'), node('p', sample.text));
  if (sample.voiceNotes) transcript.append(node('p', sample.voiceNotes));
  card.append(actions, audio, status, transcript);
  return card;
}

try {
  const response = await fetch('/voice-audition/samples.json');
  if (!response.ok) throw new Error('Sample list unavailable');
  const manifest = await response.json();
  for (const generator of manifest.generators) {
    const section = node('section', null, 'generator');
    const heading = node('div', null, 'generator-heading');
    heading.append(node('h2', generator.name), sourceLink(generator.source, 'Original demo ↗'));
    const samples = node('div', null, 'samples');
    for (const sample of generator.samples) samples.append(sampleCard(sample));
    section.append(heading, node('p', generator.context, 'context'), samples);
    container.append(section);
  }
  loadStatus.textContent = `${players.length} recordings ready. Nothing plays automatically.`;
} catch {
  loadStatus.textContent = 'The sample list could not load. Reload the page to try again.';
}
