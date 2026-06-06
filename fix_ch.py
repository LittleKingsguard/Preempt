with open('server/seed.sql', 'r') as f:
    lines = f.readlines()

ch_insert_idx = None
already_has_19 = False
for i, line in enumerate(lines):
    if line.startswith('2\t19\t'):
        already_has_19 = True
    if line.strip() == '\\.' and '2\t18\t' in lines[i-1]:
        ch_insert_idx = i
        break

if ch_insert_idx is not None and not already_has_19:
    lines.insert(ch_insert_idx, "2\t19\t2026-05-27 22:52:47.319007+00\t2026-05-27 22:52:47.319007+00\n")
    with open('server/seed.sql', 'w') as f:
        f.writelines(lines)
