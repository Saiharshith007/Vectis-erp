/* ============================================
   Storage Module — localStorage CRUD + backup
   ============================================ */

// Redirect API calls to localhost:8000 if running via file:// protocol (double-clicked index.html)
(function() {
    if (window.location.protocol === 'file:') {
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
            if (typeof input === 'string' && input.startsWith('/api/')) {
                input = 'http://localhost:8000' + input;
            } else if (input && typeof input === 'object' && typeof input.url === 'string' && input.url.startsWith('/api/')) {
                const newUrl = 'http://localhost:8000' + input.url;
                input = new Request(newUrl, input);
            }
            return originalFetch(input, init);
        };
    }
})();

const Storage = (() => {
    // Organisation code that prefixes every document number (ORG/0001/2627,
    // ORG001/ABC001/PO/2627, ...). Letters/digits only — it is used in regexes.
    const ORG_CODE = 'ORG';

    const PO_KEY = 'po_documents';
    const QU_KEY = 'qu_documents';
    const INV_KEY = 'inv_documents';
    const PROF_KEY = 'prof_documents';
    const TM_KEY = 'tm_documents';
    const VENDORS_KEY = 'saved_vendors';
    const SUPPLIERS_KEY = 'saved_suppliers';
    const CORR_BANKS_KEY = 'saved_correspondent_banks';
    const BENEF_BANKS_KEY = 'saved_beneficiary_banks';
    const ULT_BENEF_KEY = 'saved_ultimate_beneficiary';
    const DOMESTIC_BANKS_KEY = 'saved_domestic_banks';
    const SETTINGS_KEY = 'app_settings';
    const PO_COL_VISIBILITY_KEY = 'po_column_visibility';
    const QU_COL_VISIBILITY_KEY = 'qu_column_visibility';
    const INV_COL_VISIBILITY_KEY = 'inv_column_visibility';
    const COUNTERS_KEY = 'document_counters';
    const RECEIPTS_KEY = 'receipt_documents';
    const SALES_RETURNS_KEY = 'sales_return_documents';
    const RECEIPT_BANKS_KEY = 'receipt_banks';
    const UOM_KEY = 'uom_list';
    const ACT_KEY = 'activity_log';
    const USERS_KEY = 'auth_users';
    const PENDING_KEY = 'auth_pending_users';
    const ADMIN_PWD_KEY = 'auth_password_hash';

    // In-memory cache for all tables
    const _dbCache = {
        [PO_KEY]: [],
        [QU_KEY]: [],
        [INV_KEY]: [],
        [PROF_KEY]: [],
        [TM_KEY]: [],
        [ACT_KEY]: [],
        [VENDORS_KEY]: [],
        [SUPPLIERS_KEY]: [],
        [CORR_BANKS_KEY]: [],
        [BENEF_BANKS_KEY]: [],
        [ULT_BENEF_KEY]: [],
        [DOMESTIC_BANKS_KEY]: [],
        [SETTINGS_KEY]: {},
        [PO_COL_VISIBILITY_KEY]: {
            sno: true,
            name: true,
            spec: true,
            uom: true,
            qty: true,
            rate: true,
            discount: false,
            amount: true
        },
        [QU_COL_VISIBILITY_KEY]: {
            sno: true,
            desc: true,
            uom: true,
            qty: true,
            rate: true,
            discount: true,
            amount: true
        },
        [INV_COL_VISIBILITY_KEY]: {
            qty: true,
            hours: true,
            rate: true
        },
        [COUNTERS_KEY]: [],
        [RECEIPTS_KEY]: [],
        [SALES_RETURNS_KEY]: [],
        [RECEIPT_BANKS_KEY]: [],
        [UOM_KEY]: ['Nos', 'Hrs', 'Days'],
        [USERS_KEY]: [],
        [PENDING_KEY]: [],
        [ADMIN_PWD_KEY]: null
    };

    // --- Generic helpers ---
    function _get(key) {
        return _dbCache[key] || [];
    }

    function _updateServerStatus(isOnline) {
        const el = document.getElementById('server-status-indicator');
        if (!el) return;
        if (isOnline) {
            el.className = 'status-online';
            el.innerHTML = '<span class="status-dot"></span><span class="status-text">Connected</span>';
            el.title = "Connected to Server";
        } else {
            el.className = 'status-offline';
            el.innerHTML = '<span class="status-dot"></span><span class="status-text">Offline (Local Fallback)</span>';
            el.title = "Server is offline. Changes are saved to Local Storage fallback.";
        }
    }

    async function _saveToServer(key, data) {
        try {
            const response = await fetch('/api/db/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify({ key, data })
            });
            if (response.status === 401) { _handle401(); throw new Error('Unauthorized'); }
            if (!response.ok) {
                throw new Error(response.statusText);
            }
            _updateServerStatus(true);
        } catch (error) {
            console.warn(`Server save failed for key ${key}, falling back to localStorage:`, error);
            try {
                localStorage.setItem(key, JSON.stringify(data));
            } catch (e) {
                console.warn('Failed to write to localStorage fallback:', e);
            }
            _updateServerStatus(false);
            if (error.message === 'Unauthorized') {
                return;
            }
            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Server connection offline. Saved locally.', 'warning');
            }
        }
    }

    // Session expired: warn, then log out + reload. Shared by whole-key and
    // item-delta save paths.
    function _handle401() {
        if (typeof App !== 'undefined' && App.showToast) {
            App.showToast('Session expired. Please log in again.', 'error');
            setTimeout(() => {
                if (typeof Auth !== 'undefined' && Auth.logout) {
                    Auth.logout().then(() => { window.location.reload(); });
                } else {
                    window.location.reload();
                }
            }, 1500);
        }
    }

    // Atomic item-level save for document collections (see _ITEM_KEYS server-side).
    // Applies ONE change to the server's current state, so two users editing
    // different documents can't overwrite each other's whole collection like the
    // old whole-array PUT did.
    async function _sendItemDelta(key, body) {
        try {
            const response = await fetch('/api/db/item', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(Object.assign({ key }, body))
            });
            if (response.status === 401) { _handle401(); throw new Error('Unauthorized'); }
            if (!response.ok) throw new Error(response.statusText);
            _updateServerStatus(true);
        } catch (error) {
            console.warn(`Item delta failed for ${key}, saving whole key locally:`, error);
            try { localStorage.setItem(key, JSON.stringify(_dbCache[key])); } catch (e) {}
            _updateServerStatus(false);
            if (error.message !== 'Unauthorized' && typeof App !== 'undefined' && App.showToast) {
                App.showToast('Server connection offline. Saved locally.', 'warning');
            }
        }
    }

    // Update the local cache for a document collection AND persist the single
    // change as an atomic server delta. `list` is the caller's already-mutated
    // full list (kept as the local cache for instant reads).
    function _persistItem(key, item, list) {
        _dbCache[key] = list;
        _sendItemDelta(key, { op: 'upsert', item });
    }
    function _persistItems(key, items, list) {
        _dbCache[key] = list;
        _sendItemDelta(key, { op: 'upsertMany', items });
    }
    function _persistDelete(key, id, list) {
        _dbCache[key] = list;
        _sendItemDelta(key, { op: 'delete', id });
    }

    // Synchronous, server-atomic serial allocation so concurrent document
    // generation can't mint duplicate numbers. Sync XHR is deprecated but ideal
    // here: one tiny request on a deliberate user click, with NO async ripple
    // through every generator in every module. Returns the server number, or
    // null when offline (caller falls back to the local counter).
    // ponytail: sync XHR blocks the UI thread for one round-trip; move to async
    //           allocation only if document generation ever feels slow.
    function _serverSerial(op, docType, month, fy, value) {
        try {
            let url = '/api/db/next-serial';
            if (window.location.protocol === 'file:') url = 'http://localhost:8000' + url;
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.withCredentials = true;
            xhr.send(JSON.stringify({ key: COUNTERS_KEY, docType, month, fy, op, value }));
            if (xhr.status === 200) {
                const n = JSON.parse(xhr.responseText).number;
                _mirrorCounter(docType, month, fy, n);   // keep peekNext* in sync
                _updateServerStatus(true);
                return n;
            }
        } catch (e) {
            console.warn('Server serial allocation failed, using local counter:', e);
        }
        _updateServerStatus(false);
        return null;
    }

    // Reflect a server-allocated serial into the local cache WITHOUT a server
    // write (the server already stored it). Never rewinds.
    function _mirrorCounter(docType, month, fy, n) {
        const counters = _getCounters();
        const rec = counters.find(c => c.doc_type === docType && c.month === month && c.fy === fy);
        if (rec) { if (n > rec.last_number) rec.last_number = n; }
        else { counters.push({ id: _generateId('CNT'), doc_type: docType, month: month, fy: fy, last_number: n }); }
        _dbCache[COUNTERS_KEY] = counters;
    }

    function _set(key, data) {
        _dbCache[key] = data;

        // app_settings is intentionally NOT admin-only here: the server lets any
        // logged-in user persist the shared signature fields and their own
        // per-user save paths (and preserves everything else server-side).
        const adminOnlyKeys = [USERS_KEY, PENDING_KEY, ADMIN_PWD_KEY];
        const isAdmin = typeof Auth !== 'undefined' && typeof Auth.isAdmin === 'function' && Auth.isAdmin();

        if (adminOnlyKeys.includes(key) && !isAdmin) {
            // Save locally but skip server upload to avoid 403 Forbidden errors
            try {
                localStorage.setItem(key, JSON.stringify(data));
            } catch (e) {
                console.warn('Failed to save settings locally in fallback:', e);
            }
            return;
        }

        _saveToServer(key, data);
    }

    function generateClientCode(name) {
        if (!name) return 'XXX';
        const orgCode = ORG_CODE;
        let cleaned = name.replace(/\([^)]*\)/g, ' ');
        cleaned = cleaned.replace(/[^a-zA-Z0-9]/g, ' ');
        const words = cleaned
            .split(/\s+/)
            .map(word => word.trim())
            .filter(word =>
                word.length > 0 &&
                !['pvt', 'ltd', 'private', 'limited', '&', 'p'].includes(word.toLowerCase())
            );

        let code = '';
        if (words.length >= 3) {
            code = words[0][0] + words[1][0] + words[2][0];
        } else if (words.length === 2) {
            const w1 = words[0];
            const w2 = words[1];
            code = w1.substring(0, 2) + w2.substring(0, 1);
            if (code.length < 3 && w2.length > 1) {
                code = w1 + w2.substring(0, 2);
            }
        } else if (words.length === 1) {
            code = words[0].substring(0, 3);
        }

        code = code.toUpperCase();
        while (code.length < 3) {
            code += 'X';
        }

        // Resolve conflict if the client code is the same as the organization code
        if (code === orgCode) {
            if (words.length >= 3) {
                const char2 = words[0][1] ? words[0][1] : 'X';
                code = (words[0][0] + char2 + words[2][0]).toUpperCase();
            } else if (words.length === 2) {
                const char2_2 = words[1][1] ? words[1][1] : 'X';
                code = (words[0][0] + words[1][0] + char2_2).toUpperCase();
            } else if (words.length === 1) {
                const w = words[0];
                const char3 = w[3] ? w[3] : 'X';
                code = (w.substring(0, 2) + char3).toUpperCase();
            }
        }

        return code;
    }

    function getFinancialYear(dateStr) {
        const date = dateStr ? new Date(dateStr) : new Date();
        const year = date.getFullYear();

        const month = date.getMonth() + 1;

        if (month >= 4) {
            return `${year}-${year + 1}`;
        }

        return `${year - 1}-${year}`;
    }

    function _getCounters() {
        return _get(COUNTERS_KEY) || [];
    }

    function _setCounters(counters) {
        _set(COUNTERS_KEY, counters);
    }

    function peekNextSerialNumber(docType, month, fy) {
        const counters = _getCounters();
        const record = counters.find(c => c.doc_type === docType && c.month === month && c.fy === fy);
        return record ? (record.last_number + 1) : 1;
    }

    function incrementSerialNumber(docType, month, fy) {
        // Allocate atomically on the server so two simultaneous generations can't
        // get the same number. Falls back to a local increment only when offline.
        const n = _serverSerial('increment', docType, month, fy);
        if (n !== null) return n;

        const counters = _getCounters();
        let record = counters.find(c => c.doc_type === docType && c.month === month && c.fy === fy);
        if (record) {
            record.last_number += 1;
        } else {
            record = {
                id: _generateId('CNT'),
                doc_type: docType,
                month: month,
                fy: fy,
                last_number: 1
            };
            counters.push(record);
        }
        _setCounters(counters);
        return record.last_number;
    }

    // Raise a serial counter so the NEXT auto-generated number continues past an
    // already-used serial (e.g. after a bulk import of historical invoices). Only
    // ever moves the counter forward — never rewinds it. Returns the new last_number.
    function bumpSerialNumber(docType, month, fy, value) {
        value = parseInt(value, 10);
        if (!docType || !(value > 0)) return 0;

        const n = _serverSerial('bump', docType, month, fy, value);
        if (n !== null) return n;

        const counters = _getCounters();
        let record = counters.find(c => c.doc_type === docType && c.month === month && c.fy === fy);
        if (record) {
            if (value > record.last_number) record.last_number = value;
        } else {
            record = { id: _generateId('CNT'), doc_type: docType, month: month, fy: fy, last_number: value };
            counters.push(record);
        }
        _setCounters(counters);
        return record.last_number;
    }

    // Short financial year, e.g. "2026-2027" -> "2627" (no separator).
    function getFinancialYearShort(dateStr) {
        const fy = getFinancialYear(dateStr);
        const parts = fy.split('-');
        if (parts.length !== 2) return fy;
        return `${parts[0].slice(-2)}${parts[1].slice(-2)}`;
    }

    // Org-wide running serial — shared across all PO + Quotation documents,
    // runs through the financial year and resets each new financial year.
    function peekNextOrgSerial(fy) {
        const counters = _getCounters();
        const record = counters.find(c => c.doc_type === 'ORG' && c.fy === fy);
        return record ? (record.last_number + 1) : 1;
    }

    function incrementOrgSerial(fy) {
        return incrementSerialNumber('ORG', '', fy);
    }

    // Per-client running serial — counts how many PO + Quotation documents
    // were issued to a given client (by client code) in the financial year.
    function peekNextClientSerial(clientCode, fy) {
        const counters = _getCounters();
        const docType = 'CLIENT:' + clientCode;
        const record = counters.find(c => c.doc_type === docType && c.fy === fy);
        return record ? (record.last_number + 1) : 1;
    }

    function incrementClientSerial(clientCode, fy) {
        return incrementSerialNumber('CLIENT:' + clientCode, '', fy);
    }

    // --- Units of Measure (shared across Quotation, PO, Invoice, PO Received) ---
    const DEFAULT_UOMS = ['Nos', 'Hrs', 'Days'];

    function getUOMList() {
        const list = _dbCache[UOM_KEY];
        if (Array.isArray(list) && list.length > 0) return list;
        return DEFAULT_UOMS.slice();
    }

    function saveUOMList(list) {
        _set(UOM_KEY, Array.isArray(list) ? list : DEFAULT_UOMS.slice());
    }

    // Add a new UOM if it doesn't already exist (case-insensitive). Persists to
    // the database immediately so custom units are never lost. Returns the
    // canonical stored value (existing match or the newly added one).
    function addUOM(value) {
        const v = (value || '').trim();
        if (!v) return null;
        const list = getUOMList();
        const existing = list.find(u => u.toLowerCase() === v.toLowerCase());
        if (existing) return existing;
        list.push(v);
        _set(UOM_KEY, list);
        logActivity('settings_changed', `Added unit of measure: ${v}`);
        return v;
    }

    // --- Purchase Orders ---
    function savePO(poData) {
        const list = _get(PO_KEY);
        const isEdit = !!poData.id;
        poData.id = poData.id || _generateId('PO');
        poData.savedAt = new Date().toISOString();
        // Check if updating existing
        const idx = list.findIndex(d => d.id === poData.id);
        if (idx >= 0) {
            list[idx] = poData;
        } else {
            list.unshift(poData);
        }
        _persistItem(PO_KEY, poData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `PO Issue: ${poData.poNumber || poData.id}`);
        return poData;
    }

    function getAllPOs() {
        return _get(PO_KEY);
    }

    function getPO(id) {
        return _get(PO_KEY).find(d => d.id === id);
    }

    function deletePO(id) {
        const doc = getPO(id);
        const name = doc ? (doc.poNumber || id) : id;
        const list = _get(PO_KEY).filter(d => d.id !== id);
        _persistDelete(PO_KEY, id, list);
        logActivity('file_deleted', `PO Issue: ${name}`);
    }

    // Update only a PO's workflow status (e.g. 'pending' | 'completed') without
    // touching its saved timestamp or any other fields.
    function setPOStatus(id, status) {
        const list = _get(PO_KEY);
        const idx = list.findIndex(d => d.id === id);
        if (idx < 0) return null;
        list[idx].status = status;
        _persistItem(PO_KEY, list[idx], list);
        return list[idx];
    }

    // --- Quotations ---
    function saveQuotation(quData) {
        const list = _get(QU_KEY);
        const isEdit = !!quData.id;
        quData.id = quData.id || _generateId('QU');
        quData.savedAt = new Date().toISOString();
        const idx = list.findIndex(d => d.id === quData.id);
        if (idx >= 0) {
            list[idx] = quData;
        } else {
            list.unshift(quData);
        }
        _persistItem(QU_KEY, quData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `Quotation: ${quData.refNumber || quData.id}`);
        return quData;
    }

    function getAllQuotations() {
        return _get(QU_KEY);
    }

    function getQuotation(id) {
        return _get(QU_KEY).find(d => d.id === id);
    }

    function deleteQuotation(id) {
        const doc = getQuotation(id);
        const name = doc ? (doc.refNumber || id) : id;
        const list = _get(QU_KEY).filter(d => d.id !== id);
        _persistDelete(QU_KEY, id, list);
        logActivity('file_deleted', `Quotation: ${name}`);
    }

    // --- Invoices ---
    function saveInvoice(invData) {
        const list = _get(INV_KEY);
        const isEdit = !!invData.id;
        invData.id = invData.id || _generateId('INV');
        invData.savedAt = new Date().toISOString();
        const idx = list.findIndex(d => d.id === invData.id);
        if (idx >= 0) {
            list[idx] = invData;
        } else {
            list.unshift(invData);
        }
        _persistItem(INV_KEY, invData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `Invoice: ${invData.refNumber || invData.id}`);
        return invData;
    }

    function getAllInvoices() {
        return _get(INV_KEY);
    }

    // Cross-document duplicate check: is this reference number already used by any
    // PO, quotation, invoice or proforma? Returns { type, refNumber, id } of the
    // first match, or null. `excludeId` skips the document currently being edited
    // so re-saving it doesn't flag itself. Case/space-insensitive.
    function findByRefNumber(ref, excludeId) {
        const norm = (r) => String(r == null ? '' : r).trim().toLowerCase();
        const target = norm(ref);
        if (!target) return null;
        // Each type's identity field: POs are numbered by poNumber, the rest by
        // refNumber. (An invoice's poNumber is the client's order ref, not its own
        // identity, so it's deliberately not matched here.)
        const groups = [
            ['Purchase Order', getAllPOs(), d => d.poNumber || d.refNumber],
            ['Quotation', getAllQuotations(), d => d.refNumber],
            ['Invoice', getAllInvoices(), d => d.refNumber],
            ['Proforma Invoice', getAllProformas(), d => d.refNumber]
        ];
        for (const [type, list, idOf] of groups) {
            for (const d of (list || [])) {
                if (excludeId && d.id === excludeId) continue;
                const num = idOf(d);
                if (norm(num) === target) return { type, refNumber: num, id: d.id };
            }
        }
        return null;
    }

    function getInvoice(id) {
        return _get(INV_KEY).find(d => d.id === id);
    }

    function deleteInvoice(id) {
        const doc = getInvoice(id);
        const name = doc ? (doc.refNumber || id) : id;
        const list = _get(INV_KEY).filter(d => d.id !== id);
        _persistDelete(INV_KEY, id, list);
        logActivity('file_deleted', `Invoice: ${name}`);
    }

    // --- Receipts (payments received against an invoice) ---
    function saveReceipt(rcpData) {
        const list = _get(RECEIPTS_KEY);
        const isEdit = !!rcpData.id;
        rcpData.id = rcpData.id || _generateId('RCP');
        rcpData.savedAt = new Date().toISOString();
        const idx = list.findIndex(d => d.id === rcpData.id);
        if (idx >= 0) {
            list[idx] = rcpData;
        } else {
            list.unshift(rcpData);
        }
        _persistItem(RECEIPTS_KEY, rcpData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `Receipt: ${rcpData.receiptNumber || rcpData.invoiceRef || rcpData.id}`);
        return rcpData;
    }

    function saveReceiptsBatch(receiptsList) {
        const list = _get(RECEIPTS_KEY);
        const touched = [];
        receiptsList.forEach(rcpData => {
            const isEdit = !!rcpData.id;
            rcpData.id = rcpData.id || _generateId('RCP');
            rcpData.savedAt = new Date().toISOString();
            const idx = list.findIndex(d => d.id === rcpData.id);
            if (idx >= 0) {
                list[idx] = rcpData;
            } else {
                list.unshift(rcpData);
            }
            touched.push(rcpData);
            logActivity(isEdit ? 'file_edited' : 'file_generated', `Receipt: ${rcpData.receiptNumber || rcpData.invoiceRef || rcpData.id}`);
        });
        if (touched.length > 0) {
            _persistItems(RECEIPTS_KEY, touched, list);
        }
    }

    function getAllReceipts() {
        return _get(RECEIPTS_KEY);
    }

    function getReceipt(id) {
        return _get(RECEIPTS_KEY).find(d => d.id === id);
    }

    function deleteReceipt(id) {
        const doc = getReceipt(id);
        const name = doc ? (doc.receiptNumber || doc.invoiceRef || id) : id;
        const list = _get(RECEIPTS_KEY).filter(d => d.id !== id);
        _persistDelete(RECEIPTS_KEY, id, list);
        logActivity('file_deleted', `Receipt: ${name}`);
    }

    // --- Sales returns (credit notes raised against an invoice) ---
    function saveSalesReturn(crnData) {
        const list = _get(SALES_RETURNS_KEY);
        const isEdit = !!crnData.id;
        crnData.id = crnData.id || _generateId('CRN');
        crnData.savedAt = new Date().toISOString();
        const idx = list.findIndex(d => d.id === crnData.id);
        if (idx >= 0) {
            list[idx] = crnData;
        } else {
            list.unshift(crnData);
        }
        _persistItem(SALES_RETURNS_KEY, crnData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `Credit Note: ${crnData.invoiceRef || crnData.id}`);
        return crnData;
    }

    function getAllSalesReturns() {
        return _get(SALES_RETURNS_KEY);
    }

    function getSalesReturn(id) {
        return _get(SALES_RETURNS_KEY).find(d => d.id === id);
    }

    function deleteSalesReturn(id) {
        const doc = getSalesReturn(id);
        const name = doc ? (doc.invoiceRef || id) : id;
        const list = _get(SALES_RETURNS_KEY).filter(d => d.id !== id);
        _persistDelete(SALES_RETURNS_KEY, id, list);
        logActivity('file_deleted', `Credit Note: ${name}`);
    }

    // --- Receipt banks (the bank accounts money can be received into) ---
    function saveReceiptBank(bankData) {
        const list = _get(RECEIPT_BANKS_KEY);
        bankData.id = bankData.id || _generateId('RBANK');
        const idx = list.findIndex(d => d.id === bankData.id);
        if (idx >= 0) {
            list[idx] = bankData;
        } else {
            list.push(bankData);
        }
        _set(RECEIPT_BANKS_KEY, list);
        return bankData;
    }

    function getAllReceiptBanks() {
        return _get(RECEIPT_BANKS_KEY);
    }

    function getReceiptBank(id) {
        return _get(RECEIPT_BANKS_KEY).find(d => d.id === id);
    }

    function deleteReceiptBank(id) {
        const list = _get(RECEIPT_BANKS_KEY).filter(d => d.id !== id);
        _set(RECEIPT_BANKS_KEY, list);
    }

    // --- Proforma Invoices ---
    function saveProforma(profData) {
        const list = _get(PROF_KEY);
        const isEdit = !!profData.id;
        profData.id = profData.id || _generateId('PROF');
        profData.savedAt = new Date().toISOString();
        const idx = list.findIndex(d => d.id === profData.id);
        if (idx >= 0) {
            list[idx] = profData;
        } else {
            list.unshift(profData);
        }
        _persistItem(PROF_KEY, profData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `Proforma Invoice: ${profData.refNumber || profData.id}`);
        return profData;
    }

    function getAllProformas() {
        return _get(PROF_KEY);
    }

    function getProforma(id) {
        return _get(PROF_KEY).find(d => d.id === id);
    }

    function deleteProforma(id) {
        const doc = getProforma(id);
        const name = doc ? (doc.refNumber || id) : id;
        const list = _get(PROF_KEY).filter(d => d.id !== id);
        _persistDelete(PROF_KEY, id, list);
        logActivity('file_deleted', `Proforma Invoice: ${name}`);
    }

    // --- PO Received Documents ---
    function saveTM(tmData) {
        const list = _get(TM_KEY);
        const isEdit = !!tmData.id;
        tmData.id = tmData.id || _generateId('TM');
        tmData.savedAt = new Date().toISOString();
        const idx = list.findIndex(d => d.id === tmData.id);
        if (idx >= 0) {
            list[idx] = tmData;
        } else {
            list.unshift(tmData);
        }
        _persistItem(TM_KEY, tmData, list);
        logActivity(isEdit ? 'file_edited' : 'file_generated', `PO Received Doc: ${tmData.refNumber || tmData.poNumber || tmData.id}`);
        return tmData;
    }

    function getAllTMs() {
        return _get(TM_KEY);
    }

    function getTM(id) {
        return _get(TM_KEY).find(d => d.id === id);
    }

    function deleteTM(id) {
        const doc = getTM(id);
        const name = doc ? (doc.refNumber || doc.poNumber || id) : id;
        const list = _get(TM_KEY).filter(d => d.id !== id);
        _persistDelete(TM_KEY, id, list);
        logActivity('file_deleted', `PO Received Doc: ${name}`);
    }

    // --- Vendors ---
    function saveVendor(vendorData) {
        const list = _get(VENDORS_KEY);
        const isEdit = !!vendorData.id;
        vendorData.id = vendorData.id || _generateId('VND');
        vendorData.savedAt = new Date().toISOString();
        const idx = list.findIndex(v => v.id === vendorData.id);
        if (idx >= 0) {
            list[idx] = vendorData;
        } else {
            list.push(vendorData);
        }
        // Sort alphabetically by name
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(VENDORS_KEY, list);
        logActivity('user_action', `${isEdit ? 'Edited' : 'Added'} contact: ${vendorData.name}`);
        return vendorData;
    }

    function getAllVendors() {
        return _get(VENDORS_KEY);
    }

    function getVendor(id) {
        return _get(VENDORS_KEY).find(v => v.id === id);
    }

    function deleteVendor(id) {
        const vendor = getVendor(id);
        const name = vendor ? vendor.name : id;
        const list = _get(VENDORS_KEY).filter(v => v.id !== id);
        _set(VENDORS_KEY, list);
        logActivity('user_action', `Deleted contact: ${name}`);
    }

    function deleteVendorsBatch(ids) {
        const idSet = new Set(ids);
        const list = _get(VENDORS_KEY).filter(v => !idSet.has(v.id));
        _set(VENDORS_KEY, list);
        logActivity('user_action', `Batch deleted ${ids.length} contacts`);
    }

    // --- Suppliers (Purchase Order only — separate from clients/vendors) ---
    function saveSupplier(supplierData) {
        const list = _get(SUPPLIERS_KEY);
        const isEdit = !!supplierData.id;
        supplierData.id = supplierData.id || _generateId('SUP');
        supplierData.savedAt = new Date().toISOString();
        const idx = list.findIndex(s => s.id === supplierData.id);
        if (idx >= 0) {
            list[idx] = supplierData;
        } else {
            list.push(supplierData);
        }
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(SUPPLIERS_KEY, list);
        logActivity('user_action', `${isEdit ? 'Edited' : 'Added'} supplier: ${supplierData.name}`);
        return supplierData;
    }

    function getAllSuppliers() {
        return _get(SUPPLIERS_KEY);
    }

    function getSupplier(id) {
        return _get(SUPPLIERS_KEY).find(s => s.id === id);
    }

    function deleteSupplier(id) {
        const supplier = getSupplier(id);
        const name = supplier ? supplier.name : id;
        const list = _get(SUPPLIERS_KEY).filter(s => s.id !== id);
        _set(SUPPLIERS_KEY, list);
        logActivity('user_action', `Deleted supplier: ${name}`);
    }

    function deleteSuppliersBatch(ids) {
        const idSet = new Set(ids);
        const list = _get(SUPPLIERS_KEY).filter(s => !idSet.has(s.id));
        _set(SUPPLIERS_KEY, list);
        logActivity('user_action', `Batch deleted ${ids.length} suppliers`);
    }

    // --- Bulk import (clients / suppliers) ---------------------------------
    // Upsert many records in a single write (one server save), de-duplicating by
    // name. Clients are also keyed by clientType so the same company can exist in
    // both Domestic and International lists. Returns { added, updated, skipped }.
    function bulkUpsertVendors(records) {
        const list = _get(VENDORS_KEY);
        let added = 0, updated = 0, skipped = 0;
        const keyOf = (n, t) => `${(n || '').trim().toLowerCase()}|${t || 'domestic'}`;
        const index = new Map();
        list.forEach(v => index.set(keyOf(v.name, v.clientType || 'domestic'), v));
        (records || []).forEach(r => {
            if (!r || !r.name || !r.name.trim()) { skipped++; return; }
            const t = (r.clientType === 'international') ? 'international' : 'domestic';
            const k = keyOf(r.name, t);
            const existing = index.get(k);
            if (existing) {
                if (r.gst) existing.gst = r.gst;
                if (r.address) existing.address = r.address;
                if (r.contactPerson) existing.contactPerson = r.contactPerson;
                if (r.contact) existing.contact = r.contact;
                if (r.email) existing.email = r.email;
                if (r.group) existing.group = r.group;
                if (r.subGroup) existing.subGroup = r.subGroup;
                existing.clientType = t;
                existing.savedAt = new Date().toISOString();
                updated++;
            } else {
                const rec = {
                    id: _generateId('VND'), name: r.name.trim(),
                    gst: r.gst || '', address: r.address || '', contactPerson: r.contactPerson || '',
                    contact: r.contact || '', email: r.email || '', clientType: t,
                    group: r.group || '', subGroup: r.subGroup || '',
                    savedAt: new Date().toISOString()
                };
                list.push(rec); index.set(k, rec); added++;
            }
        });
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(VENDORS_KEY, list);
        logActivity('user_action', `Bulk import clients: ${added} added, ${updated} updated`);
        return { added, updated, skipped };
    }

    function saveVendorsBatch(vendorsList) {
        const list = _get(VENDORS_KEY);
        let affected = 0;
        vendorsList.forEach(vendorData => {
            const idx = list.findIndex(v => v.id === vendorData.id);
            if (idx >= 0) {
                list[idx] = vendorData;
                affected++;
            }
        });
        if (affected > 0) {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            _set(VENDORS_KEY, list);
            logActivity('user_action', `Updated group for ${affected} client(s)`);
        }
    }

    function saveSuppliersBatch(suppliersList) {
        const list = _get(SUPPLIERS_KEY);
        let affected = 0;
        suppliersList.forEach(supplierData => {
            const idx = list.findIndex(s => s.id === supplierData.id);
            if (idx >= 0) {
                list[idx] = supplierData;
                affected++;
            }
        });
        if (affected > 0) {
            list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            _set(SUPPLIERS_KEY, list);
            logActivity('user_action', `Updated group for ${affected} supplier(s)`);
        }
    }


    function bulkUpsertSuppliers(records) {
        const list = _get(SUPPLIERS_KEY);
        let added = 0, updated = 0, skipped = 0;
        const keyOf = (n) => (n || '').trim().toLowerCase();
        const index = new Map();
        list.forEach(s => index.set(keyOf(s.name), s));
        (records || []).forEach(r => {
            if (!r || !r.name || !r.name.trim()) { skipped++; return; }
            const k = keyOf(r.name);
            const existing = index.get(k);
            if (existing) {
                if (r.gst) existing.gst = r.gst;
                if (r.address) existing.address = r.address;
                if (r.contactPerson) existing.contactPerson = r.contactPerson;
                if (r.contact) existing.contact = r.contact;
                if (r.email) existing.email = r.email;
                existing.savedAt = new Date().toISOString();
                updated++;
            } else {
                const rec = {
                    id: _generateId('SUP'), name: r.name.trim(),
                    gst: r.gst || '', address: r.address || '', contactPerson: r.contactPerson || '',
                    contact: r.contact || '', email: r.email || '',
                    savedAt: new Date().toISOString()
                };
                list.push(rec); index.set(k, rec); added++;
            }
        });
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(SUPPLIERS_KEY, list);
        logActivity('user_action', `Bulk import suppliers: ${added} added, ${updated} updated`);
        return { added, updated, skipped };
    }

    // Bulk import of PREVIOUS invoices from a sheet. Records are FULLY-BUILT invoice
    // objects (same shape saveInvoice stores — client fields, line items, banks,
    // totals) constructed by BulkImport. Matched/deduped by refNumber: a repeat
    // updates in place rather than adding a duplicate. Flagged { imported:true }.
    function bulkUpsertInvoices(records) {
        const list = _get(INV_KEY);
        let added = 0, updated = 0, skipped = 0;
        const keyOf = (ref) => (ref || '').trim().toLowerCase();
        const index = new Map();
        list.forEach(i => index.set(keyOf(i.refNumber), i));
        const touched = [];
        (records || []).forEach(r => {
            if (!r || !r.refNumber || !r.refNumber.trim()) { skipped++; return; }
            const k = keyOf(r.refNumber);
            const now = new Date().toISOString();
            const existing = index.get(k);
            if (existing) {
                // Overwrite with the imported version, keeping the original id.
                Object.assign(existing, r, { id: existing.id, imported: true, savedAt: now });
                touched.push(existing);
                updated++;
            } else {
                const rec = { ...r, id: _generateId('INV'), imported: true, savedAt: now };
                list.unshift(rec); index.set(k, rec); touched.push(rec); added++;
            }
        });
        _persistItems(INV_KEY, touched, list);
        logActivity('user_action', `Bulk import invoices: ${added} added, ${updated} updated`);
        return { added, updated, skipped };
    }

    // --- Correspondent Banks ---
    function saveCorrBank(bankData) {
        const list = _get(CORR_BANKS_KEY);
        const isEdit = !!bankData.id;
        bankData.id = bankData.id || _generateId('BANK');
        bankData.savedAt = new Date().toISOString();
        const idx = list.findIndex(b => b.id === bankData.id);
        if (idx >= 0) {
            list[idx] = bankData;
        } else {
            list.push(bankData);
        }
        // Sort alphabetically by name
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(CORR_BANKS_KEY, list);
        logActivity('user_action', `${isEdit ? 'Edited' : 'Added'} correspondent bank: ${bankData.name}`);
        return bankData;
    }

    function getAllCorrBanks() {
        return _get(CORR_BANKS_KEY);
    }

    function getCorrBank(id) {
        return _get(CORR_BANKS_KEY).find(b => b.id === id);
    }

    function deleteCorrBank(id) {
        const bank = getCorrBank(id);
        const name = bank ? bank.name : id;
        const list = _get(CORR_BANKS_KEY).filter(b => b.id !== id);
        _set(CORR_BANKS_KEY, list);
        logActivity('user_action', `Deleted correspondent bank: ${name}`);
    }

    // --- Beneficiary Banks ---
    function saveBenefBank(bankData) {
        const list = _get(BENEF_BANKS_KEY);
        const isEdit = !!bankData.id;
        bankData.id = bankData.id || _generateId('BENEF');
        bankData.savedAt = new Date().toISOString();
        const idx = list.findIndex(b => b.id === bankData.id);
        if (idx >= 0) {
            list[idx] = bankData;
        } else {
            list.push(bankData);
        }
        // Sort alphabetically by name
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(BENEF_BANKS_KEY, list);
        logActivity('user_action', `${isEdit ? 'Edited' : 'Added'} beneficiary bank: ${bankData.name}`);
        return bankData;
    }

    function getAllBenefBanks() {
        return _get(BENEF_BANKS_KEY);
    }

    function getBenefBank(id) {
        return _get(BENEF_BANKS_KEY).find(b => b.id === id);
    }

    function deleteBenefBank(id) {
        const bank = getBenefBank(id);
        const name = bank ? bank.name : id;
        const list = _get(BENEF_BANKS_KEY).filter(b => b.id !== id);
        _set(BENEF_BANKS_KEY, list);
        logActivity('user_action', `Deleted beneficiary bank: ${name}`);
    }

    // --- Domestic Banks (IFSC) ---
    function saveDomesticBank(bankData) {
        const list = _get(DOMESTIC_BANKS_KEY);
        const isEdit = !!bankData.id;
        bankData.id = bankData.id || _generateId('DOMBANK');
        bankData.savedAt = new Date().toISOString();
        const idx = list.findIndex(b => b.id === bankData.id);
        if (idx >= 0) {
            list[idx] = bankData;
        } else {
            list.push(bankData);
        }
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        _set(DOMESTIC_BANKS_KEY, list);
        logActivity('user_action', `${isEdit ? 'Edited' : 'Added'} domestic bank: ${bankData.name}`);
        return bankData;
    }

    function getAllDomesticBanks() {
        return _get(DOMESTIC_BANKS_KEY);
    }

    function getDomesticBank(id) {
        return _get(DOMESTIC_BANKS_KEY).find(b => b.id === id);
    }

    function deleteDomesticBank(id) {
        const bank = getDomesticBank(id);
        const name = bank ? bank.name : id;
        const list = _get(DOMESTIC_BANKS_KEY).filter(b => b.id !== id);
        _set(DOMESTIC_BANKS_KEY, list);
        logActivity('user_action', `Deleted domestic bank: ${name}`);
    }

    // --- Ultimate Beneficiary ---
    function saveUltBenef(data) {
        if (!data.orgName) return { success: false, message: 'Org name is required' };
        if (data.id) {
            const idx = _get(ULT_BENEF_KEY).findIndex(ub => ub.id === data.id);
            if (idx !== -1) {
                const list = _get(ULT_BENEF_KEY);
                list[idx] = { ...data, updatedAt: new Date().toISOString() };
                _set(ULT_BENEF_KEY, list);
            }
        } else {
            const list = _get(ULT_BENEF_KEY);
            list.push({
                id: `ub_${Date.now()}`,
                ...data,
                createdAt: new Date().toISOString()
            });
            _set(ULT_BENEF_KEY, list);
        }
        logActivity('user_action', `Ultimate beneficiary saved: ${data.orgName}`);
        return { success: true, data: _get(ULT_BENEF_KEY) };
    }

    function getAllUltBenef() {
        const list = _get(ULT_BENEF_KEY);
        return list.sort((a, b) => (a.orgName || '').localeCompare(b.orgName || ''));
    }

    function getUltBenef(id) {
        return _get(ULT_BENEF_KEY).find(ub => ub.id === id) || null;
    }

    function deleteUltBenef(id) {
        const ub = getUltBenef(id);
        const name = ub ? ub.orgName : id;
        const list = _get(ULT_BENEF_KEY).filter(ub => ub.id !== id);
        _set(ULT_BENEF_KEY, list);
        logActivity('user_action', `Deleted ultimate beneficiary: ${name}`);
    }

    // --- Settings (signature, stamp, etc.) ---
    function getSettings() {
        return _dbCache[SETTINGS_KEY] || {};
    }

    function saveSettings(settings) {
        _set(SETTINGS_KEY, settings);
        logActivity('settings_changed', 'Updated system preferences / settings configuration');
    }

    // --- Per-user save paths (kept under settings.userPaths[username]) ---
    function _currentUser() {
        return (typeof Auth !== 'undefined' && typeof Auth.getUser === 'function') ? Auth.getUser() : null;
    }

    // The current user's PDF/upload save paths, or {} when none are set.
    function getUserPaths() {
        const user = _currentUser();
        if (!user) return {};
        const map = getSettings().userPaths || {};
        return map[user] || {};
    }

    // Persist the current user's PDF/upload save paths. The server merges only
    // this user's entry, leaving other users' paths untouched.
    function saveUserPaths(paths) {
        const user = _currentUser();
        if (!user) return;
        const settings = getSettings();
        settings.userPaths = settings.userPaths || {};
        settings.userPaths[user] = paths;
        _set(SETTINGS_KEY, settings);
        logActivity('settings_changed', 'Updated PDF / upload save paths');
    }

    function getPOColumnVisibility() {
        const val = _dbCache[PO_COL_VISIBILITY_KEY];
        const defaults = {
            sno: true,
            name: true,
            spec: true,
            uom: true,
            qty: true,
            rate: true,
            discount: false,
            amount: true,
            signature: false,
            roundOff: false
        };
        return val ? { ...defaults, ...val } : defaults;
    }

    function savePOColumnVisibility(visibility) {
        _set(PO_COL_VISIBILITY_KEY, visibility);
    }

    function getQUColumnVisibility() {
        const val = _dbCache[QU_COL_VISIBILITY_KEY];
        const defaults = {
            sno: true,
            desc: true,
            uom: true,
            qty: true,
            rate: true,
            discount: true,
            amount: true,
            signature: false,
            roundOff: false
        };
        return val ? { ...defaults, ...val } : defaults;
    }

    function saveQUColumnVisibility(visibility) {
        _set(QU_COL_VISIBILITY_KEY, visibility);
    }

    function getINVColumnVisibility() {
        const val = _dbCache[INV_COL_VISIBILITY_KEY];
        const defaults = {
            qty: true,
            hours: true,
            rate: true,
            signature: false,
            roundOff: false
        };
        return val ? { ...defaults, ...val } : defaults;
    }

    function saveINVColumnVisibility(visibility) {
        _set(INV_COL_VISIBILITY_KEY, visibility);
    }

    // --- Stats ---
    function getStats() {
        const pos = _get(PO_KEY);
        const qus = _get(QU_KEY);
        const invs = _get(INV_KEY);
        return {
            totalPOs: pos.length,
            totalQuotations: qus.length,
            totalInvoices: invs.length,
            totalDocuments: pos.length + qus.length + invs.length
        };
    }

    // --- Recent documents (combined, sorted by date) ---
    function getRecentDocuments(limit = 15) {
        const pos = _get(PO_KEY).map(d => ({ ...d, type: 'PO' }));
        const qus = _get(QU_KEY).map(d => ({ ...d, type: 'QU' }));
        const invs = _get(INV_KEY).map(d => ({ ...d, type: 'INV' }));
        const all = [...pos, ...qus, ...invs];
        all.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
        return all.slice(0, limit);
    }

    // Maps a logical document type (as used by the Settings UI) to a predicate that
    // matches the actual counter records it owns. Purchase Order and Quotation each
    // have their own running serial ('PO' / 'QU') plus per-client serials
    // ('PO_CLIENT:<code>' / 'QU_CLIENT:<code>'); PO Received and Invoices each split
    // into domestic/international counters.
    function _counterBelongsTo(docType) {
        switch (docType) {
            case 'PO':
            case 'ORG': // legacy alias
                return c => c.doc_type === 'PO' || (c.doc_type || '').startsWith('PO_CLIENT:');
            case 'QT':
            case 'QU':
                return c => c.doc_type === 'QU' || (c.doc_type || '').startsWith('QU_CLIENT:');
            case 'TM':
                return c => c.doc_type === 'TM_DOM' || c.doc_type === 'TM_INT';
            case 'INV':
                return c => c.doc_type === 'INV_DOM' || c.doc_type === 'INV_INT';
            default:
                // Exact types: INV_DOM, INV_INT, TM_DOM, TM_INT
                return c => c.doc_type === docType;
        }
    }

    function resetCounters(docType) {
        if (!docType) {
            _setCounters([]);
            logActivity('settings_changed', 'Reset all document sequential counters to 001');
            return;
        }
        const belongs = _counterBelongsTo(docType);
        const filtered = _getCounters().filter(c => !belongs(c));
        _setCounters(filtered);
        logActivity('settings_changed', `Reset sequential counters to 001 for type: ${docType}`);
    }

    // Manually set the NEXT serial number for a counter (so the next generated
    // document uses `startNumber`). Stored as last_number = startNumber - 1.
    function setCounterStart(docType, fy, startNumber) {
        // Purchase Order and Quotation have independent running serials ('PO' / 'QU').
        const keyMap = {
            PO: 'PO', QT: 'QU', QU: 'QU', ORG: 'PO',
            INV_DOM: 'INV_DOM', INV_INT: 'INV_INT',
            TM_DOM: 'TM_DOM', TM_INT: 'TM_INT'
        };
        const key = keyMap[docType] || docType;
        const n = Math.max(1, parseInt(startNumber, 10) || 1);
        const last = n - 1;
        let counters = _getCounters();

        // PO and Quotation references also carry a per-client running serial
        // (PO_CLIENT:<code> / QU_CLIENT:<code>). When the org serial is re-based,
        // clear those clients for this FY so the WHOLE reference resets too — e.g.
        // setting PO to 1 yields ORG001/ABC001/PO/... rather than ORG001/ABC004/...
        if (key === 'PO' || key === 'QU') {
            const clientPrefix = key + '_CLIENT:';
            counters = counters.filter(c => !((c.doc_type || '').startsWith(clientPrefix) && c.fy === fy));
        }

        let record = counters.find(c => c.doc_type === key && c.month === '' && c.fy === fy);
        if (record) {
            record.last_number = last;
        } else {
            counters.push({ id: _generateId('CNT'), doc_type: key, month: '', fy: fy, last_number: last });
        }
        _setCounters(counters);
        logActivity('settings_changed', `Set ${key} serial start to ${n} for FY ${fy}`);
    }

    // --- User login info getters and setters ---
    function getUsers() {
        return _get(USERS_KEY) || [];
    }

    function saveUsers(users) {
        _set(USERS_KEY, users);
    }

    function getPendingUsers() {
        return _get(PENDING_KEY) || [];
    }

    function savePendingUsers(list) {
        _set(PENDING_KEY, list);
    }

    function getAdminPasswordHash() {
        return _dbCache[ADMIN_PWD_KEY] || null;
    }

    function saveAdminPasswordHash(hash) {
        _set(ADMIN_PWD_KEY, hash);
    }

    // --- Export all data as JSON ---
    function getBackupPayload() {
        return {
            purchaseOrders: _get(PO_KEY),
            quotations: _get(QU_KEY),
            invoices: _get(INV_KEY),
            proformas: _get(PROF_KEY),
            poReceived: _get(TM_KEY),
            vendors: _get(VENDORS_KEY),
            suppliers: _get(SUPPLIERS_KEY),
            settings: getSettings(),
            documentCounters: _getCounters(),
            activityLog: _get(ACT_KEY),
            authUsers: _get(USERS_KEY),
            authPendingUsers: _get(PENDING_KEY),
            authPasswordHash: _dbCache[ADMIN_PWD_KEY],
            exportedAt: new Date().toISOString()
        };
    }

    function exportAllData() {
        const data = getBackupPayload();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PO_QU_Backup_${_dateStamp()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importAllData(data) {
        _set(PO_KEY, data.purchaseOrders || []);
        _set(QU_KEY, data.quotations || []);
        _set(INV_KEY, data.invoices || []);
        _set(PROF_KEY, data.proformas || []);
        _set(TM_KEY, data.poReceived || []);
        _set(VENDORS_KEY, data.vendors || []);
        _set(SUPPLIERS_KEY, data.suppliers || []);
        _set(SETTINGS_KEY, data.settings || {});
        _setCounters(data.documentCounters || []);
        _set(ACT_KEY, data.activityLog || []);
        _set(USERS_KEY, data.authUsers || []);
        _set(PENDING_KEY, data.authPendingUsers || []);
        if (data.authPasswordHash) {
            _set(ADMIN_PWD_KEY, data.authPasswordHash);
        }
    }

    // --- Activity Log ---
    function logActivity(action, details) {
        let username = 'Anonymous';
        let role = 'unknown';
        if (typeof Auth !== 'undefined' && typeof Auth.getUser === 'function') {
            username = Auth.getUser() || 'Anonymous';
            role = Auth.getRole() || 'unknown';
        }

        // Intentional omission: Admin activities (role 'admin', matched by role so
        // it holds regardless of the admin's email) are not logged to the primary
        // activity log to keep it clean of system-level actions.
        if (role === 'admin') {
            return null;
        }

        const logEntry = {
            id: 'ACT_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
            timestamp: new Date().toISOString(),
            username: username,
            role: role,
            action: action, // 'login', 'file_generated', 'file_edited', 'file_deleted', 'settings_changed', 'user_action'
            details: details
        };
        const list = _get(ACT_KEY) || [];
        list.unshift(logEntry);
        _set(ACT_KEY, list);
        return logEntry;
    }

    function getActivityLog() {
        return _get(ACT_KEY) || [];
    }

    function clearActivityLog() {
        _set(ACT_KEY, []);
    }

    // --- Helpers ---
    function _generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    function _dateStamp() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }

    function _loadCacheFromLocalStorage() {
        const keys = [
            PO_KEY,
            QU_KEY,
            INV_KEY,
            PROF_KEY,
            TM_KEY,
            VENDORS_KEY,
            SUPPLIERS_KEY,
            CORR_BANKS_KEY,
            BENEF_BANKS_KEY,
            ULT_BENEF_KEY,
            DOMESTIC_BANKS_KEY,
            SETTINGS_KEY,
            PO_COL_VISIBILITY_KEY,
            QU_COL_VISIBILITY_KEY,
            INV_COL_VISIBILITY_KEY,
            COUNTERS_KEY,
            RECEIPTS_KEY,
            SALES_RETURNS_KEY,
            RECEIPT_BANKS_KEY,
            UOM_KEY,
            ACT_KEY,
            USERS_KEY,
            PENDING_KEY,
            ADMIN_PWD_KEY
        ];

        for (const key of keys) {
            const localVal = localStorage.getItem(key);
            if (localVal !== null) {
                try {
                    _dbCache[key] = JSON.parse(localVal);
                } catch (e) {
                    console.error(`Error parsing fallback localStorage for key ${key}:`, e);
                }
            }
        }
    }

    /**
     * Backfill missing `id` fields on PO and QU documents.
     * Documents saved before the ID-generation logic was added (or that
     * lost their IDs through data migration) will be assigned a new
     * unique ID so that delete / edit operations work correctly.
     */
    function _backfillIds() {
        const keys = [PO_KEY, QU_KEY, INV_KEY, TM_KEY, VENDORS_KEY, SUPPLIERS_KEY];
        const prefixFor = (key) =>
            key === PO_KEY ? 'PO' : (key === QU_KEY ? 'QU' : (key === INV_KEY ? 'INV' : (key === TM_KEY ? 'TM' : (key === SUPPLIERS_KEY ? 'SUP' : 'VND'))));

        const changedKeys = new Set();
        keys.forEach(key => {
            const list = _dbCache[key];
            if (!Array.isArray(list)) return;
            const prefix = prefixFor(key);
            list.forEach(item => {
                if (!item.id) {
                    item.id = _generateId(prefix);
                    changedKeys.add(key);
                }
            });
        });
        if (changedKeys.size > 0) {
            changedKeys.forEach(key => { _saveToServer(key, _dbCache[key]); });
        }
    }

    async function loadDatabaseFromServer() {
        try {
            const response = await fetch('/api/db', { credentials: 'same-origin' });
            if (response.status === 401) {
                // Not authenticated — do not fall back to cached data.
                _updateServerStatus(true);
                return false;
            }
            if (response.ok) {
                const serverDb = await response.json();
                
                const keys = [
                    PO_KEY,
                    QU_KEY,
                    INV_KEY,
                    PROF_KEY,
                    TM_KEY,
                    VENDORS_KEY,
                    SUPPLIERS_KEY,
                    CORR_BANKS_KEY,
                    BENEF_BANKS_KEY,
                    ULT_BENEF_KEY,
                    DOMESTIC_BANKS_KEY,
                    SETTINGS_KEY,
                    PO_COL_VISIBILITY_KEY,
                    QU_COL_VISIBILITY_KEY,
                    INV_COL_VISIBILITY_KEY,
                    COUNTERS_KEY,
                    RECEIPTS_KEY,
                    SALES_RETURNS_KEY,
                    RECEIPT_BANKS_KEY,
                    UOM_KEY,
                    ACT_KEY,
                    USERS_KEY,
                    PENDING_KEY,
                    ADMIN_PWD_KEY
                ];

                for (const key of keys) {
                    if (serverDb[key] !== undefined && serverDb[key] !== null) {
                        _dbCache[key] = serverDb[key];
                        // Sync back to localStorage for redundancy/fallback
                        try {
                            localStorage.setItem(key, JSON.stringify(serverDb[key]));
                        } catch (e) {
                            console.warn('Failed to sync to localStorage:', e);
                        }
                    } else {
                        // The server is the source of truth: a key it doesn't have is
                        // empty. Drop any local copy rather than uploading it, so data
                        // from an older install on this address (or from before db/
                        // was reset) can't resurface in a fresh database.
                        try { localStorage.removeItem(key); } catch (e) {}
                    }
                }
                _backfillIds();
                _updateServerStatus(true);
                return true;
            }
        } catch (error) {
            console.warn('Could not load database from server, falling back to localStorage:', error);
        }
        
        // Fallback: Populate cache entirely from localStorage
        _loadCacheFromLocalStorage();
        _backfillIds();
        _updateServerStatus(false);
        return false;
    }

    return {
        savePO, getAllPOs, getPO, deletePO, setPOStatus,
        saveQuotation, getAllQuotations, getQuotation, deleteQuotation,
        saveInvoice, getAllInvoices, getInvoice, deleteInvoice, findByRefNumber,
        saveReceipt, saveReceiptsBatch, getAllReceipts, getReceipt, deleteReceipt,
        saveSalesReturn, getAllSalesReturns, getSalesReturn, deleteSalesReturn,
        saveReceiptBank, getAllReceiptBanks, getReceiptBank, deleteReceiptBank,
        saveProforma, getAllProformas, getProforma, deleteProforma,
        saveTM, getAllTMs, getTM, deleteTM,
        saveVendor, saveVendorsBatch, getAllVendors, getVendor, deleteVendor, deleteVendorsBatch,
        saveSupplier, saveSuppliersBatch, getAllSuppliers, getSupplier, deleteSupplier, deleteSuppliersBatch,
        bulkUpsertVendors, bulkUpsertSuppliers, bulkUpsertInvoices,
        saveCorrBank, getAllCorrBanks, getCorrBank, deleteCorrBank,
        saveBenefBank, getAllBenefBanks, getBenefBank, deleteBenefBank,
        saveDomesticBank, getAllDomesticBanks, getDomesticBank, deleteDomesticBank,
        saveUltBenef, getAllUltBenef, getUltBenef, deleteUltBenef,
        getSettings, saveSettings,
        getUserPaths, saveUserPaths,
        getPOColumnVisibility, savePOColumnVisibility,
        getQUColumnVisibility, saveQUColumnVisibility,
        getINVColumnVisibility, saveINVColumnVisibility,
        getStats, getRecentDocuments, exportAllData, getBackupPayload, importAllData,
        generateClientCode, getFinancialYear, getFinancialYearShort, peekNextSerialNumber, incrementSerialNumber, bumpSerialNumber,
        peekNextOrgSerial, incrementOrgSerial, peekNextClientSerial, incrementClientSerial,
        getUOMList, saveUOMList, addUOM,
        resetCounters, setCounterStart, loadDatabaseFromServer,
        logActivity, getActivityLog, clearActivityLog,
        getUsers, saveUsers, getPendingUsers, savePendingUsers,
        getAdminPasswordHash, saveAdminPasswordHash,
        getOrgInfo, ORG_CODE
    };

    function getOrgInfo() {
        return {
            serialPrefix: ORG_CODE,
            defaultCurrency: 'INR'
        };
    }
})();
