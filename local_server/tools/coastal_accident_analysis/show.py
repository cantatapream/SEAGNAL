import sys, pandas as pd
pd.set_option('display.width', 250); pd.set_option('display.max_rows', 2000)
f, models = sys.argv[1], sys.argv[2].split(',')
subs = sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] else None
r = pd.read_csv(f)
for c in ['RR', 'lo', 'hi', 'p', 'ref_share']: r[c] = r[c].round(3)
r = r[~r.term.str.startswith('dow') & (r.term != 'hol')]
for m in models:
    x = r[r.model.str.startswith(m)]
    if subs: x = x[x.subset.isin(subs)]
    print(x[['model', 'subset', 'term', 'RR', 'lo', 'hi', 'n_events', 'cases_with', 'ref_share']].to_string(index=False))
