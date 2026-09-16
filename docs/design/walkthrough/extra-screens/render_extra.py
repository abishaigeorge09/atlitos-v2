import os, json
FULL = "/private/tmp/claude-502/-Users-Candy-atlitos/82ac8511-d6ae-4340-96fc-3b0787565134/scratchpad/board/full"
__file__ = os.path.abspath(FULL + "/lib.py")
exec(open(FULL + "/lib.py").read())
exec(open(FULL + "/v2/screens_home.py").read())
before = set(S)
clip_hits = result_card('Last over, six needed', 'Kiran Rao, Cricket, 3h ago', '128 likes') + result_card('Cover drive at nets', 'Arjun Mehta, Cricket, 2h ago', '48 likes') + result_card('Backlift check from Tuesday', 'Priya Nair, Badminton, 1d ago')
add('home-search-results-clips', phone(search_bar + scroll(search_input('badminton', focus=False) + f'<div class="col" style="gap: 12px;">{results_header("badminton")}{segment_tabs("Clips", ["Coaches", "Courts", "Gear", "Clips"])}{clip_hits}</div>', gap=20)))
court_hits = result_card('Turf One', 'Gachibowli Sports Arena, 3.4 km', 'Closest', '₹800') + result_card('Court 2', 'Jubilee Hills Badminton Hall, 6.1 km', None, '₹600') + result_card('Pitch B', 'Kondapur Cricket Grounds, 7.8 km', None, '₹1,770')
add('home-search-results-courts', phone(search_bar + scroll(search_input('badminton', focus=False) + f'<div class="col" style="gap: 12px;">{results_header("badminton")}{segment_tabs("Courts", ["Coaches", "Courts", "Gear", "Clips"])}{court_hits}</div>', gap=20)))
gear_hits = result_card('Yonex Astrox 22 RS Badminton Racket', 'Rackets, 12 in stock', 'Best price match', '₹4,299') + result_card('Yonex Mavis 350 Shuttlecocks, tube of 6', 'Shuttles, 40 in stock', None, '₹1,150') + result_card('Li Ning feather shuttlecocks, pack of 12', 'Shuttles, 8 in stock', None, '₹1,299')
add('home-search-results-gear', phone(search_bar + scroll(search_input('badminton', focus=False) + f'<div class="col" style="gap: 12px;">{results_header("badminton")}{segment_tabs("Gear", ["Coaches", "Courts", "Gear", "Clips"])}{gear_hits}</div>', gap=20)))
new = [k for k in S if k not in before]
out = os.path.dirname(os.path.abspath("extra/render_extra.py")) + "/extra/html"
os.makedirs(out, exist_ok=True)
jobs = []
start = 1018
for i, k in enumerate(new):
    name = f"{start+i:03d}-{k}"
    open(f"{out}/{name}.html", "w").write(f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}@keyframes spin{{to{{transform:rotate(360deg)}}}}.spin{{animation:spin .9s linear infinite}}</style></head><body>{S[k]}</body></html>')
    jobs.append([f"extra/html/{name}.html", name])
json.dump(jobs, open("extra/jobs.json", "w"))
print(jobs)
