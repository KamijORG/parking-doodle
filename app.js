document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const trackingToken = urlParams.get('token');

    let reservations = { "1": {}, "2": {}, "3": {}, "4": {} };
    let penalties = {};
    let reports = {};
    let logs = [];

    let state = {
        apartment: null,
        parking: '1',
        day: new Date().getDay() === 0 ? 6 : new Date().getDay() - 1 // 0=Mon, 6=Sun
    };

    // --- Backend Sync Functions ---
    async function validateToken(token) {
        if (!token) return null;
        try {
            const res = await fetch(`/api/validate_token?token=${token}`);
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'ok') return data.apt;
            }
        } catch (e) {
            console.error('Error validating token', e);
        }
        return null;
    }

    async function fetchDB() {
        try {
            const res = await fetch('/api/db');
            if (res.ok) {
                const data = await res.json();
                reservations = data.reservations || { "1": {}, "2": {}, "3": {}, "4": {} };
                penalties = data.penalties || {};
                reports = data.reports || {};
                logs = data.logs || [];
            }
        } catch (e) {
            console.error('Error fetching DB', e);
        }
    }

    async function saveDB() {
        try {
            await fetch('/api/db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reservations, penalties, reports, logs })
            });
        } catch (e) {
            console.error('Error saving DB', e);
        }
    }

    // Initialize UI
    const scheduleEl = document.getElementById('schedule');
    const modal = document.getElementById('modal');
    let selectedSlotToBook = null;

    // Build the grid
    function renderGrid() {
        scheduleEl.innerHTML = '';

        // Helper to get dates for the next 8 days starting today
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
        const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

        const daysData = [];
        for (let i = 0; i < 8; i++) {
            const dateStr = new Date(now);
            dateStr.setDate(now.getDate() + i);
            const yyyymmdd = dateStr.toISOString().split('T')[0]; // Use real date as key
            const dayName = dayNames[dateStr.getDay()];
            daysData.push({
                key: yyyymmdd,
                date: dateStr,
                label: `${dayName}<br><span style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">${formatter.format(dateStr)}</span>`
            });
        }

        const blocks = [
            { id: 'matin', startHour: 8, endHour: 12, label: 'Matinée<br>(8h-12h)' },
            { id: 'midi', startHour: 12, endHour: 14, label: 'Pause déjeuner<br>(12h-14h)' },
            { id: 'aprem', startHour: 14, endHour: 18, label: 'Après-midi<br>(14h-18h)' },
            { id: 'soir', startHour: 18, endHour: 22, label: 'Soirée<br>(18h-22h)' },
            { id: 'nuit', startHour: 22, endHour: 8, label: 'Nuit<br>(22h-8h)' }
        ];

        // Header empty cell
        const headerEmpty = document.createElement('div');
        headerEmpty.className = 'grid-cell header empty';
        scheduleEl.appendChild(headerEmpty);

        // Days header
        daysData.forEach((dayData, idx) => {
            const headerCell = document.createElement('div');
            headerCell.className = 'grid-cell header';
            if (idx === 0) headerCell.style.color = 'var(--primary)'; // highlight today
            headerCell.innerHTML = dayData.label;
            scheduleEl.appendChild(headerCell);
        });

        blocks.forEach(block => {
            const slotId = `slot_${block.id}`;

            const timeCell = document.createElement('div');
            timeCell.className = 'grid-cell time-label';
            timeCell.innerHTML = block.label;
            scheduleEl.appendChild(timeCell);

            daysData.forEach(dayData => {
                const dayStr = dayData.key;

                const div = document.createElement('div');
                div.className = 'grid-cell slot dual-parking';

                const now = new Date();
                const yyyymmddNow = now.toISOString().split('T')[0];
                const currentHour = now.getHours();

                // If the user has 3 strikes and is currently banned, grey out everything for them
                const isBanned = state.apartment && penalties[state.apartment] && penalties[state.apartment].bannedUntil && penalties[state.apartment].bannedUntil > Date.now();

                // It's a past slot if it's before today, or today but the hour has passed, or if the user is banned
                let isPast = false;
                if (isBanned || dayStr < yyyymmddNow) isPast = true;

                // For night slot ends next day at 8h, but the slot starts at 22h
                if (dayStr === yyyymmddNow) {
                    if (block.id !== 'nuit') {
                        if (currentHour >= block.endHour) isPast = true;
                    } else {
                        // For the night block (22h - 8h), it only becomes "past" after 8h the NEXT day.
                        // However, to prevent booking a night slot that *just* passed 8am today:
                        if (currentHour >= 8 && currentHour < 22) {
                            // Wait, if it's 10am today, can I book the night slot for *tonight*? Yes.
                            // But I shouldn't treat *tonight's* slot as past just because currentHour(10) > end(8). 
                            // Tonight's night slot is not past yet. 
                        }
                    }
                }

                // Special edge case: If it is currently between 00:00 and 08:00, 
                // the "nuit" slot of YESTERDAY is still active. 
                // We shouldn't grey it out completely if we are actively in it, 
                // but we also don't want people booking yesterday's night slot anew at 3am.
                if (dayStr === yyyymmddNow && currentHour >= 8 && currentHour < 22 && block.id === 'nuit') {
                    // Can still book tonight's night slot. NOT past.
                }

                if (isPast) {
                    div.classList.add('past-slot');
                }

                [1, 2].forEach(p => {
                    const parkingStr = String(p);
                    // Ensure the parking and day structures exist
                    if (!reservations[parkingStr]) reservations[parkingStr] = {};
                    if (!reservations[parkingStr][dayStr]) reservations[parkingStr][dayStr] = {};

                    const currentDayReservations = reservations[parkingStr][dayStr] || {};
                    const bookedBy = currentDayReservations[slotId];

                    const spotDiv = document.createElement('div');
                    spotDiv.className = 'parking-spot';

                    let icon = `<span class="status-icon available">Place ${p} 🟢</span>`;

                    if (bookedBy) {
                        if (bookedBy === state.apartment) {
                            spotDiv.classList.add('mine');
                            icon = `<span class="status-icon mine" style="color: var(--danger);">Place ${p} 🔴</span> <div class="apt-label" style="font-weight: bold; color: var(--text-main);">Apt ${bookedBy} (Vous)</div>`;
                        } else {
                            spotDiv.classList.add('occupied');
                            icon = `<span class="status-icon booked" style="color: var(--danger);">Place ${p} 🔴</span> <div class="apt-label">Apt ${bookedBy}</div>`;
                        }
                    } else {
                        // Check for reports on empty/wrong slots
                        const reportKey = `${dayStr}_${slotId}_${p}`;
                        if (reports[reportKey]) {
                            icon += `<br><span class="report-badge">🚨 SIGNALÉ : OCCUPÉ</span>`;
                        }
                    }

                    spotDiv.innerHTML = icon;

                    spotDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // If no apartment selected, ask them to click a QR code
                        if (!state.apartment) {
                            alert("Veuillez sélectionner votre appartement en cliquant sur un des 4 QR codes ci-dessous, ou scannez le QR code avec votre téléphone.");
                            return;
                        }

                        state.parking = parkingStr; // Set active parking for the modal action
                        if (bookedBy) {
                            if (bookedBy === state.apartment) {
                                openCancelModal(block, slotId, dayData);
                            } else {
                                openInfoModal(block, slotId, dayData, bookedBy);
                            }
                            return;
                        }
                        openBookingModal(block, slotId, dayData);
                    });

                    div.appendChild(spotDiv);
                });

                scheduleEl.appendChild(div);
            });
        });
    }

    // Modal logic
    function openBookingModal(block, slotId, dayData) {
        const now = new Date();
        const yyyymmddNow = now.toISOString().split('T')[0];
        const currentHour = now.getHours();

        const isNuit = block.id === 'nuit';

        let isPast = false;
        if (dayData.key < yyyymmddNow) isPast = true;
        if (dayData.key === yyyymmddNow) {
            if (!isNuit && currentHour >= block.endHour) isPast = true;
            // Note: Tonight's night slot (22h) is bookable as long as it's not past 8am the next morning.
        }

        if (isPast) {
            alert("⚠️ Vous ne pouvez pas réserver un créneau dans le passé.");
            return;
        }

        if (penalties[state.apartment] && penalties[state.apartment].bannedUntil && penalties[state.apartment].bannedUntil > Date.now()) {
            alert("⚠️ Vous ne pouvez pas réserver car vous avez eu 3 retards ou oublis de check-out. Vous êtes suspendu pour 1 semaine.");
            return;
        }

        const reservationCount = countActiveReservations(state.apartment);

        document.getElementById('modal-title').innerText = "Confirmer la réservation";
        document.getElementById('modal-details').innerHTML = `
            Voulez-vous réserver la <strong>Place ${state.parking}</strong><br>
            le <strong>${dayData.label.replace('<br>', ' ')}</strong> de <strong>${block.label.replace('<br>', ' ')}</strong> ?<br><br>
            ${reservationCount >= 2 ? '<span style="color:var(--danger)">⚠️ Vous avez déjà atteint la limite de 2 réservations.</span>' : ''}
            ${reservationCount === 1 ? '<span style="color:var(--accent)">ℹ️ Il vous restera 0 réservation après celle-ci (limite: 2).</span>' : ''}
        `;

        // Check if slot is active right now
        const start = new Date(dayData.key);
        start.setHours(block.startHour, 0, 0, 0);
        let end = new Date(dayData.key);
        if (block.id === 'nuit') end.setDate(end.getDate() + 1);
        end.setHours(block.endHour, 0, 0, 0);
        const isCurrent = now >= start && now < end;

        document.getElementById('report-btn').style.display = isCurrent ? 'block' : 'none';

        if (reservationCount >= 2) {
            document.getElementById('confirm-btn').disabled = true;
            document.getElementById('confirm-btn').style.opacity = '0.5';
            document.getElementById('confirm-btn').style.cursor = 'not-allowed';
        } else {
            document.getElementById('confirm-btn').disabled = false;
            document.getElementById('confirm-btn').style.opacity = '1';
            document.getElementById('confirm-btn').style.cursor = 'pointer';
        }

        selectedSlotToBook = { type: 'book', slotId: slotId, day: dayData.key };
        modal.classList.add('active');
    }

    function openCancelModal(block, slotId, dayData) {
        document.getElementById('modal-title').innerText = "Annuler la réservation";
        document.getElementById('modal-details').innerHTML = `
            Voulez-vous <strong>annuler</strong> votre réservation pour la <strong>Place ${state.parking}</strong><br>
            le <strong>${dayData.label.replace('<br>', ' ')}</strong> de <strong>${block.label.replace('<br>', ' ')}</strong> ?
        `;

        // Allow reporting only if it's the current slot
        const now = new Date();
        const start = new Date(dayData.key);
        start.setHours(block.startHour, 0, 0, 0);
        let end = new Date(dayData.key);
        if (block.id === 'nuit') end.setDate(end.getDate() + 1);
        end.setHours(block.endHour, 0, 0, 0);
        const isCurrent = now >= start && now < end;

        document.getElementById('report-btn').style.display = isCurrent ? 'block' : 'none';

        document.getElementById('confirm-btn').disabled = false;
        document.getElementById('confirm-btn').style.opacity = '1';
        document.getElementById('confirm-btn').style.cursor = 'pointer';

        selectedSlotToBook = { type: 'cancel', slotId: slotId, day: dayData.key };
        modal.classList.add('active');
    }

    function openInfoModal(block, slotId, dayData, bookedBy) {
        document.getElementById('modal-title').innerText = "Détails occupation";
        document.getElementById('modal-details').innerHTML = `
            Ce créneau est réservé par l'<strong>Appartement ${bookedBy}</strong>.<br>
            Place ${state.parking}, le ${dayData.label.replace('<br>', ' ')}<br>
            Horaire : ${block.label.replace('<br>', ' ')}<br><br>
            <span style="font-size: 0.9rem;">Si vous constatez qu'un autre véhicule occupe la place sans autorisation, vous pouvez le signaler.</span>
        `;

        // Only allow reporting for the current slot
        const now = new Date();
        const start = new Date(dayData.key);
        start.setHours(block.startHour, 0, 0, 0);
        let end = new Date(dayData.key);
        if (block.id === 'nuit') end.setDate(end.getDate() + 1);
        end.setHours(block.endHour, 0, 0, 0);
        const isCurrent = now >= start && now < end;

        document.getElementById('report-btn').style.display = isCurrent ? 'block' : 'none';
        document.getElementById('confirm-btn').disabled = true;
        document.getElementById('confirm-btn').style.opacity = '0'; // Hide confirm btn, only cancel/report

        selectedSlotToBook = { type: 'info', slotId: slotId, day: dayData.key };
        modal.classList.add('active');
    }

    function countActiveReservations(apt) {
        let count = 0;
        // Look through all parkings and days for reservations by this apartment
        for (const p in reservations) {
            for (const d in reservations[p]) {
                for (const s in reservations[p][d]) {
                    if (reservations[p][d][s] === apt) count++;
                }
            }
        }
        return count;
    }

    function getDayName(dayIndex) {
        const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
        return days[dayIndex];
    }

    document.getElementById('cancel-btn').addEventListener('click', () => {
        modal.classList.remove('active');
        selectedSlotToBook = null;
    });

    document.getElementById('confirm-btn').addEventListener('click', async () => {
        if (!selectedSlotToBook) return;

        const d = selectedSlotToBook.day || state.day;

        if (!reservations[state.parking][d]) {
            reservations[state.parking][d] = {};
        }

        if (selectedSlotToBook.type === 'book') {
            reservations[state.parking][d][selectedSlotToBook.slotId] = state.apartment;
        } else if (selectedSlotToBook.type === 'cancel') {
            delete reservations[state.parking][d][selectedSlotToBook.slotId];
        }

        await saveDB(); // wait for save to complete
        modal.classList.remove('active');
        selectedSlotToBook = null;
        renderGrid();
        renderStats();
    });

    document.getElementById('report-btn').addEventListener('click', async () => {
        if (!selectedSlotToBook) return;
        const reportKey = `${selectedSlotToBook.day}_${selectedSlotToBook.slotId}_${state.parking}`;
        reports[reportKey] = {
            by: state.apartment,
            at: Date.now()
        };
        await saveDB();

        document.getElementById('modal-title').innerText = "Abus signalé";
        document.getElementById('modal-details').innerHTML = `
            <div style="border: 2px solid #dc3545; color: #dc3545; background-color: #f8d7da; padding: 15px; margin-top: 15px; font-weight: bold; font-size: 1.2em; text-align: center; border-radius: 8px;">
                Le stationnement non autorisé sur une place réservée est nuisible à l'ensemble des locataires de l'immeuble.
            </div>
        `;
        document.getElementById('report-btn').style.display = 'none';
        document.getElementById('confirm-btn').style.display = 'none';
        document.getElementById('cancel-btn').innerText = "Fermer";

        showToast("Signalement envoyé.");
        renderGrid();
    });

    // Event Listeners removed since apartment dropdown is gone

    // Active reservation tracking and penalties
    async function addPenalty(apt) {
        if (!penalties[apt]) penalties[apt] = { strikes: 0, bannedUntil: null };
        penalties[apt].strikes++;
        if (penalties[apt].strikes >= 3) {
            penalties[apt].bannedUntil = Date.now() + 7 * 24 * 60 * 60 * 1000; // ban for 1 week
            penalties[apt].strikes = 0;
        }
        await saveDB();
    }

    function checkActiveReservation() {
        const now = new Date();
        const yyyymmddNow = now.toISOString().split('T')[0];
        const currentHour = now.getHours();
        const currentMinutes = now.getMinutes();

        let activeAptRes = null;
        let activeResDetails = null;
        let requiresRender = false;

        for (const p in reservations) {
            for (const d in reservations[p]) {
                for (const s in reservations[p][d]) {
                    const apt = reservations[p][d][s];
                    const blockId = s.replace('slot_', '');

                    const blockDef = [
                        { id: 'matin', startHour: 8, endHour: 12, label: 'Matinée' },
                        { id: 'midi', startHour: 12, endHour: 14, label: 'Déjeuner' },
                        { id: 'aprem', startHour: 14, endHour: 18, label: 'Après-midi' },
                        { id: 'soir', startHour: 18, endHour: 22, label: 'Soirée' },
                        { id: 'nuit', startHour: 22, endHour: 8, label: 'Nuit' }
                    ].find(b => b.id === blockId);

                    if (!blockDef) continue; // safety

                    // Is this slot in the past?
                    let isPast = false;
                    let gracePeriodEndHour = blockDef.endHour;
                    let gracePeriodEndMin = 30;

                    const isNightBlock = blockDef.id === 'nuit';
                    let slotEndDay = new Date(d); // Default end day is same as start day

                    if (isNightBlock) {
                        slotEndDay.setDate(slotEndDay.getDate() + 1); // Night slot ends the next day
                    }

                    const yyyymmddSlotEnd = slotEndDay.toISOString().split('T')[0];

                    if (yyyymmddNow > yyyymmddSlotEnd) {
                        isPast = true; // Definitely passed the end day
                    } else if (yyyymmddNow === yyyymmddSlotEnd) {
                        if (currentHour > gracePeriodEndHour || (currentHour === gracePeriodEndHour && currentMinutes > gracePeriodEndMin)) {
                            isPast = true; // Passed end hour + grace
                        }
                    }

                    if (isPast) {
                        // Archive before deleting?
                        if (apt) {
                            logs.push({
                                apt: apt,
                                p: p,
                                day: d,
                                slot: blockDef.label,
                                status: 'Terminé (Auto)',
                                timestamp: Date.now()
                            });
                            // Keep logs manageable (last 100)
                            if (logs.length > 100) logs.shift();
                        }

                        // Penalty trigger!
                        addPenalty(apt);
                        delete reservations[p][d][s]; // Auto-clear
                        requiresRender = true;
                        continue;
                    }

                    // Is it active now? Custom block limits
                    let isActive = false;

                    // Convert current time to a continuous timestamp structure over the two days to easily compare
                    const slotStartDate = new Date(d);
                    slotStartDate.setHours(blockDef.startHour, 0, 0, 0);

                    const slotEndDate = new Date(slotEndDay);
                    slotEndDate.setHours(blockDef.endHour, gracePeriodEndMin, 0, 0); // Include 30 min grace

                    const nowFullDate = new Date();

                    if (nowFullDate >= slotStartDate && nowFullDate < slotEndDate) {
                        isActive = true;
                    }

                    if (isActive && apt === state.apartment) {
                        activeAptRes = { p, d, s };
                        activeResDetails = { blockEndHour: blockDef.endHour, slotEndDate: slotEndDate, slotLabel: blockDef.label };
                    }
                }
            }
        }

        if (requiresRender) {
            saveDB();
            renderGrid();
        }

        const banner = document.getElementById('active-reservation-banner');

        // If we opened via token, session is tied to that token

        if (activeAptRes) {
            banner.style.display = 'flex';
            // Set end to the strict block end, without the grace period, to show countdown correctly
            const endPrecise = new Date(activeResDetails.slotEndDate);
            endPrecise.setMinutes(0); // Remove the 30min grace for the visual countdown to 0

            const diff = endPrecise - now;
            const countdownEl = document.getElementById('countdown');
            if (diff > 0) {
                const h = Math.floor(diff / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const sec = Math.floor((diff % (1000 * 60)) / 1000);
                countdownEl.innerText = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
                countdownEl.style.color = 'var(--text-main)';
                document.querySelector('.active-banner h3').innerText = "Votre réservation en cours";
                document.querySelector('.active-banner h3').style.color = "var(--text-main)";
            } else {
                countdownEl.innerText = 'Temps écoulé (période de grâce)';
                countdownEl.style.color = 'var(--danger)';
                // Red warning text when late
                document.querySelector('.active-banner h3').innerText = "VOTRE RÉSERVATION EST TERMINÉE - CHECK-OUT REQUIS !";
                document.querySelector('.active-banner h3').style.color = "var(--danger)";
            }

            document.getElementById('checkout-btn').onclick = async () => {
                // Archive log
                logs.push({
                    apt: state.apartment,
                    p: activeAptRes.p,
                    day: activeAptRes.d,
                    slot: activeResDetails.slotLabel, // Need to add this to details
                    status: 'Check-out OK',
                    timestamp: Date.now()
                });
                if (logs.length > 100) logs.shift();

                delete reservations[activeAptRes.p][activeAptRes.d][activeAptRes.s];
                await saveDB();
                checkActiveReservation();
                renderGrid();
                renderStats();
            };
        } else {
            banner.style.display = 'none';
        }
    }

    // Interval to keep checking active timers every second
    setInterval(checkActiveReservation, 1000);

    // Sync database with the backend server every 2 seconds quietly so realtime users see updates
    setInterval(async () => {
        await fetchDB();
        renderGrid();
        checkActiveReservation();
        renderStats();
    }, 2000);

    function renderStats() {
        const statsGrid = document.getElementById('stats-grid');
        const historyBody = document.getElementById('history-body');
        if (!statsGrid || !historyBody) return;

        // Stats calculation
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const usage = { "1": 0, "2": 0, "3": 0, "4": 0 };
        logs.forEach(log => {
            const logDate = new Date(log.timestamp);
            if (logDate.getMonth() === thisMonth && logDate.getFullYear() === thisYear) {
                usage[log.apt] = (usage[log.apt] || 0) + 3; // Approx 3h per block
            }
        });

        statsGrid.innerHTML = '';
        [1, 2, 3, 4].forEach(apt => {
            const card = document.createElement('div');
            card.className = 'stats-card';
            card.innerHTML = `
                <span class="val">${usage[apt]}h</span>
                <span class="label">Apt ${apt}</span>
            `;
            statsGrid.innerHTML += card.outerHTML;
        });

        // History table
        historyBody.innerHTML = '';
        const sortedLogs = [...logs].reverse().slice(0, 10); // Show last 10
        sortedLogs.forEach(log => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${log.day}</td>
                <td>Place ${log.p}</td>
                <td>Apt ${log.apt}</td>
                <td>${log.slot}</td>
                <td style="color:${log.status.includes('OK') ? 'var(--success)' : 'var(--warning)'}">${log.status}</td>
            `;
            historyBody.appendChild(row);
        });
    }

    // Initial load logic
    async function initApp() {
        await fetchDB(); // get initial data

        if (trackingToken) {
            const apt = await validateToken(trackingToken);
            if (apt) {
                state.apartment = apt;
                document.querySelector('header p').innerText = `Appartement ${apt} sélectionné (via Token)`;
            } else {
                document.querySelector('header p').innerText = `Token invalide ou expiré.`;
            }
        } else {
            document.querySelector('header p').innerText = `Utilisez votre lien personnalisé pour réserver.`;
        }

        renderGrid();
        checkActiveReservation();
        renderStats();
    }

    initApp();
});

// Custom Toast Notification
function showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.innerText = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}
