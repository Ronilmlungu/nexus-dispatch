// Same-origin when served by Flask (port 5000); otherwise talk to the local Flask server.
const API = location.port === '5000' ? '/api' : 'http://localhost:5000/api';

const ZOMBA = [-15.3833, 35.3333];
const map = L.map('map', { zoomControl: false }).setView(ZOMBA, 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const $ = (id) => document.getElementById(id);

const TYPE_META = {
  hospital: { label: 'HOSPITAL / ER',  color: 'red',  symbol: '+', css: 'var(--red)' },
  police:   { label: 'POLICE STATION', color: 'blue', symbol: 'P', css: 'var(--blue)' },
  fire:     { label: 'FIRE STATION',   color: 'red',  symbol: 'F', css: 'var(--red)' }
};
const PILL_TYPES = { 'All Units': 'all', 'Hospitals (ER)': 'hospital', 'Police': 'police' };

function pinIcon(color, symbol) {
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    html: `<div class="pin ${color}"><span>${symbol}</span></div>`
  });
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setState(state) {
  $('idle').classList.toggle('hidden', state !== 'idle');
  $('loading').classList.toggle('hidden', state !== 'loading');
  $('result').classList.toggle('hidden', state !== 'result');
}

// ---------- layers from the database (FR2) ----------
const facilityLayer = L.layerGroup().addTo(map);
const hazardLayer = L.layerGroup().addTo(map);

async function loadLayers() {
  const [fac, haz] = await Promise.all([getJSON(`${API}/facilities`), getJSON(`${API}/hazards`)]);
  facilityLayer.clearLayers();
  hazardLayer.clearLayers();

  L.geoJSON(haz, {
    style: () => ({ className: 'hazard-zone' }),
    onEachFeature: (f, layer) =>
      layer.bindTooltip(`${f.properties.hazard_type} (${f.properties.severity})`)
  }).addTo(hazardLayer);

  L.geoJSON(fac, {
    pointToLayer: (f, latlng) => {
      const m = TYPE_META[f.properties.type] || TYPE_META.hospital;
      return L.marker(latlng, { icon: pinIcon(m.color, m.symbol) });
    },
    onEachFeature: (f, layer) => layer.bindTooltip(f.properties.name)
  }).addTo(facilityLayer);
}

// ---------- routing (FR3, FR5-FR11) ----------
let selectedType = 'all';
let startPoint = null;
let startMarker = null;
let routeLine = null;
let requestId = 0;

function showRoute(data) {
  const hazardous = data.hazard.intersects;
  routeLine = L.polyline(data.path, {
    color: hazardous ? '#dc2626' : '#2563eb',
    weight: 6,
    opacity: 0.95
  }).addTo(map);

  const meta = TYPE_META[data.facility.type] || TYPE_META.hospital;
  document.querySelector('.facility').textContent = data.facility.name;
  const badge = document.querySelector('.badge');
  badge.textContent = meta.label;
  badge.style.backgroundColor = meta.css;

  $('eta').textContent = `${data.eta_min} min${data.eta_min === 1 ? '' : 's'}`;
  $('dist').textContent = `${data.distance_km.toFixed(1)} km`;

  const warning = $('hazard-warning');
  warning.classList.toggle('hidden', !hazardous);
  if (hazardous) {
    const names = [...new Set(data.hazard.zones.map((z) => z.hazard_type))].join(', ');
    warning.querySelector('span').textContent =
      `Warning: Route crosses a reported hazard zone (${names}).`;
  }

  const onDesktop = window.innerWidth > 700;
  map.fitBounds(routeLine.getBounds(), {
    paddingTopLeft: onDesktop ? [430, 60] : [30, 60],
    paddingBottomRight: [40, onDesktop ? 40 : 300]
  });
  setState('result');
}

async function requestRoute() {
  if (!startPoint) return;
  const thisRequest = ++requestId;
  if (routeLine) { routeLine.remove(); routeLine = null; }
  setState('loading');

  try {
    const q = new URLSearchParams({ lat: startPoint[0], lng: startPoint[1], type: selectedType });
    const data = await getJSON(`${API}/route?${q}`);
    if (thisRequest !== requestId) return;
    showRoute(data);
  } catch (err) {
    if (thisRequest !== requestId) return;
    $('idle').textContent = err.message;
    setState('idle');
  }
}

function setStart(latlng) {
  startPoint = latlng;
  if (startMarker) startMarker.remove();
  startMarker = L.marker(latlng, { icon: pinIcon('blue', '●') }).addTo(map);
  requestRoute();
}

map.on('click', (e) => setStart([e.latlng.lat, e.latlng.lng]));

document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    selectedType = PILL_TYPES[pill.textContent.trim()] || 'all';
    requestRoute();
  });
});

// Address search: geocode with Nominatim and use the result as the start point
$('custom-search').addEventListener('keypress', async function (e) {
  if (e.key !== 'Enter' || !this.value) return;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mw&q=${encodeURIComponent(this.value)}`;
    const data = await getJSON(url);
    if (!data.length) { alert('Location not found. Please try another search.'); return; }
    setStart([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
  } catch (err) {
    console.error('Geocoding error:', err);
  }
});

// ---------- startup ----------
loadLayers().catch((err) => console.error('Could not load map layers:', err));
getJSON(`${API}/health`).catch(() => {
  const status = document.querySelector('.status');
  status.lastChild.textContent = 'DB Offline';
  status.querySelector('.dot').style.background = '#dc2626';
});
