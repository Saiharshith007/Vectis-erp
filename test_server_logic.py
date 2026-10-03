"""Self-check for the per-item save, serial-number and audit-log logic in server.py.
Run: python test_server_logic.py   (no DATABASE_URL needed — pure functions)."""
from server import _apply_item_op, _apply_serial_op, _append_only_log

# --- item upsert/delete (fixes whole-collection clobber) ---
lst = _apply_item_op([], 'upsert', item={'id': 'a', 'v': 1})
assert lst == [{'id': 'a', 'v': 1}], lst

# re-upsert same id replaces in place, never duplicates
lst = _apply_item_op(lst, 'upsert', item={'id': 'a', 'v': 2})
assert lst == [{'id': 'a', 'v': 2}], lst

# THE bug this fixes: adding a different doc to a list that already grew keeps BOTH
lst = _apply_item_op([{'id': 'a'}], 'upsert', item={'id': 'b'})
assert {d['id'] for d in lst} == {'a', 'b'}, lst

# upsertMany applies all
lst = _apply_item_op([], 'upsertMany', items=[{'id': 'x'}, {'id': 'y'}])
assert {d['id'] for d in lst} == {'x', 'y'}, lst

# delete removes only the target
lst = _apply_item_op([{'id': 'a'}, {'id': 'b'}], 'delete', item_id='a')
assert [d['id'] for d in lst] == ['b'], lst

# garbage items are skipped, not crashed on
lst = _apply_item_op([], 'upsert', item={'no_id': True})
assert lst == [], lst

# --- serial allocation (fixes duplicate document numbers) ---
c = []
c, n1 = _apply_serial_op(c, 'increment', 'PO', '', '2627')
c, n2 = _apply_serial_op(c, 'increment', 'PO', '', '2627')
assert (n1, n2) == (1, 2), (n1, n2)          # two allocations are always distinct

# a different (docType, fy) counts independently
c, m = _apply_serial_op(c, 'increment', 'QU', '', '2627')
assert m == 1, m

# bump only moves forward, never rewinds
c, b1 = _apply_serial_op(c, 'bump', 'PO', '', '2627', value=1)
assert b1 == 2, b1                            # 1 < current 2 → unchanged
c, b2 = _apply_serial_op(c, 'bump', 'PO', '', '2627', value=10)
assert b2 == 10, b2
c, n3 = _apply_serial_op(c, 'increment', 'PO', '', '2627')
assert n3 == 11, n3                           # increment continues past the bump

# --- audit log is append-only for non-admins ---
log = [{'id': 'a', 'details': 'real'}]
assert _append_only_log(log, []) == log                                  # can't clear
assert _append_only_log(log, [{'id': 'a', 'details': 'x'}]) == log       # can't rewrite
merged = _append_only_log(log, [{'id': 'b', 'details': 'new'}])
assert [e['id'] for e in merged] == ['b', 'a'], merged                   # can append, newest first

print('ok')
