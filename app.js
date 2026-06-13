document.addEventListener('DOMContentLoaded', async () => {
    let matchData = null;
    const STORAGE_KEY = 'wc2026_scores';

    const COUNTRY_CODES = {
        'South Korea': 'kr', 'Curaçao': 'cw', 'Haiti': 'ht', 'Uruguay': 'uy', 'Spain': 'es', 
        'Ecuador': 'ec', 'Ghana': 'gh', 'Mexico': 'mx', 'USA': 'us', 'Germany': 'de', 
        'Austria': 'at', 'Colombia': 'co', 'Paraguay': 'py', 'Norway': 'no', 
        'Bosnia & Herzegovina': 'ba', 'Czech Republic': 'cz', 'Turkey': 'tr', 
        'Ivory Coast': 'ci', 'Netherlands': 'nl', 'Argentina': 'ar', 'Uzbekistan': 'uz', 
        'Egypt': 'eg', 'England': 'gb-eng', 'New Zealand': 'nz', 'Algeria': 'dz', 
        'Switzerland': 'ch', 'Cape Verde': 'cv', 'Brazil': 'br', 'Senegal': 'sn', 
        'Canada': 'ca', 'Australia': 'au', 'Tunisia': 'tn', 'Belgium': 'be', 'Japan': 'jp', 
        'France': 'fr', 'Saudi Arabia': 'sa', 'South Africa': 'za', 'Iraq': 'iq', 'Iran': 'ir', 
        'Morocco': 'ma', 'Sweden': 'se', 'Jordan': 'jo', 'Portugal': 'pt', 'DR Congo': 'cd', 
        'Croatia': 'hr', 'Scotland': 'gb-sct', 'Panama': 'pa', 'Qatar': 'qa'
    };

    // ESPN uses different team names than openfootball; map ESPN names to openfootball names
    const ESPN_NAME_MAP = {
        'United States': 'USA',
        'Korea Republic': 'South Korea',
        'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
        'Côte d\'Ivoire': 'Ivory Coast',
        'Congo DR': 'DR Congo',
        'Cabo Verde': 'Cape Verde',
        'Czechia': 'Czech Republic',
        'Turkiye': 'Turkey'
    };

    function getCountryCode(teamName) {
        return COUNTRY_CODES[teamName] || 'un';
    }

    function formatTime(isoString) {
        try {
            const date = new Date(isoString);
            const formatted = new Intl.DateTimeFormat(navigator.language, {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true
            }).format(date);
            return formatted.replace(' AM', ' am').replace(' PM', ' pm');
        } catch(e) {
            return isoString;
        }
    }

    function isMatchLive(isoString) {
        const matchTime = new Date(isoString).getTime();
        const now = Date.now();
        // Assuming a match lasts roughly 110 minutes total including halftime
        return now >= matchTime && now <= matchTime + (110 * 60 * 1000);
    }

    function isMatchWatchable(isoString) {
        const matchTime = new Date(isoString).getTime();
        const now = Date.now();
        const MARGIN = 15 * 60 * 1000; // 15 minutes before/after
        return now >= matchTime - MARGIN && now <= matchTime + (110 * 60 * 1000) + MARGIN;
    }

    function getFlagHtml(code) {
        if (!code || code === 'un') return '';
        return `<img src="https://flagcdn.com/24x18/${code.toLowerCase()}.png" alt="${code}" class="flag-icon">`;
    }

    function getMatchWinnerSide(match) {
        const s1 = Number(match.score1);
        const s2 = Number(match.score2);

        if (Number.isFinite(s1) && Number.isFinite(s2) && s1 !== s2) {
            return s1 > s2 ? '1' : '2';
        }

        const penMatch = String(match.penalties || '').match(/(\d+)\s*-\s*(\d+)/);
        if (!penMatch) return null;

        const p1 = Number(penMatch[1]);
        const p2 = Number(penMatch[2]);
        if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 === p2) return null;

        return p1 > p2 ? '1' : '2';
    }

    function getLiveWatchUrl() {
        return 'https://www.yalla9live.tv/';
    }

    async function fetchInternetData() {
        const url = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json?t=' + new Date().getTime();
        const response = await fetch(url);
        const rawData = await response.json();

        let parsedData = { groups: {}, knockout: {} };
        const roundMap = {
            "Round of 32": "Round of 32",
            "Round of 16": "Round of 16",
            "Quarter-final": "Quarter-finals",
            "Semi-final": "Semi-finals",
            "Final": "Final"
        };

        rawData.matches.forEach(match => {
            // Parse Time
            let isoTime = match.date;
            if (match.time) {
                let tParts = match.time.split(' UTC');
                let tz = tParts[1] || "0";
                let offset = parseInt(tz);
                let sign = offset < 0 ? '-' : '+';
                let absOffset = Math.abs(offset);
                let tzStr = sign + (absOffset < 10 ? '0' : '') + absOffset + ':00';
                isoTime = `${match.date}T${tParts[0]}:00${tzStr}`;
            }

            let s1 = "", s2 = "", pens = "";
            if (match.score && match.score.ft) {
                s1 = match.score.ft[0];
                s2 = match.score.ft[1];
            }
            if (match.score && match.score.p) {
                pens = `${match.score.p[0]}-${match.score.p[1]} pens`;
            }

            let matchObj = {
                id: match.num || Math.floor(Math.random()*10000),
                team1: match.team1,
                team2: match.team2,
                score1: s1,
                score2: s2,
                penalties: pens,
                time: isoTime,
                stadium: match.ground || "TBD",
                code1: getCountryCode(match.team1),
                code2: getCountryCode(match.team2)
            };

            if (match.group) {
                let g = match.group.replace("Group ", "");
                if (!parsedData.groups[g]) parsedData.groups[g] = [];
                parsedData.groups[g].push(matchObj);
            } else if (roundMap[match.round]) {
                let mappedRound = roundMap[match.round];
                if (!parsedData.knockout[mappedRound]) parsedData.knockout[mappedRound] = [];
                parsedData.knockout[mappedRound].push(matchObj);
            }
        });

        // Ensure sorted by time
        for (let g in parsedData.groups) {
            parsedData.groups[g].sort((a,b) => new Date(a.time) - new Date(b.time));
        }
        for (let r in parsedData.knockout) {
            parsedData.knockout[r].sort((a,b) => a.id - b.id);
        }

        return parsedData;
    }

    async function loadData() {
        try {
            matchData = await fetchInternetData();
            
            // Fetch live scores from ESPN and overlay them
            await fetchLiveScores();
            
            renderGroups();
            renderBracket();
            renderUpcoming();
            renderStandings();

        } catch (error) {
            console.error("Error loading data:", error);
            document.getElementById('groups-container').innerHTML = `<p style="color: red; font-weight: bold; background: #fff; padding: 1rem; border-radius: 8px;">Error fetching live data: ${error.message}. Please check your internet connection.</p>`;
        }
    }

    async function fetchLiveScores() {
        try {
            const resp = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard');
            const data = await resp.json();

            for (const ev of (data.events || [])) {
                for (const comp of (ev.competitions || [])) {
                    const statusState = comp.status?.type?.state; // 'in', 'post', 'pre'
                    const statusDetail = comp.status?.type?.detail; // "61'", "FT", etc.
                    
                    // Get team names and scores from ESPN
                    let espnHome = null, espnAway = null;
                    for (const c of (comp.competitors || [])) {
                        const entry = {
                            name: c.team?.displayName || '',
                            score: c.score || '',
                            homeAway: c.homeAway
                        };
                        if (c.homeAway === 'home') espnHome = entry;
                        else espnAway = entry;
                    }
                    if (!espnHome || !espnAway) continue;

                    // Normalize ESPN names to our internal names
                    const normHome = ESPN_NAME_MAP[espnHome.name] || espnHome.name;
                    const normAway = ESPN_NAME_MAP[espnAway.name] || espnAway.name;

                    // Find matching match in our data
                    const updateMatch = (m) => {
                        if (!m) return false;
                        // ESPN: home listed first in competitor array
                        // openfootball: team1 is first listed (may be home or away)
                        if ((m.team1 === normHome && m.team2 === normAway)) {
                            if (statusState === 'in' || statusState === 'post') {
                                m.score1 = espnHome.score;
                                m.score2 = espnAway.score;
                            }
                            if (statusState === 'in') {
                                m._liveDetail = statusDetail; // e.g. "61'"
                            }
                            return true;
                        } else if ((m.team1 === normAway && m.team2 === normHome)) {
                            if (statusState === 'in' || statusState === 'post') {
                                m.score1 = espnAway.score;
                                m.score2 = espnHome.score;
                            }
                            if (statusState === 'in') {
                                m._liveDetail = statusDetail;
                            }
                            return true;
                        }
                        return false;
                    };

                    let found = false;
                    for (const g in matchData.groups) {
                        for (const m of matchData.groups[g]) {
                            if (updateMatch(m)) { found = true; break; }
                        }
                        if (found) break;
                    }
                    if (!found) {
                        for (const r in matchData.knockout) {
                            for (const m of matchData.knockout[r]) {
                                if (updateMatch(m)) { found = true; break; }
                            }
                            if (found) break;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('ESPN live scores unavailable:', e.message);
        }
    }

    function saveScore(matchId, s1, s2, pens = null) {
        // Find match in memory and update it dynamically
        for (const group in matchData.groups) {
            const m = matchData.groups[group].find(x => x.id == matchId);
            if(m) {
                m.score1 = s1; m.score2 = s2;
                return renderStandings();
            }
        }
        for (const round in matchData.knockout) {
            const m = matchData.knockout[round].find(x => x.id == matchId);
            if(m) {
                m.score1 = s1; m.score2 = s2;
                if(pens !== null) m.penalties = pens;
                return;
            }
        }
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
                const isLive = match._liveDetail || isMatchLive(match.time);
                const winnerSide = getMatchWinnerSide(match);
                
                row.className = `match-row hover-target ${isLive ? 'live-match' : ''} ${(!isLive && match.score1 !== '' && match.score2 !== '') ? 'completed-match' : ''}`;
                row.id = `match-${match.id}`;

                const liveText = match._liveDetail || 'LIVE';
                const liveBadge = isLive ? `<div class="live-badge">${liveText} <span class="pulsing-dot"></span></div>` : '';

                const watchable = isMatchWatchable(match.time);
                const watchBtn = watchable ? `<a href="${getLiveWatchUrl(match)}" target="_blank" class="live-watch-btn" onclick="event.stopPropagation()">▶ Live</a>` : '';

                row.innerHTML = `
                    ${liveBadge}
                    <div class="match-teams">
                        <div class="team ${winnerSide === '1' ? 'winner' : ''}">${getFlagHtml(match.code1)}<span class="team-name">${match.team1}</span></div>
                        <div class="score-box">
                            <input type="number" class="score-input" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                            <span>-</span>
                            <input type="number" class="score-input" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                        </div>
                        <div class="team right ${winnerSide === '2' ? 'winner' : ''}"><span class="team-name">${match.team2}</span>${getFlagHtml(match.code2)}</div>
                    </div>
                    ${watchBtn}
                    <div class="match-time-label">${formatTime(match.time)}</div>
                    <div class="match-details">Stadium: ${match.stadium}</div>
                `;
                groupCard.appendChild(row);
            });

            container.appendChild(groupCard);
        }
    }

    function createKnockoutMatchHtml(match, isFinal = false) {
        if(!match) return ''; // Safety check if data is incomplete
        const isLive = match._liveDetail || isMatchLive(match.time);
        const winnerSide = getMatchWinnerSide(match);
        const liveText = match._liveDetail || 'LIVE';
        const liveBadge = isLive ? `<div class="live-badge" style="top: -15px; right: -5px;">${liveText} <span class="pulsing-dot"></span></div>` : '';
        let pensInput = isFinal || match.id > 72 ? `<input type="text" class="penalties-input" data-id="${match.id}" placeholder="" value="${match.penalties || ''}">` : '';
        const watchable = isMatchWatchable(match.time);
        const watchBtn = watchable ? `<a href="${getLiveWatchUrl(match)}" target="_blank" class="live-watch-btn" onclick="event.stopPropagation()">▶ Live</a>` : '';

        return `
            <div id="match-${match.id}" class="knockout-match hover-target ${isFinal ? 'final-match' : ''} ${isLive ? 'live-match' : ''} ${(!isLive && match.score1 !== '' && match.score2 !== '') ? 'completed-match' : ''}">
                ${liveBadge}
                ${isFinal ? '<div class="final-label">Final</div>' : ''}
                <div class="match-time-label ko-time">${formatTime(match.time)}</div>
                <div class="ko-team-row ${winnerSide === '1' ? 'winner' : ''}">
                    <span class="ko-team" title="${match.team1}">${getFlagHtml(match.code1)}${match.team1}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                </div>
                <div class="ko-team-row ${winnerSide === '2' ? 'winner' : ''}">
                    <span class="ko-team" title="${match.team2}">${getFlagHtml(match.code2)}${match.team2}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                </div>
                ${pensInput}
                ${watchBtn}
                <div class="match-details">Stadium: ${match.stadium}</div>
            </div>
        `;
    }

    function renderBracket() {
        const container = document.getElementById('bracket-container');
        container.innerHTML = '';

        const stages = {
            r32: matchData.knockout["Round of 32"] || [],
            r16: matchData.knockout["Round of 16"] || [],
            qf: matchData.knockout["Quarter-finals"] || [],
            sf: matchData.knockout["Semi-finals"] || [],
            final: matchData.knockout["Final"] ? matchData.knockout["Final"][0] : null
        };

        const renderCol = (matches, align) => {
            const col = document.createElement('div');
            col.className = 'bracket-column ' + align;
            
            for(let i=0; i<matches.length; i+=2) {
                if (i+1 < matches.length) {
                    const pair = document.createElement('div');
                    pair.className = 'match-pair';
                    pair.innerHTML = createKnockoutMatchHtml(matches[i]) + createKnockoutMatchHtml(matches[i+1]);
                    col.appendChild(pair);
                } else {
                    const single = document.createElement('div');
                    single.className = 'match-single';
                    single.innerHTML = createKnockoutMatchHtml(matches[i]);
                    col.appendChild(single);
                }
            }
            return col;
        };

        // Left Bracket
        container.appendChild(renderCol(stages.r32.slice(0, 8), 'left-col'));
        container.appendChild(renderCol(stages.r16.slice(0, 4), 'left-col'));
        container.appendChild(renderCol(stages.qf.slice(0, 2), 'left-col'));
        container.appendChild(renderCol([stages.sf[0]], 'left-col'));

        // Center Final
        const centerCol = document.createElement('div');
        centerCol.className = 'bracket-column col-center';
        if(stages.final) centerCol.innerHTML = createKnockoutMatchHtml(stages.final, true);
        container.appendChild(centerCol);

        // Right Bracket
        container.appendChild(renderCol([stages.sf[1]], 'right-col'));
        container.appendChild(renderCol(stages.qf.slice(2, 4), 'right-col'));
        container.appendChild(renderCol(stages.r16.slice(4, 8), 'right-col'));
        container.appendChild(renderCol(stages.r32.slice(8, 16), 'right-col'));
    }

    function renderUpcoming() {
        const container = document.getElementById('upcoming-container');
        if (!container) return;
        container.innerHTML = '';

        let allMatches = [];
        for (const g in matchData.groups) allMatches.push(...matchData.groups[g]);
        for (const r in matchData.knockout) allMatches.push(...matchData.knockout[r]);

        // Filter out completed matches (assuming ~2 hours duration)
        const now = Date.now() - 2 * 60 * 60 * 1000; 
        const futureMatches = allMatches.filter(m => new Date(m.time).getTime() > now);
        
        // Sort chronologically
        futureMatches.sort((a,b) => new Date(a.time) - new Date(b.time));

        const next5 = futureMatches.slice(0, 5);

        if (next5.length === 0) {
            document.getElementById('upcoming-matches-section').style.display = 'none';
            return;
        }

        next5.forEach(match => {
            const card = document.createElement('div');
            const isLive = match._liveDetail || isMatchLive(match.time);
            card.className = `upcoming-card ${isLive ? 'live-match' : ''}`;
            card.style.position = 'relative';
            card.onclick = () => window.scrollToMatch(match.id);
            
            const team1Display = getFlagHtml(match.code1) || `<span style="font-size: 0.85rem">${match.team1}</span>`;
            const team2Display = getFlagHtml(match.code2) || `<span style="font-size: 0.85rem">${match.team2}</span>`;
            const liveText = match._liveDetail || 'LIVE';
            const liveBadge = isLive ? `<div class="live-badge">${liveText} <span class="pulsing-dot"></span></div>` : '';
            const scoreDisplay = (isLive && match.score1 !== '' && match.score2 !== '') 
                ? `<div style="font-size: 1.1rem; font-weight: 800; color: var(--primary);">${match.score1} - ${match.score2}</div>` 
                : '';

            const watchable = isMatchWatchable(match.time);
            const watchBtn = watchable ? `<a href="${getLiveWatchUrl(match)}" target="_blank" class="live-watch-btn" onclick="event.stopPropagation()">▶ Live</a>` : '';

            card.innerHTML = `
                ${liveBadge}
                <div class="upcoming-flags">
                    ${team1Display} vs. ${team2Display}
                </div>
                ${scoreDisplay}
                ${watchBtn}
                <div class="upcoming-time">${formatTime(match.time)}</div>
            `;
            container.appendChild(card);
        });
    }

    window.scrollToMatch = function(id) {
        const el = document.getElementById(`match-${id}`);
        if(el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            el.classList.add('highlight-match');
            setTimeout(() => el.classList.remove('highlight-match'), 1500);
        }
    };

    function renderStandings() {
        const container = document.getElementById('standings-container');
        container.innerHTML = '';

        for (const [groupName, matches] of Object.entries(matchData.groups)) {
            const teamsMap = {};
            
            matches.forEach(m => {
                if(!teamsMap[m.team1]) teamsMap[m.team1] = { name: m.team1, code: m.code1, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
                if(!teamsMap[m.team2]) teamsMap[m.team2] = { name: m.team2, code: m.code2, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
            });

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

            let teamList = Object.values(teamsMap);
            teamList.forEach(t => t.gd = t.gf - t.ga);
            
            teamList.sort((a, b) => {
                if(b.pts !== a.pts) return b.pts - a.pts; 
                if(b.gd !== a.gd) return b.gd - a.gd;    
                return b.gf - a.gf;                      
            });

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

    loadData();
    
    // Auto-refresh live scores every 30 seconds
    setInterval(() => {
        loadData();
    }, 30000);
});
