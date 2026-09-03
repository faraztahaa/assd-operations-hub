/**
 * 1. ASSD HTML Parser
 */
function parseAssdCalendar(htmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  const headerSpans = doc.querySelectorAll('thead th span[date]');
  const dateColumns = Array.from(headerSpans).map(span => span.getAttribute('date'));

  const roomRows = doc.querySelectorAll('tbody tr[room]');
  const parsedRooms = [];

  roomRows.forEach(row => {
    const rawRoom = row.getAttribute('room')?.trim() || '';
    const cleanRoomNumber = rawRoom.replace(/[^a-zA-Z0-9]/g, '');
    const bedCount = parseInt(row.getAttribute('bed'), 10) || 1;
    const roomType = row.getAttribute('rtypedesc') || '';
    const floor = row.children[1]?.textContent.trim() || '';

    const dayCells = Array.from(row.children).slice(5);
    let dateIndex = 0;

    dayCells.forEach(cell => {
      const colSpan = parseInt(cell.getAttribute('colspan'), 10) || 1;
      const isVacant = cell.querySelector('.quota') !== null || cell.textContent.includes('1/ASSD') || cell.textContent.trim() === '';
      const bookingDiv = cell.querySelector('.r');
      const guestText = bookingDiv?.querySelector('span')?.textContent.trim() || '';

      const hasLeftArrow = cell.querySelector('.arrow-left') !== null;
      const hasRightArrow = cell.querySelector('.arrow-right') !== null;
      const hasLeftZigzag = cell.querySelector('.l-zigzag') !== null;
      const hasRightZigzag = cell.querySelector('.r-zigzag') !== null;

      for (let dayOffset = 0; dayOffset < colSpan; dayOffset++) {
        const currentDate = dateColumns[dateIndex + dayOffset];
        if (!currentDate) continue;

        let dayStatus = 'VACANT';

        if (!isVacant && (bookingDiv || guestText)) {
          const isFirstDay = (dayOffset === 0);
          const isLastDay = (dayOffset === colSpan - 1);

          if (isFirstDay && (hasLeftArrow || !hasLeftZigzag)) {
            dayStatus = 'ARRIVAL';
          } else if (isLastDay && (hasRightArrow || !hasRightZigzag)) {
            dayStatus = 'DEPARTURE';
          } else {
            dayStatus = 'STAYOVER';
          }
        }

        parsedRooms.push({
          roomNumber: cleanRoomNumber,
          floor: floor,
          roomType: roomType,
          bedCount: bedCount,
          date: currentDate,
          status: dayStatus,
          guest: isVacant ? '' : guestText
        });
      }

      dateIndex += colSpan;
    });
  });

  return { dates: dateColumns, rooms: parsedRooms };
}

/**
 * 2. Daily Summary & Housekeeping Aggregator
 */
function getDailyOperationsSummary(rooms, targetDate) {
  const dayRooms = rooms.filter(r => r.date === targetDate);

  const summary = {
    totalRooms: dayRooms.length,
    arrivals: 0,
    departures: 0,
    stayovers: 0,
    vacant: 0,
    occupancyRate: 0,
    housekeepingList: []
  };

  dayRooms.forEach(room => {
    if (room.status === 'ARRIVAL') summary.arrivals++;
    else if (room.status === 'DEPARTURE') summary.departures++;
    else if (room.status === 'STAYOVER') summary.stayovers++;
    else if (room.status === 'VACANT') summary.vacant++;

    let cleaningTask = 'No Action';
    let cleaningPriority = 4;

    if (room.status === 'DEPARTURE') {
      cleaningTask = 'Departure Clean (Full Clean & Linen)';
      cleaningPriority = 1;
    } else if (room.status === 'ARRIVAL' && !room.guest) {
      cleaningTask = 'Arrival Check (Prep Room)';
      cleaningPriority = 2;
    } else if (room.status === 'STAYOVER') {
      cleaningTask = 'Stayover Clean (Towels/Bins)';
      cleaningPriority = 3;
    }

    summary.housekeepingList.push({
      roomNumber: room.roomNumber,
      floor: room.floor,
      roomType: room.roomType,
      status: room.status,
      cleaningTask: cleaningTask,
      priority: cleaningPriority,
      guest: room.guest
    });
  });

  const occupied = summary.arrivals + summary.departures + summary.stayovers;
  summary.occupancyRate = summary.totalRooms > 0 
    ? Math.round((occupied / summary.totalRooms) * 100) 
    : 0;

  summary.housekeepingList.sort((a, b) => {
    if (a.floor !== b.floor) return a.floor.localeCompare(b.floor);
    return a.priority - b.priority;
  });

  return summary;
}