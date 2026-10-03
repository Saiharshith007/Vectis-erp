/* ============================================
   Sales Module — turnover over a month range
   (start month+year → end month+year), from
   generated invoices. Reports in INR;
   foreign-currency invoices are converted
   using the exchange rate captured on each
   invoice when it was generated.
   ============================================ */

const Sales = (() => {
    const _now = new Date();
    let _state = {
        startMonth: _now.getMonth() + 1, // 1-12
        startYear: _now.getFullYear(),
        endMonth: _now.getMonth() + 1,   // 1-12
        endYear: _now.getFullYear(),
        scope: 'domestic',               // 'domestic' | 'international' | 'all'
        metric: 'net',                   // 'net' | 'gross'
        department: '',                  // '' (all) | a department | '__none__' (no dept)
        rangeMode: 'months',             // 'months' (MM/YYYY–MM/YYYY) | 'fy' (financial year)
        expanded: {},                    // { 'year-month': true } — months whose invoice list is expanded
        bPage: 1,                        // monthly-breakdown table page
        bPageSize: 10
    };


    const MONTHS = [
        { v: 1, label: 'January' }, { v: 2, label: 'February' }, { v: 3, label: 'March' },
        { v: 4, label: 'April' }, { v: 5, label: 'May' }, { v: 6, label: 'June' },
        { v: 7, label: 'July' }, { v: 8, label: 'August' }, { v: 9, label: 'September' },
        { v: 10, label: 'October' }, { v: 11, label: 'November' }, { v: 12, label: 'December' }
    ];

    function _escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _formatMoney(amount, currency) {
        if (typeof PdfUtils !== 'undefined' && PdfUtils.formatMoney) {
            return PdfUtils.formatMoney(amount, currency || 'INR');
        }
        return (amount || 0).toFixed(2);
    }

    const REPORT_CUR = 'INR';

    // --- Currency conversion -------------------------------------------------
    // Foreign-currency invoices carry the exchange rate the user supplied when the
    // invoice was generated (inv.exchangeRate, in report-currency units per 1 unit
    // of the invoice currency). The turnover total converts each invoice with its
    // own stored rate; there are no longer any shared/global manual rates.

    // The chosen metric value (net or gross) converted into the region's report
    // currency. Returns null for a foreign invoice that has no usable stored rate,
    // so callers can flag it as unconverted instead of treating it as 1:1.
    function _invoiceReportValue(inv) {
        const reportCur = REPORT_CUR;
        const cur = (inv && inv.currency) || reportCur;
        const amount = _invoiceValue(inv);
        if (cur === reportCur) return FinanceUtils.truncate2(amount);
        const rate = parseFloat(inv && inv.exchangeRate);
        return (rate > 0) ? FinanceUtils.truncate2(amount * rate) : null;
    }

    // Foreign-currency invoices present that have no usable exchange rate stored
    // (so their amounts can't be converted into the report currency).
    function _missingRateCurrencies(invoices) {
        const reportCur = REPORT_CUR;
        const curs = invoices
            .filter(inv => ((inv.currency || reportCur) !== reportCur) && !(parseFloat(inv.exchangeRate) > 0))
            .map(inv => inv.currency);
        return [...new Set(curs)];
    }

    // --- Range helpers (month+year → month+year) -----------------------------
    function _absIndex(month, year) { return year * 12 + (month - 1); }

    // Ordered list of { year, month } between two month/year endpoints (inclusive),
    // auto-swapped if the end precedes the start.
    function _rangeMonthsBetween(sm, sy, em, ey) {
        let s = _absIndex(sm, sy);
        let e = _absIndex(em, ey);
        if (s > e) { const t = s; s = e; e = t; }
        const arr = [];
        for (let i = s; i <= e; i++) arr.push({ year: Math.floor(i / 12), month: (i % 12) + 1 });
        return arr;
    }

    // Ordered list of { year, month } from start to end (inclusive); auto-swaps
    // if the user picked an end before the start.
    function _rangeMonths() {
        return _rangeMonthsBetween(_state.startMonth, _state.startYear, _state.endMonth, _state.endYear);
    }

    // Shift a month/year by a whole number of months.
    function _shiftMonth(month, year, delta) {
        const idx = _absIndex(month, year) + delta;
        return { month: (idx % 12) + 1, year: Math.floor(idx / 12) };
    }

    // The "previous period" used for the KPI comparisons: a same-length window
    // immediately before the selected range. In financial-year mode that is the
    // previous FY (FY 2026-27 compares against FY 2025-26). In month mode it is the
    // block of months directly before the range (Apr–May 2026 compares against
    // Feb–Mar 2026; Apr–Jun 2026 against Jan–Mar 2026; a single month against the
    // month before it).
    function _prevRange() {
        const len = _absIndex(_state.endMonth, _state.endYear) - _absIndex(_state.startMonth, _state.startYear) + 1;
        const delta = _state.rangeMode === 'fy' ? -12 : -len;
        const s = _shiftMonth(_state.startMonth, _state.startYear, delta);
        const e = _shiftMonth(_state.endMonth, _state.endYear, delta);
        return { startMonth: s.month, startYear: s.year, endMonth: e.month, endYear: e.year };
    }

    function _prevRangeLabel() {
        const p = _prevRange();
        const r = _rangeMonthsBetween(p.startMonth, p.startYear, p.endMonth, p.endYear);
        if (r.length === 0) return '';
        const a = r[0], b = r[r.length - 1];
        const m = o => MONTHS[o.month - 1].label.slice(0, 3);
        if (a.year === b.year && a.month === b.month) return `${m(a)} ${a.year}`;
        return `${m(a)} ${a.year} – ${m(b)} ${b.year}`;
    }

    // Domestic / international / total turnover (report currency) and invoice count
    // over an arbitrary range. Honours the department filter but always covers both
    // regions (the scope pill only narrows the breakdown table + chart, not the KPIs).
    function _statsForRange(range) {
        const list = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const keys = new Set(_rangeMonthsBetween(range.startMonth, range.startYear, range.endMonth, range.endYear).map(o => `${o.year}-${o.month}`));
        let dom = 0, intl = 0, count = 0;
        list.forEach(inv => {
            if (!inv || !inv.date) return;
            const d = new Date(inv.date);
            if (isNaN(d.getTime())) return;
            if (!keys.has(`${d.getFullYear()}-${d.getMonth() + 1}`)) return;
            if (!_matchesRowFilters(inv)) return;
            const v = _invoiceReportValue(inv);
            if (v == null) return;
            count += 1;
            if ((inv.mode || 'domestic') === 'international') intl += v; else dom += v;
        });
        // Subtract same-FY credit notes filed within this range (by filing month),
        // and tally the total credit-note value filed in the range.
        const ded = _creditDeductionsByMonth();
        let credit = 0;
        Object.keys(ded).forEach(k => {
            if (!keys.has(k)) return;
            dom -= ded[k].dom;
            intl -= ded[k].intl;
            credit += ded[k].dom + ded[k].intl;
        });
        return { dom, intl, total: dom + intl, count, credit };
    }

    // Per-month series over the last `nMonths` ending at the selected range end,
    // used to draw the KPI sparklines. `picker(cell)` selects which metric.
    function _sparkSeries(picker, nMonths) {
        const endIdx = _absIndex(_state.endMonth, _state.endYear);
        const months = [];
        for (let i = nMonths - 1; i >= 0; i--) {
            const idx = endIdx - i;
            months.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
        }
        const list = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const byKey = {};
        months.forEach(o => { byKey[`${o.year}-${o.month}`] = { dom: 0, intl: 0, count: 0, credit: 0 }; });
        list.forEach(inv => {
            if (!inv || !inv.date) return;
            const d = new Date(inv.date);
            if (isNaN(d.getTime())) return;
            const cell = byKey[`${d.getFullYear()}-${d.getMonth() + 1}`];
            if (!cell) return;
            if (!_matchesRowFilters(inv)) return;
            const v = _invoiceReportValue(inv);
            if (v == null) return;
            cell.count += 1;
            if ((inv.mode || 'domestic') === 'international') cell.intl += v; else cell.dom += v;
        });
        // Reduce each month by the same-FY credit notes filed that month.
        const ded = _creditDeductionsByMonth();
        months.forEach(o => {
            const cell = byKey[`${o.year}-${o.month}`];
            const d = ded[`${o.year}-${o.month}`];
            if (cell && d) { cell.dom -= d.dom; cell.intl -= d.intl; cell.credit = d.dom + d.intl; }
        });
        return months.map(o => picker(byKey[`${o.year}-${o.month}`]));
    }

    // Minimal inline area-sparkline SVG from a numeric series.
    function _sparkline(values, color) {
        const w = 120, h = 40, pad = 3;
        const vals = (values && values.length) ? values : [0, 0];
        const max = Math.max(...vals, 1);
        const min = Math.min(...vals, 0);
        const span = (max - min) || 1;
        const n = vals.length;
        const pts = vals.map((v, i) => {
            const x = pad + (n === 1 ? 0.5 : i / (n - 1)) * (w - 2 * pad);
            const y = h - pad - ((v - min) / span) * (h - 2 * pad);
            return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
        });
        const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
        const area = `${line} L${pts[n - 1][0]},${h} L${pts[0][0]},${h} Z`;
        const id = 'spk' + Math.random().toString(36).slice(2, 8);
        return `<svg viewBox="0 0 ${w} ${h}" width="120" height="40" preserveAspectRatio="none" style="display:block; overflow:visible;">
            <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
                <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
            </linearGradient></defs>
            <path d="${area}" fill="url(#${id})"/>
            <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
    }

    function _multiYear() {
        const r = _rangeMonths();
        return r.length > 0 && r[0].year !== r[r.length - 1].year;
    }

    function _monthLabel(year, month, forceYear) {
        return `${MONTHS[month - 1].label}${(forceYear || _multiYear()) ? ' ' + year : ''}`;
    }

    function _rangeLabel() {
        const r = _rangeMonths();
        if (r.length === 0) return '';
        const a = r[0], b = r[r.length - 1];
        if (a.year === b.year && a.month === b.month) return `${MONTHS[a.month - 1].label} ${a.year}`;
        return `${MONTHS[a.month - 1].label} ${a.year} – ${MONTHS[b.month - 1].label} ${b.year}`;
    }

    // Period text for the PDF: "<Month> of <YYYY>" for a single month,
    // otherwise "MM/YY to MM/YY".
    // Period text for the report PDFs in the form "MM/YYYY - MM/YYYY"
    // (or a single "MM/YYYY" when the range is one month).
    function _pdfPeriodRange() {
        const r = _rangeMonths();
        if (r.length === 0) return '';
        const a = r[0], b = r[r.length - 1];
        const mm = n => String(n).padStart(2, '0');
        const start = `${mm(a.month)}/${a.year}`;
        const end = `${mm(b.month)}/${b.year}`;
        return start === end ? start : `${start} - ${end}`;
    }

    function _matchesScope(inv) {
        if (_state.scope === 'all') return true;
        return (inv.mode || 'domestic') === _state.scope;
    }

    // Row-level filters shared by the KPIs, chart, breakdown and the exports:
    // department plus the client multi-select. (Scope is applied separately —
    // the KPI cards deliberately span both regions.)
    function _matchesRowFilters(inv) {
        const sel = Dashboard.clientSelection('sales');
        if (sel.size && !sel.has((inv.clientName || '').trim())) return false;
        if (!_state.department) return true;                       // All departments
        const d = inv.department || '';
        if (_state.department === '__none__') return d === '';      // No department set
        return d === _state.department;
    }

    // Invoices whose date falls in the selected month range + scope + department.
    function _filteredInvoices() {
        const list = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const keys = new Set(_rangeMonths().map(o => `${o.year}-${o.month}`));
        return list.filter(inv => {
            if (!inv || !inv.date) return false;
            const d = new Date(inv.date);
            if (isNaN(d.getTime())) return false;
            if (!keys.has(`${d.getFullYear()}-${d.getMonth() + 1}`)) return false;
            return _matchesScope(inv) && _matchesRowFilters(inv);
        });
    }

    function _invoiceValue(inv) {
        let net = FinanceUtils.truncate2(parseFloat(inv.totalAmount || 0) || 0);
        let gross = parseFloat(inv.grandTotal || inv.totalAmount || 0) || 0;
        // Match the PDF: when Round Off is selected, domestic INR invoices print totals
        // rounded to the nearest rupee. Mirror that here so the dashboard
        // total reconciles with the document.
        const roundOffOn = typeof Storage !== 'undefined' && Storage.getINVColumnVisibility
            && Storage.getINVColumnVisibility().roundOff === true;
        if (roundOffOn && inv.mode === 'domestic' && (inv.currency || 'INR') === 'INR') {
            gross = Math.round(gross);
        }
        return _state.metric === 'net' ? net : gross;
    }

    // Credit notes (Sales Returns) reduce sales in the MONTH THEY WERE FILED — not
    // the invoice's month — provided the credit note falls in the SAME financial
    // year as its invoice (e.g. an April invoice credited in June reduces June's
    // sales). Returns the deductions in report currency, keyed by the credit note's
    // "year-month", split into { dom, intl } by the linked invoice's mode. Honours
    // the department filter (a credit note inherits its invoice's department).
    function _creditDeductionsByMonth() {
        const result = {};
        const returns = (Storage.getAllSalesReturns && Storage.getAllSalesReturns()) || [];
        const reportCur = REPORT_CUR;
        returns.forEach(cn => {
            if (!cn || !cn.date) return;
            const cd = new Date(cn.date);
            if (isNaN(cd.getTime())) return;

            const inv = (cn.invoiceId && Storage.getInvoice) ? Storage.getInvoice(cn.invoiceId) : null;

            // Only same-financial-year credit notes are deducted (when we can tell).
            if (inv && inv.date &&
                Storage.getFinancialYear(cn.date) !== Storage.getFinancialYear(inv.date)) return;

            // Department filter — derived from the linked invoice.
            if (inv) { if (!_matchesRowFilters(inv)) return; }
            else if (_state.department) return; // can't verify dept without the invoice

            // Convert the credit amount into the report currency.
            const cur = cn.currency || reportCur;
            let net = FinanceUtils.truncate2(parseFloat(cn.creditNet !== undefined ? cn.creditNet : cn.creditAmount) || 0);
            let gross = parseFloat(cn.creditAmount || 0) || 0;
            const roundOffOn = typeof Storage !== 'undefined' && Storage.getINVColumnVisibility
                && Storage.getINVColumnVisibility().roundOff === true;
            if (roundOffOn && (!inv || inv.mode === 'domestic') && (cur || 'INR') === 'INR') {
                gross = Math.round(gross);
            }
            let amt = _state.metric === 'net' ? net : gross;
            if (cur !== reportCur) {
                const rate = parseFloat(inv && inv.exchangeRate) || 0;
                if (!(rate > 0)) return; // no usable rate — skip rather than mis-state
                amt = FinanceUtils.truncate2(amt * rate);
            }

            const intl = inv && (inv.mode === 'international');
            const key = `${cd.getFullYear()}-${cd.getMonth() + 1}`;
            if (!result[key]) result[key] = { dom: 0, intl: 0 };
            if (intl) result[key].intl += amt; else result[key].dom += amt;
        });
        return result;
    }

    // The credit-note deduction for one month, narrowed to the active scope pill.
    function _scopedDeduction(ded, key) {
        const d = ded[key];
        if (!d) return 0;
        if (_state.scope === 'international') return d.intl;
        if (_state.scope === 'domestic') return d.dom;
        return d.dom + d.intl;
    }

    // A single credit note's amount converted into the report currency.
    function _creditNoteReportValue(cn) {
        const reportCur = REPORT_CUR;
        const cur = (cn && cn.currency) || reportCur;
        let net = FinanceUtils.truncate2(parseFloat(cn && cn.creditNet !== undefined ? cn.creditNet : (cn && cn.creditAmount)) || 0);
        let gross = parseFloat(cn && cn.creditAmount || 0) || 0;
        const inv = (cn && cn.invoiceId && Storage.getInvoice) ? Storage.getInvoice(cn.invoiceId) : null;
        const roundOffOn = typeof Storage !== 'undefined' && Storage.getINVColumnVisibility
            && Storage.getINVColumnVisibility().roundOff === true;
        if (roundOffOn && (!inv || inv.mode === 'domestic') && (cur || 'INR') === 'INR') {
            gross = Math.round(gross);
        }
        let amt = _state.metric === 'net' ? net : gross;
        if (cur !== reportCur) {
            const inv = (cn.invoiceId && Storage.getInvoice) ? Storage.getInvoice(cn.invoiceId) : null;
            const rate = parseFloat(inv && inv.exchangeRate) || 0;
            if (rate > 0) amt = FinanceUtils.truncate2(amt * rate);
        }
        return amt;
    }

    // The credit notes that reduce each month's sales (same FY as their invoice,
    // honouring the department filter), keyed by the credit note's filing month.
    // Each entry carries the linked invoice's mode so the breakdown can scope them.
    function _creditNotesByMonth() {
        const map = {};
        const returns = (Storage.getAllSalesReturns && Storage.getAllSalesReturns()) || [];
        returns.forEach(cn => {
            if (!cn || !cn.date) return;
            const cd = new Date(cn.date);
            if (isNaN(cd.getTime())) return;
            const inv = (cn.invoiceId && Storage.getInvoice) ? Storage.getInvoice(cn.invoiceId) : null;
            if (inv && inv.date &&
                Storage.getFinancialYear(cn.date) !== Storage.getFinancialYear(inv.date)) return;
            if (inv) { if (!_matchesRowFilters(inv)) return; }
            else if (_state.department) return;
            const mode = (inv && inv.mode === 'international') ? 'international' : 'domestic';
            const key = `${cd.getFullYear()}-${cd.getMonth() + 1}`;
            (map[key] = map[key] || []).push({ cn, mode, value: _creditNoteReportValue(cn) });
        });
        return map;
    }

    // Per-month totals (in report currency) for the range.
    function _monthlyBreakdown(invoices) {
        const months = _rangeMonths();
        const byKey = {};
        months.forEach(o => { byKey[`${o.year}-${o.month}`] = { year: o.year, month: o.month, value: 0, count: 0, unconverted: false }; });
        invoices.forEach(inv => {
            const d = new Date(inv.date);
            const k = `${d.getFullYear()}-${d.getMonth() + 1}`;
            const cell = byKey[k];
            if (!cell) return;
            const v = _invoiceReportValue(inv);
            if (v == null) cell.unconverted = true;
            else cell.value = FinanceUtils.truncate2(cell.value + v);
            cell.count += 1;
        });
        // Reduce each month's value by the same-FY credit notes filed that month
        // (narrowed to the active scope so the row + total stay consistent).
        const ded = _creditDeductionsByMonth();
        months.forEach(o => {
            const cell = byKey[`${o.year}-${o.month}`];
            if (cell) cell.value = FinanceUtils.truncate2(cell.value - _scopedDeduction(ded, `${o.year}-${o.month}`));
        });
        return months.map(o => byKey[`${o.year}-${o.month}`]);
    }

    // Invoices grouped by month for the detailed report, in range order; each
    // group also carries the credit notes (sales returns) that reduce that
    // month's sales, scoped to the active pill — so the downloaded detailed
    // report matches the on-screen breakdown. Months with neither are dropped;
    // months that hold only credit notes (no invoices) are kept.
    function _detailGroupsByMonth(invoices) {
        const months = _rangeMonths();
        const invByKey = {};
        invoices.forEach(inv => {
            const d = new Date(inv.date);
            const k = `${d.getFullYear()}-${d.getMonth() + 1}`;
            (invByKey[k] = invByKey[k] || []).push(inv);
        });
        const cnByKey = _creditNotesByMonth();
        return months
            .map(o => {
                const key = `${o.year}-${o.month}`;
                const creditNotes = (cnByKey[key] || []).filter(e => _state.scope === 'all' || e.mode === _state.scope);
                return { year: o.year, month: o.month, list: invByKey[key] || [], creditNotes };
            })
            .filter(g => g.list.length > 0 || g.creditNotes.length > 0);
    }

    // Years offered in the From/To year selectors: a sensible window around now,
    // plus any year that actually has invoices.
    function _availableYears() {
        const all = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const years = new Set();
        const cy = new Date().getFullYear();
        for (let y = cy - 5; y <= cy + 1; y++) years.add(y);
        all.forEach(inv => {
            if (!inv || !inv.date) return;
            const d = new Date(inv.date);
            if (!isNaN(d.getTime())) years.add(d.getFullYear());
        });
        years.add(_state.startYear); years.add(_state.endYear);
        return [...years].sort((a, b) => b - a);
    }

    // Nested invoice table shown when a month row is expanded. Per-invoice values
    // use the active net/gross metric so the rows reconcile with the month subtotal.
    function _monthDetailHTML(list, creditNotes) {
        const reportCur = REPORT_CUR;
        const homeSym = (typeof PdfUtils !== 'undefined' && PdfUtils.currencySymbol) ? PdfUtils.currencySymbol(reportCur) : reportCur;
        const th = (label, align) => `<th style="padding:8px 14px; text-align:${align}; font-size:10px; font-weight:700; color:#71717a; letter-spacing:0.3px; text-transform:uppercase; white-space:nowrap; position:sticky; top:0; background:#f2f2f2; z-index:1;">${label}</th>`;
        const rows = list.map(inv => {
            const cur = inv.currency || reportCur;
            const amt = _invoiceValue(inv);
            const isForeign = cur !== reportCur;
            const rate = parseFloat(inv.exchangeRate);
            const forex = isForeign ? `${cur} ${_formatMoney(amt, cur)}` : '—';
            const rateCell = (isForeign && rate > 0)
                ? `${homeSym}${(typeof PdfUtils !== 'undefined' && PdfUtils.formatCurrency) ? PdfUtils.formatCurrency(rate, reportCur) : rate}/${cur}`
                : '—';
            const value = isForeign ? (rate > 0 ? _formatMoney(amt * rate, reportCur) : '—') : _formatMoney(amt, reportCur);
            const dateStr = (inv.date && typeof PdfUtils !== 'undefined' && PdfUtils.formatDateDMY) ? PdfUtils.formatDateDMY(inv.date) : (inv.date || '—');
            return `
                <tr style="border-top:1px solid rgba(0,0,0,0.04);">
                    <td style="padding:8px 14px 8px 28px; font-size:12px; color:#18181b; font-weight:600; white-space:nowrap;">${_escapeHtml(inv.refNumber || '—')}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#52525b; white-space:nowrap;">${_escapeHtml(dateStr)}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#52525b;">${_escapeHtml(inv.clientName || '—')}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#71717a; white-space:nowrap;">${_escapeHtml(forex)}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#71717a; white-space:nowrap;">${_escapeHtml(rateCell)}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#18181b; font-weight:700; text-align:right; white-space:nowrap;">${_escapeHtml(value)}</td>
                    <td style="padding:8px 14px; text-align:center;">
                        <button type="button" onclick="Sales.viewInvoice('${inv.id}')" class="btn-action-generate" style="padding:5px 14px; font-size:12px;">View</button>
                    </td>
                </tr>`;
        }).join('');

        // Credit notes (sales returns) filed this month — shown as deductions in
        // orange with a negative value, so it's clear they reduce the month's sales.
        const cnRows = (creditNotes || []).map(entry => {
            const cn = entry.cn;
            const dateStr = (cn.date && typeof PdfUtils !== 'undefined' && PdfUtils.formatDateDMY) ? PdfUtils.formatDateDMY(cn.date) : (cn.date || '—');
            const cur = cn.currency || reportCur;
            const isForeign = cur !== reportCur;
            let cnNet = parseFloat(cn.creditNet !== undefined ? cn.creditNet : cn.creditAmount) || 0;
            let cnGross = parseFloat(cn.creditAmount || 0) || 0;
            const roundOffOn = typeof Storage !== 'undefined' && Storage.getINVColumnVisibility
                && Storage.getINVColumnVisibility().roundOff === true;
            const cnInv = (cn.invoiceId && Storage.getInvoice) ? Storage.getInvoice(cn.invoiceId) : null;
            if (roundOffOn && (!cnInv || cnInv.mode === 'domestic') && (cur || 'INR') === 'INR') {
                cnGross = Math.round(cnGross);
            }
            const cnAmt = _state.metric === 'net' ? cnNet : cnGross;
            const forex = isForeign ? `${cur} ${_formatMoney(parseFloat(cnAmt || 0) || 0, cur)}` : '—';
            const valStr = '-' + _formatMoney(entry.value, reportCur);
            const badge = `<span style="display:inline-block; margin-left:8px; font-size:9.5px; font-weight:700; letter-spacing:0.3px; text-transform:uppercase; color:#f37b21; background:rgba(243,123,33,0.12); border:1px solid rgba(243,123,33,0.25); padding:1px 7px; border-radius:999px; vertical-align:middle;">Credit Note</span>`;
            return `
                <tr style="border-top:1px solid rgba(0,0,0,0.04); background:rgba(243,123,33,0.04);">
                    <td style="padding:8px 14px 8px 28px; font-size:12px; color:#18181b; font-weight:600; white-space:nowrap;">${_escapeHtml(cn.invoiceRef || '—')}${badge}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#52525b; white-space:nowrap;">${_escapeHtml(dateStr)}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#52525b;">${_escapeHtml(cn.clientName || '—')}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#71717a; white-space:nowrap;">${_escapeHtml(forex)}</td>
                    <td style="padding:8px 14px; font-size:12px; color:#71717a; white-space:nowrap;">—</td>
                    <td style="padding:8px 14px; font-size:12px; color:#ef4444; font-weight:700; text-align:right; white-space:nowrap;">${_escapeHtml(valStr)}</td>
                    <td style="padding:8px 14px; text-align:center; font-size:11px; font-weight:700; color:#f37b21;">Credit Note</td>
                </tr>`;
        }).join('');

        // Show at most 10 rows at a time; beyond that the list scrolls within a
        // fixed-height area (the month row stays put — only the invoice list scrolls).
        const scroll = (list.length + (creditNotes || []).length) > 10 ? 'max-height:380px; overflow-y:auto;' : '';
        return `
            <div style="${scroll}">
                <table style="width:100%; border-collapse:collapse; background:rgba(0,0,0,0.012);">
                    <thead>
                        <tr style="background:rgba(0,0,0,0.03);">
                            ${th('Invoice Ref Number', 'left')}${th('Date', 'left')}${th('Client', 'left')}${th('Forex Amount', 'left')}${th('Rate of Exchange', 'left')}${th('Value in ' + homeSym, 'right')}${th('Action', 'center')}
                        </tr>
                    </thead>
                    <tbody>${rows}${cnRows}</tbody>
                </table>
            </div>`;
    }

    // --- Sales bar chart -----------------------------------------------------
    // Per-month domestic vs international turnover (in the report currency),
    // respecting the range + department filter but always showing both regions.
    function _chartData() {
        const list = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const months = _rangeMonths();
        const byKey = {};
        months.forEach(o => { byKey[`${o.year}-${o.month}`] = { dom: 0, intl: 0 }; });
        list.forEach(inv => {
            if (!inv || !inv.date) return;
            const d = new Date(inv.date);
            if (isNaN(d.getTime())) return;
            const cell = byKey[`${d.getFullYear()}-${d.getMonth() + 1}`];
            if (!cell) return;
            if (!_matchesRowFilters(inv)) return;
            const v = _invoiceReportValue(inv);
            if (v == null) return;
            if ((inv.mode || 'domestic') === 'international') cell.intl += v;
            else cell.dom += v;
        });
        // Reduce each month by the same-FY credit notes filed that month.
        const ded = _creditDeductionsByMonth();
        months.forEach(o => {
            const d = ded[`${o.year}-${o.month}`];
            if (d) { byKey[`${o.year}-${o.month}`].dom -= d.dom; byKey[`${o.year}-${o.month}`].intl -= d.intl; }
        });
        return months.map(o => ({ year: o.year, month: o.month, dom: byKey[`${o.year}-${o.month}`].dom, intl: byKey[`${o.year}-${o.month}`].intl }));
    }

    // Adaptive "nice" axis scale (shared by the on-screen chart and the PDF chart),
    // so bars fill the plot whatever the magnitude of the sales. Values are reported
    // in lakhs (INR) or thousands (other currencies). Returns rupee-denominated
    // `top`/`step` plus the unit and tick count.
    function _chartScale(maxVal) {
        const unit = REPORT_CUR === 'INR' ? 100000 : 1000;
        const maxU = (maxVal || 0) / unit;
        if (maxU <= 0) return { unit, top: 25 * unit, stepU: 5, ticks: 5 };
        const rough = maxU / 5;                       // aim for ~5 divisions
        const pow = Math.pow(10, Math.floor(Math.log10(rough)));
        const n = rough / pow;
        const s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
        const stepU = s * pow;
        let topU = Math.ceil(maxU / stepU) * stepU;
        // Keep generous headroom above the tallest bar (cap ~70% of the plot) so the
        // value label printed above each bar always has room and never clips against
        // the top of the (compact) chart card.
        if (topU > 0 && maxU / topU > 0.7) topU += stepU;
        return { unit, top: topU * unit, stepU, ticks: Math.round(topU / stepU) };
    }

    // Tick label formatting (in the chosen unit).
    function _fmtTick(u) {
        return (Math.round(u * 100) / 100).toString();
    }

    // Builds the bar chart (Domestic + International per month).
    function _renderBarChart() {
        const reportCur = REPORT_CUR;
        const data = _chartData();
        const isINR = reportCur === 'INR';
        const unitLabel = isINR ? '₹ in Lakhs' : `${PdfUtils.currencySymbol(reportCur)} in Thousands`;

        const maxVal = data.reduce((m, d) => Math.max(m, d.dom, d.intl), 0);
        const sc = _chartScale(maxVal);
        const unit = sc.unit, top = sc.top, tickCount = sc.ticks;
        const tickSuffix = isINR ? 'L' : 'K';
        const PLOT = 190;                             // plot height in px (fits 300px card)

        // Y-axis tick labels (0 at the bottom, then step, 2·step …), with the
        // lakh/thousand unit suffix (e.g. 4L) except the baseline 0.
        let axisTicks = '';
        for (let i = tickCount; i >= 0; i--) {
            axisTicks += `<div style="line-height:1;">${i === 0 ? '0' : _fmtTick(i * sc.stepU) + tickSuffix}</div>`;
        }
        // Horizontal gridlines aligned with the ticks.
        let gridlines = '';
        for (let i = 0; i <= tickCount; i++) {
            const bottom = (i / tickCount) * PLOT;
            gridlines += `<div style="position:absolute; left:0; right:0; bottom:${bottom}px; border-top:1px ${i === 0 ? 'solid rgba(0,0,0,0.16)' : 'dashed rgba(0,0,0,0.06)'};"></div>`;
        }

        const hasData = maxVal > 0;
        const n = Math.max(1, data.length);
        // The chart is fluid: columns and bars flex to share the container width so a
        // full financial year (12 months) fits without horizontal scrolling. The
        // denser the range, the tighter the gaps, smaller the caps and labels — and
        // past ~7 months the per-bar value tags are dropped (still shown on hover) to
        // keep things legible.
        const dense = n > 7;
        const colGap = n > 8 ? 8 : (n > 5 ? 16 : 14);
        const barMax = dense ? 26 : 40;                // px cap per bar; bars shrink below this to fit
        const colMax = barMax * 2 + 24;               // stop few-month charts from over-stretching
        const showVals = n <= 6;                       // hide value tags when crowded
        const xFont = dense ? 10 : 11.5;
        let delay = 0;
        const cols = data.map(d => {
            const label = `${MONTHS[d.month - 1].label.slice(0, 3)} ${d.year}`;
            const fullLabel = _monthLabel(d.year, d.month, true);
            const bar = (val, series, cls) => {
                const h = top > 0 ? (val > 0 ? Math.max(4, (val / top) * PLOT) : 0) : 0;
                const d2 = (delay += 90);
                const valTxt = _escapeHtml(_formatMoney(val, reportCur)).replace(/'/g, '&#39;');
                return `<div class="scg-bar ${cls}" style="height:${h}px; --d:${d2}ms;"
                    onmousemove="Sales.barTip(event,'${_escapeHtml(fullLabel)}','${series}','${valTxt}')" onmouseout="Sales.barTip(event)">${showVals ? `<span class="scg-val">${valTxt}</span>` : ''}</div>`;
            };
            return `
                <div class="scg-col">
                    <div class="scg-bars">
                        ${bar(d.dom, 'Domestic', 'dom')}
                        ${bar(d.intl, 'International', 'intl')}
                    </div>
                    <div class="scg-xlabel">${_escapeHtml(label)}</div>
                </div>`;
        }).join('');

        return `
            <div>
                <style>
                    .scg-wrap *{ box-sizing:border-box; }
                    .scg-plot{ position:relative; height:${PLOT}px; width:100%; flex:1 1 auto; min-width:0; padding-top:16px; }
                    .scg-cols{ position:absolute; left:0; right:0; bottom:0; top:0; display:flex; align-items:flex-end; justify-content:center; gap:${colGap}px; padding:0 12px; }
                    .scg-col{ display:flex; flex-direction:column; align-items:center; flex:1 1 0; min-width:0; max-width:${colMax}px; }
                    .scg-bars{ display:flex; align-items:flex-end; justify-content:center; gap:0; width:100%; height:${PLOT}px; }
                    .scg-bar{ position:relative; flex:1 1 0; min-width:0; max-width:${barMax}px; align-self:flex-end;
                        transform-origin:bottom; animation:scgGrow 1s cubic-bezier(.16,.84,.30,1) both; animation-delay:var(--d); }
                    .scg-bar.dom{ background:linear-gradient(180deg,#13955c 0%, #045f37 100%); border-radius:4px 0 0 0; }
                    .scg-bar.intl{ background:linear-gradient(180deg,#7fd3a6 0%, #34b06f 100%); border-radius:0 4px 0 0; }
                    .scg-bar:hover{ filter:brightness(1.05); }
                    .scg-val{ position:absolute; bottom:100%; left:50%; transform:translateX(-50%); margin-bottom:7px;
                        font-size:10px; font-weight:600; color:#3f3f46; white-space:nowrap; pointer-events:none; z-index:2;
                        opacity:0; animation:scgFade .3s ease both; animation-delay:calc(var(--d) + .7s); }
                    .scg-xlabel{ margin-top:12px; font-size:${xFont}px; font-weight:600; color:#52525b; white-space:nowrap; }
                    @keyframes scgGrow{ from{ transform:scaleY(0); opacity:.35; } to{ transform:scaleY(1); opacity:1; } }
                    @keyframes scgFade{ from{ opacity:0; } to{ opacity:1; } }
                </style>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                    <div>
                        <div style="font-size:14px; font-weight:800; color:#18181b; letter-spacing:-0.2px;">Sales by Month</div>
                        <div style="font-size:11px; color:#71717a; margin-top:2px;">Domestic vs International · ${_escapeHtml(_rangeLabel())}</div>
                    </div>
                    <div style="display:flex; gap:18px; align-items:center; font-size:12px; color:#52525b;">
                        <span style="display:inline-flex; align-items:center; gap:7px;"><span style="width:13px; height:13px; border-radius:3px; background:linear-gradient(180deg,#13955c,#045f37); box-shadow:0 1px 2px rgba(0,0,0,0.18);"></span>Domestic</span>
                        <span style="display:inline-flex; align-items:center; gap:7px;"><span style="width:13px; height:13px; border-radius:3px; background:linear-gradient(180deg,#7fd3a6,#34b06f); box-shadow:0 1px 2px rgba(0,0,0,0.18);"></span>International</span>
                    </div>
                </div>
                ${hasData
                    ? `<div style="font-size:11px; color:#71717a; margin-bottom:6px;">Amount (${reportCur})</div>
                       <div class="scg-wrap" style="display:flex; gap:14px; align-items:flex-start; justify-content:center; width:100%; overflow:visible;">
                        <div style="display:flex; flex-direction:column; justify-content:space-between; height:${PLOT}px; padding-top:16px; font-size:10px; font-weight:600; color:#a1a1aa; text-align:right; min-width:34px; flex:0 0 auto;">
                            ${axisTicks}
                        </div>
                        <div class="scg-plot">
                            ${gridlines}
                            <div class="scg-cols">${cols}</div>
                        </div>
                       </div>
                       <div style="font-size:10px; color:#a1a1aa; margin-top:5px; text-align:right;">${_escapeHtml(unitLabel)}</div>`
                    : `<div style="padding:70px 20px; text-align:center; color:#a1a1aa; font-size:13px;">No sales data in this range to chart.</div>`}
            </div>`;
    }

    // Floating tooltip for the bar chart.
    function barTip(evt, title, series, valueText) {
        let t = document.getElementById('sales-bar-tip');
        if (evt && evt.type === 'mouseout') { if (t) t.style.opacity = '0'; return; }
        if (!t) {
            t = document.createElement('div');
            t.id = 'sales-bar-tip';
            t.style.cssText = 'position:fixed; z-index:20000; pointer-events:none; background:#18181b; color:#fff; padding:8px 11px; border-radius:8px; font-size:12px; font-family:Inter,-apple-system,sans-serif; box-shadow:0 6px 20px rgba(0,0,0,0.28); transition:opacity .12s; white-space:nowrap; opacity:0;';
            document.body.appendChild(t);
        }
        const color = series === 'Domestic' ? '#0a7a4a' : '#f37b21';
        t.innerHTML = `<div style="font-weight:700; margin-bottom:3px;">${title}</div>
            <div><span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:${color}; margin-right:6px;"></span>${series}: <b>${valueText}</b></div>`;
        t.style.opacity = '1';
        t.style.left = (evt.clientX + 14) + 'px';
        t.style.top = (evt.clientY - 12) + 'px';
    }

    // --- Render --------------------------------------------------------------
    async function render() {
        const container = document.getElementById('sales-content');
        if (!container) return;
        Dashboard.registerClientFilter('sales', () => (Storage.getAllInvoices && Storage.getAllInvoices()) || [], render);

        const reportCur = REPORT_CUR;
        const invoices = _filteredInvoices();

        const breakdown = _monthlyBreakdown(invoices);
        const total = breakdown.reduce((s, b) => s + b.value, 0);
        const anyUnconverted = breakdown.some(b => b.unconverted);

        const regionFg = '#004d2c';
        const metricLabel = _state.metric === 'net' ? 'Net' : 'Gross';

        // --- KPI stats (current range vs the previous period) -----------------
        // The KPI cards always cover both regions; the scope pill only narrows the
        // breakdown table + chart further down.
        const cur = _statsForRange({ startMonth: _state.startMonth, startYear: _state.startYear, endMonth: _state.endMonth, endYear: _state.endYear });
        const prev = _statsForRange(_prevRange());
        const prevLabel = _prevRangeLabel();
        const pct = (c, p) => (p > 0 ? ((c - p) / p) * 100 : null);
        const dTotal = pct(cur.total, prev.total);
        const dDom = pct(cur.dom, prev.dom);
        const dIntl = pct(cur.intl, prev.intl);
        const dCredit = pct(cur.credit, prev.credit);
        const domShare = cur.total > 0 ? (cur.dom / cur.total) * 100 : 0;

        // One KPI card: label, big value, a vs-previous delta badge, and a trend
        // (sparkline for revenue cards, an icon for the invoice-count card).
        // opts.invert flips the sentiment: for Sales Return an INCREASE is bad, so
        // it is coloured red and the card gets a red top accent line to flag it.
        const kpiCard = (label, valueHtml, deltaPct, trendHtml, opts) => {
            const invert = !!(opts && opts.invert);
            const known = deltaPct != null;
            const rose = known && deltaPct >= 0;        // value went up vs previous
            const good = !known || (invert ? !rose : rose);
            const col = !known ? '#a1a1aa' : (good ? '#0a7a4a' : '#dc2626');
            const badgeBg = !known ? 'rgba(0,0,0,0.05)' : (good ? 'rgba(10,122,74,0.12)' : 'rgba(220,38,38,0.12)');
            const arrow = rose ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>' : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>';
            const pctText = !known ? 'n/a' : `${Math.abs(deltaPct).toFixed(2)}%`;
            // Red top accent line when an inverted metric (Sales Return) has risen.
            const alert = invert && known && rose;
            const topLine = alert ? 'border-top:3px solid #dc2626;' : '';
            return `
                <div style="flex:1 1 210px; min-width:210px; background:#fff; border:1px solid rgba(0,0,0,0.06); ${topLine} border-radius:14px; padding:18px 18px 14px; box-shadow:0 2px 10px rgba(0,0,0,0.03);">
                    <div style="font-size:12px; color:#71717a; font-weight:600; margin-bottom:10px;">${label}</div>
                    <div style="font-size:25px; font-weight:800; color:#18181b; letter-spacing:-0.6px; line-height:1.1;">${valueHtml}</div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:13px;">
                        <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                            <span style="width:26px; height:26px; border-radius:50%; background:${badgeBg}; color:${col}; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${arrow}</svg>
                            </span>
                            <div style="min-width:0;">
                                <div style="font-size:13px; font-weight:700; color:${col}; line-height:1.15;">${pctText}</div>
                                <div style="font-size:10px; color:#a1a1aa; white-space:nowrap;">vs ${_escapeHtml(prevLabel)}</div>
                            </div>
                        </div>
                        <div style="flex:0 0 auto; width:120px; height:40px; display:flex; align-items:center; justify-content:flex-end;">${trendHtml || ''}</div>
                    </div>
                </div>`;
        };

        const moneyVal = v => (invoices.length === 0 && v === 0)
            ? `<span style="color:#a1a1aa;">—</span>`
            : _escapeHtml(_formatMoney(v, reportCur));
        // The Other view reports realised exchange differences, not turnover, so it
        // gets its own tiles rather than four zeroed revenue cards.
        let kpiCardsHtml;
        if (_state.scope === 'other') {
            const oi = _otherIncomeInRange();
            const oGain = oi.reduce((t, e) => t + e.gain, 0);
            const oLoss = oi.reduce((t, e) => t + e.loss, 0);
            const oIntl = oi.filter(e => e.mode === 'international').length;
            const tint = (html, color) => `<span style="color:${color};">${html}</span>`;
            kpiCardsHtml =
                kpiCard('Exchange Gain (Other Income)', tint(moneyVal(oGain), '#0a7a4a'), null, '') +
                kpiCard('Exchange Loss (Expenditure)', tint(moneyVal(oLoss), '#dc2626'), null, '', { invert: true }) +
                kpiCard('Invoices Closed', String(oi.length), null,
                    `<div style="font-size:11px; color:#a1a1aa; white-space:nowrap;">${oIntl} international</div>`);
        } else {
            kpiCardsHtml =
                kpiCard(`Total Revenue (${metricLabel})`, moneyVal(cur.total), dTotal, _sparkline(_sparkSeries(c => c.dom + c.intl, 7), '#0a7a4a')) +
                kpiCard('Domestic Revenue', moneyVal(cur.dom), dDom, _sparkline(_sparkSeries(c => c.dom, 7), '#0a7a4a')) +
                kpiCard('International Revenue', moneyVal(cur.intl), dIntl, _sparkline(_sparkSeries(c => c.intl, 7), '#f37b21')) +
                kpiCard('Sales Return', moneyVal(cur.credit), dCredit, _sparkline(_sparkSeries(c => c.credit, 7), '#dc2626'), { invert: true });
        }

        // Insight lines beneath the dashboard.
        const insightRow = (up, html) => {
            const col = up ? '#0a7a4a' : '#f37b21';
            const bg = up ? 'rgba(10,122,74,0.12)' : 'rgba(243,123,33,0.12)';
            const arrow = up ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>' : '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>';
            return `<div style="display:flex; align-items:center; gap:11px; padding:9px 0;">
                <span style="width:24px; height:24px; border-radius:50%; background:${bg}; color:${col}; display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${arrow}</svg>
                </span>
                <span style="font-size:13px; color:#3f3f46;">${html}</span>
            </div>`;
        };
        const hl = (txt, up) => `<strong style="color:${up ? '#0a7a4a' : '#f37b21'};">${txt}</strong>`;
        const insightsHtml = [
            dTotal != null ? insightRow(dTotal >= 0, `Total Revenue ${dTotal >= 0 ? 'increased' : 'decreased'} by ${hl(Math.abs(dTotal).toFixed(2) + '%', dTotal >= 0)} compared to the previous period.`) : '',
            insightRow(true, `Domestic Revenue contributes ${hl(domShare.toFixed(2) + '%', true)} of the total revenue.`),
            dIntl != null ? insightRow(dIntl >= 0, `International Revenue ${dIntl >= 0 ? 'increased' : 'decreased'} by ${hl(Math.abs(dIntl).toFixed(2) + '%', dIntl >= 0)} compared to the previous period.`) : ''
        ].join('');

        // A foreign invoice with no exchange rate stored (e.g. generated before this
        // was captured) can't be converted, so it's left out of the total.
        let warningNote = '';
        if (anyUnconverted) {
            const missing = _missingRateCurrencies(invoices);
            const missingStr = missing.length ? missing.map(_escapeHtml).join(', ') : 'some currencies';
            warningNote = `<div style="font-size:11px; color:#b45309; background:rgba(180,83,9,0.08); border:1px solid rgba(180,83,9,0.18); border-radius:8px; padding:7px 10px; margin-top:6px; display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>No exchange rate stored for <strong>${missingStr}</strong> — those invoices are excluded from the total. Re-generate the invoice to record its rate.</span>
            </div>`;
        }



        function pillToggle(name, current, options) {
            return `<div style="display:inline-flex; background:rgba(0,0,0,0.05); padding:4px; border-radius:10px; gap:2px;">` +
                options.map(o => {
                    const active = o.v === current;
                    const base = 'padding:7px 16px; font-size:12px; font-weight:600; border:none; border-radius:7px; cursor:pointer; transition:all .15s;';
                    const style = active
                        ? base + ' background:#fff; color:#18181b; box-shadow:0 1px 3px rgba(0,0,0,0.10);'
                        : base + ' background:transparent; color:#71717a;';
                    return `<button type="button" onclick="Sales.set${name[0].toUpperCase() + name.slice(1)}('${o.v}')" style="${style}">${o.label}</button>`;
                }).join('') +
                `</div>`;
        }

        // Premium custom-select (same component the dashboard uses) instead of a
        // native <select>. `handler` is the inline call run on change, `options`
        // is [{v,label}], `sel` the selected value, `width` the wrapper width.
        const customSelect = (handler, options, sel, width) => {
            const match = options.find(o => String(o.v) === String(sel));
            const label = match ? match.label : (options[0] ? options[0].label : '');
            return `
                <div class="custom-select-wrapper" style="width:${width}px;">
                    <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: rgba(0,0,0,0.05); border: none; border-radius: 10px; font-weight: 600; color: #18181b;">
                        <span>${_escapeHtml(label)}</span>
                        <div class="arrow"></div>
                    </div>
                    <div class="custom-options">
                        ${options.map(o => `<div class="custom-option${String(o.v) === String(sel) ? ' selected' : ''}" data-value="${_escapeHtml(String(o.v))}">${_escapeHtml(o.label)}</div>`).join('')}
                    </div>
                    <input type="hidden" value="${_escapeHtml(String(sel))}" onchange="${handler}">
                </div>`;
        };
        // Department is a dropdown list (not pills) — there are several departments
        // and a single select keeps the filter row compact.
        const deptSelect = customSelect('Sales.setDepartment(this.value)', [
            { v: '', label: 'All Departments' },
            { v: 'Engineering', label: 'Engineering' },
            { v: 'Consulting', label: 'Consulting' },
            { v: 'Projects', label: 'Projects' },
            { v: 'Support', label: 'Support' },
            { v: '__none__', label: 'No Dept' }
        ], _state.department, 180);

        // Group the filtered invoices by month so a month's row can expand to its list.
        const invByMonth = {};
        invoices.forEach(inv => {
            const d = new Date(inv.date);
            const k = `${d.getFullYear()}-${d.getMonth() + 1}`;
            (invByMonth[k] = invByMonth[k] || []).push(inv);
        });

        // Per-month domestic / international turnover (report currency), so the
        // breakdown shows the combined (Net/Gross) total per month.
        const chartByKey = {};
        _chartData().forEach(d => { chartByKey[`${d.year}-${d.month}`] = d; });

        // Credit notes filed per month (scoped to the active pill), so a month can
        // expand to show its deductions alongside its invoices.
        const creditByMonth = _creditNotesByMonth();
        // Whether the selected range has any (scoped) credit notes — so the table
        // still renders for a month that holds only credit notes and no invoices.
        const _rangeKeys = new Set(_rangeMonths().map(o => `${o.year}-${o.month}`));
        const hasCreditInRange = Object.keys(creditByMonth).some(k =>
            _rangeKeys.has(k) && creditByMonth[k].some(e => _state.scope === 'all' || e.mode === _state.scope));

        // Page the breakdown by month. The tfoot Total stays whole-range — it is
        // the range's grand total, not a per-page subtotal.
        const bTotalPages = Math.max(1, Math.ceil(breakdown.length / _state.bPageSize));
        _state.bPage = Math.min(Math.max(1, _state.bPage), bTotalPages);
        const bStart = (_state.bPage - 1) * _state.bPageSize;
        const breakdownRows = breakdown.slice(bStart, bStart + _state.bPageSize).map(b => {
            const key = `${b.year}-${b.month}`;
            const net = b.value;
            const cnList = (creditByMonth[key] || []).filter(e => _state.scope === 'all' || e.mode === _state.scope);
            const hasDetail = b.count > 0 || cnList.length > 0;
            const isOpen = !!_state.expanded[key];
            const caret = isOpen
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
            const cnTag = cnList.length > 0
                ? `<span title="${cnList.length} credit note(s) this month" style="margin-left:7px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:#f37b21; background:rgba(243,123,33,0.12); border:1px solid rgba(243,123,33,0.25); padding:1px 7px; border-radius:999px;">${cnList.length} CN</span>`
                : '';
            const countCell = !hasDetail
                ? '<span style="color:#a1a1aa;">0</span>'
                : `<button type="button" onclick="Sales.toggleMonth(${b.year}, ${b.month})" title="View this month's invoices & credit notes" style="display:inline-flex; align-items:center; gap:6px; background:${isOpen ? 'rgba(0,77,44,0.10)' : 'transparent'}; border:1px solid ${isOpen ? 'rgba(0,77,44,0.25)' : 'rgba(0,0,0,0.14)'}; color:#004d2c; font-weight:700; font-size:13px; padding:3px 11px; border-radius:999px; cursor:pointer;">${b.count}${caret}</button>`;
            const mainRow = `
                <tr style="border-top:1px solid rgba(0,0,0,0.05);">
                    <td style="padding:13px 20px; font-size:13px; color:#18181b; font-weight:600;">${_escapeHtml(_monthLabel(b.year, b.month))}${cnTag}</td>
                    <td style="padding:13px 20px; text-align:center;">${countCell}</td>
                    <td style="padding:13px 20px; font-size:13px; color:#18181b; font-weight:700; text-align:right;">${_escapeHtml(_formatMoney(net, reportCur))}</td>
                </tr>`;
            const detailRow = (isOpen && hasDetail)
                ? `<tr><td colspan="3" style="padding:0; border-top:1px solid rgba(0,0,0,0.05);">${_monthDetailHTML(invByMonth[key] || [], cnList)}</td></tr>`
                : '';
            return mainRow + detailRow;
        }).join('');

        const scopeLabel = ({ domestic: 'Domestic', international: 'International', other: 'Other' })[_state.scope] || 'All';

        container.innerHTML = `
            <div class="form-container" style="padding:24px; border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,0.04); border:1px solid rgba(0,0,0,0.05); margin-bottom:20px;">
                <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:18px;">
                    <div>
                        <div class="title-accent" style="font-size:28px; font-weight:800; letter-spacing:-0.8px; line-height:1.2;">Sales Overview</div>
                    </div>
                    <button type="button" onclick="Sales.promptReportType()"
                        style="padding:10px 18px; font-size:13px; font-weight:700; border:none; border-radius:10px; cursor:pointer; background:${regionFg}; color:#fff; display:inline-flex; align-items:center; gap:8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Report
                    </button>
                </div>

                ${warningNote}

                <div style="display:flex; flex-wrap:wrap; gap:12px 14px; align-items:center; margin:10px 0 4px;">
                    ${pillToggle('scope', _state.scope, [
                        { v: 'domestic', label: 'Domestic' },
                        { v: 'international', label: 'International' },
                        { v: 'all', label: 'All' },
                        { v: 'other', label: 'Other' }
                    ])}
                    ${pillToggle('metric', _state.metric, [
                        { v: 'net', label: 'Net' },
                        { v: 'gross', label: 'Gross' }
                    ])}
                    ${deptSelect}
                    ${Dashboard.renderClientFilter('sales', { width: 180 })}
                    <div style="flex:1 1 auto;"></div>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <label style="font-size:10px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase;">Timeline</label>
                        <button type="button" onclick="Sales.openTimelineModal()"
                            style="display:inline-flex; align-items:center; gap:9px; padding:9px 14px; font-size:13px; font-weight:600; color:#18181b; background:rgba(0,0,0,0.05); border:none; border-radius:10px; cursor:pointer;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                            <span>${_escapeHtml(_rangeLabel())}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                    </div>
                </div>

                <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:18px;">
                    ${kpiCardsHtml}
                </div>
            </div>

            ${_state.scope === 'other' ? _renderOtherIncome() : `
            <div style="margin-bottom:20px;">
                <div class="form-container" style="padding:0; border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,0.04); border:1px solid rgba(0,0,0,0.05); overflow:hidden;">
                    <div style="padding:16px 20px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center;">
                        <div class="title-accent" style="font-size:15px; font-weight:800; letter-spacing:-0.2px;">Monthly breakdown · ${_escapeHtml(_rangeLabel())}</div>
                        <div style="font-size:12px; color:#71717a;">${scopeLabel}</div>
                    </div>
                    ${(invoices.length === 0 && !hasCreditInRange)
                        ? `<div style="padding:60px 20px; text-align:center; color:#a1a1aa; font-size:13px;">No ${_state.scope === 'all' ? '' : _state.scope + ' '}invoices in this range.</div>`
                        : `<div style="overflow-x:auto;">
                            <table style="width:100%; border-collapse:collapse;">
                                <thead>
                                    <tr style="background:rgba(0,0,0,0.015);">
                                        <th style="padding:11px 20px; text-align:left; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase;">Month</th>
                                        <th style="padding:11px 20px; text-align:center; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase;">Invoices</th>
                                        <th style="padding:11px 20px; text-align:right; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase;">${_state.metric === 'net' ? 'Net' : 'Gross'} (${reportCur})</th>
                                    </tr>
                                </thead>
                                <tbody>${breakdownRows}</tbody>
                                <tfoot>
                                    <tr style="border-top:2px solid rgba(0,0,0,0.08); background:rgba(0,0,0,0.015);">
                                        <td style="padding:13px 20px; font-size:13px; color:#18181b; font-weight:800;">Total</td>
                                        <td style="padding:13px 20px; font-size:12px; color:#71717a; text-align:center; font-weight:700;">${invoices.length}</td>
                                        <td style="padding:13px 20px; font-size:14px; color:#18181b; font-weight:800; text-align:right;">${_escapeHtml(_formatMoney(total, reportCur))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div style="padding:0 20px 16px;">${Dashboard.renderPagination({
                            page: _state.bPage, pageSize: _state.bPageSize, total: breakdown.length, noun: 'months',
                            onPage: 'Sales.setBreakdownPage', onSize: 'Sales.setBreakdownPageSize'
                        })}</div>`}
                </div>
            </div>

            <div style="display:flex; gap:20px; flex-wrap:wrap; margin-bottom:20px; align-items:stretch;">
                ${insightsHtml ? `
                <div class="form-container" style="flex:0 0 calc(40% - 10px); min-width:280px; height:300px; overflow:auto; padding:16px 22px; border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,0.04); border:1px solid rgba(0,0,0,0.05);">
                    <div style="font-size:15px; font-weight:800; color:#18181b; letter-spacing:-0.2px; margin-bottom:4px;">Insights</div>
                    ${insightsHtml}
                </div>` : ''}
                <div class="form-container" style="flex:0 0 calc(60% - 10px); min-width:300px; height:300px; overflow:visible; padding:12px 16px; border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,0.04); border:1px solid rgba(0,0,0,0.05);">
                    ${_renderBarChart()}
                </div>
            </div>
            `}
        `;

        // Keep the open "Select Timeline" popup (if any) in sync with the new range.
        if (document.getElementById('sales-timeline-modal')) _renderTimelineBody();
    }

    // --- Other income: realised exchange gains and losses ---------------------
    // Foreign-currency invoices are booked at one rate and collected at another.
    // Once an invoice is closed the difference is realised: a gain is other
    // income, a loss is expenditure. Neither is netted off turnover, so these sit
    // in their own "Other" view rather than moving the sales figures.
    function _otherIncomeInRange() {
        if (typeof Receipts === 'undefined' || !Receipts.otherIncomeEntries) return [];
        const keys = new Set(_rangeMonths().map(o => `${o.year}-${o.month}`));
        return Receipts.otherIncomeEntries()
            .filter(e => {
                if (!e.date) return false;
                const d = new Date(e.date);
                if (isNaN(d.getTime())) return false;
                return keys.has(`${d.getFullYear()}-${d.getMonth() + 1}`);
            })
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }

    function _renderOtherIncome() {
        const entries = _otherIncomeInRange();
        const cur = REPORT_CUR;
        const gain = entries.reduce((t, e) => t + e.gain, 0);
        const loss = entries.reduce((t, e) => t + e.loss, 0);

        const rows = entries.map(e => `
            <tr style="border-top:1px solid rgba(0,0,0,0.04);">
                <td style="padding:10px 20px; font-size:12.5px; color:#18181b; font-weight:600; white-space:nowrap;">${_escapeHtml(e.invoiceRef || '—')}</td>
                <td style="padding:10px 20px; font-size:12.5px; color:#52525b; white-space:nowrap;">${_escapeHtml(e.date ? (PdfUtils.formatDateDMY ? PdfUtils.formatDateDMY(e.date) : e.date) : '—')}</td>
                <td style="padding:10px 20px; font-size:12.5px; color:#52525b;">${_escapeHtml(e.clientName || '—')}</td>
                <td style="padding:10px 20px; font-size:12px; color:#71717a; white-space:nowrap;">${e.mode === 'international' ? 'International' : 'Domestic'}</td>
                <td style="padding:10px 20px; font-size:12.5px; text-align:right; font-weight:700; white-space:nowrap; color:${e.gain ? '#0a7a4a' : '#a1a1aa'};">${e.gain ? _escapeHtml(_formatMoney(e.gain, cur)) : '—'}</td>
                <td style="padding:10px 20px; font-size:12.5px; text-align:right; font-weight:700; white-space:nowrap; color:${e.loss ? '#dc2626' : '#a1a1aa'};">${e.loss ? _escapeHtml(_formatMoney(e.loss, cur)) : '—'}</td>
            </tr>`).join('');

        const head = (t, align) => `<th style="padding:11px 20px; text-align:${align}; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase;">${t}</th>`;

        return `
            <div style="margin-bottom:20px;">
                <div class="form-container" style="padding:0; border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,0.04); border:1px solid rgba(0,0,0,0.05); overflow:hidden;">
                    <div style="padding:16px 20px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <div class="title-accent" style="font-size:15px; font-weight:800; letter-spacing:-0.2px;">Other income · ${_escapeHtml(_rangeLabel())}</div>
                        <div style="font-size:12px; color:#71717a;">Realised exchange gain / loss on closed invoices</div>
                    </div>
                    ${entries.length === 0
                        ? `<div style="padding:60px 20px; text-align:center; color:#a1a1aa; font-size:13px;">
                               No exchange gain or loss realised in this range.<br>
                               <span style="font-size:12px;">Close a foreign-currency invoice from the Receipts screen to realise it.</span>
                           </div>`
                        : `<div style="overflow-x:auto;">
                            <table style="width:100%; border-collapse:collapse;">
                                <thead>
                                    <tr style="background:rgba(0,0,0,0.015);">
                                        ${head('Invoice', 'left')}${head('Closed on', 'left')}${head('Client', 'left')}${head('Type', 'left')}
                                        ${head(`Gain (${cur})`, 'right')}${head(`Loss (${cur})`, 'right')}
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                                <tfoot>
                                    <tr style="border-top:2px solid rgba(0,0,0,0.08); background:rgba(0,0,0,0.015);">
                                        <td colspan="4" style="padding:13px 20px; font-size:13px; color:#18181b; font-weight:800;">Total</td>
                                        <td style="padding:13px 20px; font-size:14px; text-align:right; font-weight:800; color:#0a7a4a;">${_escapeHtml(_formatMoney(gain, cur))}</td>
                                        <td style="padding:13px 20px; font-size:14px; text-align:right; font-weight:800; color:#dc2626;">${_escapeHtml(_formatMoney(loss, cur))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>`}
                </div>
            </div>`;
    }

    // --- PDF report ----------------------------------------------------------

    // The font an autoTable should use so currency symbols (₹) that the built-in
    // PDF fonts can't draw still render. Falls back to Helvetica when the report
    // currency's symbol is plain ASCII (e.g. $ for USD).
    function _tableFont(doc) {
        const reportCur = REPORT_CUR;
        const curFont = PdfUtils.registerCurrencyFont(doc);
        return (PdfUtils.needsCurrencyFont(reportCur) && curFont) ? curFont : 'helvetica';
    }

    // Shared branded header for both report PDFs: the premium letterhead (logo
    // left, company details right) + slanted green/orange bar, then a centered
    // title with the period range (MM/YYYY - MM/YYYY) beneath it — identical look
    // to the invoice/PO/quotation PDFs.
    async function _drawReportHeader(doc, title) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 10;
        const contentWidth = pageWidth - 2 * margin;
        let y = 5;

        const logo = await PdfUtils.getLogoBase64();
        y = PdfUtils.drawLetterhead(doc, logo, pageWidth, margin, y, true);

        // Slanted green/orange bar (same geometry as the document PDFs).
        const greenWidth = contentWidth * 0.82;
        const slantWidth = 4;
        const barH = 2;
        doc.setFillColor(243, 123, 33);
        doc.rect(margin, y, contentWidth, barH, 'F');
        doc.setFillColor(0, 77, 44);
        doc.lines([[greenWidth + slantWidth, 0], [-slantWidth, barH], [-greenWidth, 0]], margin, y, [1, 1], 'F', true);
        y += 12;

        // Title
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(0, 77, 44);
        doc.text(title, pageWidth / 2, y, { align: 'center' });
        y += 7;

        // Second heading — the period range "MM/YYYY - MM/YYYY", bold.
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(51, 51, 51);
        doc.text(_pdfPeriodRange(), pageWidth / 2, y, { align: 'center' });
        y += 6;

        // Third line — which figure the report is based on (Net vs Gross) and the
        // selected scope, so the printed totals are unambiguous.
        const metricText = _state.metric === 'net' ? 'Net turnover (excl. tax)' : 'Gross turnover (incl. tax)';
        const scopeText = _state.scope === 'domestic' ? 'Domestic' : (_state.scope === 'international' ? 'International' : 'Domestic + International');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(90, 90, 90);
        doc.text(`${metricText}  •  ${scopeText}`, pageWidth / 2, y, { align: 'center' });
        y += 8;

        doc.setTextColor(0, 0, 0);
        return y;
    }

    // Options chosen in the Download Sales Report sheet. Graph is OFF by default
    // and only ever applies to PDF (Excel never embeds a chart).
    let _reportOpts = { format: 'pdf', type: 'normal', graph: 'no' };

    // Dynamic active styling for the segmented controls + primary button.
    const SEG_ACT_BG = '#004d2c';
    const SEG_ACT_SH = '0 3px 9px rgba(0,77,44,0.30)';
    const SEG_HOVER_SH = '0 6px 16px rgba(0,77,44,0.38)';

    // Clicking "Download Report" opens a simple options sheet: pick the format,
    // report type, and (PDF only) whether to include the graph, then press Download.
    // Each control uses a direct inline onclick (the app's standard, reliable pattern).
    function promptReportType() {
        if (document.getElementById('sales-report-type-modal')) return; // already open
        _reportOpts = { format: 'pdf', type: 'normal', graph: 'no' };
        const overlay = document.createElement('div');
        overlay.id = 'sales-report-type-modal';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.45); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; z-index:16000; font-family:Inter,-apple-system,sans-serif;';
        // Intentionally NOT closing on backdrop click — use the Cancel button.

        const seg = (group, options) => `
            <div style="display:flex; background:#eef1f0; border-radius:12px; padding:4px; gap:4px;">
                ${options.map(o => {
                    const active = _reportOpts[group] === o.v;
                    return `<button type="button" data-seg="${group}-${o.v}" onclick="Sales.setReportOpt('${group}','${o.v}')" style="flex:1; padding:10px 8px; font-size:13px; font-weight:700; border:none; border-radius:9px; cursor:pointer; transition:all .18s ease; background:${active ? SEG_ACT_BG : 'transparent'}; color:${active ? '#fff' : '#64748b'}; box-shadow:${active ? SEG_ACT_SH : 'none'};">${o.label}</button>`;
                }).join('')}
            </div>`;
        const label = txt => `<div style="font-size:11px; font-weight:700; color:#9ca3af; letter-spacing:0.5px; text-transform:uppercase; margin:0 2px 8px;">${txt}</div>`;

        overlay.innerHTML = `
            <div style="background:#fff; border-radius:20px; padding:24px 24px 20px; width:390px; max-width:92vw; box-shadow:0 30px 70px rgba(15,23,42,0.30); border:1px solid rgba(0,0,0,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:22px;">
                    <div style="font-size:17px; font-weight:800; color:#18181b; letter-spacing:-0.2px;">Download Sales Report</div>
                    <button type="button" onclick="Sales.toggleReportConfig()" style="background:#f1f5f3; border:none; color:#16a34a; cursor:pointer; width:32px; height:32px; border-radius:9px; display:inline-flex; align-items:center; justify-content:center;" title="More options">
                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                </div>

                ${label('Report type')}
                <div style="margin-bottom:22px;">${seg('type', [{ v: 'normal', label: 'Normal' }, { v: 'detailed', label: 'Detailed' }])}</div>

                <div id="sales-report-config" style="display:none; margin-bottom:22px; padding-top:18px; border-top:1px solid #eef1f0;">
                    ${label('Format')}
                    <div style="margin-bottom:18px;">${seg('format', [{ v: 'pdf', label: 'PDF' }, { v: 'excel', label: 'Excel' }])}</div>

                    <div id="sales-report-graph-group" style="display:${_reportOpts.format === 'pdf' ? 'block' : 'none'};">
                        ${label('Graph (PDF only)')}
                        <div>${seg('graph', [{ v: 'yes', label: 'With graph' }, { v: 'no', label: 'No graph' }])}</div>
                    </div>
                </div>

                <div style="display:flex; gap:10px;">
                    <button type="button" onclick="Sales.closeReportModal()" style="flex:1; padding:13px; font-size:14px; font-weight:700; border:1px solid #e2e8f0; border-radius:12px; background:#fff; color:#64748b; cursor:pointer; transition:all .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#fff'">Cancel</button>
                    <button type="button" onclick="Sales.confirmReportDownload()" style="flex:2; padding:13px; font-size:14px; font-weight:800; border:none; border-radius:12px; background:${SEG_ACT_BG}; color:#fff; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; box-shadow:${SEG_ACT_SH}; transition:transform .12s ease, box-shadow .12s ease;" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='${SEG_HOVER_SH}'" onmouseout="this.style.transform='none'; this.style.boxShadow='${SEG_ACT_SH}'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
    }

    // Set one option (type/format/graph) and repaint just that segmented group.
    // Switching format also shows/hides the PDF-only graph control.
    function setReportOpt(group, val) {
        _reportOpts[group] = val;
        const modal = document.getElementById('sales-report-type-modal');
        if (!modal) return;
        modal.querySelectorAll(`[data-seg^="${group}-"]`).forEach(b => {
            const active = b.getAttribute('data-seg') === `${group}-${val}`;
            b.style.background = active ? SEG_ACT_BG : 'transparent';
            b.style.color = active ? '#fff' : '#64748b';
            b.style.boxShadow = active ? SEG_ACT_SH : 'none';
        });
        if (group === 'format') {
            const g = document.getElementById('sales-report-graph-group');
            if (g) g.style.display = val === 'pdf' ? 'block' : 'none';
        }
    }

    function toggleReportConfig() {
        const conf = document.getElementById('sales-report-config');
        if (conf) conf.style.display = conf.style.display === 'none' ? 'block' : 'none';
    }

    function closeReportModal() {
        const m = document.getElementById('sales-report-type-modal');
        if (m) m.remove();
    }

    function confirmReportDownload() {
        const { format, type, graph } = _reportOpts;
        // Graph only ever applies to PDF.
        const includeGraph = format === 'pdf' && graph === 'yes';
        closeReportModal();
        if (type === 'detailed') downloadDetailedReport(format, includeGraph);
        else downloadReport(format, includeGraph);
    }

    // Draws the Domestic-vs-International monthly bar chart into the PDF — flat 2D
    // bars, compact centered month groups, value labels above each bar, L/K axis —
    // matching the on-screen dashboard chart. Returns the y just below the chart.
    function _drawPdfChart(doc, startY, margin) {
        const reportCur = REPORT_CUR;
        const homeSym = PdfUtils.currencySymbol(reportCur);
        const data = _chartData();
        const isINR = reportCur === 'INR';
        const tickSuffix = isINR ? 'L' : 'K';
        const unitLabel = isINR ? '(Values in Lakhs)' : '(Values in Thousands)';
        const maxVal = data.reduce((m, d) => Math.max(m, d.dom, d.intl), 0);
        const sc = _chartScale(maxVal);
        const unit = sc.unit, top = sc.top, tickCount = sc.ticks, step = sc.stepU * sc.unit;

        const pageWidth = doc.internal.pageSize.getWidth();
        const contentWidth = pageWidth - 2 * margin;
        const axisW = 16;
        const x0 = margin + axisW;
        const plotW = contentWidth - axisW;
        let y = startY;

        // Title + legend
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(0, 77, 44);
        doc.text('Sales by Month — Domestic vs International', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const lgY = y - 2.6;
        doc.setFillColor(19, 149, 92); doc.rect(pageWidth - margin - 48, lgY, 3, 3, 'F');
        doc.setTextColor(60, 60, 60); doc.text('Domestic', pageWidth - margin - 43.5, y);
        doc.setFillColor(127, 211, 166); doc.rect(pageWidth - margin - 24, lgY, 3, 3, 'F');
        doc.text('International', pageWidth - margin - 19.5, y);

        y += 9;                                  // headroom for value labels above bars
        const plotTop = y;
        const plotH = 52;
        const baseline = plotTop + plotH;

        // Gridlines + Y-axis tick labels (with the L/K unit suffix, like the dashboard)
        doc.setFontSize(7);
        for (let i = 0; i <= tickCount; i++) {
            const yy = baseline - (i / tickCount) * plotH;
            doc.setDrawColor(i === 0 ? 170 : 228, i === 0 ? 170 : 230, i === 0 ? 170 : 228);
            doc.setLineWidth(0.1);
            doc.line(x0, yy, margin + contentWidth, yy);
            doc.setTextColor(150, 150, 150);
            doc.text(i === 0 ? '0' : (Math.round((i * step / unit) * 100) / 100) + tickSuffix, x0 - 2, yy + 1, { align: 'right' });
        }

        // Flat 2D bars — the two region bars sit flush (no inner gap) and the whole
        // group of months is auto-fitted to the plot width so a full financial year
        // (12 months) never overflows the page. Gaps tighten and bars shrink as the
        // range grows; few-month ranges stay compact and centered.
        const n = data.length || 1;
        const innerGap = 0;                      // bars within a month touch
        const monthGap = n > 8 ? 3 : (n > 5 ? 6 : 5);
        const avail = plotW - 8;                 // leave a little side padding
        let barW = (avail - (n - 1) * monthGap) / (2 * n);
        barW = Math.min(8, Math.max(1.5, barW));  // cap so few months don't get huge bars
        const showVals = n <= 6;                  // hide value tags when crowded
        const groupW = barW * 2 + innerGap;
        const totalW = n * groupW + (n - 1) * monthGap;
        const startX = x0 + Math.max(4, (plotW - totalW) / 2);

        data.forEach((d, idx) => {
            const groupLeft = startX + idx * (groupW + monthGap);
            const center = groupLeft + groupW / 2;
            [['dom', [19, 149, 92]], ['intl', [127, 211, 166]]].forEach((spec, i) => {
                const val = d[spec[0]];
                const col = spec[1];
                const h = top > 0 ? (val / top) * plotH : 0;
                const bx = groupLeft + i * (barW + innerGap);
                if (h > 0.1) {
                    doc.setFillColor(col[0], col[1], col[2]);
                    doc.rect(bx, baseline - h, barW, h, 'F');
                }
                if (showVals && val > 0) {       // value label above the bar
                    doc.setFontSize(5.6);
                    doc.setTextColor(55, 55, 55);
                    doc.text(`${homeSym}${_formatNumber(val)}`, bx + barW / 2, baseline - h - 1.6, { align: 'center' });
                }
            });
            doc.setFontSize(n > 8 ? 6.5 : 7.5);
            doc.setTextColor(70, 70, 70);
            doc.text(`${MONTHS[d.month - 1].label.slice(0, 3)} ${d.year}`, center, baseline + 4.5, { align: 'center' });
        });

        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(unitLabel, margin + contentWidth, baseline + 9, { align: 'right' });

        return baseline + 12;
    }

    // Place the chart below the table (after autoTable), starting a new page if it
    // would overflow the current one. Shared by both report types.
    function _drawChartBelowTable(doc, margin) {
        const pageH = doc.internal.pageSize.getHeight();
        let chartY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 40) + 10;
        if (chartY + 80 > pageH - 12) { doc.addPage(); chartY = 20; }
        _drawPdfChart(doc, chartY, margin);
    }

    async function downloadReport(format = 'pdf', includeGraph = true) {
        const reportCur = REPORT_CUR;
        const invoices = _filteredInvoices();
        if (invoices.length === 0) {
            if (typeof App !== 'undefined' && App.showToast) App.showToast('No invoices in this range to export.', 'info');
            return;
        }

        const breakdown = _monthlyBreakdown(invoices);
        const total = breakdown.reduce((s, b) => s + b.value, 0);
        const homeSym = PdfUtils.currencySymbol(reportCur);

        if (format === 'excel') { _downloadReportExcel(breakdown, total, invoices.length, homeSym, includeGraph); return; }

        try {
            const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
            let doc = new jsPDF('p', 'mm', 'a4');
            const tableFont = _tableFont(doc);
            const margin = 10;
            let y = await _drawReportHeader(doc, 'Sales Report');

            doc.autoTable({
                startY: y,
                head: [['Month', 'No. of Invoices', `${_state.metric === 'net' ? 'Net' : 'Gross'} value in ${homeSym}`]],
                body: breakdown.filter(b => b.count > 0 || b.value !== 0)
                    .map(b => [_monthLabel(b.year, b.month, _multiYear()), String(b.count), _formatNumber(b.value)]),
                foot: [['Total', String(invoices.length), `${homeSym}${_formatNumber(total)}`]],
                theme: 'grid',
                styles: { font: tableFont, fontStyle: 'normal', fontSize: 10.5, cellPadding: { top: 4, bottom: 4, left: 7, right: 7 }, textColor: [45, 45, 45], lineColor: [224, 228, 226], lineWidth: 0.1, valign: 'middle' },
                headStyles: { font: tableFont, fontStyle: 'bold', fontSize: 10, fillColor: [0, 77, 44], textColor: [255, 255, 255], lineColor: [0, 77, 44], lineWidth: 0.1, cellPadding: { top: 4.5, bottom: 4.5, left: 7, right: 7 } },
                footStyles: { font: tableFont, fontStyle: 'bold', fontSize: 11, fillColor: [235, 242, 238], textColor: [0, 77, 44], lineColor: [0, 77, 44], lineWidth: 0.1 },
                alternateRowStyles: { fillColor: [248, 250, 249] },
                columnStyles: {
                    0: { halign: 'left', cellWidth: 80 },
                    1: { halign: 'center', cellWidth: 45 },
                    2: { halign: 'right', cellWidth: 65 }
                },
                margin: { left: margin, right: margin }
            });

            if (includeGraph) _drawChartBelowTable(doc, margin);

            const fname = `Sales_Report_${_pdfPeriodRange().replace(/[^\w]+/g, '_')}.pdf`;
            doc = await PdfUtils.flattenToImagePdf(doc);
            doc.save(fname);
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Sales report downloaded.', 'success');
        } catch (e) {
            console.error('Sales report error', e);
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Could not generate the report: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    // Month-by-month breakdown with a per-invoice table inside each month, a
    // per-month total, and two grand totals at the end (sum of every invoice
    // value, and the sum of the monthly totals).
    async function downloadDetailedReport(format = 'pdf', includeGraph = true) {
        const reportCur = REPORT_CUR;
        const invoices = _filteredInvoices();
        if (invoices.length === 0) {
            if (typeof App !== 'undefined' && App.showToast) App.showToast('No invoices in this range to export.', 'info');
            return;
        }

        const homeSym = PdfUtils.currencySymbol(reportCur);

        if (format === 'excel') { _downloadDetailedExcel(_detailGroupsByMonth(invoices), homeSym, includeGraph); return; }

        try {
            const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
            let doc = new jsPDF('p', 'mm', 'a4');
            const tableFont = _tableFont(doc);
            const margin = 10;
            let y = await _drawReportHeader(doc, 'Sales Report');

            // One continuous table for the whole report: a single header row, then
            // each month introduced by a full-width section row, its invoices, and a
            // grand-total row at the very end. The INV Ref NO column auto-sizes to its
            // content; Value / Month Total are fixed and right-aligned.
            const gridLine = [222, 226, 224];
            const sectionStyle = { fontStyle: 'bold', textColor: [0, 77, 44], fillColor: [235, 242, 238], halign: 'left' };
            const monthTotalStyle = { fontStyle: 'bold', textColor: [0, 77, 44], halign: 'right' };

            const groups = _detailGroupsByMonth(invoices);
            let grandValueTotal = 0; // sum of every individual invoice value (net of credit notes)
            let grandMonthTotal = 0; // sum of the per-month totals
            const creditRowStyle = { textColor: [239, 68, 68] };

            const body = [];
            groups.forEach(g => {
                // Full-width month section row.
                body.push([{ content: _monthLabel(g.year, g.month, true), colSpan: 5, styles: sectionStyle }]);

                let monthTotal = 0;
                let lastRow = null;
                g.list.forEach(inv => {
                    const v = _invoiceReportValue(inv);
                    const dateStr = (inv.date && PdfUtils.formatDateDMY) ? PdfUtils.formatDateDMY(inv.date) : (inv.date || '—');
                    const valStr = (v == null) ? '—' : _formatNumber(v);
                    if (v != null) { monthTotal = FinanceUtils.truncate2(monthTotal + v); grandValueTotal = FinanceUtils.truncate2(grandValueTotal + v); }
                    lastRow = [inv.refNumber || '—', dateStr, inv.clientName || '—', valStr, ''];
                    body.push(lastRow);
                });
                // Credit notes (sales returns) filed this month — shown in red as
                // negative rows that reduce the month's sales.
                g.creditNotes.forEach(entry => {
                    const cn = entry.cn;
                    const dateStr = (cn.date && PdfUtils.formatDateDMY) ? PdfUtils.formatDateDMY(cn.date) : (cn.date || '—');
                    const valStr = '-' + _formatNumber(entry.value);
                    monthTotal = FinanceUtils.truncate2(monthTotal - entry.value);
                    grandValueTotal = FinanceUtils.truncate2(grandValueTotal - entry.value);
                    lastRow = [
                        { content: `${cn.invoiceRef || '—'} (Credit Note)`, styles: creditRowStyle },
                        { content: dateStr, styles: creditRowStyle },
                        { content: cn.clientName || '—', styles: creditRowStyle },
                        { content: valStr, styles: { textColor: [239, 68, 68], halign: 'right' } },
                        ''
                    ];
                    body.push(lastRow);
                });
                grandMonthTotal = FinanceUtils.truncate2(grandMonthTotal + monthTotal);
                // The month total sits in the last column of the month's final row.
                if (lastRow) lastRow[4] = { content: _formatNumber(monthTotal), styles: monthTotalStyle };
            });

            // Grand-total row: sum of every invoice value (Value column) and the sum
            // of the monthly totals (Month Total column).
            const totalCellStyle = { fontStyle: 'bold', textColor: [0, 77, 44], fillColor: [235, 242, 238], halign: 'right' };
            body.push([
                { content: 'Total', colSpan: 3, styles: totalCellStyle },
                { content: `${homeSym}${_formatNumber(grandValueTotal)}`, styles: totalCellStyle },
                { content: `${homeSym}${_formatNumber(grandMonthTotal)}`, styles: totalCellStyle }
            ]);

            doc.autoTable({
                startY: y,
                head: [['INV Ref NO', 'Date', 'Client', `${_state.metric === 'net' ? 'Net' : 'Gross'} value in ${homeSym}`, 'Month Total']],
                body,
                theme: 'grid',
                styles: { font: tableFont, fontSize: 9.5, cellPadding: 2.6, textColor: [45, 45, 45], lineColor: gridLine, lineWidth: 0.1, valign: 'middle', overflow: 'linebreak' },
                headStyles: { font: tableFont, fontStyle: 'bold', fontSize: 9.5, fillColor: [0, 77, 44], textColor: [255, 255, 255], lineColor: [0, 77, 44], lineWidth: 0.1 },
                columnStyles: {
                    0: { halign: 'left' },
                    1: { cellWidth: 26, halign: 'left' },
                    2: { halign: 'left' },
                    3: { cellWidth: 32, halign: 'right' },
                    4: { cellWidth: 32, halign: 'right' }
                },
                margin: { left: margin, right: margin }
            });

            if (includeGraph) _drawChartBelowTable(doc, margin);

            const fname = `Sales_Detailed_Report_${_pdfPeriodRange().replace(/[^\w]+/g, '_')}.pdf`;
            doc = await PdfUtils.flattenToImagePdf(doc);
            doc.save(fname);
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Detailed sales report downloaded.', 'success');
        } catch (e) {
            console.error('Sales detailed report error', e);
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Could not generate the detailed report: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    // Plain grouped number (no symbol) for PDF cells — Indian grouping for INR.
    function _formatNumber(v) {
        const n = Number(v) || 0;
        if (typeof PdfUtils !== 'undefined' && PdfUtils.formatCurrency) {
            return PdfUtils.formatCurrency(n, REPORT_CUR);
        }
        return n.toFixed(2);
    }

    // --- Excel (.xls) export -------------------------------------------------
    // Excel opens an HTML table saved with the .xls extension natively, preserving
    // styling — so we build the same report as styled HTML and download it. No
    // extra library required.
    function _xlsEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _numCell(v, extra = '') {
        // mso-number-format keeps Excel treating the value as a 2-decimal number.
        return `<td style="mso-number-format:'#,##0.00'; text-align:right; ${extra}">${Number(v) || 0}</td>`;
    }
    function _downloadXls(innerHtml, filename) {
        const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body>${innerHtml}</body></html>`;
        const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const _XLS_HEAD = "background:#004d2c; color:#ffffff; font-weight:bold; text-align:center; border:1px solid #004d2c; padding:6px;";
    const _XLS_CELL = "border:1px solid #dfe3e1; padding:5px;";
    const _XLS_TOTAL = "background:#ebf2ee; color:#004d2c; font-weight:bold; border:1px solid #004d2c; padding:6px;";

    // Domestic-vs-International per-month data table (the chart's underlying data).
    // Appended to the Excel export when "With graph" is chosen, since a drawn chart
    // can't be embedded via the HTML-table approach.
    function _xlsChartTable(homeSym) {
        const rows = _chartData().map(d => `
            <tr>
                <td style="${_XLS_CELL}">${_xlsEscape(_monthLabel(d.year, d.month, true))}</td>
                ${_numCell(d.dom, _XLS_CELL)}
                ${_numCell(d.intl, _XLS_CELL)}
            </tr>`).join('');
        return `<br>
            <table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-family:Calibri, Arial, sans-serif; font-size:11pt;">
                <tr><td colspan="3" style="font-weight:bold; color:#004d2c; border:none; padding:8px 0 4px;">Sales by Month — Domestic vs International</td></tr>
                <tr>
                    <th style="${_XLS_HEAD} text-align:left;">Month</th>
                    <th style="${_XLS_HEAD} text-align:right;">Domestic (${_xlsEscape(homeSym)})</th>
                    <th style="${_XLS_HEAD} text-align:right;">International (${_xlsEscape(homeSym)})</th>
                </tr>
                ${rows}
            </table>`;
    }

    function _downloadReportExcel(breakdown, total, invCount, homeSym, includeGraph) {
        const rows = breakdown.filter(b => b.count > 0 || b.value !== 0).map(b => `
            <tr>
                <td style="${_XLS_CELL}">${_xlsEscape(_monthLabel(b.year, b.month, _multiYear()))}</td>
                <td style="${_XLS_CELL} text-align:center;">${b.count}</td>
                ${_numCell(b.value, _XLS_CELL)}
            </tr>`).join('');
        const table = `
            <table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-family:Calibri, Arial, sans-serif; font-size:11pt;">
                <tr><td colspan="3" style="font-size:16pt; font-weight:bold; color:#004d2c; text-align:center; border:none; padding:8px;">Sales Report</td></tr>
                <tr><td colspan="3" style="font-weight:bold; text-align:center; border:none; padding:2px 8px 12px;">${_xlsEscape(_pdfPeriodRange())}</td></tr>
                <tr>
                    <th style="${_XLS_HEAD} text-align:left;">Month</th>
                    <th style="${_XLS_HEAD}">No of Invoices</th>
                    <th style="${_XLS_HEAD} text-align:right;">${_state.metric === 'net' ? 'Net' : 'Gross'} value in ${_xlsEscape(homeSym)}</th>
                </tr>
                ${rows}
                <tr>
                    <td style="${_XLS_TOTAL}">Total</td>
                    <td style="${_XLS_TOTAL} text-align:center;">${invCount}</td>
                    ${_numCell(total, _XLS_TOTAL)}
                </tr>
            </table>`;
        _downloadXls(table + (includeGraph ? _xlsChartTable(homeSym) : ''), `Sales_Report_${_pdfPeriodRange().replace(/[^\w]+/g, '_')}.xls`);
        if (typeof App !== 'undefined' && App.showToast) App.showToast('Sales report downloaded (Excel).', 'success');
    }

    function _downloadDetailedExcel(groups, homeSym, includeGraph) {
        let grandValueTotal = 0;
        let grandMonthTotal = 0;
        let bodyRows = '';
        groups.forEach(g => {
            bodyRows += `<tr><td colspan="5" style="${_XLS_TOTAL} text-align:left;">${_xlsEscape(_monthLabel(g.year, g.month, true))}</td></tr>`;
            let monthTotal = 0;
            const rendered = g.list.map(inv => {
                const v = _invoiceReportValue(inv);
                const dateStr = (inv.date && PdfUtils.formatDateDMY) ? PdfUtils.formatDateDMY(inv.date) : (inv.date || '—');
                if (v != null) { monthTotal += v; grandValueTotal += v; }
                return { ref: inv.refNumber || '—', dateStr, client: inv.clientName || '—', v, credit: false };
            });
            // Credit notes filed this month, as negative deduction rows.
            (g.creditNotes || []).forEach(entry => {
                const cn = entry.cn;
                const dateStr = (cn.date && PdfUtils.formatDateDMY) ? PdfUtils.formatDateDMY(cn.date) : (cn.date || '—');
                monthTotal -= entry.value;
                grandValueTotal -= entry.value;
                rendered.push({ ref: `${cn.invoiceRef || '—'} (Credit Note)`, dateStr, client: cn.clientName || '—', v: -entry.value, credit: true });
            });
            grandMonthTotal += monthTotal;
            rendered.forEach((r, i) => {
                const isLast = i === rendered.length - 1;
                const cellStyle = r.credit ? `${_XLS_CELL} color:#ef4444;` : _XLS_CELL;
                const valCell = r.v == null
                    ? `<td style="${cellStyle} text-align:right;">—</td>`
                    : _numCell(r.v, cellStyle);
                bodyRows += `
                    <tr>
                        <td style="${cellStyle}">${_xlsEscape(r.ref)}</td>
                        <td style="${cellStyle}">${_xlsEscape(r.dateStr)}</td>
                        <td style="${cellStyle}">${_xlsEscape(r.client)}</td>
                        ${valCell}
                        ${isLast ? _numCell(monthTotal, _XLS_TOTAL) : `<td style="${_XLS_CELL}"></td>`}
                    </tr>`;
            });
        });
        const table = `
            <table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-family:Calibri, Arial, sans-serif; font-size:11pt;">
                <tr><td colspan="5" style="font-size:16pt; font-weight:bold; color:#004d2c; text-align:center; border:none; padding:8px;">Sales Report</td></tr>
                <tr><td colspan="5" style="font-weight:bold; text-align:center; border:none; padding:2px 8px 12px;">${_xlsEscape(_pdfPeriodRange())}</td></tr>
                <tr>
                    <th style="${_XLS_HEAD} text-align:left;">INV Ref NO</th>
                    <th style="${_XLS_HEAD} text-align:left;">Date</th>
                    <th style="${_XLS_HEAD} text-align:left;">Client</th>
                    <th style="${_XLS_HEAD} text-align:right;">${_state.metric === 'net' ? 'Net' : 'Gross'} value in ${_xlsEscape(homeSym)}</th>
                    <th style="${_XLS_HEAD} text-align:right;">Month Total</th>
                </tr>
                ${bodyRows}
                <tr>
                    <td colspan="3" style="${_XLS_TOTAL} text-align:right;">Total</td>
                    ${_numCell(grandValueTotal, _XLS_TOTAL)}
                    ${_numCell(grandMonthTotal, _XLS_TOTAL)}
                </tr>
            </table>`;
        _downloadXls(table + (includeGraph ? _xlsChartTable(homeSym) : ''), `Sales_Detailed_Report_${_pdfPeriodRange().replace(/[^\w]+/g, '_')}.xls`);
        if (typeof App !== 'undefined' && App.showToast) App.showToast('Detailed sales report downloaded (Excel).', 'success');
    }

    // --- Controls ------------------------------------------------------------
    // True when the range covers exactly one month.
    function _isSingleMonth() {
        return _absIndex(_state.startMonth, _state.startYear) === _absIndex(_state.endMonth, _state.endYear);
    }

    // Changing From while the range is a single month keeps it a single month —
    // "show me September" must not leave the previous end month hanging.
    function _followStart(wasSingle) {
        if (!wasSingle) return;
        _state.endMonth = _state.startMonth;
        _state.endYear = _state.startYear;
    }

    function setStartMonth(v) { const one = _isSingleMonth(); _state.startMonth = parseInt(v, 10) || 1; _followStart(one); render(); }
    function setStartYear(v) { const one = _isSingleMonth(); _state.startYear = parseInt(v, 10) || _now.getFullYear(); _followStart(one); render(); }
    function setEndMonth(v) { _state.endMonth = parseInt(v, 10) || 1; render(); }
    function setEndYear(v) { _state.endYear = parseInt(v, 10) || _now.getFullYear(); render(); }
    function setScope(v) {
        _state.scope = ['international', 'all', 'other'].includes(v) ? v : 'domestic';
        _state.bPage = 1;
        render();
    }
    function setMetric(v) { _state.metric = (v === 'gross') ? 'gross' : 'net'; render(); }
    function setDepartment(v) { _state.department = v || ''; render(); }

    // --- "Select Timeline" popup --------------------------------------------
    // A premium custom-select (matches the dashboard component); the global
    // custom-select handler wires the change events.
    function _timelineSelect(handler, options, sel, width) {
        const match = options.find(o => String(o.v) === String(sel));
        const label = match ? match.label : (options[0] ? options[0].label : '');
        return `
            <div class="custom-select-wrapper" style="width:${width};">
                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: rgba(0,0,0,0.05); border: none; border-radius: 10px; font-weight: 600; color: #18181b;">
                    <span>${_escapeHtml(label)}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options">
                    ${options.map(o => `<div class="custom-option${String(o.v) === String(sel) ? ' selected' : ''}" data-value="${_escapeHtml(String(o.v))}">${_escapeHtml(o.label)}</div>`).join('')}
                </div>
                <input type="hidden" value="${_escapeHtml(String(sel))}" onchange="${handler}">
            </div>`;
    }

    function openTimelineModal() {
        closeTimelineModal();
        const accent = '#004d2c';
        const ov = document.createElement('div');
        ov.id = 'sales-timeline-modal';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.45); backdrop-filter:blur(3px); display:flex; align-items:flex-start; justify-content:center; z-index:16000; font-family:Inter,-apple-system,sans-serif; padding:80px 16px; overflow:auto;';
        // Intentionally NOT closing on backdrop click — only via × / Done.
        ov.innerHTML = `
            <div style="background:#fff; border-radius:16px; width:100%; max-width:440px; box-shadow:0 20px 60px rgba(0,0,0,0.25); overflow:visible;">
                <div style="padding:18px 22px; border-bottom:1px solid rgba(0,0,0,0.07); display:flex; align-items:center; justify-content:space-between;">
                    <div style="font-size:16px; font-weight:800; color:#18181b;">Select Timeline</div>
                    <button onclick="Sales.closeTimelineModal()" style="border:none; background:transparent; font-size:22px; line-height:1; color:#a1a1aa; cursor:pointer;">&times;</button>
                </div>
                <div style="padding:20px 22px;" id="sales-timeline-body"></div>
                <div style="padding:14px 22px; border-top:1px solid rgba(0,0,0,0.07); display:flex; justify-content:flex-end;">
                    <button onclick="Sales.closeTimelineModal()" style="padding:9px 22px; font-size:13px; font-weight:700; border:none; border-radius:10px; background:${accent}; color:#fff; cursor:pointer;">Done</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        _renderTimelineBody();
    }

    function closeTimelineModal() {
        const m = document.getElementById('sales-timeline-modal');
        if (m) m.remove();
    }

    function _renderTimelineBody() {
        const box = document.getElementById('sales-timeline-body');
        if (!box) return;
        const years = _availableYears();
        const lbl = t => `<label style="display:block; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:6px;">${t}</label>`;

        const modeBtn = (v, label) => {
            const active = _state.rangeMode === v;
            const base = 'flex:1; padding:10px 12px; font-size:12.5px; font-weight:600; border:none; border-radius:8px; cursor:pointer; transition:all .15s;';
            const style = active
                ? base + ' background:#fff; color:#18181b; box-shadow:0 1px 3px rgba(0,0,0,0.12);'
                : base + ' background:transparent; color:#71717a;';
            return `<button type="button" onclick="Sales.setRangeMode('${v}')" style="${style}">${label}</button>`;
        };
        const toggle = `<div style="display:flex; background:rgba(0,0,0,0.05); padding:4px; border-radius:10px; gap:3px; margin-bottom:18px;">${modeBtn('months', 'MM/YYYY – MM/YYYY')}${modeBtn('fy', 'Financial Year')}</div>`;

        let controls;
        if (_state.rangeMode === 'fy') {
            const fyOptions = years.map(y => ({ v: y, label: `FY ${y}-${String(y + 1).slice(-2)}` }));
            const cur = _state.startMonth >= 4 ? _state.startYear : _state.startYear - 1;
            controls = lbl('Financial Year') + _timelineSelect('Sales.setFinancialYear(this.value)', fyOptions, cur, '100%');
        } else {
            const months = MONTHS.map(m => ({ v: m.v, label: m.label }));
            const yrs = years.map(y => ({ v: y, label: String(y) }));
            controls = `
                ${lbl('From')}
                <div style="display:flex; gap:8px; margin-bottom:16px;">
                    ${_timelineSelect('Sales.setStartMonth(this.value)', months, _state.startMonth, '100%')}
                    ${_timelineSelect('Sales.setStartYear(this.value)', yrs, _state.startYear, '120px')}
                </div>
                ${lbl('To')}
                <div style="display:flex; gap:8px;">
                    ${_timelineSelect('Sales.setEndMonth(this.value)', months, _state.endMonth, '100%')}
                    ${_timelineSelect('Sales.setEndYear(this.value)', yrs, _state.endYear, '120px')}
                </div>`;
        }

        box.innerHTML = toggle + controls +
            `<div style="margin-top:18px; font-size:12.5px; color:#71717a;">Showing: <b style="color:#18181b;">${_escapeHtml(_rangeLabel())}</b></div>`;
    }

    // Switch the date filter between an explicit month range and a financial year.
    // Switching to FY snaps the range to the financial year of the current start so
    // the view stays valid; switching to Months keeps the current range editable.
    function setRangeMode(mode) {
        if (mode === 'fy') {
            _state.rangeMode = 'fy';
            const y = _state.startMonth >= 4 ? _state.startYear : _state.startYear - 1;
            setFinancialYear(y); // sets the full FY range and re-renders
            return;
        }
        // Leaving FY mode the range still spans the whole financial year, so the
        // month pickers open on Apr–Mar and picking one month still shows the year.
        // Collapse to a single month so "a particular month" means that month.
        if (_state.rangeMode === 'fy') {
            _state.endMonth = _state.startMonth;
            _state.endYear = _state.startYear;
        }
        _state.rangeMode = 'months';
        render();
    }

    // Set the whole From/To range to a financial year. `v` is the FY's start year.
    // Apr (Y) → Mar (Y+1).
    function setFinancialYear(v) {
        const y = parseInt(v, 10);
        if (!y) return;
        _state.startMonth = 4; _state.startYear = y;
        _state.endMonth = 3; _state.endYear = y + 1;
        render();
    }

    // Expand/collapse a month's invoice list in the breakdown table.
    function toggleMonth(year, month) {
        const k = `${year}-${month}`;
        if (_state.expanded[k]) delete _state.expanded[k];
        else _state.expanded[k] = true;
        render();
    }

    // Open a generated invoice's PDF in a new tab (View action in the expanded list).
    async function viewInvoice(id) {
        const win = window.open('', '_blank');
        try {
            const data = Storage.getInvoice ? Storage.getInvoice(id) : null;
            if (!data) { if (win) win.close(); return; }
            if (typeof Invoice !== 'undefined' && Invoice.generatePDF) {
                await Invoice.generatePDF(data, 'view', win);
            } else if (win) {
                win.close();
            }
        } catch (e) {
            if (win) win.close();
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Failed to view PDF: ' + e.message, 'error');
        }
    }

    function setBreakdownPage(p) {
        _state.bPage = Math.max(1, p);
        render();
    }

    function setBreakdownPageSize(n) {
        _state.bPageSize = n;
        _state.bPage = 1;
        render();
    }

    return { render, setBreakdownPage, setBreakdownPageSize, setStartMonth, setStartYear, setEndMonth, setEndYear, setFinancialYear, setRangeMode, openTimelineModal, closeTimelineModal, setScope, setMetric, setDepartment, toggleMonth, viewInvoice, barTip, promptReportType, setReportOpt, toggleReportConfig, closeReportModal, confirmReportDownload, downloadReport, downloadDetailedReport };
})();
