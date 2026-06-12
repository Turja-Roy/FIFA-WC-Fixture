document.addEventListener('DOMContentLoaded', async () => {
    let matchData = null;
    const STORAGE_KEY = 'wc2026_scores';

    function formatTime(isoString) {
        const date = new Date(isoString);
        return new Intl.DateTimeFormat(navigator.language, {
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        }).format(date);
    }

    function getFlagHtml(code) {
        if (!code || code === 'un') return '';
        return `<img src="https://flagcdn.com/24x18/${code.toLowerCase()}.png" alt="${code}" class="flag-icon">`;
    }

    async function fetchInternetData() {
        // Simulating an internet fetch by grabbing data.json with a cache buster
        const response = await fetch('data.json?t=' + new Date().getTime());
        return await response.json();
    }

    async function loadData() {
        try {
            matchData = await fetchInternetData();
            
            const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            
            // Merge groups
            for (const group in matchData.groups) {
                matchData.groups[group].forEach(match => {
                    if (savedData[match.id]) {
                        match.score1 = savedData[match.id].score1;
                        match.score2 = savedData[match.id].score2;
                    }
                });
            }

            // Merge knockouts
            for (const stage in matchData.knockout) {
                matchData.knockout[stage].forEach(match => {
                    if (savedData[match.id]) {
                        match.score1 = savedData[match.id].score1;
                        match.score2 = savedData[match.id].score2;
                        if (savedData[match.id].penalties !== undefined) {
                            match.penalties = savedData[match.id].penalties;
                        }
                    }
                });
            }

            renderGroups();
            renderBracket();
            renderStandings();
            setupTooltips();

        } catch (error) {
            console.error("Error loading data:", error);
            document.getElementById('groups-container').innerHTML = '<p>Error loading match data.</p>';
        }
    }

    function saveScore(matchId, s1, s2, pens = null) {
        const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (!savedData[matchId]) savedData[matchId] = {};
        savedData[matchId].score1 = s1;
        savedData[matchId].score2 = s2;
        if (pens !== null) {
            savedData[matchId].penalties = pens;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedData));
        
        // Update in-memory data for standings calculation
        for (const group in matchData.groups) {
            const m = matchData.groups[group].find(x => x.id == matchId);
            if(m) {
                m.score1 = s1; m.score2 = s2;
            }
        }
        renderStandings();
    }

    function renderGroups() {
        const container = document.getElementById('groups-container');
        container.innerHTML = '';

        for (const [groupName, matches] of Object.entries(matchData.groups)) {
            const groupCard = document.createElement('div');
            groupCard.className = 'group-card';
            
            const title = document.createElement('h3');
            title.className = 'group-title';
            title.textContent = `Group ${groupName}`;
            groupCard.appendChild(title);

            matches.forEach(match => {
                const row = document.createElement('div');
                row.className = 'match-row hover-target';
                row.dataset.info = `Kickoff: ${formatTime(match.time)}\nStadium: ${match.stadium}`;

                row.innerHTML = `
                    <div class="team">${getFlagHtml(match.code1)}${match.team1}</div>
                    <div class="score-box">
                        <input type="number" class="score-input" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                        <span>-</span>
                        <input type="number" class="score-input" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                    </div>
                    <div class="team right">${match.team2}${getFlagHtml(match.code2)}</div>
                `;
                groupCard.appendChild(row);
            });

            container.appendChild(groupCard);
        }
    }

    function createKnockoutMatchHtml(match, isFinal = false) {
        let pensInput = isFinal || match.id > 72 ? `<input type="text" class="penalties-input" data-id="${match.id}" placeholder="e.g. 4-3 pens" value="${match.penalties || ''}">` : '';
        return `
            <div class="knockout-match hover-target ${isFinal ? 'final-match' : ''}" data-info="Kickoff: ${formatTime(match.time)}\nStadium: ${match.stadium}">
                ${isFinal ? '<div class="final-label">Final</div>' : ''}
                <div class="ko-team-row">
                    <span class="ko-team">${getFlagHtml(match.code1)}${match.team1}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                </div>
                <div class="ko-team-row">
                    <span class="ko-team">${getFlagHtml(match.code2)}${match.team2}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                </div>
                ${pensInput}
            </div>
        `;
    }

    function renderBracket() {
        const container = document.getElementById('bracket-container');
        container.innerHTML = '';

        const stages = {
            r32: matchData.knockout["Round of 32"],
            r16: matchData.knockout["Round of 16"],
            qf: matchData.knockout["Quarter-finals"],
            sf: matchData.knockout["Semi-finals"],
            final: matchData.knockout["Final"][0]
        };

        const renderCol = (matches) => {
            const col = document.createElement('div');
            col.className = 'bracket-column';
            matches.forEach(m => {
                col.innerHTML += createKnockoutMatchHtml(m);
            });
            return col;
        };

        // Left Bracket
        container.appendChild(renderCol(stages.r32.slice(0, 8)));
        container.appendChild(renderCol(stages.r16.slice(0, 4)));
        container.appendChild(renderCol(stages.qf.slice(0, 2)));
        container.appendChild(renderCol([stages.sf[0]]));

        // Center Final
        const centerCol = document.createElement('div');
        centerCol.className = 'bracket-column col-center';
        centerCol.innerHTML = createKnockoutMatchHtml(stages.final, true);
        container.appendChild(centerCol);

        // Right Bracket
        container.appendChild(renderCol([stages.sf[1]]));
        container.appendChild(renderCol(stages.qf.slice(2, 4)));
        container.appendChild(renderCol(stages.r16.slice(4, 8)));
        container.appendChild(renderCol(stages.r32.slice(8, 16)));
    }

    function renderStandings() {
        const container = document.getElementById('standings-container');
        container.innerHTML = '';

        for (const [groupName, matches] of Object.entries(matchData.groups)) {
            // Build stats table for the group
            const teamsMap = {};
            
            // Initialize teams
            matches.forEach(m => {
                if(!teamsMap[m.team1]) teamsMap[m.team1] = { name: m.team1, code: m.code1, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
                if(!teamsMap[m.team2]) teamsMap[m.team2] = { name: m.team2, code: m.code2, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
            });

            // Calculate stats
            matches.forEach(m => {
                if (m.score1 !== "" && m.score2 !== "") {
                    const s1 = parseInt(m.score1) || 0;
                    const s2 = parseInt(m.score2) || 0;
                    
                    teamsMap[m.team1].p++;
                    teamsMap[m.team2].p++;
                    teamsMap[m.team1].gf += s1;
                    teamsMap[m.team2].gf += s2;
                    teamsMap[m.team1].ga += s2;
                    teamsMap[m.team2].ga += s1;
                    
                    if (s1 > s2) {
                        teamsMap[m.team1].w++;
                        teamsMap[m.team1].pts += 3;
                        teamsMap[m.team2].l++;
                    } else if (s1 < s2) {
                        teamsMap[m.team2].w++;
                        teamsMap[m.team2].pts += 3;
                        teamsMap[m.team1].l++;
                    } else {
                        teamsMap[m.team1].d++;
                        teamsMap[m.team1].pts += 1;
                        teamsMap[m.team2].d++;
                        teamsMap[m.team2].pts += 1;
                    }
                }
            });

            // Calculate GD and sort
            let teamList = Object.values(teamsMap);
            teamList.forEach(t => t.gd = t.gf - t.ga);
            
            teamList.sort((a, b) => {
                if(b.pts !== a.pts) return b.pts - a.pts; // Points
                if(b.gd !== a.gd) return b.gd - a.gd;    // Goal Difference
                return b.gf - a.gf;                      // Goals For
            });

            // Create HTML
            const groupCard = document.createElement('div');
            groupCard.className = 'group-card';
            
            let html = `<h3 class="group-title">Group ${groupName}</h3>`;
            html += `<table class="standings-table">
                <thead>
                    <tr>
                        <th style="text-align: left;">Team</th>
                        <th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
                    </tr>
                </thead>
                <tbody>`;
            
            teamList.forEach(t => {
                html += `
                    <tr>
                        <td class="team-cell">${getFlagHtml(t.code)} ${t.name}</td>
                        <td>${t.p}</td>
                        <td>${t.w}</td>
                        <td>${t.d}</td>
                        <td>${t.l}</td>
                        <td>${t.gf}</td>
                        <td>${t.ga}</td>
                        <td>${t.gd > 0 ? '+'+t.gd : t.gd}</td>
                        <td><strong>${t.pts}</strong></td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
            
            groupCard.innerHTML = html;
            container.appendChild(groupCard);
        }
    }

    function setupTooltips() {
        const tooltip = document.getElementById('tooltip');
        
        document.body.addEventListener('mousemove', e => {
            const target = e.target.closest('.hover-target');
            if (target) {
                // If it's updating, don't show tooltips
                if(document.getElementById('update-btn').classList.contains('updating')) return;

                tooltip.textContent = target.dataset.info;
                tooltip.classList.remove('hidden');
                
                let top = e.pageY + 15;
                let left = e.pageX + 15;
                
                if (left + tooltip.offsetWidth > window.innerWidth) {
                    left = e.pageX - tooltip.offsetWidth - 15;
                }
                
                tooltip.style.top = top + 'px';
                tooltip.style.left = left + 'px';
            } else {
                tooltip.classList.add('hidden');
            }
        });
    }

    document.body.addEventListener('input', e => {
        if (e.target.classList.contains('score-input')) {
            const matchId = e.target.dataset.id;
            const parent = e.target.closest('.match-row') || e.target.closest('.knockout-match');
            const inputs = parent.querySelectorAll('.score-input');
            const pensInput = parent.querySelector('.penalties-input');
            
            const s1 = inputs[0].value;
            const s2 = inputs[1].value;
            const pens = pensInput ? pensInput.value : null;

            saveScore(matchId, s1, s2, pens);
        }

        if (e.target.classList.contains('penalties-input')) {
            const matchId = e.target.dataset.id;
            const parent = e.target.closest('.knockout-match');
            const inputs = parent.querySelectorAll('.score-input');
            
            const s1 = inputs[0].value;
            const s2 = inputs[1].value;
            const pens = e.target.value;

            saveScore(matchId, s1, s2, pens);
        }
    });

    document.getElementById('update-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.classList.add('updating');
        btn.textContent = 'Fetching...';
        
        try {
            // Fetch live data (simulated with local fetch + cache buster here, but behaves identically)
            matchData = await fetchInternetData();
            
            // Clear local storage because we are fetching the true live results from the internet
            localStorage.removeItem(STORAGE_KEY);
            
            renderGroups();
            renderBracket();
            renderStandings();
            
            btn.textContent = 'Updated!';
            setTimeout(() => {
                btn.textContent = 'Update Results';
            }, 2000);
        } catch(err) {
            alert('Failed to fetch from internet. Check connection.');
            btn.textContent = 'Update Results';
        } finally {
            btn.classList.remove('updating');
        }
    });

    loadData();
});
