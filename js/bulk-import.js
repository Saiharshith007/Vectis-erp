/* ============================================
   Bulk Import Module
   --------------------------------------------
   Import many clients (domestic / international) or PO suppliers at once from an
   Excel (.xlsx/.xls) or CSV file. Columns are matched by header name (flexible,
   case/spacing-insensitive), so the user's existing sheet headings just work.
   Saved through a single batched write per import (Storage.bulkUpsert*).
   ============================================ */

const BulkImport = (() => {

    // Map of target field -> accepted header aliases (normalised: lowercased,
    // non-alphanumerics stripped). The first matching column in the sheet wins.
    const FIELD_ALIASES = {
        name:          ['name', 'companyname', 'company', 'clientname', 'client', 'vendorname', 'vendor', 'suppliername', 'supplier', 'firmname', 'firm', 'partyname', 'party', 'organisation', 'organization'],
        gst:           ['gst', 'gstin', 'gstno', 'gstnumber', 'gstno.', 'taxid', 'tax', 'vat', 'vatno', 'tin'],
        address:       ['address', 'addr', 'fulladdress', 'billingaddress', 'companyaddress', 'location'],
        contactPerson: ['contactperson', 'contactname', 'person', 'attention', 'attn', 'poc', 'pointofcontact', 'spoc', 'name2'],
        contact:       ['contact', 'phone', 'mobile', 'phoneno', 'phonenumber', 'contactnumber', 'contactno', 'mobileno', 'mobilenumber', 'tel', 'telephone', 'cell'],
        email:         ['email', 'emailid', 'mail', 'emailaddress', 'mailid', 'e-mail'],
        group:         ['group', 'groupname', 'clientgroup', 'parentgroup', 'parentclient'],
        subGroup:      ['subgroup', 'branch', 'subclient', 'regionaloffice', 'office']
    };

    // Aliases for the full "previous invoices" importer. One invoice can span many
    // sheet rows (one per line item) — header/client/bank columns come from the
    // invoice's first row, item columns (sno…amount) are collected from every row.
    // Aliases are deliberately precise to avoid cross-column collisions (e.g. the
    // three "…Number" columns, or "Unit Rate" vs "Exchange Rate").
    const INV_FIELD_ALIASES = {
        // --- Invoice / client header ---
        refNumber:           ['invoicenumber', 'invoiceno', 'invno', 'invoiceref', 'refnumber', 'refno', 'billno', 'billnumber'],
        date:                ['date', 'invoicedate', 'invdate', 'billdate', 'documentdate', 'issuedate'],
        clientName:          ['companyname', 'company', 'clientname', 'client', 'customername', 'customer', 'partyname', 'party', 'buyer'],
        clientContactPerson: ['contactpersonname', 'contactperson', 'contactname', 'personname', 'attention', 'attn', 'poc', 'spoc'],
        clientGST:           ['gst', 'gstin', 'gstno', 'clientgst', 'taxid', 'vat', 'tin'],
        clientContact:       ['contact', 'contactnumber', 'contactno', 'phone', 'phoneno', 'mobile', 'mobileno', 'tel', 'telephone'],
        clientEmail:         ['email', 'emailid', 'emailaddress', 'mailid'],
        clientAddress:       ['address', 'clientaddress', 'billingaddress', 'companyaddress', 'location'],
        referenceMode:       ['reference', 'referencemode', 'refmode', 'modeofreference', 'communicationmode'],
        poDate:              ['orderdate', 'orddate', 'podate', 'purchaseorderdate'],
        poNumber:            ['orderreferencenumber', 'orderrefno', 'orderref', 'ordernumber', 'orderno', 'ponumber', 'pono', 'purchaseorderno'],
        projectCode:         ['projectcode', 'project', 'projcode', 'projectno'],
        shippedVia:          ['dateshippedvia', 'datashippedvia', 'shippedvia', 'shipvia', 'dispatchedvia', 'despatchedvia', 'shipmentmode', 'modeofshipment'],
        department:          ['department', 'dept'],
        terms:               ['terms', 'term', 'paymentterms', 'termsofpayment'],
        currency:            ['currency', 'curr', 'ccy'],
        exchangeRate:        ['exchangerate', 'exrate', 'fxrate', 'conversionrate', 'forexrate'],
        // --- Beneficiary bank (printed on the invoice) ---
        bankOrgName:         ['organizationname', 'organisationname', 'orgname'],
        bankIfsc:            ['ifsccode', 'ifsc'],
        bankAccount:         ['accountnumber', 'accountno', 'accno', 'acno', 'acnumber', 'bankaccount'],
        bankName:            ['bankname', 'beneficiarybank', 'bank'],
        bankBranch:          ['branch', 'bankbranch'],
        narrations:          ['narrations', 'narration', 'remarks', 'notes'],
        // --- Line item (one per row) ---
        sno:                 ['sno', 'slno', 'slno.', 'serialno', 'serial', 'srno', 'sr'],
        specification:       ['detailedspecification', 'specification', 'spec', 'description', 'itemdescription', 'particulars', 'details', 'item'],
        uom:                 ['uom', 'unitofmeasure', 'unitofmeasurement', 'unit', 'units'],
        qty:                 ['quantity', 'qty', 'qnty', 'nos'],
        rate:                ['unitrate', 'unitprice', 'rateperunit', 'price'],
        amount:              ['amount', 'lineamount', 'linetotal', 'itemamount', 'linevalue']
    };

    // Which alias fields describe the invoice as a whole (taken from its first row)
    // vs. the per-row line item. Everything not listed here is a header field.
    const INV_ITEM_FIELDS = ['sno', 'specification', 'uom', 'qty', 'rate', 'amount'];

    function _norm(s) {
        return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // Build { field -> actual header } resolver from the sheet's header keys.
    function _resolveColumns(headerKeys, aliasMap) {
        aliasMap = aliasMap || FIELD_ALIASES;
        const normalised = headerKeys.map(h => ({ raw: h, norm: _norm(h) }));
        const map = {};
        Object.keys(aliasMap).forEach(field => {
            const aliases = aliasMap[field];
            // Exact normalised match first.
            let hit = normalised.find(h => aliases.includes(h.norm));
            // Then a looser "contains" match (e.g. "Client Company Name").
            if (!hit) hit = normalised.find(h => aliases.some(a => h.norm.includes(a)));
            if (hit) map[field] = hit.raw;
        });
        return map;
    }

    function _rowsToRecords(rows) {
        if (!rows.length) return { records: [], colMap: {} };
        const headerKeys = Object.keys(rows[0]);
        const colMap = _resolveColumns(headerKeys);
        const get = (row, field) => {
            const col = colMap[field];
            if (!col) return '';
            return String(row[col] == null ? '' : row[col]).trim();
        };
        const records = rows.map(row => ({
            name: get(row, 'name'),
            gst: get(row, 'gst'),
            address: get(row, 'address'),
            contactPerson: get(row, 'contactPerson'),
            contact: get(row, 'contact'),
            email: get(row, 'email'),
            group: get(row, 'group'),
            subGroup: get(row, 'subGroup')
        })).filter(r => r.name);
        return { records, colMap };
    }

    // "1,23,456.50" / "$1,234" → number.
    function _num(s) {
        const n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    // Parse a sheet into FULL invoice objects, one per invoice number. Rows sharing
    // an invoice number (or blank number continuation rows) are one invoice: the
    // header/client/bank fields come from the invoice's first row, and every row
    // contributes a line item. `mode` is forced by the calling card.
    // Returns { records: invoiceObjects[], clients: clientRecords[], colMap }.
    function _rowsToInvoices(rows, mode) {
        if (!rows.length) return { records: [], clients: [], colMap: {} };
        const headerKeys = Object.keys(rows[0]);
        const colMap = _resolveColumns(headerKeys, INV_FIELD_ALIASES);
        if (!colMap.refNumber) return { records: [], clients: [], colMap };

        const isIntl = (mode === 'international');
        const homeCur = (typeof Storage !== 'undefined' && Storage.getOrgInfo)
            ? Storage.getOrgInfo().defaultCurrency : '';
        const get = (row, field) => {
            const col = colMap[field];
            if (!col) return '';
            return String(row[col] == null ? '' : row[col]).trim();
        };

        // Group rows into invoices by invoice number (blank number = continuation of
        // the previous invoice, so multi-line item sheets work either way).
        const groups = [];
        const byRef = new Map();
        let current = null;
        rows.forEach(row => {
            const ref = get(row, 'refNumber');
            if (ref) {
                const key = ref.toLowerCase();
                current = byRef.get(key);
                if (!current) { current = { refNumber: ref, header: row, rows: [] }; byRef.set(key, current); groups.push(current); }
            }
            if (!current) return; // rows before any invoice number — ignore
            current.rows.push(row);
        });

        const settings = (typeof Storage !== 'undefined' && Storage.getSettings) ? Storage.getSettings() : {};
        const effSettings = isIntl ? { ...settings, gstEnabled: false } : settings;

        const records = groups.map(g => {
            const h = g.header;
            const items = [];
            g.rows.forEach(row => {
                const spec = get(row, 'specification');
                const qty = _num(get(row, 'qty'));
                const rate = _num(get(row, 'rate'));
                if (!spec && !qty && !rate) return; // not an item row
                const amount = FinanceUtils.truncate2(qty * rate);
                items.push({ sno: items.length + 1, specification: spec, qty, uom: get(row, 'uom'), rate, amount });
            });

            const subtotal = FinanceUtils.truncate2(items.reduce((s, it) => s + it.amount, 0));
            const clientGst = get(h, 'clientGST');
            const fin = (typeof FinanceUtils !== 'undefined')
                ? FinanceUtils.calculateTotals(subtotal, effSettings, clientGst)
                : { grandTotal: subtotal };

            const narrRaw = get(h, 'narrations');
            const termsAndConditions = narrRaw ? narrRaw.split(/[\n;]+/).map(s => s.trim()).filter(Boolean) : [];

            // Beneficiary bank block (only if any bank column was filled).
            const bankName = get(h, 'bankName'), bankAcc = get(h, 'bankAccount');
            const bankIfsc = get(h, 'bankIfsc'), bankBranch = get(h, 'bankBranch'), bankOrg = get(h, 'bankOrgName');
            const domesticBank = (bankName || bankAcc || bankIfsc || bankBranch || bankOrg)
                ? { orgName: bankOrg, name: bankName, accountNumber: bankAcc, ifscCode: bankIfsc, branch: bankBranch }
                : null;

            const currency = isIntl ? (get(h, 'currency') || 'USD') : (homeCur || 'INR');
            const exRate = _num(get(h, 'exchangeRate'));
            const grandTotal = fin.grandTotal;

            return {
                mode,
                refNumber: g.refNumber,
                date: _toISODate(get(h, 'date')),
                clientName: get(h, 'clientName'),
                clientContactPerson: get(h, 'clientContactPerson'),
                clientGST: clientGst,
                clientContact: get(h, 'clientContact'),
                clientEmail: get(h, 'clientEmail'),
                clientAddress: get(h, 'clientAddress'),
                invoiceType: 'po',
                referenceMode: get(h, 'referenceMode'),
                poDate: _toISODate(get(h, 'poDate')),
                poNumber: get(h, 'poNumber'),
                projectCode: get(h, 'projectCode'),
                shippedVia: get(h, 'shippedVia'),
                department: get(h, 'department'),
                terms: get(h, 'terms'),
                milestones: [],
                termsAndConditions,
                items,
                totalAmount: subtotal,
                ...fin,
                domesticBank,
                currency,
                exchangeRate: exRate || undefined,
                reportValue: isIntl ? (exRate ? grandTotal * exRate : undefined) : grandTotal
            };
        }).filter(r => r.refNumber);

        // Unique clients (deduped by name) → upserted into the client master so a
        // repeated client isn't added twice.
        const clients = [];
        const seen = new Set();
        records.forEach(r => {
            const key = (r.clientName || '').trim().toLowerCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            clients.push({
                name: r.clientName, gst: r.clientGST, address: r.clientAddress,
                contactPerson: r.clientContactPerson, contact: r.clientContact, email: r.clientEmail,
                clientType: mode
            });
        });

        return { records, clients, colMap };
    }

    // ── Tally Prime "Ledger Voucher" export ───────────────────────────────
    // Tally exports a ledger (e.g. "Consultancy Charges National") as a positional
    // sheet, NOT a header-mapped table: title rows, then columns
    //   Date | Particulars | (blank) | Vch Type | Vch No. | Debit | Credit
    // where one invoice = a "By …/Sales" row (date, client, Vch No., credit),
    // followed by its line-item rows (Particulars=spec, qty, rate, amount) and a
    // "Being the invoice…" narration row. We detect it, then parse positionally
    // into the SAME record shape _rowsToInvoices produces, so everything
    // downstream (save, client upsert, serial bump, result message) is unchanged.

    // Column indices in the array-of-arrays (0-based). Note col E/F carry
    // different meanings on a header row (Vch Type / Vch No.) vs an item row
    // (rate / amount) — the parser reads them per row-type.
    const _T = { date: 0, by: 1, particulars: 2, qty: 3, rateOrType: 4, amountOrVno: 5 };

    function _looksLikeTally(aoa) {
        for (let i = 0; i < Math.min(aoa.length, 25); i++) {
            const row = aoa[i] || [];
            for (const cell of row) {
                if (_norm(cell) === 'vchno') return true;   // "Vch No." header cell
            }
        }
        return false;
    }

    function _isNum(v) {
        if (v == null || v === '') return false;
        return !isNaN(parseFloat(String(v).replace(/[^0-9.\-]/g, '')));
    }

    function _parseTallyInvoices(aoa, mode) {
        const isIntl = (mode === 'international');
        const homeCur = (typeof Storage !== 'undefined' && Storage.getOrgInfo)
            ? Storage.getOrgInfo().defaultCurrency : '';
        const settings = (typeof Storage !== 'undefined' && Storage.getSettings) ? Storage.getSettings() : {};
        const effSettings = isIntl ? { ...settings, gstEnabled: false } : settings;
        const cell = (row, i) => String(row[i] == null ? '' : row[i]).trim();

        // Group rows into invoices. A "By …/Sales" row opens one; every following
        // row (until the next By/To voucher) is either a line item or narration.
        const groups = [];
        let current = null;
        aoa.forEach(row => {
            const by = cell(row, _T.by);
            const vchType = cell(row, _T.rateOrType);
            if (by === 'By' && /sales/i.test(vchType)) {
                current = { header: row, items: [], narration: [] };
                groups.push(current);
                return;
            }
            // Any other voucher line (Opening/Closing Balance, non-Sales) ends the
            // current invoice and is not itself imported.
            if (by === 'By' || by === 'To') { current = null; return; }
            if (!current) return;
            const spec = cell(row, _T.particulars);
            if (!spec) return;
            if (_isNum(row[_T.qty]) || _isNum(row[_T.amountOrVno])) {
                const qty = _num(cell(row, _T.qty));
                const rate = _num(cell(row, _T.rateOrType));
                let amount = _num(cell(row, _T.amountOrVno));
                if (!amount) amount = FinanceUtils.truncate2(qty * rate);
                current.items.push({ spec, qty, rate, amount });
            } else {
                current.narration.push(spec);   // "Being the invoice …"
            }
        });

        // Verify each client against the saved client master (matched by name +
        // this mode/branch). Tally's export carries NO GSTIN, so when the client
        // already exists in the app we reuse its saved GST — that's what decides
        // the tax split (IGST inter-state vs CGST+SGST intra-state) and pulls the
        // saved address/contact onto the imported invoice. No match → GST blank.
        const savedClients = (typeof Storage !== 'undefined' && Storage.getAllVendors) ? Storage.getAllVendors() : [];
        const clientKey = n => (n || '').trim().toLowerCase();
        const clientByName = new Map();
        savedClients.forEach(c => {
            const t = (c.clientType === 'international') ? 'international' : 'domestic';
            if (t === mode) clientByName.set(clientKey(c.name), c);
        });

        let matchedCount = 0;
        const records = groups.map(g => {
            const h = g.header;
            const refNumber = cell(h, _T.amountOrVno);       // Vch No.
            const clientName = cell(h, _T.particulars);
            const saved = clientByName.get(clientKey(clientName)) || null;
            if (saved) matchedCount++;
            const clientGST = saved ? (saved.gst || '') : '';
            const items = g.items.map((it, i) => ({
                sno: i + 1, specification: it.spec, qty: it.qty, uom: '',
                rate: it.rate, amount: FinanceUtils.truncate2(it.amount)
            }));
            const subtotal = FinanceUtils.truncate2(items.reduce((s, it) => s + it.amount, 0));
            // Tally books the taxable value; reconstruct the grand total with the
            // org's GST, using the matched client's GSTIN for the correct split.
            const fin = (typeof FinanceUtils !== 'undefined')
                ? FinanceUtils.calculateTotals(subtotal, effSettings, clientGST)
                : { grandTotal: subtotal };
            const grandTotal = fin.grandTotal;
            return {
                mode,
                refNumber,
                date: _toISODate(h[_T.date]),
                clientName,
                clientContactPerson: saved ? (saved.contactPerson || '') : '',
                clientGST,
                clientContact: saved ? (saved.contact || '') : '',
                clientEmail: saved ? (saved.email || '') : '',
                clientAddress: saved ? (saved.address || '') : '',
                clientMatched: !!saved,
                invoiceType: 'po',
                referenceMode: '', poDate: '', poNumber: '', projectCode: '', shippedVia: '',
                department: '', terms: '',
                milestones: [],
                termsAndConditions: g.narration.filter(Boolean),
                items,
                totalAmount: subtotal,
                ...fin,
                domesticBank: null,
                currency: isIntl ? (homeCur || 'USD') : (homeCur || 'INR'),
                exchangeRate: undefined,
                reportValue: isIntl ? undefined : grandTotal
            };
        }).filter(r => r.refNumber && r.items.length);

        // Only clients NOT already in the master are added (as new, no GST — the
        // user fills their GST in the app, and future imports pick it up). Existing
        // matched clients are left untouched.
        const clients = [];
        const seen = new Set();
        records.forEach(r => {
            const key = clientKey(r.clientName);
            if (!key || seen.has(key) || clientByName.has(key)) return;
            seen.add(key);
            clients.push({ name: r.clientName, gst: '', address: '', contactPerson: '', contact: '', email: '', clientType: mode });
        });

        // Synthetic colMap so the caller's "found Invoice Number" guard and the
        // "Columns matched" line work unchanged.
        const colMap = { refNumber: 'Vch No.', date: 'Date', clientName: 'Particulars',
                         specification: 'Particulars', qty: 'Qty', rate: 'Rate', amount: 'Amount' };
        return { records, clients, colMap, matchedCount };
    }

    function _isoParts(y, mo, d) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }

    // Pull the numeric serial out of a ref number. The serial is the segment before
    // the trailing financial-year segment: ORG/0001/2627 → 1, ORG/INT023/2627 → 23.
    function _serialFromRef(ref) {
        const parts = String(ref || '').split('/').filter(Boolean);
        if (parts.length < 2) return 0;
        const seg = parts[parts.length - 2];       // segment before the FY
        const digits = (seg.match(/\d+/) || [''])[0];
        return parseInt(digits, 10) || 0;
    }

    // After importing, raise the INV_DOM / INV_INT serial counter (per financial
    // year) to the highest imported serial, so form-created invoices continue from
    // there instead of colliding with imported ones.
    function _bumpInvoiceSerials(records, mode) {
        if (typeof Storage === 'undefined' || !Storage.bumpSerialNumber || !Storage.getFinancialYear) return;
        const docType = (mode === 'international') ? 'INV_INT' : 'INV_DOM';
        const maxByFy = {};   // fy -> max serial
        records.forEach(r => {
            const serial = _serialFromRef(r.refNumber);
            if (!serial || !r.date) return;
            const fy = Storage.getFinancialYear(r.date);
            if (!fy) return;
            if (!maxByFy[fy] || serial > maxByFy[fy]) maxByFy[fy] = serial;
        });
        Object.keys(maxByFy).forEach(fy => Storage.bumpSerialNumber(docType, '', fy, maxByFy[fy]));
    }

    // Best-effort date → YYYY-MM-DD. Handles JS Date objects (XLSX cellDates),
    // Excel day-serials, ISO, and D/M/Y or M/D/Y text. Returns '' (never a bad
    // string) when unparseable, so a stored date can never format to "NaN-…".
    function _toISODate(v) {
        if (v == null || v === '') return '';
        // Real Date object (from XLSX cellDates:true). SheetJS builds date cells at
        // MIDNIGHT UTC of the intended calendar day, so read the UTC parts — reading
        // local parts rolls the date back a day on any machine in a behind-UTC
        // timezone (the "8-May → 7-May" off-by-one). Matches the Excel-serial branch
        // below, which is already UTC.
        if (v instanceof Date) {
            return isNaN(v.getTime()) ? '' : _isoParts(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
        }
        const s = String(v).trim();
        if (!s) return '';
        // Excel day-serial (e.g. 45762), possibly with a time fraction.
        if (/^\d{4,5}(\.\d+)?$/.test(s)) {
            const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86400000);
            if (!isNaN(d.getTime())) return _isoParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        }
        // Already ISO (YYYY-MM-DD…).
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return _isoParts(+m[1], +m[2], +m[3]);
        // D/M/Y or M/D/Y with / - . separators.
        m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (m) {
            let a = +m[1], b = +m[2], y = +m[3];
            if (m[3].length === 2) y += 2000;
            let day, mon;
            if (a > 12 && b <= 12) { day = a; mon = b; }        // 1st part > 12 ⇒ D/M/Y
            else if (b > 12 && a <= 12) { day = b; mon = a; }   // 2nd part > 12 ⇒ M/D/Y
            else {
                // Ambiguous (both ≤ 12): read as D/M/Y.
                day = a; mon = b;
            }
            if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return _isoParts(y, mon, day);
        }
        // Last resort: native parse.
        const d = new Date(s);
        return isNaN(d.getTime()) ? '' : _isoParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }

    function _setResult(kind, html, ok) {
        const el = document.getElementById('bulk-result-' + kind);
        if (!el) return;
        el.style.display = 'block';
        el.style.color = ok === false ? '#b91c1c' : (ok ? '#15803d' : '#52525b');
        el.innerHTML = html;
    }

    // Read the chosen file, parse the first sheet, map columns, and save.
    // kind: 'domestic' | 'international' | 'supplier'
    function handleFile(inputEl, kind) {
        const file = inputEl && inputEl.files && inputEl.files[0];
        if (!file) return;
        if (typeof XLSX === 'undefined') {
            _setResult(kind, 'Spreadsheet library failed to load — check your internet connection and reload.', false);
            return;
        }
        // Confirm before importing — a bulk upload creates/updates many records at once.
        if (typeof App !== 'undefined' && App.showConfirm) {
            App.showConfirm(
                'Import this file?',
                `“${file.name}” will be imported and its rows added to your records. Continue?`,
                () => _processFile(inputEl, kind, file),
                () => { inputEl.value = ''; }
            );
        } else {
            _processFile(inputEl, kind, file);
        }
    }

    function _processFile(inputEl, kind, file) {
        _setResult(kind, 'Reading file…', null);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // Read WITHOUT cellDates: date cells then arrive as raw Excel day
                // serials (e.g. 46150), which _toISODate converts arithmetically in
                // UTC — fully timezone-proof. cellDates would hand over JS Date
                // objects whose local/UTC reading shifts the day by one on machines
                // in a behind-UTC timezone (the "8-May → 7-May" bug).
                const wb = XLSX.read(data, { type: 'array' });
                const firstSheet = wb.SheetNames[0];
                const sheet = wb.Sheets[firstSheet];
                const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                if (!rows.length) {
                    _setResult(kind, 'No rows found in the sheet.', false);
                    inputEl.value = '';
                    return;
                }

                if (kind === 'invoice-domestic' || kind === 'invoice-international') {
                    const forced = (kind === 'invoice-international') ? 'international' : 'domestic';
                    // Auto-detect a Tally Prime ledger export (positional layout) and
                    // parse it directly; otherwise use the header-mapped template parser.
                    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
                    const { records, clients, colMap, matchedCount } = _looksLikeTally(aoa)
                        ? _parseTallyInvoices(aoa, forced)
                        : _rowsToInvoices(rows, forced);
                    if (!colMap.refNumber) {
                        _setResult(kind, `Could not find an <b>Invoice Number</b> column. Found headers: ${Object.keys(rows[0]).map(h => `<code>${_esc(h)}</code>`).join(', ')}. Rename a column to <b>Invoice Number</b> (or download the template).`, false);
                        inputEl.value = '';
                        return;
                    }
                    if (!records.length) {
                        _setResult(kind, 'No rows with an invoice number to import.', false);
                        inputEl.value = '';
                        return;
                    }
                    const res = Storage.bulkUpsertInvoices(records);
                    // Add the invoices' clients to the client master, deduped by name.
                    const cRes = clients.length ? Storage.bulkUpsertVendors(clients) : { added: 0, updated: 0 };
                    // Continue the auto-serial past the highest imported ref, per financial
                    // year, so the next invoice created from the form doesn't restart at 1.
                    _bumpInvoiceSerials(records, forced);
                    const itemCount = records.reduce((s, r) => s + (r.items ? r.items.length : 0), 0);
                    const mappedCols = Object.keys(colMap).map(f => `${f} ← <code>${_esc(colMap[f])}</code>`).join(', ');
                    _setResult(kind,
                        `✓ Imported <b>${res.added + res.updated}</b> ${forced} invoices (<b>${res.added}</b> new, <b>${res.updated}</b> updated) with <b>${itemCount}</b> line items.<br>` +
                        `Clients: <b>${cRes.added}</b> new, <b>${cRes.updated}</b> matched (no duplicates).` +
                        `${typeof matchedCount === 'number' ? `<br>GST reused from <b>${matchedCount}</b> of ${records.length} invoices' saved clients${matchedCount < records.length ? ` — the rest had no matching client (add them &amp; their GST in the app, then re-import to apply tax).` : '.'}` : ''}` +
                        `${res.skipped ? ` ${res.skipped} rows skipped (no invoice no).` : ''}` +
                        `<br><span style="font-size:11px; color:#71717a;">Columns matched: ${mappedCols}</span>`,
                        true);
                    if (typeof App !== 'undefined' && App.showToast) App.showToast(`Imported ${res.added + res.updated} ${forced} invoices`, 'success');
                    inputEl.value = '';
                    return;
                }

                const { records, colMap } = _rowsToRecords(rows);
                if (!colMap.name) {
                    _setResult(kind, `Could not find a <b>Name</b> column. Found headers: ${Object.keys(rows[0]).map(h => `<code>${_esc(h)}</code>`).join(', ')}. Rename a column to <b>Name</b> (or download the template).`, false);
                    inputEl.value = '';
                    return;
                }
                if (!records.length) {
                    _setResult(kind, 'No rows with a Name value to import.', false);
                    inputEl.value = '';
                    return;
                }

                let res;
                if (kind === 'supplier') {
                    res = Storage.bulkUpsertSuppliers(records);
                } else {
                    records.forEach(r => { r.clientType = (kind === 'international') ? 'international' : 'domestic'; });
                    res = Storage.bulkUpsertVendors(records);
                }

                const label = kind === 'supplier' ? 'suppliers' : (kind + ' clients');
                const mappedCols = Object.keys(colMap).map(f => `${f} ← <code>${_esc(colMap[f])}</code>`).join(', ');
                _setResult(kind,
                    `✓ Imported <b>${res.added + res.updated}</b> ${label}: <b>${res.added}</b> new, <b>${res.updated}</b> updated${res.skipped ? `, ${res.skipped} skipped (no name)` : ''}.<br><span style="font-size:11px; color:#71717a;">Columns matched: ${mappedCols}</span>`,
                    true);
                if (typeof App !== 'undefined' && App.showToast) {
                    App.showToast(`Imported ${res.added + res.updated} ${label}`, 'success');
                }
            } catch (err) {
                console.error('Bulk import failed:', err);
                _setResult(kind, 'Could not read this file. Make sure it is a valid .xlsx, .xls or .csv file.', false);
            }
            inputEl.value = ''; // allow re-selecting the same file
        };
        reader.onerror = () => { _setResult(kind, 'Failed to read the file.', false); };
        reader.readAsArrayBuffer(file);
    }

    // Download a ready-to-fill template (.csv) with the expected headers.
    function downloadTemplate(kind) {
        if (kind === 'invoice-domestic' || kind === 'invoice-international') {
            const isIntl = (kind === 'invoice-international');
            const homeCur = (typeof Storage !== 'undefined' && Storage.getOrgInfo)
                ? Storage.getOrgInfo().defaultCurrency : 'INR';
            // Full invoice sheet. Mode is fixed by the card. One invoice can span
            // several rows — one per line item — sharing the same Invoice Number;
            // header/client/bank cells only need filling on the invoice's first row.
            const invHeaders = [
                'Invoice Number', 'Date', 'Company Name', 'Contact Person Name', 'GST', 'Contact', 'Email', 'Address',
                'Reference', 'Order Date', 'Order Reference Number', 'Project Code', 'Date Shipped Via', 'Department', 'Terms',
                'S.No', 'Detailed Specification', 'UOM', 'Quantity', 'Unit Rate', 'Amount',
                'Organization Name', 'IFSC Code', 'Account Number', 'Bank Name', 'Branch', 'Narrations',
                'Currency', 'Exchange Rate'
            ];
            // Sample dates (D/M/Y).
            const dSample = '15/04/2025';   // "Date" (15 Apr 2025)
            const dOrder  = '10/04/2025';   // "Order Date" (10 Apr 2025)
            // Two-line sample: one invoice with two line items (2nd row = item only).
            const invSample = isIntl
                ? [
                    ['ORG/INT001/2526', dSample, 'Globex International LLC', 'John Carter', '', '+1 212 555 0100', 'contact@globex.com', '500 Market St, New York, USA',
                     'Email', dOrder, 'PO-9001', 'PRJ-01', 'Air', 'Exports', 'Advance',
                     '1', 'Consulting services', 'Nos', '1', '10000', '10000',
                     'Globex International LLC', '', '', 'Citibank', 'New York', 'Payment within 30 days', 'USD', '83.5'],
                    ['ORG/INT001/2526', '', '', '', '', '', '', '',
                     '', '', '', '', '', '', '',
                     '2', 'Onsite support', 'Nos', '5', '500', '2500',
                     '', '', '', '', '', '', '', '']
                  ]
                : [
                    ['ORG/0001/2526', dSample, 'Bharat Traders', 'Sita Sharma', '27AABCB1234C1ZX', '9123456780', 'info@bharattraders.in', '45 MG Road, Mumbai',
                     'Email', dOrder, 'PO-1234', 'PRJ-01', 'Road', 'Sales', 'Advance',
                     '1', 'Steel rods 12mm', 'MT', '10', '5000', '50000',
                     'Bharat Traders Pvt Ltd', 'HDFC0001234', '50100123456789', 'HDFC Bank', 'MG Road', 'Payment within 30 days', homeCur, ''],
                    ['ORG/0001/2526', '', '', '', '', '', '', '',
                     '', '', '', '', '', '', '',
                     '2', 'Cement bags', 'Bags', '100', '350', '35000',
                     '', '', '', '', '', '', '', '']
                  ];
            _downloadCsv(`${isIntl ? 'international' : 'domestic'}-invoice-import-template.csv`, invHeaders, invSample);
            return;
        }

        const headers = ['Name', 'Group', 'Sub Group', 'GST', 'Address', 'Contact Person', 'Phone', 'Email'];
        const sample = kind === 'supplier'
            ? ['ACME Supplies Pvt Ltd', '', '', '29ABCDE1234F1Z5', '12 Industrial Area, City', 'Ramesh Kumar', '9876543210', 'sales@acme.com']
            : (kind === 'international'
                ? ['Globex International LLC', '', '', '', '500 Market St, New York, USA', 'John Carter', '+1 212 555 0100', 'contact@globex.com']
                : ['Bharat Traders', 'Bharat Group', 'Mumbai Branch', '27AABCB1234C1ZX', '45 MG Road, Mumbai', 'Sita Sharma', '9123456780', 'info@bharattraders.in']);

        _downloadCsv(`${kind}-import-template.csv`, headers, sample);
    }

    // Write a header row + one or more sample rows as a downloadable CSV.
    // `sample` may be a single row (array of cells) or an array of such rows.
    function _downloadCsv(filename, headers, sample) {
        const esc = v => {
            const s = String(v == null ? '' : v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const rows = Array.isArray(sample[0]) ? sample : [sample];
        const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n') + '\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function renderBulkImportPage() {
        const container = document.getElementById('bulk-import-blocks');
        if (!container) return;

        // Previous-invoices cards.
        const invCard = (kind, title, accent) => `
                <div style="border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:18px; background:linear-gradient(180deg,#ffffff,#fbfbfc);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">
                        <div style="font-size:14.5px; font-weight:800; color:#18181b;">${title}</div>
                    </div>
                    <p style="font-size:12px; color:#71717a; margin:0 0 12px;">Import past domestic invoices in full — client, line items, bank &amp; totals. Repeat the Invoice Number across rows for multi-item invoices. Clients are auto-added (no duplicates). Deduped by Invoice Number.<br><b>Tally Prime</b> ledger exports are auto-detected — upload them as-is, no reformatting.</p>
                    <label style="display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border:1px dashed ${accent}66; border-radius:10px; background:transparent; color:${accent}; font-size:13px; font-weight:600; cursor:pointer;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Choose Excel / CSV file
                        <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="BulkImport.handleFile(this,'${kind}')">
                    </label>
                    <div id="bulk-result-${kind}" style="display:none; margin-top:12px; font-size:13px;"></div>
                </div>
`;
        const invBlock = invCard('invoice-domestic', 'Domestic Invoices', '#6d28d9');

        container.innerHTML = `
            <!-- Domestic clients -->
            <div style="border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:18px; background:linear-gradient(180deg,#ffffff,#fbfbfc);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">
                    <div style="font-size:14.5px; font-weight:800; color:#18181b;">Domestic Clients</div>
                    <button type="button" class="btn btn-secondary" style="padding:7px 14px; font-size:12.5px;" onclick="BulkImport.downloadTemplate('domestic')">Download template</button>
                </div>
                <p style="font-size:12px; color:#71717a; margin:0 0 12px;">Saved as India domestic clients (used on Domestic Quotation / Invoice).</p>
                <label style="display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border:1px dashed rgba(0,77,44,0.4); border-radius:10px; background:transparent; color:#004d2c; font-size:13px; font-weight:600; cursor:pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Choose Excel / CSV file
                    <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="BulkImport.handleFile(this,'domestic')">
                </label>
                <div id="bulk-result-domestic" style="display:none; margin-top:12px; font-size:13px;"></div>
            </div>

            <!-- International clients -->
            <div style="border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:18px; background:linear-gradient(180deg,#ffffff,#fbfbfc);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">
                    <div style="font-size:14.5px; font-weight:800; color:#18181b;">International Clients</div>
                    <button type="button" class="btn btn-secondary" style="padding:7px 14px; font-size:12.5px;" onclick="BulkImport.downloadTemplate('international')">Download template</button>
                </div>
                <p style="font-size:12px; color:#71717a; margin:0 0 12px;">Saved as international clients (used on International Quotation / Invoice).</p>
                <label style="display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border:1px dashed rgba(243,123,33,0.45); border-radius:10px; background:transparent; color:#c2410c; font-size:13px; font-weight:600; cursor:pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Choose Excel / CSV file
                    <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="BulkImport.handleFile(this,'international')">
                </label>
                <div id="bulk-result-international" style="display:none; margin-top:12px; font-size:13px;"></div>
            </div>

            ${invBlock}
            <!-- PO Suppliers -->
            <div style="border:1px solid rgba(0,0,0,0.08); border-radius:14px; padding:18px; background:linear-gradient(180deg,#ffffff,#fbfbfc);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">
                    <div style="font-size:14.5px; font-weight:800; color:#18181b;">PO Suppliers</div>
                    <button type="button" class="btn btn-secondary" style="padding:7px 14px; font-size:12.5px;" onclick="BulkImport.downloadTemplate('supplier')">Download template</button>
                </div>
                <p style="font-size:12px; color:#71717a; margin:0 0 12px;">Saved as PO suppliers (used on Purchase Orders) — kept separate from clients.</p>
                <label style="display:inline-flex; align-items:center; gap:8px; padding:10px 16px; border:1px dashed rgba(37,99,235,0.4); border-radius:10px; background:transparent; color:#1d4ed8; font-size:13px; font-weight:600; cursor:pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Choose Excel / CSV file
                    <input type="file" accept=".xlsx,.xls,.csv" style="display:none;" onchange="BulkImport.handleFile(this,'supplier')">
                </label>
                <div id="bulk-result-supplier" style="display:none; margin-top:12px; font-size:13px;"></div>
            </div>
        `;
    }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return { handleFile, downloadTemplate, renderBulkImportPage, _parseTallyInvoices, _looksLikeTally };
})();
