document.addEventListener('DOMContentLoaded', async () => {
    let matchData = null;
    let originalMatchData = null;
    let predictMode = false;
    const STORAGE_KEY = 'wc2026_scores';

    // Cloud-prediction state (declared early: renderAll runs at init, before
    // the cloud section below, and refreshPredictionViews reads these).
    const sb = window.sb || null;
    let cloudUser = null;        // { id, nickname }
    let othersPredictions = [];  // [{ user_id, nickname, match_num, score1, score2, pens1, pens2 }]

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
        'Turkiye': 'Turkey',
        'Türkiye': 'Turkey'
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

    function getMatchStatus(match) {
        if (match._espnStatusState === 'in' || isMatchLive(match.time)) return 'live';
        if (match._espnStatusState === 'post' || (match.score1 !== '' && match.score2 !== '')) return 'completed';
        return 'upcoming';
    }

    function getMatchCity(match) {
        const s = match.stadium || '';
        const parts = s.split(',').map(p => p.trim());
        return parts[parts.length - 1] || s;
    }

    function getCityFromStadium(stadium) {
        if (!stadium) return 'TBD';
        const parts = stadium.split(',').map(p => p.trim());
        return parts[parts.length - 1] || stadium;
    }

    function formatGoalScorer(goal) {
        let suffix = '';
        if (goal.owngoal) suffix = ' (OG)';
        else if (goal.penalty) suffix = ' (P)';
        return `${goal.name} ${goal.minute}'${suffix}`;
    }

    function getGoalsHtml(match) {
        const goals = [];
        if (match.goals1 && match.goals1.length) {
            match.goals1.forEach(g => goals.push(`<span class="goal-scorer team1-goal">${getFlagHtml(match.code1)} ${formatGoalScorer(g)}</span>`));
        }
        if (match.goals2 && match.goals2.length) {
            match.goals2.forEach(g => goals.push(`<span class="goal-scorer team2-goal">${getFlagHtml(match.code2)} ${formatGoalScorer(g)}</span>`));
        }
        return goals;
    }

    function isMatchFinished(match) {
        return getMatchStatus(match) === 'completed';
    }

    // Stable, deterministic id for matches the source ships without a `num`
    // (group stage — 72 of 104). Derived from date + teams so it stays the
    // same across reloads and users, which published predictions rely on.
    // Offset above the 1..104 num space; stays within int4 range.
    function stableMatchId(match) {
        const key = (match.date || '') + '|' + (match.team1 || '') + '|' + (match.team2 || '') + '|' + (match.round || '');
        let h = 5381;
        for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
        return 1000000 + (Math.abs(h) % 2000000000);
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
                id: match.num || stableMatchId(match),
                team1: match.team1,
                team2: match.team2,
                score1: s1,
                score2: s2,
                penalties: pens,
                time: isoTime,
                stadium: match.ground || "TBD",
                code1: getCountryCode(match.team1),
                code2: getCountryCode(match.team2),
                goals1: match.goals1 || [],
                goals2: match.goals2 || [],
                htScore: match.score && match.score.ht ? match.score.ht : null,
                round: match.round || null,
                group: match.group || null
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
            await fetchLiveScores();
            originalMatchData = JSON.parse(JSON.stringify(matchData));
        } catch (error) {
            console.error("Error loading data:", error);
            document.getElementById('groups-container').innerHTML = `<p style="color: red; font-weight: bold; background: #fff; padding: 1rem; border-radius: 8px;">Error fetching live data: ${error.message}. Please check your internet connection.</p>`;
            throw error;
        }
    }

    function renderAll() {
        renderGroups();
        renderBracket();
        renderUpcoming();
        renderStandings();
        applyPredictMode();
        if (typeof refreshPredictionViews === 'function') refreshPredictionViews();
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
                            id: c.id,
                            name: c.team?.displayName || '',
                            score: c.score || '',
                            homeAway: c.homeAway,
                            statistics: c.statistics || []
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
                            m._espnEventId = ev.id;
                            m._espnStatusState = statusState;
                            m._espnDetails = comp.details || [];
                            m._espnStats = {
                                home: espnHome.statistics,
                                away: espnAway.statistics
                            };
                            m._espnVenue = comp.venue || null;
                            m._espnAttendance = comp.attendance || 0;
                            m._espnHeadline = (comp.headlines && comp.headlines[0]) ? comp.headlines[0] : null;
                            m._espnBroadcasts = comp.broadcasts || null;
                            m._espnHomeName = normHome;
                            m._espnAwayName = normAway;
                            if (statusState === 'in' || statusState === 'post') {
                                m.score1 = espnHome.score;
                                m.score2 = espnAway.score;
                                const parsed = parseEspnGoals(m._espnDetails, espnHome.id, espnAway.id);
                                m.goals1 = parsed[0];
                                m.goals2 = parsed[1];
                            }
                            if (statusState === 'in') {
                                m._liveDetail = statusDetail; // e.g. "61'"
                            }
                            return true;
                        } else if ((m.team1 === normAway && m.team2 === normHome)) {
                            m._espnEventId = ev.id;
                            m._espnStatusState = statusState;
                            m._espnDetails = comp.details || [];
                            m._espnStats = {
                                home: espnHome.statistics,
                                away: espnAway.statistics
                            };
                            m._espnVenue = comp.venue || null;
                            m._espnAttendance = comp.attendance || 0;
                            m._espnHeadline = (comp.headlines && comp.headlines[0]) ? comp.headlines[0] : null;
                            m._espnBroadcasts = comp.broadcasts || null;
                            m._espnHomeName = normHome;
                            m._espnAwayName = normAway;
                            if (statusState === 'in' || statusState === 'post') {
                                m.score1 = espnAway.score;
                                m.score2 = espnHome.score;
                                const parsed = parseEspnGoals(m._espnDetails, espnAway.id, espnHome.id);
                                m.goals1 = parsed[0];
                                m.goals2 = parsed[1];
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

    function parseEspnGoals(details, team1Id, team2Id) {
        const g1 = [], g2 = [];
        for (const d of (details || [])) {
            if (!d.scoringPlay) continue;
            const player = d.athletesInvolved && d.athletesInvolved[0]
                ? d.athletesInvolved[0].displayName
                : 'Unknown';
            const minute = (d.clock && d.clock.displayValue || '').replace("'", '');
            const goal = {
                name: player,
                minute,
                owngoal: !!d.ownGoal,
                penalty: !!d.penaltyKick
            };
            const tid = d.team && d.team.id;
            if (!!d.ownGoal) {
                if (tid == team1Id) g2.push(goal);
                else if (tid == team2Id) g1.push(goal);
            } else {
                if (tid == team1Id) g1.push(goal);
                else if (tid == team2Id) g2.push(goal);
            }
        }
        return [g1, g2];
    }

    function computeGroupStandings(groupName) {
        const matches = matchData.groups[groupName] || [];
        const teamsMap = {};
        matches.forEach(m => {
            if (!teamsMap[m.team1]) teamsMap[m.team1] = { name: m.team1, code: m.code1, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
            if (!teamsMap[m.team2]) teamsMap[m.team2] = { name: m.team2, code: m.code2, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
        });
        matches.forEach(m => {
            if (m.score1 !== '' && m.score2 !== '') {
                const s1 = parseInt(m.score1) || 0;
                const s2 = parseInt(m.score2) || 0;
                teamsMap[m.team1].p++; teamsMap[m.team2].p++;
                teamsMap[m.team1].gf += s1; teamsMap[m.team2].gf += s2;
                teamsMap[m.team1].ga += s2; teamsMap[m.team2].ga += s1;
                if (s1 > s2) { teamsMap[m.team1].w++; teamsMap[m.team1].pts += 3; teamsMap[m.team2].l++; }
                else if (s1 < s2) { teamsMap[m.team2].w++; teamsMap[m.team2].pts += 3; teamsMap[m.team1].l++; }
                else { teamsMap[m.team1].d++; teamsMap[m.team1].pts += 1; teamsMap[m.team2].d++; teamsMap[m.team2].pts += 1; }
            }
        });
        let teamList = Object.values(teamsMap);
        teamList.forEach(t => t.gd = t.gf - t.ga);
        teamList.sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            if (b.gd !== a.gd) return b.gd - a.gd;
            if (b.gf !== a.gf) return b.gf - a.gf;
            return a.name.localeCompare(b.name);
        });
        return teamList;
    }

    function isGroupComplete(groupName) {
        return (matchData.groups[groupName] || []).every(m => m.score1 !== '' && m.score2 !== '');
    }

    function resolveBracketPosition(pos) {
        const m = pos.match(/^(\d)([A-Z](?:\/[A-Z])*)$/);
        if (!m) return null;
        const position = parseInt(m[1]);
        const groups = m[2].split('/');
        for (const group of groups) {
            const standings = computeGroupStandings(group);
            const team = standings[position - 1];
            if (team) {
                return { name: team.name, code: team.code, group, incomplete: !isGroupComplete(group) };
            }
        }
        return null;
    }

    const PREDICT_CACHE_KEY = 'wc26_predict_cache';
    const predictModifiedIds = new Set();

    function persistPredictData() {
        try {
            if (predictModifiedIds.size === 0) return;
            let cache = {};
            const existing = localStorage.getItem(PREDICT_CACHE_KEY);
            if (existing) { try { cache = JSON.parse(existing); } catch (e) { cache = {}; } }

            for (const rawId of predictModifiedIds) {
                const key = String(rawId);
                let found = false;

                for (const g in matchData.groups) {
                    for (const m of matchData.groups[g]) {
                        if (String(m.id) === key) {
                            cache[key] = { score1: m.score1, score2: m.score2 };
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }

                if (!found) {
                    for (const r in matchData.knockout) {
                        for (const m of matchData.knockout[r]) {
                            if (String(m.id) === key) {
                                cache[key] = { score1: m.score1, score2: m.score2, penalties: m.penalties || '' };
                                found = true;
                                break;
                            }
                        }
                        if (found) break;
                    }
                }

                if (!found) {
                    console.warn('persistPredictData: match', key, 'not found in matchData');
                }
            }

            localStorage.setItem(PREDICT_CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.error('persistPredictData error', e);
        }
    }

    function restorePredictData() {
        try {
            const raw = localStorage.getItem(PREDICT_CACHE_KEY);
            if (!raw) { console.warn('restorePredictData: no cache in localStorage'); return; }
            const cache = JSON.parse(raw);
            let restoreCount = 0;
            const cacheKeys = Object.keys(cache);
            console.log('restorePredictData: cache keys count', cacheKeys.length, 'sample', cacheKeys.slice(0, 3));

            for (const g in matchData.groups) {
                for (const m of matchData.groups[g]) {
                    const c = cache[String(m.id)];
                    if (c && (c.score1 !== '' || c.score2 !== '')) {
                        m.score1 = c.score1; m.score2 = c.score2;
                        restoreCount++;
                    }
                }
            }
            for (const r in matchData.knockout) {
                for (const m of matchData.knockout[r]) {
                    const c = cache[String(m.id)];
                    if (c && (c.score1 !== '' || c.score2 !== '')) {
                        m.score1 = c.score1; m.score2 = c.score2;
                        if (c.penalties) m.penalties = c.penalties;
                        restoreCount++;
                    }
                }
            }

            console.log('restorePredictData: restored', restoreCount, 'matches');
        } catch (e) {
            console.error('restorePredictData error', e);
        }
    }

    function clearPredictCache() {
        predictModifiedIds.clear();
        localStorage.removeItem(PREDICT_CACHE_KEY);
    }

    function saveScore(matchId, s1, s2, pens = null) {
        for (const group in matchData.groups) {
            const m = matchData.groups[group].find(x => x.id == matchId);
            if (m) {
                m.score1 = s1; m.score2 = s2;
                predictModifiedIds.add(matchId);
                persistPredictData();
                return 'group';
            }
        }
        for (const round in matchData.knockout) {
            const m = matchData.knockout[round].find(x => x.id == matchId);
            if (m) {
                m.score1 = s1; m.score2 = s2;
                if (pens !== null) m.penalties = pens;
                predictModifiedIds.add(matchId);
                persistPredictData();
                return 'knockout';
            }
        }
        return null;
    }

    let bracketRenderTimer = null;
    function deferBracketRender() {
        if (bracketRenderTimer) clearTimeout(bracketRenderTimer);
        bracketRenderTimer = setTimeout(() => { bracketRenderTimer = null; renderBracket(); }, 300);
    }

    function getKnockoutWinner(match) {
        const s1 = parseInt(match.score1);
        const s2 = parseInt(match.score2);
        if (isNaN(s1) || isNaN(s2)) return null;

        function resolve(team, code) {
            const r = resolveBracketPosition(team);
            return r ? { name: r.name, code: r.code } : { name: team, code: code };
        }

        if (s1 > s2) return resolve(match.team1, match.code1);
        if (s2 > s1) return resolve(match.team2, match.code2);
        if (match.penalties) {
            const parts = match.penalties.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (parts) {
                const p1 = parseInt(parts[1]), p2 = parseInt(parts[2]);
                if (p1 > p2) return resolve(match.team1, match.code1);
                if (p2 > p1) return resolve(match.team2, match.code2);
            }
        }
        return null;
    }

    function applyPredictMode() {
        const inputs = document.querySelectorAll('.score-input, .penalties-input');
        inputs.forEach(inp => {
            if (predictMode) {
                inp.removeAttribute('readonly');
            } else {
                inp.setAttribute('readonly', '');
            }
        });
        const btn = document.getElementById('predict-toggle');
        if (btn) {
            btn.textContent = predictMode ? '🔮 Predict Mode: ON' : '🔮 Predict Mode: OFF';
            btn.classList.toggle('active', predictMode);
        }
        const publishBtn = document.getElementById('predict-publish');
        if (publishBtn) publishBtn.classList.toggle('hidden', !predictMode);
    }

    function renderGroups() {
        const container = document.getElementById('groups-container');
        container.innerHTML = '';

        const sortedGroups = Object.entries(matchData.groups).sort(([a], [b]) => a.localeCompare(b));
        for (const [groupName, matches] of sortedGroups) {
            const groupCard = document.createElement('div');
            groupCard.className = 'group-card';
            groupCard.dataset.group = groupName;

            const title = document.createElement('h3');
            title.className = 'group-title';
            title.textContent = `Group ${groupName}`;
            groupCard.appendChild(title);

            matches.forEach(match => {
                const row = document.createElement('div');
                const status = getMatchStatus(match);
                const isLive = status === 'live';
                const winnerSide = getMatchWinnerSide(match);
                const showResult = isLive || status === 'completed';

                row.className = `match-row hover-target ${isLive ? 'live-match' : ''} ${status === 'completed' ? 'completed-match' : ''}`;
                row.id = `match-${match.id}`;
                row.dataset.matchId = match.id;
                row.dataset.team1 = match.team1;
                row.dataset.team2 = match.team2;
                row.dataset.stadium = match.stadium;
                row.dataset.city = getCityFromStadium(match.stadium);
                row.dataset.group = groupName;
                row.dataset.stage = 'Group Stage';
                row.dataset.status = status;
                row.dataset.time = match.time;

                const liveText = match._liveDetail || 'LIVE';
                const liveBadge = isLive ? `<div class="live-badge">${liveText} <span class="pulsing-dot"></span></div>` : '';

                const watchable = isMatchWatchable(match.time);
                const watchBtn = watchable ? `<a href="${getLiveWatchUrl(match)}" target="_blank" class="live-watch-btn" onclick="event.stopPropagation()">▶ Live</a>` : '';

                const goalList = getGoalsHtml(match);
                const goalsHtml = goalList.length ? `<div class="match-goals">${goalList.map(g => `<div class="goal-entry">⚽ ${g}</div>`).join('')}</div>` : '';
                const showInfoBtn = isMatchFinished(match) || isLive;
                const infoBtn = showInfoBtn ? `<button class="match-info-btn" data-match-id="${match.id}" title="Match details">ℹ Stats</button>` : '';

                row.innerHTML = `
                    ${liveBadge}
                    <div class="match-teams">
                        <div class="team ${showResult ? (winnerSide === '1' ? 'winner' : winnerSide === '2' ? 'loser' : 'draw') : ''}">${getFlagHtml(match.code1)}<span class="team-name">${match.team1}</span></div>
                        <div class="score-box">
                            <input type="number" class="score-input" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                            <span>-</span>
                            <input type="number" class="score-input" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                        </div>
                        <div class="team right ${showResult ? (winnerSide === '2' ? 'winner' : winnerSide === '1' ? 'loser' : 'draw') : ''}"><span class="team-name">${match.team2}</span>${getFlagHtml(match.code2)}</div>
                    </div>
                    ${watchBtn}
                    <div class="match-time-label">${formatTime(match.time)}</div>
                    <div class="match-details">
                        <div class="match-stadium">📍 ${match.stadium}</div>
                        ${goalsHtml}
                        ${infoBtn}
                    </div>
                `;
                groupCard.appendChild(row);
            });

            container.appendChild(groupCard);
        }
    }

    function createKnockoutMatchHtml(match, isFinal = false, predict = null) {
        if (!match) return '';
        const status = getMatchStatus(match);
        const isLive = status === 'live';
        const winnerSide = getMatchWinnerSide(match);
        const showResult = isLive || status === 'completed';
        const liveText = match._liveDetail || 'LIVE';
        const liveBadge = isLive ? `<div class="live-badge" style="top: -15px; right: -5px;">${liveText} <span class="pulsing-dot"></span></div>` : '';
        let pensInput = isFinal || match.id > 72 ? `<input type="text" class="penalties-input" data-id="${match.id}" placeholder="" value="${match.penalties || ''}">` : '';
        const watchable = isMatchWatchable(match.time);
        const watchBtn = watchable ? `<a href="${getLiveWatchUrl(match)}" target="_blank" class="live-watch-btn" onclick="event.stopPropagation()">▶ Live</a>` : '';

        const stageLabel = match.round || 'Knockout';
        const stageMap = {
            'Round of 32': 'Round of 32',
            'Round of 16': 'Round of 16',
            'Quarter-final': 'Quarter-finals',
            'Semi-final': 'Semi-finals',
            'Final': 'Final'
        };
        const mappedStage = stageMap[match.round] || match.round || 'Knockout';

        const goalList = getGoalsHtml(match);
        const goalsHtml = goalList.length ? `<div class="match-goals ko-goals">${goalList.map(g => `<div class="goal-entry">⚽ ${g}</div>`).join('')}</div>` : '';
        const showInfoBtn = isMatchFinished(match) || isLive;
        const infoBtn = showInfoBtn ? `<button class="match-info-btn ko-info-btn" data-match-id="${match.id}" title="Match details">ℹ</button>` : '';

        const showPredict = !!predict;

        const t1Name = showPredict ? (predict.t1 || match.team1) : match.team1;
        const t2Name = showPredict ? (predict.t2 || match.team2) : match.team2;
        const t1Code = showPredict ? (predict.c1 || match.code1) : match.code1;
        const t2Code = showPredict ? (predict.c2 || match.code2) : match.code2;
        const t1Incomplete = showPredict && predict.i1;
        const t2Incomplete = showPredict && predict.i2;
        const incompleteMsg = match.round === 'Round of 32' ? 'Based on live group standing!' : 'Waiting for previous round';
        const t1Tt = t1Incomplete ? incompleteMsg : t1Name;
        const t2Tt = t2Incomplete ? incompleteMsg : t2Name;
        const warnIcon = `<span class="predict-warn" title="${incompleteMsg}">!</span>`;

        return `
            <div id="match-${match.id}" class="knockout-match hover-target ${isFinal ? 'final-match' : ''} ${isLive ? 'live-match' : ''} ${status === 'completed' ? 'completed-match' : ''}"
                 data-match-id="${match.id}"
                 data-team1="${t1Name}"
                 data-team2="${t2Name}"
                 data-stadium="${match.stadium}"
                 data-city="${getCityFromStadium(match.stadium)}"
                 data-group=""
                 data-stage="${mappedStage}"
                 data-status="${status}"
                 data-time="${match.time}">
                ${liveBadge}
                ${isFinal ? '<div class="final-label">Final</div>' : ''}
                <div class="match-time-label ko-time">${formatTime(match.time)}</div>
                <div class="ko-team-row ${showResult ? (winnerSide === '1' ? 'winner' : winnerSide === '2' ? 'loser' : 'draw') : ''}">
                    <span class="ko-team" title="${t1Tt}">${getFlagHtml(t1Code)}${t1Name}${t1Incomplete ? warnIcon : ''}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                </div>
                <div class="ko-team-row ${showResult ? (winnerSide === '2' ? 'winner' : winnerSide === '1' ? 'loser' : 'draw') : ''}">
                    <span class="ko-team" title="${t2Tt}">${getFlagHtml(t2Code)}${t2Name}${t2Incomplete ? warnIcon : ''}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                </div>
                ${pensInput}
                ${watchBtn}
                <div class="match-details">
                    <div class="match-stadium">📍 ${match.stadium}</div>
                    ${goalsHtml}
                    ${infoBtn}
                </div>
            </div>
        `;
    }

    function renderBracket() {
        const container = document.getElementById('bracket-container');
        container.innerHTML = '';

        const r32 = matchData.knockout["Round of 32"] || [];
        const r16 = matchData.knockout["Round of 16"] || [];
        const qf = matchData.knockout["Quarter-finals"] || [];
        const sf = matchData.knockout["Semi-finals"] || [];
        const finalMatch = matchData.knockout["Final"] ? matchData.knockout["Final"][0] : null;

        const roundNames = [
            { original: "Round of 32", storage: "Round of 32" },
            { original: "Round of 16", storage: "Round of 16" },
            { original: "Quarter-final", storage: "Quarter-finals" },
            { original: "Semi-final", storage: "Semi-finals" },
            { original: "Final", storage: "Final" }
        ];

        function getResolvedBracketInfo(match) {
            const rIdx = roundNames.findIndex(r => r.original === match.round);
            if (rIdx === -1) return null;

            if (rIdx === 0) {
                const t1 = resolveBracketPosition(match.team1);
                const t2 = resolveBracketPosition(match.team2);
                return {
                    t1: t1 ? t1.name : match.team1,
                    t2: t2 ? t2.name : match.team2,
                    c1: t1 ? t1.code : match.code1,
                    c2: t2 ? t2.code : match.code2,
                    i1: t1 ? t1.incomplete : false,
                    i2: t2 ? t2.incomplete : false
                };
            }

            const prevStorage = roundNames[rIdx - 1].storage;
            const curStorage = roundNames[rIdx].storage;
            const prevMatches = matchData.knockout[prevStorage] || [];
            const matches = matchData.knockout[curStorage] || [];
            const matchIdx = matches.findIndex(m => m.id === match.id);
            if (matchIdx === -1) return null;

            const prevIdx1 = matchIdx * 2;
            const prevIdx2 = matchIdx * 2 + 1;

            const w1 = prevMatches[prevIdx1] ? getKnockoutWinner(prevMatches[prevIdx1]) : null;
            const w2 = prevMatches[prevIdx2] ? getKnockoutWinner(prevMatches[prevIdx2]) : null;

            return {
                t1: w1 ? w1.name : match.team1,
                t2: w2 ? w2.name : match.team2,
                c1: w1 ? w1.code : match.code1,
                c2: w2 ? w2.code : match.code2,
                i1: !w1,
                i2: !w2
            };
        }

        const renderCol = (matches, align) => {
            const col = document.createElement('div');
            col.className = 'bracket-column ' + align;
            for (let i = 0; i < matches.length; i += 2) {
                if (i + 1 < matches.length) {
                    const pair = document.createElement('div');
                    pair.className = 'match-pair';
                    pair.innerHTML = createKnockoutMatchHtml(matches[i], false, getResolvedBracketInfo(matches[i]))
                        + createKnockoutMatchHtml(matches[i + 1], false, getResolvedBracketInfo(matches[i + 1]));
                    col.appendChild(pair);
                } else {
                    const single = document.createElement('div');
                    single.className = 'match-single';
                    single.innerHTML = createKnockoutMatchHtml(matches[i], false, getResolvedBracketInfo(matches[i]));
                    col.appendChild(single);
                }
            }
            return col;
        };

        // Left Bracket
        container.appendChild(renderCol(r32.slice(0, 8), 'left-col'));
        container.appendChild(renderCol(r16.slice(0, 4), 'left-col'));
        container.appendChild(renderCol(qf.slice(0, 2), 'left-col'));
        container.appendChild(renderCol([sf[0]], 'left-col'));

        // Center Final
        const centerCol = document.createElement('div');
        centerCol.className = 'bracket-column col-center';
        if (finalMatch) centerCol.innerHTML = createKnockoutMatchHtml(finalMatch, true, getResolvedBracketInfo(finalMatch));
        container.appendChild(centerCol);

        // Right Bracket
        container.appendChild(renderCol([sf[1]], 'right-col'));
        container.appendChild(renderCol(qf.slice(2, 4), 'right-col'));
        container.appendChild(renderCol(r16.slice(4, 8), 'right-col'));
        container.appendChild(renderCol(r32.slice(8, 16), 'right-col'));
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
            const status = getMatchStatus(match);
            const isLive = status === 'live';
            card.className = `upcoming-card ${isLive ? 'live-match' : ''}`;
            card.style.position = 'relative';
            card.onclick = () => window.scrollToMatch(match.id);

            const stageMap = {
                'Round of 32': 'Round of 32',
                'Round of 16': 'Round of 16',
                'Quarter-final': 'Quarter-finals',
                'Semi-final': 'Semi-finals',
                'Final': 'Final'
            };
            const mappedStage = match.group ? 'Group Stage' : (stageMap[match.round] || match.round || 'Knockout');
            const mappedGroup = match.group ? match.group.replace('Group ', '') : '';

            card.dataset.matchId = match.id;
            card.dataset.team1 = match.team1;
            card.dataset.team2 = match.team2;
            card.dataset.stadium = match.stadium;
            card.dataset.city = getCityFromStadium(match.stadium);
            card.dataset.group = mappedGroup;
            card.dataset.stage = mappedStage;
            card.dataset.status = status;
            card.dataset.time = match.time;

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
        if (!container) return;
        container.innerHTML = '';

        const sortedGroups = Object.entries(matchData.groups).sort(([a], [b]) => a.localeCompare(b));
        for (const [groupName] of sortedGroups) {
            const teamList = computeGroupStandings(groupName);

            const groupCard = document.createElement('div');
            groupCard.className = 'group-card';
            groupCard.dataset.group = groupName;
            
            let html = `<h3 class="group-title">Group ${groupName}</h3>`;
            html += `<table class="standings-table">
                <thead>
                    <tr>
                        <th style="text-align: left;">Team</th>
                        <th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
                    </tr>
                </thead>
                <tbody>`;
            
            teamList.forEach((t, i) => {
                const rankClass = i === 0 ? 'standing-top' : i === 1 ? 'standing-second' : '';
                html += `
                    <tr class="${rankClass}">
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
        try {
            if (e.target.classList.contains('score-input') && !predictMode) return;
            if (e.target.classList.contains('score-input')) {
                const matchId = e.target.dataset.id;
                const parent = e.target.closest('.match-row') || e.target.closest('.knockout-match');
                const inputs = parent.querySelectorAll('.score-input');
                const pensInput = parent.querySelector('.penalties-input');
                
                const s1 = inputs[0].value;
                const s2 = inputs[1].value;
                const pens = pensInput ? pensInput.value : null;

                const type = saveScore(matchId, s1, s2, pens);
                if (type === 'group') {
                    renderStandings();
                    deferBracketRender();
                } else if (type === 'knockout') {
                    deferBracketRender();
                }
                e.target.style.borderColor = '#00ff88';
                setTimeout(() => { e.target.style.borderColor = ''; }, 300);
                return;
            }

            if (e.target.classList.contains('penalties-input') && !predictMode) return;
            if (e.target.classList.contains('penalties-input')) {
                const matchId = e.target.dataset.id;
                const parent = e.target.closest('.knockout-match');
                const inputs = parent.querySelectorAll('.score-input');
                
                const s1 = inputs[0].value;
                const s2 = inputs[1].value;
                const pens = e.target.value;

                const type = saveScore(matchId, s1, s2, pens);
                if (type === 'knockout') deferBracketRender();
            }
        } catch (err) {
            console.error('input handler error:', err);
        }
    });

    // =============================
    // FILTER BAR
    // =============================
    const filterState = {
        team: '',
        dateFrom: '',
        dateTo: '',
        city: '',
        group: '',
        stage: '',
        statuses: new Set()
    };

    function getAllTeams() {
        const teams = new Set();
        for (const g in matchData.groups) {
            matchData.groups[g].forEach(m => { teams.add(m.team1); teams.add(m.team2); });
        }
        for (const r in matchData.knockout) {
            matchData.knockout[r].forEach(m => { teams.add(m.team1); teams.add(m.team2); });
        }
        return Array.from(teams).sort();
    }

    function getAllCities() {
        const cities = new Set();
        const collect = (matches) => matches.forEach(m => {
            const city = getCityFromStadium(m.stadium);
            if (city && city !== 'TBD') cities.add(city);
        });
        for (const g in matchData.groups) collect(matchData.groups[g]);
        for (const r in matchData.knockout) collect(matchData.knockout[r]);
        return Array.from(cities).sort();
    }

    function populateFilterOptions() {
        const citySelect = document.getElementById('filter-city');
        if (!citySelect) return;
        const current = citySelect.value;
        citySelect.innerHTML = '<option value="">All Cities</option>';
        getAllCities().forEach(city => {
            const opt = document.createElement('option');
            opt.value = city;
            opt.textContent = city;
            citySelect.appendChild(opt);
        });
        citySelect.value = current;
    }

    function matchPassesFilter(el) {
        if (filterState.team) {
            const t1 = (el.dataset.team1 || '').toLowerCase();
            const t2 = (el.dataset.team2 || '').toLowerCase();
            const q = filterState.team.toLowerCase();
            if (!t1.includes(q) && !t2.includes(q)) return false;
        }
        if (filterState.dateFrom) {
            const t = new Date(el.dataset.time);
            const from = new Date(filterState.dateFrom);
            from.setHours(0, 0, 0, 0);
            if (t < from) return false;
        }
        if (filterState.dateTo) {
            const t = new Date(el.dataset.time);
            const to = new Date(filterState.dateTo);
            to.setHours(23, 59, 59, 999);
            if (t > to) return false;
        }
        if (filterState.city && el.dataset.city !== filterState.city) return false;
        if (filterState.group && el.dataset.group !== filterState.group) return false;
        if (filterState.stage && el.dataset.stage !== filterState.stage) return false;
        if (filterState.statuses.size > 0 && !filterState.statuses.has(el.dataset.status)) return false;
        return true;
    }

    function applyFilters() {
        let visibleGroupMatches = 0;
        let visibleBracketMatches = 0;
        let visibleUpcoming = 0;
        let totalVisible = 0;

        document.querySelectorAll('.match-row[data-match-id]').forEach(el => {
            const visible = matchPassesFilter(el);
            el.classList.toggle('filter-hidden', !visible);
            if (visible) { visibleGroupMatches++; totalVisible++; }
        });

        document.querySelectorAll('.knockout-match[data-match-id]').forEach(el => {
            const visible = matchPassesFilter(el);
            el.classList.toggle('filter-hidden', !visible);
            if (visible) { visibleBracketMatches++; totalVisible++; }
        });

        document.querySelectorAll('.upcoming-card[data-match-id]').forEach(el => {
            const visible = matchPassesFilter(el);
            el.classList.toggle('filter-hidden', !visible);
            if (visible) { visibleUpcoming++; totalVisible++; }
        });

        // Hide group cards that have no visible matches
        document.querySelectorAll('.group-card').forEach(card => {
            const hasVisible = Array.from(card.querySelectorAll('.match-row')).some(r => !r.classList.contains('filter-hidden'));
            if (card.dataset.group) {
                card.classList.toggle('filter-hidden', !hasVisible);
            }
        });

        // Hide bracket pairs/singles/columns with no visible matches
        document.querySelectorAll('.match-pair, .match-single').forEach(container => {
            const hasVisible = Array.from(container.querySelectorAll('.knockout-match')).some(m => !m.classList.contains('filter-hidden'));
            container.classList.toggle('filter-hidden', !hasVisible);
        });

        document.querySelectorAll('.bracket-column').forEach(col => {
            const hasVisible = Array.from(col.querySelectorAll('.knockout-match')).some(m => !m.classList.contains('filter-hidden'));
            col.classList.toggle('filter-hidden', !hasVisible);
        });

        // Standings: hide group cards that don't match group filter
        const standingsContainer = document.getElementById('standings-container');
        if (standingsContainer) {
            standingsContainer.classList.toggle('filter-hidden', !!filterState.group || !!filterState.team || !!filterState.statuses.size || !!filterState.dateFrom || !!filterState.dateTo || !!filterState.city || !!filterState.stage);
        }
        document.querySelectorAll('#standings-container .group-card').forEach(card => {
            card.classList.toggle('filter-hidden', filterState.group && card.dataset.group !== filterState.group);
        });

        // Hide sections that have no visible content
        const groupsSection = document.getElementById('groups-section');
        if (groupsSection) {
            groupsSection.classList.toggle('filter-hidden', visibleGroupMatches === 0 && filterState.stage !== 'Group Stage');
        }
        const bracketSection = document.getElementById('knockout-section');
        if (bracketSection) {
            bracketSection.classList.toggle('filter-hidden', visibleBracketMatches === 0 && filterState.stage === 'Group Stage');
        }
        const upcomingSection = document.getElementById('upcoming-matches-section');
        if (upcomingSection) {
            upcomingSection.classList.toggle('filter-hidden', visibleUpcoming === 0);
        }

        // Show "no matches" message
        showNoMatchesMessage(totalVisible === 0);

        // Update status line
        updateFilterStatus(visibleGroupMatches, visibleBracketMatches, visibleUpcoming);
    }

    function showNoMatchesMessage(show) {
        let msg = document.getElementById('no-matches-msg');
        if (show && !msg) {
            msg = document.createElement('div');
            msg.id = 'no-matches-msg';
            msg.className = 'no-matches-msg';
            msg.textContent = 'No matches found for the selected filters.';
            const main = document.querySelector('main');
            main.insertBefore(msg, main.firstChild);
        } else if (!show && msg) {
            msg.remove();
        }
    }

    function updateFilterStatus(g, b, u) {
        const statusEl = document.getElementById('filter-status');
        if (!statusEl) return;
        const total = g + b + u;
        const hasFilters = filterState.team || filterState.dateFrom || filterState.dateTo || filterState.city || filterState.group || filterState.stage || filterState.statuses.size;
        if (hasFilters && total > 0) {
            const parts = [];
            if (g) parts.push(`${g} group`);
            if (b) parts.push(`${b} bracket`);
            if (u) parts.push(`${u} upcoming`);
            statusEl.innerHTML = `Showing <strong>${total}</strong> match${total !== 1 ? 'es' : ''} (${parts.join(', ')})`;
            statusEl.classList.remove('hidden');
        } else {
            statusEl.classList.add('hidden');
        }
    }

    function setupTeamAutocomplete() {
        const input = document.getElementById('filter-team');
        const dropdown = document.getElementById('team-suggestions');
        if (!input || !dropdown) return;

        let highlightedIndex = -1;

        function render(items) {
            dropdown.innerHTML = '';
            if (!items.length) {
                const empty = document.createElement('div');
                empty.className = 'suggestion-empty';
                empty.textContent = 'No teams found';
                dropdown.appendChild(empty);
                return;
            }
            items.forEach((team, i) => {
                const div = document.createElement('div');
                div.className = 'suggestion-item' + (i === highlightedIndex ? ' highlighted' : '');
                div.dataset.team = team;
                const code = getCountryCode(team);
                div.innerHTML = `${getFlagHtml(code)} <span>${team}</span>`;
                div.addEventListener('mousedown', e => {
                    e.preventDefault();
                    selectTeam(team);
                });
                dropdown.appendChild(div);
            });
        }

        function selectTeam(team) {
            input.value = team;
            filterState.team = team;
            dropdown.classList.add('hidden');
            applyFilters();
        }

        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (!q) {
                filterState.team = '';
                dropdown.classList.add('hidden');
                applyFilters();
                return;
            }
            const all = getAllTeams();
            const matches = all.filter(t => t.toLowerCase().includes(q.toLowerCase())).slice(0, 10);
            filterState.team = q;
            highlightedIndex = -1;
            render(matches);
            dropdown.classList.remove('hidden');
            applyFilters();
        });

        input.addEventListener('keydown', e => {
            const items = dropdown.querySelectorAll('.suggestion-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
                render(getAllTeams().filter(t => t.toLowerCase().includes(input.value.toLowerCase())).slice(0, 10));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                highlightedIndex = Math.max(highlightedIndex - 1, 0);
                render(getAllTeams().filter(t => t.toLowerCase().includes(input.value.toLowerCase())).slice(0, 10));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlightedIndex >= 0 && items[highlightedIndex]) {
                    selectTeam(items[highlightedIndex].dataset.team);
                } else {
                    dropdown.classList.add('hidden');
                }
            } else if (e.key === 'Escape') {
                dropdown.classList.add('hidden');
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => dropdown.classList.add('hidden'), 150);
        });
    }

    function setupFilterBar() {
        const dateFrom = document.getElementById('filter-date-from');
        const dateTo = document.getElementById('filter-date-to');
        const city = document.getElementById('filter-city');
        const group = document.getElementById('filter-group');
        const stage = document.getElementById('filter-stage');
        const clear = document.getElementById('filter-clear');
        const chips = document.querySelectorAll('.status-chips .chip');

        dateFrom.addEventListener('change', () => { filterState.dateFrom = dateFrom.value; applyFilters(); });
        dateTo.addEventListener('change', () => { filterState.dateTo = dateTo.value; applyFilters(); });
        city.addEventListener('change', () => { filterState.city = city.value; applyFilters(); });
        group.addEventListener('change', () => { filterState.group = group.value; applyFilters(); });
        stage.addEventListener('change', () => { filterState.stage = stage.value; applyFilters(); });

        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const status = chip.dataset.status;
                if (filterState.statuses.has(status)) {
                    filterState.statuses.delete(status);
                    chip.classList.remove('active');
                } else {
                    filterState.statuses.add(status);
                    chip.classList.add('active');
                }
                applyFilters();
            });
        });

        clear.addEventListener('click', () => {
            filterState.team = '';
            filterState.dateFrom = '';
            filterState.dateTo = '';
            filterState.city = '';
            filterState.group = '';
            filterState.stage = '';
            filterState.statuses.clear();
            document.getElementById('filter-team').value = '';
            dateFrom.value = '';
            dateTo.value = '';
            city.value = '';
            group.value = '';
            stage.value = '';
            chips.forEach(c => c.classList.remove('active'));
            document.getElementById('team-suggestions').classList.add('hidden');
            applyFilters();
        });

        setupTeamAutocomplete();
    }

    // =============================
    // DYNAMIC HOVER EXPANSION
    // =============================
    function expandDetails(target) {
        const details = target.querySelector('.match-details');
        if (!details) return;
        if (details.dataset.expanded === '1') return;
        details.dataset.expanded = '1';
        details.style.transition = 'max-height 0.3s ease, margin-top 0.25s ease, opacity 0.25s ease';
        details.style.maxHeight = details.scrollHeight + 'px';
        details.style.opacity = '1';
        details.style.marginTop = '0.35rem';
    }

    function collapseDetails(target) {
        const details = target.querySelector('.match-details');
        if (!details) return;
        if (details.dataset.expanded !== '1') return;
        details.dataset.expanded = '0';
        details.style.transition = 'max-height 0.3s ease, margin-top 0.25s ease, opacity 0.2s ease';
        details.style.maxHeight = '0px';
        details.style.opacity = '0';
        details.style.marginTop = '0';
    }

    function setupHoverExpand() {
        // Event delegation so dynamically-rendered cards work
        document.body.addEventListener('mouseover', e => {
            const target = e.target.closest('.hover-target');
            if (!target) return;
            // Reset any explicit max-height to allow measurement
            const details = target.querySelector('.match-details');
            if (details && details.dataset.expanded !== '1') {
                // Briefly remove inline max-height so scrollHeight reflects true height
                const prev = details.style.maxHeight;
                details.style.maxHeight = 'none';
                const h = details.scrollHeight;
                details.style.maxHeight = prev || '0px';
                details._naturalHeight = h;
            }
            expandDetails(target);
        });

        document.body.addEventListener('mouseout', e => {
            const target = e.target.closest('.hover-target');
            if (!target) return;
            // Only collapse if leaving the hover-target itself (not entering a child)
            const related = e.relatedTarget;
            if (related && target.contains(related)) return;
            collapseDetails(target);
        });
    }

    function rebindHoverExpand() {
        // No-op: event delegation handles new elements automatically
    }

    // =============================
    // OVERLAY
    // =============================
    const summaryCache = new Map();
    const espnDateCache = new Map();
    const rosterCache = new Map();
    const pendingRosters = new Map();

    async function fetchTeamRoster(teamId) {
        if (!teamId) return null;
        if (rosterCache.has(teamId)) return rosterCache.get(teamId);
        if (pendingRosters.has(teamId)) return pendingRosters.get(teamId);
        const promise = (async () => {
            try {
                const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/' + teamId + '/roster';
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('Roster not available');
                const data = await resp.json();
                rosterCache.set(teamId, data);
                pendingRosters.delete(teamId);
                return data;
            } catch (e) {
                console.warn('ESPN roster unavailable:', e.message);
                rosterCache.set(teamId, null);
                pendingRosters.delete(teamId);
                return null;
            }
        })();
        pendingRosters.set(teamId, promise);
        return promise;
    }

    // Get a player's position abbreviation. ESPN puts it on the roster
    // entry (p.position), not inside the athlete object.
    function playerPosAbbrev(p) {
        // Bench entries carry a generic "SUB" position; the real role lives on
        // the athlete (filled from the team roster). Ignore "SUB" so it falls
        // through to the natural position.
        const entry = p.position && p.position.abbreviation;
        if (entry && entry.toUpperCase() !== 'SUB') return entry;
        return (p.athlete && p.athlete.position && p.athlete.position.abbreviation) || entry || '';
    }

    // Derive vertical depth (0 = GK ... 6 = striker) and lateral position
    // (-1 = left ... +1 = right) from an ESPN position abbreviation such as
    // "CD-R", "AM-L", "RB", "RWB", "CDM". Depth orders players back→front;
    // lateral orders them left→right within a row.
    function posDepthLateral(abbrev) {
        let a = (abbrev || '').toUpperCase().trim();
        let sign = 0;
        const suffix = a.match(/-(R|L|C)$/);
        if (suffix) {
            sign = suffix[1] === 'R' ? 1 : suffix[1] === 'L' ? -1 : 0;
            a = a.replace(/-(R|L|C)$/, '');
        }
        // No position abbreviation starts with R/L unless it is a right/left role.
        if (sign === 0) {
            if (a[0] === 'R') sign = 1;
            else if (a[0] === 'L') sign = -1;
        }
        const base = a.replace(/^[RL]/, ''); // RB→B, RW→W, RDM→DM, RCB→CB
        let depth;
        if (a === 'G' || a === 'GK') depth = 0;
        else if (base === 'SW') depth = 0.8;
        else if (['WB'].includes(base)) depth = 1.5;
        else if (['DM', 'CDM'].includes(base)) depth = 2;
        else if (['B', 'CB', 'CD', 'D', 'DEF'].includes(base) || base[0] === 'D') depth = 1;
        else if (['AM', 'CAM'].includes(base)) depth = 4;
        else if (['M', 'CM', 'MID'].includes(base) || base[0] === 'M') depth = 3;
        else if (['W'].includes(base) || base[0] === 'W') depth = 5;
        else if (['SS', 'WF'].includes(base)) depth = 5.3;
        else if (['CF'].includes(base)) depth = 5.5;
        else if (['ST', 'F', 'FW', 'FWD'].includes(base) || base[0] === 'F') depth = 6;
        else depth = 3;
        // Wide roles (full-/wing-backs, wingers, wide mids) sit further out
        // than central players sharing the same row.
        const wideMid = !suffix && base === 'M'; // LM/RM, not CM-L/CM-R
        const mag = (['B', 'WB', 'W'].includes(base) || wideMid) ? 2 : 1;
        return { depth, lat: sign * mag };
    }

    // Arrange starters into pitch rows (index 0 = GK ... last = most
    // advanced) using their real positions, sliced to match the formation
    // string. Works for any number of rows (e.g. 5-2-3-1, 4-1-2-1-2).
    function arrangeByFormation(starters, formation) {
        if (!starters.length) return [];
        const ann = starters.map(p => ({ p, ...posDepthLateral(playerPosAbbrev(p)) }));
        const gkArr = ann.filter(x => x.depth === 0);
        let outfield = ann.filter(x => x.depth > 0);
        const gk = gkArr.length ? [gkArr[0].p] : [];
        if (gkArr.length > 1) outfield = outfield.concat(gkArr.slice(1));
        outfield.sort((a, b) => a.depth - b.depth);

        const sortRow = arr => arr.slice().sort((a, b) => a.lat - b.lat).map(x => x.p);
        const rows = [];
        if (gk.length) rows.push(gk);

        const counts = parseFormation(formation);
        if (counts && counts.length) {
            let i = 0;
            for (const c of counts) {
                const slice = outfield.slice(i, i + c);
                i += c;
                if (slice.length) rows.push(sortRow(slice));
            }
            if (i < outfield.length) rows.push(sortRow(outfield.slice(i)));
        } else {
            const bands = {};
            for (const x of outfield) {
                const k = Math.round(x.depth);
                (bands[k] = bands[k] || []).push(x);
            }
            Object.keys(bands).sort((a, b) => a - b).forEach(k => rows.push(sortRow(bands[k])));
        }
        return rows;
    }

    // Index match key events by athlete id → goals/assists/cards/sub info.
    function buildEventsIndex(keyEvents) {
        const idx = new Map();
        const get = id => {
            id = String(id);
            if (!idx.has(id)) idx.set(id, { goals: 0, og: 0, assists: 0, yellow: 0, red: 0, subOut: null, subIn: null });
            return idx.get(id);
        };
        for (const e of (keyEvents || [])) {
            const tp = (e.type && e.type.type) || '';
            const txt = (e.type && e.type.text) || '';
            const parts = e.participants || [];
            const clock = (e.clock && e.clock.displayValue) || '';
            const aid = parts[0] && parts[0].athlete && parts[0].athlete.id;
            const bid = parts[1] && parts[1].athlete && parts[1].athlete.id;
            if (tp === 'goal' || /goal|penalty - scored/i.test(txt)) {
                if (/own goal/i.test(txt)) { if (aid) get(aid).og++; }
                else { if (aid) get(aid).goals++; if (bid) get(bid).assists++; }
            } else if (tp === 'substitution' || /substitution/i.test(txt)) {
                if (aid) get(aid).subIn = clock;   // participant 0 = player coming on
                if (bid) get(bid).subOut = clock;  // participant 1 = player going off
            } else if (tp === 'yellow-card' || /yellow card/i.test(txt)) {
                if (aid) get(aid).yellow++;
            } else if (tp === 'red-card' || /red card|sent off/i.test(txt)) {
                if (aid) get(aid).red++;
            }
        }
        return idx;
    }

    // Build the small icon cluster (goal/assist/cards/sub) for a player.
    function playerEventIconsHtml(p, eventsIdx) {
        const id = p && p.athlete && p.athlete.id;
        const ev = (id && eventsIdx) ? eventsIdx.get(String(id)) : null;
        let s = '';
        if (ev) {
            for (let i = 0; i < ev.goals; i++) s += '<span class="ov-ic ov-ic-goal" title="Goal">⚽</span>';
            for (let i = 0; i < ev.og; i++) s += '<span class="ov-ic ov-ic-goal ov-ic-og" title="Own goal">⚽</span>';
            for (let i = 0; i < ev.assists; i++) s += '<span class="ov-ic ov-ic-assist" title="Assist">👟</span>';
            if (ev.yellow) s += '<span class="ov-ic ov-ic-card ov-ic-yellow" title="Yellow card"></span>';
            if (ev.red) s += '<span class="ov-ic ov-ic-card ov-ic-red" title="Red card"></span>';
        }
        // subbedOut from roster entry (covers starters replaced); add minute if known
        if (p && p.subbedOut) {
            const m = ev && ev.subOut ? ' ' + ev.subOut : '';
            s += '<span class="ov-ic ov-ic-subout" title="Substituted off' + m + '">↓</span>';
        }
        return s ? '<span class="ov-pitch-icons">' + s + '</span>' : '';
    }

    const coreRosterCache = new Map();

    async function fetchCoreRoster(espnEventId, teamId) {
        const cacheKey = espnEventId + '_' + teamId;
        if (coreRosterCache.has(cacheKey)) return coreRosterCache.get(cacheKey);
        try {
            const url = 'http://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/' + espnEventId + '/competitions/' + espnEventId + '/competitors/' + teamId + '/roster?lang=en&region=us';
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Core roster unavailable');
            const data = await resp.json();
            coreRosterCache.set(cacheKey, data);
            return data;
        } catch (e) {
            console.warn('Core roster fetch failed:', e.message);
            coreRosterCache.set(cacheKey, null);
            return null;
        }
    }

    function buildCoreRosterIndex(coreData) {
        const idx = new Map();
        if (!coreData || !coreData.entries) return idx;
        for (const e of coreData.entries) {
            if (!e || !e.playerId) continue;
            let posId = '';
            if (e.position) {
                if (e.position.id) posId = String(e.position.id);
                else if (e.position['$ref']) {
                    const m = e.position['$ref'].match(/\/positions\/(\d+)/);
                    if (m) posId = m[1];
                }
            }
            idx.set(String(e.playerId), {
                jersey: e.jersey || '',
                formationPlace: e.formationPlace || 0,
                starter: !!e.starter,
                positionId: posId
            });
        }
        return idx;
    }

    function positionIdToAbbrev(posId) {
        const map = { '1': 'G', '2': 'D', '3': 'M', '4': 'F' };
        return map[String(posId)] || '';
    }

    function buildRosterIndex(rosterData) {
        const idx = new Map();
        if (!rosterData || !rosterData.athletes) return idx;
        for (const a of rosterData.athletes) {
            if (!a || !a.id) continue;
            idx.set(String(a.id), {
                jersey: a.jersey || '',
                position: a.position?.abbreviation || '',
                positionName: a.position?.name || ''
            });
        }
        return idx;
    }

    async function fetchEspnForMatch(match) {
        let dateStr = null;
        if (match.time) {
            const d = new Date(match.time);
            dateStr = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
        }
        if (!dateStr) return false;
        const cacheKey = 'espn_date_' + dateStr;
        let data;
        if (espnDateCache.has(cacheKey)) {
            data = espnDateCache.get(cacheKey);
        } else {
            try {
                const url = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=' + dateStr;
                const resp = await fetch(url);
                data = await resp.json();
                espnDateCache.set(cacheKey, data);
            } catch (e) {
                console.warn('ESPN date fetch failed:', e.message);
                espnDateCache.set(cacheKey, null);
                return false;
            }
        }
        if (data && !match._espnEventId) {
            for (const ev of (data.events || [])) {
                for (const comp of (ev.competitions || [])) {
                    const statusState = comp.status?.type?.state;
                    const statusDetail = comp.status?.type?.detail;
                    let espnHome = null, espnAway = null;
                    for (const c of (comp.competitors || [])) {
                        const entry = {
                            id: c.id,
                            name: c.team?.displayName || '',
                            score: c.score || '',
                            homeAway: c.homeAway,
                            statistics: c.statistics || []
                        };
                        if (c.homeAway === 'home') espnHome = entry;
                        else espnAway = entry;
                    }
                    if (!espnHome || !espnAway) continue;
                    const normHome = ESPN_NAME_MAP[espnHome.name] || espnHome.name;
                    const normAway = ESPN_NAME_MAP[espnAway.name] || espnAway.name;
                    const doUpdate = function(m, hScore, aScore, team1Id, team2Id) {
                        m._espnEventId = ev.id;
                        m._espnStatusState = statusState;
                        m._espnDetails = comp.details || [];
                        m._espnStats = { home: espnHome.statistics, away: espnAway.statistics };
                        m._espnVenue = comp.venue || null;
                        m._espnAttendance = comp.attendance || 0;
                        m._espnHeadline = (comp.headlines && comp.headlines[0]) ? comp.headlines[0] : null;
                        m._espnBroadcasts = comp.broadcasts || null;
                        m._espnHomeName = normHome;
                        m._espnAwayName = normAway;
                        if (statusState === 'in' || statusState === 'post') {
                            m.score1 = hScore;
                            m.score2 = aScore;
                            const parsed = parseEspnGoals(m._espnDetails, team1Id, team2Id);
                            m.goals1 = parsed[0];
                            m.goals2 = parsed[1];
                        }
                        if (statusState === 'in') m._liveDetail = statusDetail;
                    };
                    if (match.team1 === normHome && match.team2 === normAway) {
                        doUpdate(match, espnHome.score, espnAway.score, espnHome.id, espnAway.id);
                        return true;
                    } else if (match.team1 === normAway && match.team2 === normHome) {
                        doUpdate(match, espnAway.score, espnHome.score, espnAway.id, espnHome.id);
                        return true;
                    }
                }
            }
        }
        return !!match._espnEventId;
    }

    function findMatchById(id) {
        id = String(id);
        for (const g in matchData.groups) {
            const m = matchData.groups[g].find(x => String(x.id) === id);
            if (m) return m;
        }
        for (const r in matchData.knockout) {
            const m = matchData.knockout[r].find(x => String(x.id) === id);
            if (m) return m;
        }
        return null;
    }

    function getStatValue(stats, name) {
        if (!stats) return 0;
        const s = stats.find(x => x.name === name);
        if (!s) return 0;
        const v = parseFloat(s.displayValue);
        return isNaN(v) ? 0 : v;
    }

    function statNameLabel(name) {
        const map = {
            possessionPct: 'Possession',
            totalShots: 'Total Shots',
            shotsOnTarget: 'Shots on Target',
            wonCorners: 'Corners',
            foulsCommitted: 'Fouls',
            goalAssists: 'Goal Assists',
            shotAssists: 'Shot Assists',
            totalGoals: 'Goals',
            appearances: 'Appearances'
        };
        return map[name] || name;
    }

    function buildOverlayHeader(match) {
        const pensHtml = match.penalties ? `<div class="ov-score-pens">(${match.penalties.replace(' pens','')})</div>` : '';
        return `
            <div class="ov-header">
                <div class="ov-team">
                    <img src="https://flagcdn.com/48x36/${match.code1.toLowerCase()}.png" alt="${match.team1}" class="ov-team-flag">
                    <div class="ov-team-name">${match.team1}</div>
                </div>
                <div>
                    <div class="ov-score">${match.score1 || '0'} - ${match.score2 || '0'}</div>
                    ${pensHtml}
                </div>
                <div class="ov-team">
                    <img src="https://flagcdn.com/48x36/${match.code2.toLowerCase()}.png" alt="${match.team2}" class="ov-team-flag">
                    <div class="ov-team-name">${match.team2}</div>
                </div>
            </div>
            <div class="ov-meta">
                📅 ${formatTime(match.time)}<br>
                📍 ${match.stadium}${match.htScore ? ` &nbsp;|&nbsp; HT: ${match.htScore[0]}-${match.htScore[1]}` : ''}
                ${match._espnAttendance ? `<br>👥 Attendance: ${match._espnAttendance.toLocaleString()}` : ''}
            </div>
        `;
    }

    function buildGoalsSection(match) {
        const allGoals = [];
        if (match.goals1) match.goals1.forEach(g => allGoals.push({ ...g, team: 1, teamName: match.team1, code: match.code1 }));
        if (match.goals2) match.goals2.forEach(g => allGoals.push({ ...g, team: 2, teamName: match.team2, code: match.code2 }));

        // Sort by minute (numeric)
        allGoals.sort((a, b) => {
            const ma = parseInt(a.minute) || 0;
            const mb = parseInt(b.minute) || 0;
            return ma - mb;
        });

        if (allGoals.length === 0) {
            return `
                <div class="ov-section">
                    <div class="ov-section-title">⚽ Goals</div>
                    <div class="ov-goals-list"><div class="ov-goal-item" style="justify-content:center; color: var(--text-muted);">No goals scored</div></div>
                </div>
            `;
        }

        const items = allGoals.map(g => {
            let typeLabel = '';
            if (g.owngoal) typeLabel = 'OG';
            else if (g.penalty) typeLabel = 'Penalty';
            return `
                <div class="ov-goal-item">
                    <img src="https://flagcdn.com/24x18/${g.code.toLowerCase()}.png" alt="" class="flag-icon" style="width:18px;">
                    <span class="ov-goal-minute">${g.minute}'</span>
                    <span class="ov-goal-player">${g.name}</span>
                    ${typeLabel ? `<span class="ov-goal-type">${typeLabel}</span>` : ''}
                </div>
            `;
        }).join('');

        return `
            <div class="ov-section">
                <div class="ov-section-title">⚽ Goals</div>
                <div class="ov-goals-list">${items}</div>
            </div>
        `;
    }

    function buildCardsSection(match) {
        const cards = (match._espnDetails || []).filter(d => d.yellowCard || d.redCard);
        if (cards.length === 0) return '';
        const items = cards.map(c => {
            const player = (c.athletesInvolved && c.athletesInvolved[0]) ? c.athletesInvolved[0].displayName : 'Player';
            return `
                <div class="ov-card-item">
                    <div class="ov-card-icon ${c.redCard ? 'red' : 'yellow'}"></div>
                    <span class="ov-card-minute">${c.clock?.displayValue || ''}</span>
                    <span class="ov-card-player">${player}</span>
                </div>
            `;
        }).join('');
        return `
            <div class="ov-section">
                <div class="ov-section-title">🟨 Cards</div>
                ${items}
            </div>
        `;
    }

    function buildStatsSection(match) {
        if (!match._espnStats) return '';
        const statKeys = ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'shotAssists'];
        const rows = statKeys.map(key => {
            const left = getStatValue(match._espnStats.home, key);
            const right = getStatValue(match._espnStats.away, key);
            const total = left + right;
            let leftPct = 50, rightPct = 50;
            if (total > 0) {
                leftPct = (left / total) * 100;
                rightPct = (right / total) * 100;
            }
            return `
                <div>
                    <div class="ov-stat-label">${statNameLabel(key)}</div>
                    <div class="ov-stat-row">
                        <span class="ov-stat-value left">${left}${key === 'possessionPct' ? '%' : ''}</span>
                        <div class="ov-stat-bar-container">
                            <div class="ov-stat-bar left" style="width: ${leftPct}%"></div>
                            <div class="ov-stat-bar right" style="width: ${rightPct}%"></div>
                        </div>
                        <span class="ov-stat-value">${right}${key === 'possessionPct' ? '%' : ''}</span>
                    </div>
                </div>
            `;
        }).join('');
        if (!rows) return '';
        return `
            <div class="ov-section">
                <div class="ov-section-title">📊 Match Stats</div>
                <div class="ov-stats-list">${rows}</div>
            </div>
        `;
    }

    function posCategory(abbrev) {
        if (!abbrev) return 'MID';
        const a = abbrev.toUpperCase();
        if (a === 'GK' || a === 'G') return 'GK';
        if (['DM', 'CDM', 'RDM', 'LDM'].includes(a)) return 'MID';
        if (a.startsWith('D') || a === 'CB' || a === 'LB' || a === 'RB' || a === 'RC' || a === 'LC' || a === 'SW') return 'DEF';
        if (a.startsWith('F') || a === 'ST' || a === 'CF' || a === 'LW' || a === 'RW' || a === 'WF' || a === 'SS') return 'FWD';
        return 'MID';
    }

    function parseFormation(formation) {
        if (!formation) return null;
        const parts = formation.split('-').map(Number);
        if (parts.some(isNaN) || parts.length < 1) return null;
        return parts;
    }


    function buildPitchPlayerHtml(p, side, eventsIdx) {
        if (!p) return '<div class="ov-pitch-player"><span class="ov-pitch-num">?</span></div>';
        const name = p.athlete?.displayName || 'Player';
        const jersey = p.athlete?.jersey || p.jersey || '';
        const pos = playerPosAbbrev(p);
        const cls = side === 'away' ? ' ov-pitch-player-away' : '';
        const icons = playerEventIconsHtml(p, eventsIdx);
        return `
            <div class="ov-pitch-player${cls}" title="${name} (${pos})">
                <span class="ov-pitch-num">${jersey}${icons}</span>
                <span class="ov-pitch-name">${name.split(' ').pop()}</span>
            </div>
        `;
    }

    const POSITION_LABELS = {
        GK: 'Goalkeeper', G: 'Goalkeeper',
        DEF: 'Defender', D: 'Defender', CB: 'Defender', LB: 'Defender', RB: 'Defender', RC: 'Defender', LC: 'Defender', SW: 'Defender',
        MID: 'Midfielder', M: 'Midfielder', DM: 'Midfielder', CDM: 'Midfielder', RDM: 'Midfielder', LDM: 'Midfielder', CM: 'Midfielder', RM: 'Midfielder', LM: 'Midfielder', AM: 'Midfielder',
        FWD: 'Striker', F: 'Striker', ST: 'Striker', CF: 'Striker', LW: 'Striker', RW: 'Striker', WF: 'Striker', SS: 'Striker'
    };

    function getPosLabel(abbrev) {
        if (!abbrev) return '';
        const a = abbrev.toUpperCase();
        return POSITION_LABELS[a] || POSITION_LABELS[posCategory(a)] || '';
    }

    function buildSubsList(subs, flagCode, teamName, eventsIdx) {
        const items = subs.map(s => {
            const n = s.athlete?.jersey || s.jersey || '?';
            const nm = s.athlete?.displayName || 'Player';
            const pos = playerPosAbbrev(s);
            const posLabel = getPosLabel(pos);
            const id = s.athlete?.id;
            const ev = (id && eventsIdx) ? eventsIdx.get(String(id)) : null;
            let icons = playerEventIconsHtml(s, eventsIdx);
            if (s.subbedIn) {
                const m = ev && ev.subIn ? ' ' + ev.subIn : '';
                icons += `<span class="ov-ic ov-ic-subin" title="Substituted on${m}">↑</span>`;
            }
            return `<div class="ov-pitch-sub"><span class="ov-pitch-sub-num">${n}</span> <span class="ov-pitch-sub-name">${nm}</span>${posLabel ? ` <span class="ov-pitch-sub-pos">(${posLabel})</span>` : ''}${icons ? ` <span class="ov-pitch-sub-icons">${icons}</span>` : ''}</div>`;
        });
        return `
            <div class="ov-subs-team">
                <div class="ov-subs-team-header">${getFlagHtml(flagCode)} ${teamName}</div>
                <div class="ov-subs-list">${items.join('')}</div>
            </div>
        `;
    }

    function enrichRosterData(players, rosterIdx) {
        if (!rosterIdx || rosterIdx.size === 0) return players;
        for (const p of players) {
            if (!p || !p.athlete || !p.athlete.id) continue;
            const info = rosterIdx.get(String(p.athlete.id));
            if (info) {
                if (!p.athlete.jersey && info.jersey) p.athlete.jersey = info.jersey;
                if (!p.athlete.position && info.position) {
                    p.athlete.position = { abbreviation: info.position, name: info.positionName };
                } else if (p.athlete.position && !p.athlete.position.abbreviation && info.position) {
                    p.athlete.position.abbreviation = info.position;
                    p.athlete.position.name = info.positionName || info.position;
                }
            }
        }
        return players;
    }

    async function buildLineupsSection(summaryData) {
        if (!summaryData || !summaryData.rosters) return '';
        const rosters = summaryData.rosters || [];
        if (rosters.length < 2) return '';
        const r1 = rosters[0], r2 = rosters[1];

        const eventId = summaryData.header?.competitions?.[0]?.id || '';
        const t1Id = r1.team?.id || '';
        const t2Id = r2.team?.id || '';

        const [coreR1, coreR2, teamRoster1, teamRoster2] = await Promise.all([
            (eventId && t1Id) ? fetchCoreRoster(eventId, t1Id) : Promise.resolve(null),
            (eventId && t2Id) ? fetchCoreRoster(eventId, t2Id) : Promise.resolve(null),
            t1Id ? fetchTeamRoster(t1Id) : Promise.resolve(null),
            t2Id ? fetchTeamRoster(t2Id) : Promise.resolve(null)
        ]);
        const coreIdx1 = buildCoreRosterIndex(coreR1);
        const coreIdx2 = buildCoreRosterIndex(coreR2);
        const rosterIdx1 = buildRosterIndex(teamRoster1);
        const rosterIdx2 = buildRosterIndex(teamRoster2);

        const formation1 = coreR1?.formation?.summary || r1.formation || '';
        const formation2 = coreR2?.formation?.summary || r2.formation || '';

        let t1Starters = (r1.roster || []).filter(p => p.starter);
        let t2Starters = (r2.roster || []).filter(p => p.starter);

        t1Starters = enrichRosterData(t1Starters, rosterIdx1);
        t2Starters = enrichRosterData(t2Starters, rosterIdx2);

        t1Starters = enrichPlaceData(t1Starters, coreIdx1);
        t2Starters = enrichPlaceData(t2Starters, coreIdx2);

        const eventsIdx = buildEventsIndex(summaryData.keyEvents);

        const t1Rows = arrangeByFormation(t1Starters, formation1);
        const t2Rows = arrangeByFormation(t2Starters, formation2);
        const homeRowsHtml = buildPitchRowsFromArranged(t1Rows, 'home', eventsIdx);
        const awayRowsHtml = buildPitchRowsFromArranged(t2Rows, 'away', eventsIdx);

        const hasLineups = t1Starters.length > 0 || t2Starters.length > 0;
        if (!hasLineups) {
            return '<div class="ov-section"><div class="ov-section-title">👥 Lineups</div><div class="ov-pitch-empty">Lineups not available</div></div>';
        }

        const t1 = { name: r1.team?.displayName || 'Team', code: findCodeForTeamName(r1.team?.displayName || ''), formation: formation1 };
        const t2 = { name: r2.team?.displayName || 'Team', code: findCodeForTeamName(r2.team?.displayName || ''), formation: formation2 };

        const t1Subs = enrichRosterData((r1.roster || []).filter(p => !p.starter), rosterIdx1);
        const t2Subs = enrichRosterData((r2.roster || []).filter(p => !p.starter), rosterIdx2);

        const subsHtml = (t1Subs.length || t2Subs.length)
            ? '<div class="ov-subs-grid">' + buildSubsList(t1Subs, t1.code, t1.name, eventsIdx) + buildSubsList(t2Subs, t2.code, t2.name, eventsIdx) + '</div>'
            : '';

        return '\n            <div class="ov-section">\n                <div class="ov-section-title">👥 Lineups</div>\n                <div class="ov-pitch-container">\n                    <div class="ov-pitch-team-label ov-pitch-team-home">' + getFlagHtml(t1.code) + ' ' + t1.name + ' <span class="ov-pitch-formation">' + t1.formation + '</span></div>\n                    <div class="ov-pitch">\n                        <div class="ov-pitch-field">\n                            <div class="ov-pitch-markings">\n                                <div class="ov-pitch-outline"></div>\n                                <div class="ov-pitch-halfway"></div>\n                                <div class="ov-pitch-center-circle"></div>\n                                <div class="ov-pitch-penalty-box ov-pitch-penalty-top"></div>\n                                <div class="ov-pitch-penalty-box ov-pitch-penalty-bot"></div>\n                            </div>\n                            <div class="ov-pitch-rows">\n                                <div class="ov-pitch-half ov-pitch-half-home">' + homeRowsHtml + '</div>\n                                <div class="ov-pitch-half ov-pitch-half-away">' + awayRowsHtml + '</div>\n                            </div>\n                        </div>\n                    </div>\n                    <div class="ov-pitch-team-label ov-pitch-team-away">' + getFlagHtml(t2.code) + ' ' + t2.name + ' <span class="ov-pitch-formation">' + t2.formation + '</span></div>\n                </div>\n                ' + subsHtml + '\n            </div>\n        ';
    }

    function enrichPlaceData(players, coreIdx) {
        if (!coreIdx || coreIdx.size === 0) return players;
        for (const p of players) {
            if (!p || !p.athlete || !p.athlete.id) continue;
            const info = coreIdx.get(String(p.athlete.id));
            if (info) {
                p._formationPlace = info.formationPlace;
                if (!p.athlete.jersey && info.jersey) p.athlete.jersey = info.jersey;
                if (!p.athlete.position && info.positionId) {
                    p.athlete.position = { abbreviation: positionIdToAbbrev(info.positionId), name: '' };
                } else if (p.athlete.position && !p.athlete.position.abbreviation && info.positionId) {
                    p.athlete.position.abbreviation = positionIdToAbbrev(info.positionId);
                }
            }
        }
        return players;
    }

    function buildPitchRowsFromArranged(rows, side, eventsIdx) {
        let result = rows.map(row => {
            const cols = side === 'home' ? row.slice().reverse() : row;
            return '<div class="ov-pitch-row">' + cols.map(p => buildPitchPlayerHtml(p, side, eventsIdx)).join('') + '</div>';
        });
        if (side === 'away') result = result.reverse();
        return result.join('');
    }

    function findCodeForTeamName(teamName) {
        if (!teamName) return 'un';
        // Direct match
        if (COUNTRY_CODES[teamName]) return COUNTRY_CODES[teamName];
        // Try via ESPN name map (ESPN → internal name → code)
        const internalName = ESPN_NAME_MAP[teamName] || teamName;
        if (COUNTRY_CODES[internalName]) return COUNTRY_CODES[internalName];
        // Try case-insensitive contains
        for (const [name, code] of Object.entries(COUNTRY_CODES)) {
            if (teamName.includes(name) || name.includes(teamName)) return code;
        }
        return 'un';
    }

    function buildHeadlineSection(match) {
        if (!match._espnHeadline) return '';
        return `
            <div class="ov-headline">
                <strong>${match._espnHeadline.shortLinkText || 'Match Recap'}</strong>
                ${match._espnHeadline.description || ''}
            </div>
        `;
    }

    async function fetchMatchSummary(espnEventId) {
        if (summaryCache.has(espnEventId)) return summaryCache.get(espnEventId);
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnEventId}`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Summary not available');
            const data = await resp.json();
            summaryCache.set(espnEventId, data);
            return data;
        } catch (e) {
            console.warn('ESPN summary unavailable:', e.message);
            summaryCache.set(espnEventId, null);
            return null;
        }
    }

    async function openMatchOverlay(matchId) {
        const match = findMatchById(matchId);
        if (!match) return;
        const overlay = document.getElementById('match-overlay');
        const body = document.getElementById('overlay-body');

        // Try to fetch ESPN data for past matches if not already present
        if (!match._espnEventId) {
            await fetchEspnForMatch(match);
        }

        // Build initial content (without lineups yet)
        let html = buildHeadlineSection(match);
        html += buildOverlayHeader(match);
        html += buildGoalsSection(match);
        html += buildCardsSection(match);
        html += buildStatsSection(match);
        html += `<div id="ov-lineups-container" class="ov-section"><div class="ov-section-title">👥 Lineups</div><div class="ov-loading">Loading lineups</div></div>`;

        body.innerHTML = html;
        overlay.classList.remove('hidden');
        document.body.classList.add('overlay-open');

        // Fetch lineups async
        if (match._espnEventId) {
            const summary = await fetchMatchSummary(match._espnEventId);
            const lineupsContainer = document.getElementById('ov-lineups-container');
            if (lineupsContainer) {
                const lineupsHtml = await buildLineupsSection(summary);
                if (lineupsHtml) {
                    lineupsContainer.outerHTML = lineupsHtml;
                } else {
                    lineupsContainer.innerHTML = `<div class="ov-section-title">👥 Lineups</div><div class="ov-pitch-empty">Lineups not available for this match</div>`;
                }
            }
        } else {
            const lineupsContainer = document.getElementById('ov-lineups-container');
            if (lineupsContainer) {
                lineupsContainer.innerHTML = `<div class="ov-section-title">👥 Lineups</div><div class="ov-pitch-empty">Lineups not available yet</div>`;
            }
        }
    }

    function closeMatchOverlay() {
        const overlay = document.getElementById('match-overlay');
        if (overlay) overlay.classList.add('hidden');
        document.body.classList.remove('overlay-open');
    }

    function setupOverlay() {
        const overlay = document.getElementById('match-overlay');
        const backdrop = overlay.querySelector('.overlay-backdrop');
        const closeBtn = overlay.querySelector('.overlay-close');

        backdrop.addEventListener('click', closeMatchOverlay);
        closeBtn.addEventListener('click', closeMatchOverlay);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
                closeMatchOverlay();
            }
        });

        // Event delegation for info buttons (works across re-renders)
        document.body.addEventListener('click', e => {
            const btn = e.target.closest('.match-info-btn');
            if (btn) {
                e.stopPropagation();
                const id = btn.dataset.matchId;
                openMatchOverlay(id);
            }
        });
    }

    // =============================
    // INIT
    // =============================
    try {
        await loadData();
        renderAll();
    } catch (e) {
        console.error(e);
    }
    populateFilterOptions();
    setupFilterBar();
    setupHoverExpand();
    setupOverlay();
    applyFilters();

    // Predict mode toggle
    const predictBtn = document.getElementById('predict-toggle');
    if (predictBtn) {
        predictBtn.addEventListener('click', () => {
            predictMode = !predictMode;
            if (originalMatchData) {
                if (predictMode) {
                    matchData = JSON.parse(JSON.stringify(originalMatchData));
                    console.log('toggle: about to restorePredictData, group count', Object.keys(matchData.groups).length);
                    restorePredictData();
                } else {
                    matchData = JSON.parse(JSON.stringify(originalMatchData));
                }
            }
            renderAll();
        });
    }

    const clearLink = document.getElementById('predict-clear');
    if (clearLink) {
        clearLink.addEventListener('click', async () => {
            clearPredictCache();
            await loadData();
            renderAll();
            populateFilterOptions();
            rebindHoverExpand();
            applyFilters();
        });
    }

    // =============================
    // CLOUD PREDICTIONS (Supabase)
    // =============================
    // (sb / cloudUser / othersPredictions declared near top — TDZ otherwise.)

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = String(str == null ? '' : str);
        return d.innerHTML;
    }

    function eachMatch(data, fn) {
        if (!data) return;
        for (const g in data.groups) for (const m of data.groups[g]) fn(m);
        for (const r in data.knockout) for (const m of data.knockout[r]) fn(m);
    }

    function findOriginalMatch(num) {
        let res = null;
        eachMatch(originalMatchData, m => { if (String(m.id) === String(num)) res = m; });
        return res;
    }

    // Username-based accounts. Supabase Auth needs an email, so we synthesize a
    // stable hidden one from the username; the real account lives server-side and
    // its session persists across browser restarts (unlike the old anon flow).
    const AUTH_EMAIL_DOMAIN = '@wc26.local';
    function usernameToEmail(u) {
        return String(u).toLowerCase().replace(/[^a-z0-9._-]/g, '') + AUTH_EMAIL_DOMAIN;
    }
    function mapAuthError(error) {
        const m = (error && error.message) || '';
        if (/Invalid login credentials/i.test(m)) return 'Wrong username or password.';
        if (/already registered/i.test(m)) return 'Username already taken — try logging in.';
        if (/Email not confirmed/i.test(m)) return 'Server requires email confirmation — disable it in Supabase (Auth → Providers → Email).';
        if (/at least 6/i.test(m)) return 'Password must be at least 6 characters.';
        return m || 'Authentication failed.';
    }

    async function loadProfile(uid) {
        const { data } = await sb.from('profiles').select('id, nickname').eq('id', uid).maybeSingle();
        if (data) cloudUser = { id: data.id, nickname: data.nickname };
    }

    function updateIdentityUI() {
        const idEl = document.getElementById('predict-identity');
        const loginBtn = document.getElementById('auth-login-btn');
        const logoutBtn = document.getElementById('auth-logout-btn');
        if (idEl) {
            if (cloudUser) {
                idEl.textContent = '👤 ' + cloudUser.nickname;
                idEl.classList.remove('hidden');
            } else {
                idEl.classList.add('hidden');
            }
        }
        if (loginBtn) loginBtn.classList.toggle('hidden', !!cloudUser);
        if (logoutBtn) logoutBtn.classList.toggle('hidden', !cloudUser);
    }

    // Tiered scoring: exact=5, correct goal diff=3, correct outcome=1, wrong=0.
    function scoreOne(pred, actual) {
        if (!actual || !isMatchFinished(actual)) return null;
        const a1 = parseInt(actual.score1), a2 = parseInt(actual.score2);
        if (Number.isNaN(a1) || Number.isNaN(a2)) return null;
        const p1 = pred.score1, p2 = pred.score2;
        if (p1 === a1 && p2 === a2) return 5;
        if ((p1 - p2) === (a1 - a2)) return 3;
        if (Math.sign(p1 - p2) === Math.sign(a1 - a2)) return 1;
        return 0;
    }

    function localPredictionRows(userId) {
        const raw = localStorage.getItem(PREDICT_CACHE_KEY);
        if (!raw) return { rows: [], skipped: 0 };
        let cache = {};
        try { cache = JSON.parse(raw); } catch (e) { return { rows: [], skipped: 0 }; }
        const rows = [];
        let skipped = 0;
        for (const key in cache) {
            const c = cache[key];
            const s1 = parseInt(c.score1), s2 = parseInt(c.score2);
            if (Number.isNaN(s1) || Number.isNaN(s2)) continue;
            // Lock: don't publish predictions for matches that already kicked off.
            const actual = findOriginalMatch(key);
            if (actual && actual.time && new Date(actual.time).getTime() <= Date.now()) { skipped++; continue; }
            let pens1 = null, pens2 = null;
            if (c.penalties) {
                const pm = String(c.penalties).match(/(\d+)\s*[-–]\s*(\d+)/);
                if (pm) { pens1 = parseInt(pm[1]); pens2 = parseInt(pm[2]); }
            }
            rows.push({ user_id: userId, match_num: parseInt(key), score1: s1, score2: s2, pens1, pens2, published: true, updated_at: new Date().toISOString() });
        }
        return { rows, skipped };
    }

    async function fetchOthersPredictions() {
        if (!sb) return;
        const { data, error } = await sb.from('predictions')
            .select('user_id, match_num, score1, score2, pens1, pens2, profiles(nickname)')
            .eq('published', true);
        if (error) { console.warn('fetchOthersPredictions:', error.message); return; }
        othersPredictions = (data || []).map(r => ({
            user_id: r.user_id, match_num: r.match_num,
            score1: r.score1, score2: r.score2, pens1: r.pens1, pens2: r.pens2,
            nickname: (r.profiles && r.profiles.nickname) || '???'
        }));
    }

    function renderLeaderboard() {
        const el = document.getElementById('leaderboard-container');
        if (!el) return;
        const agg = {};
        for (const p of othersPredictions) {
            const actual = findOriginalMatch(p.match_num);
            const s = scoreOne(p, actual);
            if (s === null) continue;
            const a = agg[p.user_id] || (agg[p.user_id] = { nick: p.nickname, pts: 0, hits: 0, total: 0 });
            a.pts += s; a.total++; if (s > 0) a.hits++;
        }
        const rows = Object.values(agg).sort((x, y) => y.pts - x.pts || y.hits - x.hits);
        if (!rows.length) {
            el.innerHTML = '<p class="lb-empty">No scored predictions yet. Publish predictions and check back once matches finish.</p>';
            return;
        }
        el.innerHTML =
            '<p class="lb-legend">Exact score <b>+5</b> &middot; Correct goal difference <b>+3</b> &middot; Correct result <b>+1</b></p>' +
            '<table class="lb-table"><thead><tr><th>#</th><th>Player</th><th>Points</th><th>Hits</th><th>Success</th></tr></thead><tbody>' +
            rows.map((r, i) => {
                const rate = r.total ? Math.round(r.hits / r.total * 100) : 0;
                const me = (cloudUser && r.nick === cloudUser.nickname) ? ' class="lb-me"' : '';
                return `<tr${me}><td>${i + 1}</td><td>${escapeHtml(r.nick)}</td><td>${r.pts}</td><td>${r.hits}/${r.total}</td><td>${rate}%</td></tr>`;
            }).join('') +
            '</tbody></table>';
    }

    function flashPublish(msg) {
        const btn = document.getElementById('predict-publish');
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = msg;
        btn.classList.add('published-flash');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('published-flash'); }, 2200);
    }

    async function doPublish() {
        if (!sb) { alert('Cloud predictions not configured.'); return; }
        if (!cloudUser) { publishAfterAuth = true; openAuthModal('login'); return; }
        const { rows, skipped } = localPredictionRows(cloudUser.id);
        if (!rows.length) {
            alert(skipped
                ? 'All your predicted matches have already kicked off — nothing left to publish.'
                : 'No predicted scores yet. Turn on Predict Mode and enter some scores first.');
            return;
        }
        const { error } = await sb.from('predictions').upsert(rows, { onConflict: 'user_id,match_num' });
        if (error) { alert('Publish failed: ' + error.message); return; }
        flashPublish('✅ Published ' + rows.length + (skipped ? ' (' + skipped + ' locked)' : ''));
        await fetchOthersPredictions();
        renderLeaderboard();
        refreshPredictionViews();
    }

    // ---- Auth modal (login / signup) ----
    let authMode = 'login';
    let publishAfterAuth = false;

    function setAuthError(m) {
        const err = document.getElementById('auth-error');
        if (!err) return;
        if (m) { err.textContent = m; err.classList.remove('hidden'); }
        else { err.textContent = ''; err.classList.add('hidden'); }
    }

    function renderAuthMode() {
        const title = document.getElementById('auth-title');
        const sub = document.getElementById('auth-sub');
        const submit = document.getElementById('auth-submit');
        const sw = document.getElementById('auth-switch');
        const pw = document.getElementById('auth-password');
        if (authMode === 'signup') {
            if (title) title.textContent = 'Sign up';
            if (sub) sub.textContent = 'Create an account to publish predictions and join the leaderboard.';
            if (submit) submit.textContent = 'Sign up';
            if (sw) sw.textContent = 'Have an account? Log in';
            if (pw) pw.autocomplete = 'new-password';
        } else {
            if (title) title.textContent = 'Log in';
            if (sub) sub.textContent = 'Log in to publish predictions and join the leaderboard.';
            if (submit) submit.textContent = 'Log in';
            if (sw) sw.textContent = 'Need an account? Sign up';
            if (pw) pw.autocomplete = 'current-password';
        }
    }

    function openAuthModal(mode) {
        authMode = mode || 'login';
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        setAuthError('');
        renderAuthMode();
        modal.classList.remove('hidden');
        const u = document.getElementById('auth-username');
        if (u) u.focus();
    }
    function closeAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.classList.add('hidden');
        publishAfterAuth = false;
    }

    async function submitAuth() {
        if (!sb) { setAuthError('Cloud not configured.'); return; }
        const uEl = document.getElementById('auth-username');
        const pEl = document.getElementById('auth-password');
        const submit = document.getElementById('auth-submit');
        const username = (uEl.value || '').trim();
        const password = pEl.value || '';
        if (!/^[a-zA-Z0-9._-]{2,24}$/.test(username)) {
            setAuthError('Username: 2–24 chars, letters/digits and . _ - only.'); return;
        }
        if (password.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }
        const email = usernameToEmail(username);
        if (submit) submit.disabled = true;
        setAuthError('');
        try {
            if (authMode === 'signup') {
                const { data, error } = await sb.auth.signUp({ email, password });
                if (error) { setAuthError(mapAuthError(error)); return; }
                if (!data.session) {
                    setAuthError('Account created, but the server requires email confirmation. Disable it in Supabase (Auth → Providers → Email) for username login.');
                    return;
                }
                const { error: pErr } = await sb.from('profiles').upsert({ id: data.user.id, nickname: username });
                if (pErr) {
                    setAuthError(pErr.code === '23505' ? 'That username is taken — pick another.' : pErr.message);
                    return;
                }
                cloudUser = { id: data.user.id, nickname: username };
            } else {
                const { data, error } = await sb.auth.signInWithPassword({ email, password });
                if (error) { setAuthError(mapAuthError(error)); return; }
                await loadProfile(data.user.id);
                if (!cloudUser) cloudUser = { id: data.user.id, nickname: username };
            }
            const wantPublish = publishAfterAuth;
            closeAuthModal();
            updateIdentityUI();
            await fetchOthersPredictions();
            renderLeaderboard();
            refreshPredictionViews();
            if (wantPublish) await doPublish();
        } catch (e) {
            setAuthError((e && e.message) || 'Authentication failed.');
        } finally {
            if (submit) submit.disabled = false;
        }
    }

    async function doLogout() {
        if (sb) await sb.auth.signOut();
        cloudUser = null;
        updateIdentityUI();
        renderLeaderboard();
        refreshPredictionViews();
    }

    // ---- Per-match prediction reveal (inside the hover-expanded card) ----
    function cardMatchId(card) {
        const inp = card.querySelector('.score-input[data-id]');
        return inp ? inp.dataset.id : null;
    }

    // Inject a "see predictions" button into each card's hover-expanded
    // details. The full breakdown opens in a modal when the button is clicked.
    function refreshPredictionViews() {
        const counts = {};
        for (const p of othersPredictions) counts[p.match_num] = (counts[p.match_num] || 0) + 1;
        document.querySelectorAll('.match-row, .knockout-match').forEach(card => {
            const det = card.querySelector('.match-details');
            if (!det) return;
            const old = det.querySelector('.preds-open-btn');
            if (old) old.remove();
            const id = cardMatchId(card);
            if (!id) return;
            const c = counts[id];
            if (!c) return;
            const btn = document.createElement('button');
            btn.className = 'preds-open-btn';
            btn.dataset.predsMatch = id;
            btn.textContent = '👥 ' + c + ' prediction' + (c > 1 ? 's' : '');
            det.appendChild(btn);
        });
    }

    function openPredsModal(num) {
        const modal = document.getElementById('preds-modal');
        const title = document.getElementById('preds-title');
        const body = document.getElementById('preds-body');
        if (!modal) return;
        const list = othersPredictions.filter(p => String(p.match_num) === String(num));
        const actual = findOriginalMatch(num);
        const finished = !!(actual && isMatchFinished(actual));
        title.textContent = actual ? ((actual.team1 || '?') + ' vs ' + (actual.team2 || '?')) : 'Predictions';

        const total = list.length;
        const dist = {};
        for (const p of list) { const k = p.score1 + '–' + p.score2; dist[k] = (dist[k] || 0) + 1; }
        const distRows = Object.entries(dist).sort((a, b) => b[1] - a[1]);

        let html = '';
        if (finished) {
            html += `<p class="preds-actual">Final: <b>${actual.score1}–${actual.score2}</b>${actual.penalties ? ' (' + escapeHtml(actual.penalties) + ')' : ''}</p>`;
        }
        html += '<div class="preds-dist">' + distRows.map(([k, n]) => {
            const pct = total ? Math.round(n / total * 100) : 0;
            return `<div class="preds-bar-row"><span class="preds-score">${escapeHtml(k)}</span><span class="preds-bar"><span class="preds-bar-fill" style="width:${pct}%"></span></span><span class="preds-count">${n}</span></div>`;
        }).join('') + '</div>';

        const sorted = list.slice().sort((a, b) => (scoreOne(b, actual) || 0) - (scoreOne(a, actual) || 0));
        html += '<table class="preds-table"><thead><tr><th>Player</th><th>Pick</th>' + (finished ? '<th>Pts</th>' : '') + '</tr></thead><tbody>';
        html += sorted.map(p => {
            const pts = finished ? scoreOne(p, actual) : null;
            const pens = (p.pens1 != null && p.pens2 != null) ? ` <span class="preds-pens">(${p.pens1}–${p.pens2} pens)</span>` : '';
            const ptsCell = finished ? `<td>${pts > 0 ? '+' + pts : pts}</td>` : '';
            return `<tr><td>${escapeHtml(p.nickname)}</td><td>${p.score1}–${p.score2}${pens}</td>${ptsCell}</tr>`;
        }).join('') + '</tbody></table>';

        body.innerHTML = html;
        modal.classList.remove('hidden');
    }

    document.body.addEventListener('click', e => {
        const b = e.target.closest('.preds-open-btn');
        if (b) openPredsModal(b.dataset.predsMatch);
    });

    async function cloudInit() {
        if (!sb) { console.warn('Supabase client not found — cloud predictions disabled.'); return; }
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (session) await loadProfile(session.user.id);
            updateIdentityUI();
            await fetchOthersPredictions();
            renderLeaderboard();
            refreshPredictionViews();
        } catch (e) { console.warn('cloudInit:', e.message); }
    }

    const publishBtn = document.getElementById('predict-publish');
    if (publishBtn) publishBtn.addEventListener('click', doPublish);

    const loginBtn = document.getElementById('auth-login-btn');
    if (loginBtn) loginBtn.addEventListener('click', () => openAuthModal('login'));
    const logoutBtn = document.getElementById('auth-logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);

    const authSubmit = document.getElementById('auth-submit');
    if (authSubmit) authSubmit.addEventListener('click', submitAuth);
    const authSwitch = document.getElementById('auth-switch');
    if (authSwitch) authSwitch.addEventListener('click', () => { openAuthModal(authMode === 'login' ? 'signup' : 'login'); });
    const authModal = document.getElementById('auth-modal');
    if (authModal) {
        const bd = authModal.querySelector('.modal-backdrop');
        if (bd) bd.addEventListener('click', closeAuthModal);
        const cl = authModal.querySelector('.overlay-close');
        if (cl) cl.addEventListener('click', closeAuthModal);
        ['auth-username', 'auth-password'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
        });
    }
    const predsModal = document.getElementById('preds-modal');
    if (predsModal) {
        const bd = predsModal.querySelector('.modal-backdrop');
        const cl = predsModal.querySelector('.overlay-close');
        if (bd) bd.addEventListener('click', () => predsModal.classList.add('hidden'));
        if (cl) cl.addEventListener('click', () => predsModal.classList.add('hidden'));
    }

    cloudInit();

    function prefetchMatchLineups() {
        const candidates = [];
        for (const g in matchData.groups) {
            for (const m of matchData.groups[g]) {
                if (m._espnEventId && (m._espnStatusState === 'in' || m._espnStatusState === 'post')) {
                    candidates.push(m);
                }
            }
        }
        for (const r in matchData.knockout) {
            for (const m of matchData.knockout[r]) {
                if (m._espnEventId && (m._espnStatusState === 'in' || m._espnStatusState === 'post')) {
                    candidates.push(m);
                }
            }
        }
        for (const m of candidates) {
            const eid = m._espnEventId;
            if (m._espnStatusState === 'in' || !summaryCache.has(eid)) {
                fetchMatchSummary(eid).catch(() => {});
            }
        }
    }

    // Auto-refresh live scores every 30 seconds
    setInterval(async () => {
        if (predictMode) return; // skip while user is predicting
        try {
            await loadData();
            await fetchOthersPredictions();
            prefetchMatchLineups();
            renderAll();
            populateFilterOptions();
            rebindHoverExpand();
            applyFilters();
            renderLeaderboard();
        } catch (e) {
            console.warn('Auto-refresh failed:', e.message);
        }
    }, 30000);
});
