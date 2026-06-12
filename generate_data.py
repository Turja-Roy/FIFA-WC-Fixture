import json
from datetime import datetime, timedelta

# Mock data generation for 2026 World Cup
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

teams = {
    'A': ['Mexico', 'South Africa', 'Team A3', 'Team A4'],
    'B': ['Canada', 'Team B2', 'Team B3', 'Team B4'],
    'C': ['Team C1', 'Team C2', 'Team C3', 'Team C4'],
    'D': ['USA', 'Paraguay', 'Australia', 'Turkey'],
    'E': ['Team E1', 'Team E2', 'Team E3', 'Team E4'],
    'F': ['Team F1', 'Team F2', 'Team F3', 'Team F4'],
    'G': ['Team G1', 'Team G2', 'Team G3', 'Team G4'],
    'H': ['Team H1', 'Team H2', 'Team H3', 'Team H4'],
    'I': ['Team I1', 'Team I2', 'Team I3', 'Team I4'],
    'J': ['Team J1', 'Team J2', 'Team J3', 'Team J4'],
    'K': ['Team K1', 'Team K2', 'Team K3', 'Team K4'],
    'L': ['Team L1', 'Team L2', 'Team L3', 'Team L4'],
}

data = {"groups": {}, "knockout": {}}
match_id = 1
start_date = datetime(2026, 6, 11, 15, 0)

import random
random.seed(42)

for g in groups:
    group_matches = []
    g_teams = teams[g]
    pairs = [(0,1), (2,3), (0,2), (1,3), (0,3), (1,2)]
    
    for i, pair in enumerate(pairs):
        match_time = start_date + timedelta(days=match_id//4, hours=(match_id%4)*3)
        group_matches.append({
            "id": match_id,
            "team1": g_teams[pair[0]],
            "team2": g_teams[pair[1]],
            "score1": "",
            "score2": "",
            "time": match_time.strftime("%Y-%m-%d %H:%M"),
            "stadium": stadiums[match_id % len(stadiums)]
        })
        match_id += 1
    data["groups"][g] = group_matches

# Knockout stages
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
            "team1": f"TBD",
            "team2": f"TBD",
            "score1": "",
            "score2": "",
            "penalties": "",
            "time": match_time.strftime("%Y-%m-%d %H:%M"),
            "stadium": stadiums[match_id % len(stadiums)]
        })
        match_id += 1
    data["knockout"][r_name] = r_matches

with open('data.json', 'w') as f:
    json.dump(data, f, indent=4)
