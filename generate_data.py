import json
from datetime import datetime, timedelta

groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
stadiums = [
    "Estadio Azteca, Mexico City", "MetLife Stadium, New York/New Jersey", 
    "AT&T Stadium, Dallas", "Arrowhead Stadium, Kansas City", 
    "NRG Stadium, Houston", "Mercedes-Benz Stadium, Atlanta", 
    "SoFi Stadium, Los Angeles", "Lincoln Financial Field, Philadelphia",
    "Lumen Field, Seattle", "Levi's Stadium, San Francisco Bay Area",
    "Gillette Stadium, Boston", "Hard Rock Stadium, Miami",
    "BMO Field, Toronto", "BC Place, Vancouver",
    "Estadio BBVA, Monterrey", "Estadio Akron, Guadalajara"
]

# 48 Real Teams and their ISO 3166-1 alpha-2 codes for flagcdn
teams_data = [
    ("Mexico", "mx"), ("South Africa", "za"), ("Sweden", "se"), ("Ecuador", "ec"),
    ("Canada", "ca"), ("Japan", "jp"), ("Nigeria", "ng"), ("Austria", "at"),
    ("USA", "us"), ("Paraguay", "py"), ("Australia", "au"), ("Turkey", "tr"),
    ("Argentina", "ar"), ("Saudi Arabia", "sa"), ("Switzerland", "ch"), ("Mali", "ml"),
    ("Brazil", "br"), ("Morocco", "ma"), ("Denmark", "dk"), ("Peru", "pe"),
    ("France", "fr"), ("South Korea", "kr"), ("Serbia", "rs"), ("Costa Rica", "cr"),
    ("England", "gb-eng"), ("Senegal", "sn"), ("Poland", "pl"), ("Venezuela", "ve"),
    ("Spain", "es"), ("Iran", "ir"), ("Croatia", "hr"), ("Panama", "pa"),
    ("Germany", "de"), ("Egypt", "eg"), ("Wales", "gb-wls"), ("Chile", "cl"),
    ("Portugal", "pt"), ("Algeria", "dz"), ("Hungary", "hu"), ("Jamaica", "jm"),
    ("Italy", "it"), ("Cameroon", "cm"), ("Ukraine", "ua"), ("Honduras", "hn"),
    ("Netherlands", "nl"), ("Ghana", "gh"), ("Czechia", "cz"), ("New Zealand", "nz")
]

teams = {}
for i, g in enumerate(groups):
    teams[g] = teams_data[i*4 : (i+1)*4]

data = {"groups": {}, "knockout": {}}
match_id = 1
# Set starting time in UTC
start_date = datetime(2026, 6, 11, 20, 0)

for g in groups:
    group_matches = []
    g_teams = teams[g]
    pairs = [(0,1), (2,3), (0,2), (1,3), (0,3), (1,2)]
    
    for i, pair in enumerate(pairs):
        match_time = start_date + timedelta(days=match_id//4, hours=(match_id%4)*3)
        group_matches.append({
            "id": match_id,
            "team1": g_teams[pair[0]][0],
            "code1": g_teams[pair[0]][1],
            "team2": g_teams[pair[1]][0],
            "code2": g_teams[pair[1]][1],
            "score1": "",
            "score2": "",
            "time": match_time.isoformat() + "Z", # Store as UTC
            "stadium": stadiums[match_id % len(stadiums)]
        })
        match_id += 1
    data["groups"][g] = group_matches

rounds = [
    ("Round of 32", 16),
    ("Round of 16", 8),
    ("Quarter-finals", 4),
    ("Semi-finals", 2),
    ("Final", 1)
]

for r_name, num_matches in rounds:
    r_matches = []
    for i in range(num_matches):
        match_time = start_date + timedelta(days=15 + match_id//3)
        r_matches.append({
            "id": match_id,
            "team1": "TBD",
            "code1": "un", # unknown
            "team2": "TBD",
            "code2": "un",
            "score1": "",
            "score2": "",
            "penalties": "",
            "time": match_time.isoformat() + "Z",
            "stadium": stadiums[match_id % len(stadiums)]
        })
        match_id += 1
    data["knockout"][r_name] = r_matches

with open('data.json', 'w') as f:
    json.dump(data, f, indent=4)
