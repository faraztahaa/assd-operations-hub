// --- 1. PARSER: TIMELINE & CHECKIN STATE ---
function parseAssdCalendar(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  const headerSpans = doc.querySelectorAll('thead th span[date]');
  const dateColumns = Array.from(headerSpans).map(span => span.getAttribute('date'));

  const roomRows = doc.querySelectorAll('tbody tr[room]');
  const roomTimelines = [];

  roomRows.forEach(row => {
    const rawRoom = row.getAttribute('room')?.trim() || '';
    const cleanRoomNumber = rawRoom.replace(/[^a-zA-Z0-9]/g, '');
    const bedCount = parseInt(row.getAttribute('bed'), 10) || 1;
    const roomType = row.getAttribute('rtypedesc') || '';
    const floor = row.children[1]?.textContent.trim() || '';

    const dayCells = Array.from(row.children).slice(5);
    let dateIdx = 0;
    const bookings = [];

    dayCells.forEach(cell => {
      const colSpan = parseInt(cell.getAttribute('colspan'), 10) || 1;
      const isVacant = cell.querySelector('.quota') !== null || cell.textContent.includes('1/ASSD') || cell.textContent.trim() === '';
      const bookingDiv = cell.querySelector('.r');
      const guestText = bookingDiv?.querySelector('span')?.textContent.trim() || '';

      if (!isVacant && (bookingDiv || guestText)) {
        const divStyle = bookingDiv?.getAttribute('style') || '';
        const isUnderlined = divStyle.includes('underline') || bookingDiv?.querySelector('u') !== null;
        const isStrikethrough = divStyle.includes('line-through') || bookingDiv?.querySelector('s, del, strike') !== null;

        let checkInState = 'PENDING';
        if (isStrikethrough) checkInState = 'CHECKED_OUT';
        else if (isUnderlined) checkInState = 'CHECKED_IN';

        bookings.push({
          guest: guestText,
          checkInState: checkInState,
          startNightIdx: dateIdx,
          endNightIdx: dateIdx + colSpan - 1
        });
      }

      dateIdx += colSpan;
    });

    roomTimelines.push({
      roomNumber: cleanRoomNumber,
      floor: floor,
      roomType: roomType,
      bedCount: bedCount,
      bookings: bookings
    });
  });

  return { dates: dateColumns, rooms: roomTimelines };
}

// --- 2. SUMMARY CALCULATOR ---
function getOperationsDataForDate(roomTimelines, targetDate) {
  const allDates = globalParsedData.dates;
  const targetIdx = allDates.indexOf(targetDate);
  const prevDateIdx = targetIdx - 1;

  const data = {
    totalRooms: roomTimelines.length,
    arrivals: [],
    departures: [],
    stayovers: [],
    housekeeping: [],
    occupancyPct: 0
  };

  roomTimelines.forEach(room => {
    const departedBooking = prevDateIdx >= 0 
      ? room.bookings.find(b => b.endNightIdx === prevDateIdx) 
      : null;

    const arrivingBooking = room.bookings.find(b => b.startNightIdx === targetIdx);
    const stayoverBooking = room.bookings.find(b => b.startNightIdx < targetIdx && b.endNightIdx >= targetIdx);

    if (arrivingBooking) {
      data.arrivals.push({
        room: room.roomNumber,
        guest: arrivingBooking.guest,
        state: arrivingBooking.checkInState === 'CHECKED_IN' ? 'Checked In' : 'Expected'
      });
    }

    if (departedBooking) {
      data.departures.push({
        room: room.roomNumber,
        guest: departedBooking.guest,
        state: departedBooking.checkInState === 'CHECKED_OUT' ? 'Checked Out' : 'Pending Checkout'
      });
    }

    if (stayoverBooking) {
      data.stayovers.push({ room: room.roomNumber, guest: stayoverBooking.guest });
    }

    let hkTask = 'No Action';
    let hkStatus = 'VACANT';
    if (departedBooking && arrivingBooking) {
      hkStatus = 'TURNOVER';
      hkTask = '⚡ Rush Turnover Clean';
    } else if (departedBooking) {
      hkStatus = 'DEPARTURE';
      hkTask = 'Departure Clean';
    } else if (arrivingBooking && !departedBooking) {
      hkStatus = 'ARRIVAL';
      hkTask = 'Pre-Arrival Check';
    } else if (stayoverBooking) {
      hkStatus = 'STAYOVER';
      hkTask = 'Stayover Clean';
    }

    data.housekeeping.push({
      room: room.roomNumber,
      floor: room.floor,
      type: room.roomType,
      status: hkStatus,
      task: hkTask,
      guest: arrivingBooking?.guest || stayoverBooking?.guest || departedBooking?.guest || ''
    });
  });

  const occupied = data.arrivals.length + data.stayovers.length;
  data.occupancyPct = data.totalRooms > 0 ? Math.round((occupied / data.totalRooms) * 100) : 0;

  // Natural numeric room sorting for housekeeping table
  data.housekeeping.sort((a, b) => {
    if (a.floor !== b.floor) return a.floor.localeCompare(b.floor, undefined, { numeric: true });
    return a.room.localeCompare(b.room, undefined, { numeric: true });
  });

  return data;
}

// --- 3. UI CONTROLLER ---
let globalParsedData = null;
let activeDate = null;
let occupancyChartInstance = null;

function renderDashboard(date) {
  activeDate = date;
  const opData = getOperationsDataForDate(globalParsedData.rooms, date);

  // Update 4 Main KPI Cards
  const arrivalsIn = opData.arrivals.filter(a => a.state === 'Checked In').length;
  const arrivalsPending = opData.arrivals.length - arrivalsIn;
  document.getElementById('kpi-arrivals').textContent = opData.arrivals.length;
  document.getElementById('kpi-arrivals-sub').textContent = `${arrivalsPending} Pending | ${arrivalsIn} Checked In`;

  const depOut = opData.departures.filter(d => d.state === 'Checked Out').length;
  const depPending = opData.departures.length - depOut;
  document.getElementById('kpi-departures').textContent = opData.departures.length;
  document.getElementById('kpi-departures-sub').textContent = `${depPending} Pending | ${depOut} Out`;

  document.getElementById('kpi-stayovers').textContent = opData.stayovers.length;
  document.getElementById('kpi-occupancy').textContent = `${opData.occupancyPct}%`;

  const freeRooms = opData.totalRooms - (opData.arrivals.length + opData.stayovers.length);
  document.getElementById('kpi-free-rooms').textContent = `${freeRooms} Rooms Free`;

  document.getElementById('current-day-label').textContent = `Date Focus: ${date}`;

  // Render Secondary Drawer Table
  const tbody = document.getElementById('drawer-table-body');
  tbody.innerHTML = '';
  opData.housekeeping.forEach(row => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${row.room}</strong></td>
        <td>Floor ${row.floor || '-'}</td>
        <td>${row.type}</td>
        <td><span class="pill pill-pending">${row.status}</span></td>
        <td><strong>${row.task}</strong></td>
        <td>${row.guest || '<em style="color: #94a3b8;">Vacant</em>'}</td>
      </tr>`;
  });
}

// --- 4. OCCUPANCY GRAPH ---
function renderOccupancyChart() {
  const dates = globalParsedData.dates;
  const occupancies = dates.map(d => getOperationsDataForDate(globalParsedData.rooms, d).occupancyPct);

  const ctx = document.getElementById('occupancyChart').getContext('2d');
  if (occupancyChartInstance) occupancyChartInstance.destroy();

  occupancyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: 'Occupancy Rate (%)',
        data: occupancies,
        borderColor: '#008080',
        backgroundColor: 'rgba(0, 128, 128, 0.08)',
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#008080',
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Occupancy: ${context.parsed.y}%`
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: v => v + '%' },
          grid: { color: '#f1f5f9' }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

// --- 5. INITIALIZE ---
function init() {
  chrome.storage.local.get(['assd_table_html', 'assd_last_sync'], (res) => {
    if (!res.assd_table_html) return;

    globalParsedData = parseAssdCalendar(res.assd_table_html);
    document.getElementById('sync-status').textContent = `Last sync: ${new Date(res.assd_last_sync).toLocaleTimeString()}`;

    const nav = document.getElementById('date-buttons');
    nav.innerHTML = '';
    globalParsedData.dates.forEach((d, idx) => {
      const b = document.createElement('button');
      b.className = 'date-btn';
      b.textContent = d;
      b.onclick = () => {
        document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        renderDashboard(d);
      };
      nav.appendChild(b);
    });

    const defaultDate = globalParsedData.dates[1] || globalParsedData.dates[0];
    document.querySelectorAll('.date-btn')[1]?.classList.add('active');

    renderDashboard(defaultDate);
    renderOccupancyChart();
  });
}

// Drawer Toggle and Print
document.getElementById('btn-toggle-drawer').addEventListener('click', (e) => {
  const drawer = document.getElementById('detail-drawer');
  const isOpen = drawer.classList.toggle('open');
  e.target.textContent = isOpen ? '▲ Hide Breakdown & Housekeeping' : '📋 Show Room Breakdown & Housekeeping Sheet';
});

document.getElementById('btn-print').addEventListener('click', () => window.print());

init();