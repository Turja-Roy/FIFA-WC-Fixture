document.addEventListener('DOMContentLoaded', async () => {
    let matchData = null;
    const STORAGE_KEY = 'wc2026_scores';

    // Load data from JSON and Merge with LocalStorage
    async function loadData() {
        try {
            const response = await fetch('data.json');
            matchData = await response.json();
            
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
            setupTooltips();

        } catch (error) {
            console.error("Error loading data:", error);
            document.getElementById('groups-container').innerHTML = '<p>Error loading match data. Please ensure data.json is available.</p>';
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
                row.dataset.info = `Kickoff: ${match.time}\nStadium: ${match.stadium}`;

                row.innerHTML = `
                    <div class="team">${match.team1}</div>
                    <div class="score-box">
                        <input type="number" class="score-input" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                        <span>-</span>
                        <input type="number" class="score-input" data-id="${match.id}" data-team="2" value="${match.score2}" min="0">
                    </div>
                    <div class="team right">${match.team2}</div>
                `;
                groupCard.appendChild(row);
            });

            container.appendChild(groupCard);
        }
    }

    function createKnockoutMatchHtml(match, isFinal = false) {
        let pensInput = isFinal || match.id > 72 ? `<input type="text" class="penalties-input" data-id="${match.id}" placeholder="e.g. 4-3 pens" value="${match.penalties || ''}">` : '';
        return `
            <div class="knockout-match hover-target ${isFinal ? 'final-match' : ''}" data-info="Kickoff: ${match.time}\nStadium: ${match.stadium}">
                ${isFinal ? '<div class="final-label">Final</div>' : ''}
                <div class="ko-team-row">
                    <span class="ko-team">${match.team1}</span>
                    <input type="number" class="score-input ko-score" data-id="${match.id}" data-team="1" value="${match.score1}" min="0">
                </div>
                <div class="ko-team-row">
                    <span class="ko-team">${match.team2}</span>
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

    function setupTooltips() {
        const tooltip = document.getElementById('tooltip');
        
        document.body.addEventListener('mousemove', e => {
            const target = e.target.closest('.hover-target');
            if (target) {
                tooltip.textContent = target.dataset.info;
                tooltip.classList.remove('hidden');
                
                // Position tooltip
                let top = e.pageY + 15;
                let left = e.pageX + 15;
                
                // Prevent going off screen
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

    // Event Delegation for Input Changes
    document.body.addEventListener('input', e => {
        if (e.target.classList.contains('score-input')) {
            const matchId = e.target.dataset.id;
            const team = e.target.dataset.team;
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

    // Buttons
    document.getElementById('reset-btn').addEventListener('click', () => {
        if(confirm("Are you sure you want to clear all your entered scores?")) {
            localStorage.removeItem(STORAGE_KEY);
            loadData();
        }
    });

    document.getElementById('export-btn').addEventListener('click', () => {
        const savedData = localStorage.getItem(STORAGE_KEY);
        if(!savedData || savedData === '{}') {
            alert('No custom scores to export yet.');
            return;
        }
        
        // Make a deep copy to export
        const exportObj = JSON.parse(JSON.stringify(matchData));
        const customScores = JSON.parse(savedData);

        for(const group in exportObj.groups) {
            exportObj.groups[group].forEach(m => {
                if(customScores[m.id]) {
                    m.score1 = customScores[m.id].score1;
                    m.score2 = customScores[m.id].score2;
                }
            });
        }
        for(const stage in exportObj.knockout) {
            exportObj.knockout[stage].forEach(m => {
                if(customScores[m.id]) {
                    m.score1 = customScores[m.id].score1;
                    m.score2 = customScores[m.id].score2;
                    if(customScores[m.id].penalties !== undefined) {
                        m.penalties = customScores[m.id].penalties;
                    }
                }
            });
        }

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 4));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "data.json");
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    loadData();
});
