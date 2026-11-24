

const ZOMBA = [-15.3833, 35.3333];
const map = L.map('map', { zoomControl: false }).setView(ZOMBA, 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);


const $ = (id) => document.getElementById(id);

function pinIcon(color, symbol) {
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    html: `<div class="pin ${color}"><span>${symbol}</span></div>`
  });
}

function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}


const USER_START_LOCATION = [-15.3860, 35.3150]; 

const facilities = [
  { name: 'Zomba Central Hospital', type: 'Hospital', coords: [-15.3850, 35.3200] },
  { name: 'Matawale Private Clinic', type: 'Hospital', coords: [-15.3750, 35.3300] },
  { name: 'Zomba Police Station', type: 'Police', coords: [-15.3880, 35.3180] },
  { name: 'Zomba City Police', type: 'Police', coords: [-15.3700, 35.3400] }
];

// Define Hazard Zone
const HAZARD_ZONE = [
  [-15.3810, 35.3170],
  [-15.3810, 35.3230],
  [-15.3870, 35.3230],
  [-15.3870, 35.3170]
];

// Draw Hazard Zone on map
L.polygon(HAZARD_ZONE, {
  className: 'hazard-zone'
}).addTo(map).bindTooltip("Reported Flood Zone");

// Add facility markers
facilities.forEach(facility => {
  const color = facility.type === 'Hospital' ? 'red' : 'blue';
  const symbol = facility.type === 'Hospital' ? '+' : 'P';
  
  const marker = L.marker(facility.coords, { icon: pinIcon(color, symbol) })
    .addTo(map)
    .bindTooltip(facility.name);

  marker.on('click', () => {
    updatePanelInfo(facility.name, facility.type);
    drawRoute(USER_START_LOCATION, facility.coords);
  });
});


function setState(state) {
  $('idle').classList.toggle('hidden', state !== 'idle');
  $('loading').classList.toggle('hidden', state !== 'loading');
  $('result').classList.toggle('hidden', state !== 'result');
}

function updatePanelInfo(name, type) {
  document.querySelector('.facility').textContent = name;
  const badge = document.querySelector('.badge');
  if (type === 'Hospital') {
    badge.textContent = 'HOSPITAL / ER';
    badge.style.backgroundColor = 'var(--red)';
  } else {
    badge.textContent = 'POLICE STATION';
    badge.style.backgroundColor = 'var(--blue)';
  }
}

let startMarker = null;
let routeLine = null;
let requestId = 0;

async function drawRoute(startCoords, destCoords) {
  const thisRequest = ++requestId;

  if (routeLine) { routeLine.remove(); routeLine = null; }
  if (startMarker) startMarker.remove();
  
  startMarker = L.marker(startCoords, { icon: pinIcon('blue', '●') }).addTo(map);
  setState('loading');

  const data = await mockFetchRoute(startCoords, destCoords);
  if (thisRequest !== requestId) return;

 
  const hazardPolygon = L.polygon(HAZARD_ZONE);
  let hitsHazard = false;
  
  for (let i = 0; i < data.path.length; i++) {
    if (hazardPolygon.getBounds().contains(data.path[i])) {
      hitsHazard = true;
      break;
    }
  }

  routeLine = L.polyline(data.path, {
    color: hitsHazard ? '#dc2626' : '#2563eb',
    weight: 6,
    opacity: 0.95
  }).addTo(map);

 
  const warningBox = document.getElementById('hazard-warning');
  if (hitsHazard) {
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
  }

  const onDesktop = window.innerWidth > 700;
  map.fitBounds(routeLine.getBounds(), {
    paddingTopLeft: onDesktop ? [430, 60] : [30, 60],
    paddingBottomRight: [40, onDesktop ? 40 : 300]
  });

  $('eta').textContent = data.eta;
  $('dist').textContent = data.dist;
  setState('result');
}

function mockFetchRoute(start, destination) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const straight = distanceKm(start, destination);
      const road = straight * 1.35;

      const midLat = (start[0] + destination[0]) / 2;
      const midLng = (start[1] + destination[1]) / 2;
      const path = [
        start,
        [start[0], midLng],
        [midLat, midLng],
        [midLat, destination[1]],
        destination
      ];

      resolve({
        eta: Math.max(1, Math.round(road / 0.5)) + ' mins', 
        dist: road.toFixed(1) + ' km',
        path
      });
    }, 1500);
  });
}


document.querySelectorAll('.pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');

    const text = pill.textContent;

    if (text === 'All Units') {
      const sorted = [...facilities].sort((a, b) => 
        distanceKm(USER_START_LOCATION, a.coords) - distanceKm(USER_START_LOCATION, b.coords)
      );
      const nearest = sorted[0];
      updatePanelInfo(nearest.name, nearest.type);
      drawRoute(USER_START_LOCATION, nearest.coords);
    }
    
    if (text === 'Hospitals (ER)') {
      const hospitals = facilities.filter(f => f.type === 'Hospital');
      const nearestHospital = hospitals.sort((a, b) => 
        distanceKm(USER_START_LOCATION, a.coords) - distanceKm(USER_START_LOCATION, b.coords)
      )[0];
      updatePanelInfo(nearestHospital.name, nearestHospital.type);
      drawRoute(USER_START_LOCATION, nearestHospital.coords);
    }

    if (text === 'Police') {
      const police = facilities.filter(f => f.type === 'Police');
      const nearestPolice = police.sort((a, b) => 
        distanceKm(USER_START_LOCATION, a.coords) - distanceKm(USER_START_LOCATION, b.coords)
      )[0];
      updatePanelInfo(nearestPolice.name, nearestPolice.type);
      drawRoute(USER_START_LOCATION, nearestPolice.coords);
    }
  });
});


map.on('click', (e) => {
  const clickedStart = [e.latlng.lat, e.latlng.lng];
  const nearestHospital = facilities.filter(f => f.type === 'Hospital')[0];
  updatePanelInfo(nearestHospital.name, nearestHospital.type);
  drawRoute(clickedStart, nearestHospital.coords);
});


document.getElementById('custom-search').addEventListener('keypress', function (e) {
  if (e.key === 'Enter') {
    const query = this.value;
    if (!query) return;

    
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
      .then(response => response.json())
      .then(data => {
        if (data && data.length > 0) {
          const result = data[0];
          const destination = [parseFloat(result.lat), parseFloat(result.lon)];
          
          map.fitBounds([[result.boundingbox[0], result.boundingbox[2]], [result.boundingbox[1], result.boundingbox[3]]]);
          
          updatePanelInfo('Searched: ' + result.display_name.split(',')[0], 'Hospital'); 
          drawRoute(USER_START_LOCATION, destination);
        } else {
          alert("Location not found. Please try another search.");
        }
      })
      .catch(err => console.error("Geocoding error:", err));
  }
});