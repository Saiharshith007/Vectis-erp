/* ============================================
   Summary Dashboard Module
   --------------------------------------------
   Executive overview of all invoices:
   - Headline KPI cards (Total Invoiced, Received, Pending, Settled Rate)
   - Filterable & searchable table:
     1. Invoice No
     2. Date
     3. Client
     4. Type (Domestic / International)
     5. Amount (Total invoice amount)
     6. Receipt (Total receipt amount received/settled)
     7. Pending (Remaining balance; "Settled" badge when fully settled)
     8. Actions (View / Download PDF)
   ============================================ */

const Summary = (() => {
    let currentPage = 1;
    let pageSize = 10;
    let _search = '';
    let _statusFilter = 'all'; // 'all' | 'settled' | 'pending' | 'partial'
    let _poFilter = '';        // Order Reference Number of a received PO ('' = all)
    let _typeFilter = 'all';   // 'all' | 'domestic' | 'international'
    let _filtersVisible = true;
    let _sortBy = 'date';
    let _sortDir = 'desc';

    // Timeline / Period filter state
    let _dateFilterMode = 'all'; // 'all' | 'dates' | 'months' | 'fy'
    let _filterStartDate = '';   // 'YYYY-MM-DD'
    let _filterEndDate = '';     // 'YYYY-MM-DD'
    let _filterStartMonth = 4;
    let _filterStartYear = 2026;
    let _filterEndMonth = 3;
    let _filterEndYear = 2027;
    let _filterSelectedFY = '2026-27';

    // Temp state for timeline popup
    let _tempTab = 'dates'; // 'dates' | 'months' | 'fy'
    let _tempStartDate = '';
    let _tempEndDate = '';
    let _tempStartMonth = 4;
    let _tempStartYear = 2026;
    let _tempEndMonth = 3;
    let _tempEndYear = 2027;
    let _tempSelectedFY = '2026-27';

    function _formatShortDate(str) {
        if (!str) return '';
        const parts = str.split('-');
        if (parts.length !== 3) return str;
        const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const m = parseInt(parts[1], 10);
        return `${parts[2]} ${mNames[m - 1]} ${parts[0]}`;
    }

    function _getAvailableFinancialYears() {
        const allInvoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const fys = new Set();
        allInvoices.forEach(inv => {
            if (inv && inv.date) {
                const parts = inv.date.split('-');
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!isNaN(y) && !isNaN(m)) {
                    const fyStart = (m >= 4) ? y : y - 1;
                    fys.add(`${fyStart}-${String(fyStart + 1).slice(-2)}`);
                }
            }
        });
        const curY = new Date().getFullYear();
        const curM = new Date().getMonth() + 1;
        const defaultFyStart = (curM >= 4) ? curY : curY - 1;
        fys.add(`${defaultFyStart}-${String(defaultFyStart + 1).slice(-2)}`);
        return Array.from(fys).sort().reverse();
    }

    function _getAvailableYears() {
        const allInvoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const years = new Set();
        allInvoices.forEach(inv => {
            if (inv && inv.date) {
                const y = parseInt(inv.date.split('-')[0], 10);
                if (!isNaN(y)) years.add(y);
            }
        });
        years.add(new Date().getFullYear());
        return Array.from(years).sort().reverse();
    }

    function _getActiveDateRange() {
        if (_dateFilterMode === 'dates') {
            return {
                start: _filterStartDate || '',
                end: _filterEndDate || ''
            };
        }
        if (_dateFilterMode === 'months') {
            const sm = String(_filterStartMonth).padStart(2, '0');
            const em = String(_filterEndMonth).padStart(2, '0');
            const start = `${_filterStartYear}-${sm}-01`;
            const lastDay = new Date(_filterEndYear, _filterEndMonth, 0).getDate();
            const end = `${_filterEndYear}-${em}-${String(lastDay).padStart(2, '0')}`;
            return { start, end };
        }
        if (_dateFilterMode === 'fy') {
            const y = parseInt(String(_filterSelectedFY).split('-')[0], 10);
            if (!isNaN(y)) {
                return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
            }
        }
        return { start: '', end: '' };
    }

    function _getTimelineLabel() {
        const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (_dateFilterMode === 'all') return 'All Time';
        if (_dateFilterMode === 'fy') return `FY ${_filterSelectedFY}`;
        if (_dateFilterMode === 'months') {
            const sLab = `${mNames[_filterStartMonth - 1]} ${_filterStartYear}`;
            const eLab = `${mNames[_filterEndMonth - 1]} ${_filterEndYear}`;
            return (sLab === eLab) ? sLab : `${sLab} – ${eLab}`;
        }
        if (_dateFilterMode === 'dates') {
            if (_filterStartDate && _filterEndDate) {
                return `${_formatShortDate(_filterStartDate)} – ${_formatShortDate(_filterEndDate)}`;
            }
            if (_filterStartDate) return `From ${_formatShortDate(_filterStartDate)}`;
            if (_filterEndDate) return `To ${_formatShortDate(_filterEndDate)}`;
            return 'Custom Dates';
        }
        return 'All Time';
    }

    function _getTempShowingText() {
        const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if (_tempTab === 'dates') {
            if (_tempStartDate && _tempEndDate) {
                return `${_formatShortDate(_tempStartDate)} – ${_formatShortDate(_tempEndDate)}`;
            }
            if (_tempStartDate) return `From ${_formatShortDate(_tempStartDate)}`;
            if (_tempEndDate) return `To ${_formatShortDate(_tempEndDate)}`;
            return 'Select date range';
        }
        if (_tempTab === 'months') {
            const sLab = `${mNames[_tempStartMonth - 1]} ${_tempStartYear}`;
            const eLab = `${mNames[_tempEndMonth - 1]} ${_tempEndYear}`;
            return (sLab === eLab) ? sLab : `${sLab} – ${eLab}`;
        }
        if (_tempTab === 'fy') {
            return `FY ${_tempSelectedFY}`;
        }
        return 'All Time';
    }

    function _escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _getInvoiceType(inv) {
        const t = (inv && (inv.invoiceType || inv.type || '')) .toLowerCase();
        if (t === 'international' || inv.currency === 'USD') return 'international';
        return 'domestic';
    }

    function _calcInvoiceDetails(inv, allReceipts, allReturns) {
        const cur = (inv && inv.currency) || 'INR';
        const isForeign = cur !== 'INR';
        // Match the PDF: with Round Off on, domestic INR invoices print the grand
        // total rounded to the nearest rupee.
        const roundOff = !isForeign && (inv.mode || 'domestic') === 'domestic'
            && Storage.getINVColumnVisibility && Storage.getINVColumnVisibility().roundOff === true;
        const _ro = v => roundOff ? Math.round(v) : v;
        const total = _ro(Number(inv.grandTotal) || 0);
        const rate = parseFloat(inv && inv.exchangeRate) || 0;

        // Total in INR
        let totalINR = total;
        if (isForeign) {
            if (inv.reportValue !== undefined && inv.reportValue !== null && inv.reportValue !== '' && Number(inv.reportValue) > 0) {
                totalINR = Number(inv.reportValue);
            } else if (rate > 0) {
                totalINR = total * rate;
            }
        }

        // Sales returns (credit notes) for this invoice
        const returns = allReturns.filter(r => r && r.invoiceId === inv.id);
        const credit = returns.reduce((s, r) => s + _ro(Number(r.creditAmount) || 0), 0);
        const creditINR = isForeign ? (rate > 0 ? credit * rate : credit) : credit;

        const netBillable = Math.max(0, total - credit);
        const netBillableINR = Math.max(0, totalINR - creditINR);

        // Receipts credited to this invoice
        const receipts = allReceipts.filter(r => r && r.invoiceId === inv.id);
        const received = receipts.reduce((s, r) => s + (Number(r.amountReceived) || 0), 0);

        // Actual receipt value in INR credited
        let receivedINR = 0;
        let exchangeDiff = 0;
        let hasExchangeDiff = false;

        if (receipts.length > 0) {
            receipts.forEach(r => {
                let actualINR = 0;
                if (r.currency === 'INR') {
                    actualINR = Number(r.amountReceived) || 0;
                } else if (Number(r.amountInINR) > 0) {
                    actualINR = Number(r.amountInINR);
                } else {
                    const bkRate = Number(r.bookingRate) || 0;
                    if (bkRate > 0) {
                        let charges = Number(r.bankCharges) || 0;
                        if (r.bankChargesType === 'percent') {
                            charges = (Number(r.amountReceived) || 0) * bkRate * (charges / 100);
                        }
                        actualINR = Math.max(0, (Number(r.amountReceived) || 0) * bkRate - charges);
                    }
                }
                receivedINR += actualINR;

                if (isForeign && rate > 0) {
                    hasExchangeDiff = true;
                    const bookedINR = (Number(r.amountReceived) || 0) * rate;
                    exchangeDiff += (actualINR - bookedINR);
                }
            });
            receivedINR = Math.round(receivedINR * 100) / 100;
            exchangeDiff = Math.round(exchangeDiff * 100) / 100;
        }

        // Outstanding pending amount
        const pending = Math.max(0, netBillable - received);
        const isSettled = total > 0 && pending <= 0.005;
        const isPartial = !isSettled && received > 0.005;

        let pendingINR = 0;
        if (isSettled) {
            pendingINR = 0;
        } else if (isForeign) {
            pendingINR = rate > 0 ? Math.round(pending * rate * 100) / 100 : pending;
        } else {
            pendingINR = Math.round(pending * 100) / 100;
        }

        let status = 'pending';
        if (isSettled) status = 'settled';
        else if (isPartial) status = 'partial';

        return {
            total,
            totalINR,
            currency: cur,
            isForeign,
            exchangeRate: rate,
            received,
            receivedINR,
            exchangeDiff,
            hasExchangeDiff,
            credit,
            creditINR,
            netBillable,
            netBillableINR,
            pending,
            pendingINR,
            isSettled,
            isPartial,
            status,
            receiptCount: receipts.length
        };
    }

    function render() {
        const container = document.getElementById('summary-content');
        if (!container) return;

        const homeCur = 'INR';

        const allInvoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const allReceipts = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        const allReturns = (Storage.getAllSalesReturns && Storage.getAllSalesReturns()) || [];

        // Register client filter with Dashboard client multi-select
        Dashboard.registerClientFilter('summary', () => allInvoices, () => {
            currentPage = 1;
            render();
        });
        const clientSel = Dashboard.clientSelection('summary');

        const processedList = allInvoices.map(inv => {
            return {
                ...inv,
                _details: _calcInvoiceDetails(inv, allReceipts, allReturns),
                _type: _getInvoiceType(inv)
            };
        });

        // Apply filters
        const q = _search.trim().toLowerCase();
        const filtered = processedList.filter(item => {
            const party = (item.clientName || item.consignorName || item.client || '').trim();
            if (clientSel.size && !clientSel.has(party)) return false;

            if (_typeFilter !== 'all' && item._type !== _typeFilter) return false;
            if (_poFilter && (item.poNumber || '').trim().toLowerCase() !== _poFilter.toLowerCase()) return false;

            if (_statusFilter === 'settled' && !item._details.isSettled) return false;
            if (_statusFilter === 'pending' && item._details.status !== 'pending') return false;
            if (_statusFilter === 'partial' && !item._details.isPartial) return false;

            // Date / Timeline filtering
            if (_dateFilterMode !== 'all') {
                const invDate = item.date;
                if (!invDate) return false;
                const { start, end } = _getActiveDateRange();
                if (start && invDate < start) return false;
                if (end && invDate > end) return false;
            }

            if (q) {
                const ref = String(item.refNumber || item.invoiceNumber || '').toLowerCase();
                const partyStr = party.toLowerCase();
                if (!ref.includes(q) && !partyStr.includes(q)) return false;
            }

            return true;
        });

        // Sorting
        filtered.sort((a, b) => {
            let va, vb;
            if (_sortBy === 'date') {
                va = new Date(a.date || 0).getTime();
                vb = new Date(b.date || 0).getTime();
            } else if (_sortBy === 'invoiceNo') {
                va = String(a.refNumber || a.invoiceNumber || '').toLowerCase();
                vb = String(b.refNumber || b.invoiceNumber || '').toLowerCase();
                return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else if (_sortBy === 'client') {
                va = String(a.clientName || a.consignorName || '').toLowerCase();
                vb = String(b.clientName || b.consignorName || '').toLowerCase();
                return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            } else if (_sortBy === 'amount') {
                va = a._details.totalINR;
                vb = b._details.totalINR;
            } else if (_sortBy === 'receipt') {
                va = a._details.receivedINR;
                vb = b._details.receivedINR;
            } else if (_sortBy === 'exchangeDiff') {
                va = a._details.exchangeDiff || 0;
                vb = b._details.exchangeDiff || 0;
            } else if (_sortBy === 'pending') {
                va = a._details.pendingINR;
                vb = b._details.pendingINR;
            } else {
                va = new Date(a.date || 0).getTime();
                vb = new Date(b.date || 0).getTime();
            }
            return _sortDir === 'asc' ? (va - vb) : (vb - va);
        });

        const totalFiltered = filtered.length;
        const hasInternational = filtered.some(item => item._type === 'international' || item._details.isForeign);

        // Calculate Totals in INR for the footer row across all filtered records
        let sumTotalINR = 0;
        let sumCreditINR = 0;
        let sumNetINR = 0;
        let sumReceivedINR = 0;
        let sumExchangeDiff = 0;
        let sumPendingINR = 0;

        filtered.forEach(item => {
            const d = item._details;
            sumTotalINR += d.totalINR;
            sumCreditINR += d.creditINR;
            sumNetINR += d.netBillableINR;
            sumReceivedINR += d.receivedINR;
            sumExchangeDiff += (d.exchangeDiff || 0);
            sumPendingINR += d.pendingINR;
        });

        sumTotalINR = Math.round(sumTotalINR * 100) / 100;
        sumCreditINR = Math.round(sumCreditINR * 100) / 100;
        sumNetINR = Math.round(sumNetINR * 100) / 100;
        sumReceivedINR = Math.round(sumReceivedINR * 100) / 100;
        sumExchangeDiff = Math.round(sumExchangeDiff * 100) / 100;
        sumPendingINR = Math.round(sumPendingINR * 100) / 100;

        const tableFooterHtml = '';

        const hasActiveFilters = !!(_search || clientSel.size || _statusFilter !== 'all' || _typeFilter !== 'all' || _poFilter || _dateFilterMode !== 'all');
        // PO numbers come from the Order Reference Numbers of received purchase orders.
        const poNumbers = [...new Set(((Storage.getAllTMs && Storage.getAllTMs()) || [])
            .map(tm => ((tm && tm.details && tm.details.poNumber) || '').trim()).filter(Boolean))].sort();

        // With a PO selected, show its value against what has been invoiced on it.
        // Invoiced uses grandTotal so it reflects the actual invoice value —
        // including GST for domestic invoices, same as totalAmount for international.
        let poSummaryHtml = '';
        if (_poFilter) {
            const key = _poFilter.toLowerCase();
            const pos = ((Storage.getAllTMs && Storage.getAllTMs()) || [])
                .filter(tm => tm && tm.details && (tm.details.poNumber || '').trim().toLowerCase() === key);
            const poCur = (pos[0] && pos[0].details.currency) || 'INR';
            const poValue = pos.reduce((sum, tm) => sum + (parseFloat(tm.details.grandTotal != null ? tm.details.grandTotal : tm.details.totalAmount) || 0), 0);
            const poInvoices = allInvoices.filter(inv => (inv.poNumber || '').trim().toLowerCase() === key);
            // Use grandTotal (incl. GST) — falls back to totalAmount for records that pre-date grandTotal storage
            const invoiced = Math.round(poInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal != null && inv.grandTotal !== '' ? inv.grandTotal : inv.totalAmount) || 0), 0) * 100) / 100;

            // Sum all receipts across every invoice linked to this PO
            const poInvIds = new Set(poInvoices.map(inv => inv.id));
            const received = Math.round(allReceipts
                .filter(r => r && poInvIds.has(r.invoiceId))
                .reduce((sum, r) => sum + (Number(r.amountReceived) || 0), 0) * 100) / 100;
            const pending = Math.max(0, Math.round((invoiced - received) * 100) / 100);

            const remaining = Math.round((poValue - invoiced) * 100) / 100;
            const card = (label, value, color, sub) => `
                <div style="flex:1; min-width:180px; min-height:66px; background:#fff; border:1px solid rgba(0,0,0,0.07); border-radius:10px; padding:9px 16px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
                    <div style="font-size:11px; font-weight:700; color:#71717a; text-transform:uppercase; letter-spacing:0.5px; line-height:1.2;">${label}</div>
                    <div style="flex:1; display:flex; align-items:center; ${sub ? 'margin-top:2px;' : 'margin-top:4px;'}">
                        <div style="font-size:${sub ? '18px' : '21px'}; font-weight:800; color:${color}; line-height:1.2;">${_escapeHtml(PdfUtils.formatMoney(value, poCur))}</div>
                    </div>
                    ${sub ? `<div style="font-size:10.5px; color:#a1a1aa; margin-top:2px; line-height:1.2;">${sub}</div>` : ''}
                </div>`;
            poSummaryHtml = `
                <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:18px;">
                    ${card('PO Value', poValue, '#18181b', _escapeHtml(_poFilter))}
                    ${card('Invoiced', invoiced, '#004d2c', poInvoices.length + ' invoice' + (poInvoices.length === 1 ? '' : 's'))}
                    ${card('Received', received, '#2563eb', '')}
                    ${card('Pending', pending, pending <= 0.005 ? '#167946' : '#dc2626', pending <= 0.005 ? 'All payments received' : 'Invoiced but not yet received')}
                    ${card(remaining < 0 ? 'Over-invoiced' : 'Remaining to Invoice', Math.abs(remaining), remaining < 0 ? '#dc2626' : '#d97706', '')}
                </div>`;
        }


        container.innerHTML = `
            <style>
                .sum-th {
                    padding: 11px 14px;
                    font-size: 11.5px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.6px;
                    color: #52525b;
                    background: #f8fafc;
                    border-bottom: 1px solid rgba(0,0,0,0.08);
                    white-space: nowrap;
                    cursor: pointer;
                    user-select: none;
                }
                .sum-th:hover {
                    color: #004d2c;
                    background: #f1f5f9;
                }
                .sum-td {
                    padding: 12px 14px;
                    font-size: 13px;
                    color: #18181b;
                    border-bottom: 1px solid rgba(0,0,0,0.05);
                    vertical-align: middle;
                }
                .sum-row:hover {
                    background: rgba(0,77,44,0.02);
                }
                .sum-preset-btn {
                    padding: 6px 12px;
                    font-size: 11.5px;
                    font-weight: 600;
                    color: #52525b;
                    background: #f4f4f5;
                    border: 1px solid rgba(0,0,0,0.06);
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .sum-preset-btn:hover {
                    background: #e4e4e7;
                    color: #18181b;
                }
                .badge-settled {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 9px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    background: rgba(22,121,70,0.10);
                    color: #167946;
                    border: 1px solid rgba(22,121,70,0.20);
                }
                .badge-partial {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    background: rgba(217,119,6,0.10);
                    color: #b45309;
                    border: 1px solid rgba(217,119,6,0.20);
                }
                .badge-pending {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 3px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    font-weight: 700;
                    background: rgba(220,38,38,0.08);
                    color: #dc2626;
                    border: 1px solid rgba(220,38,38,0.18);
                }
            </style>

            <!-- Page Header -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
                <div>
                    <h1 style="font-size:22px; font-weight:800; color:#18181b; letter-spacing:-0.4px; margin:0 0 4px 0; display:flex; align-items:center;">
                        Summary
                    </h1>
                    <p style="font-size:13px; color:#71717a; margin:0;">Complete ledger of all invoices, payments received, and pending balances</p>
                </div>
                <div style="display:flex; align-items:center; gap:10px;">
                    <button type="button" class="btn" onclick="Summary.exportExcel()" style="padding:8px 14px; font-size:12.5px; font-weight:600; display:inline-flex; align-items:center; gap:6px; background:#fff; border:1px solid rgba(0,0,0,0.12); border-radius:8px; cursor:pointer;" title="Download report in Excel (.xlsx) format">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <span>Export</span>
                    </button>
                    <button type="button" class="btn" onclick="Summary.toggleFilters()" style="padding:8px 14px; font-size:12.5px; font-weight:600; display:inline-flex; align-items:center; gap:6px; background:${_filtersVisible ? '#004d2c' : '#fff'}; color:${_filtersVisible ? '#fff' : '#18181b'}; border:1px solid ${_filtersVisible ? '#004d2c' : 'rgba(0,0,0,0.12)'}; border-radius:8px; cursor:pointer;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        <span>Filter</span>
                        ${hasActiveFilters ? '<span style="width:7px; height:7px; border-radius:50%; background:#22c55e; display:inline-block;"></span>' : ''}
                    </button>
                </div>
            </div>

            <!-- Filters Bar -->
            <div id="sum-filters-wrapper" style="display:${_filtersVisible ? 'block' : 'none'}; margin-bottom:18px; padding:14px 16px; background:rgba(0,0,0,0.02); border:1px solid rgba(0,0,0,0.05); border-radius:12px;">
                <div class="dashboard-filters" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-start;">
                    <!-- Search Input -->
                    <div style="position:relative; width:240px;">
                        <input type="text" id="sum-filter-search" class="dashboard-filter-input" placeholder="Search Invoice No, Client..." 
                            oninput="Dashboard.keepFocus(Summary.applySearch.bind(null, this.value))" 
                            style="width:100%; box-sizing:border-box; font-size:13px;" value="${_escapeHtml(_search)}">
                    </div>

                    <!-- Timeline / Period Filter -->
                    <div>
                        <button type="button" onclick="Summary.openTimelinePopup()" 
                            style="display:flex; align-items:center; justify-content:space-between; gap:8px; height:38px; padding:0 12px; background:${_dateFilterMode !== 'all' ? 'rgba(0,77,44,0.08)' : '#fff'}; border:1px solid ${_dateFilterMode !== 'all' ? 'rgba(0,77,44,0.35)' : 'rgba(0,0,0,0.12)'}; border-radius:10px; font-size:12.5px; font-weight:600; color:${_dateFilterMode !== 'all' ? '#004d2c' : '#18181b'}; cursor:pointer; box-sizing:border-box; transition:all 0.15s; white-space:nowrap;"
                            title="Filter by Date, Month & Year Range, or Financial Year">
                            <span style="display:flex; align-items:center; gap:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto; color:${_dateFilterMode !== 'all' ? '#004d2c' : '#71717a'};"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escapeHtml(_getTimelineLabel())}</span>
                            </span>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto; opacity:0.6; margin-left:4px;"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                    </div>

                    <!-- Status Filter -->
                    <div class="custom-select-wrapper" style="width:145px;">
                        <div class="custom-select-trigger" style="justify-content:space-between; text-align:left; font-size:12.5px;">
                            <span>${_statusFilter === 'all' ? 'All Statuses' : (_statusFilter === 'settled' ? 'Settled' : (_statusFilter === 'partial' ? 'Partially Paid' : 'Pending'))}</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options">
                            <div class="custom-option${_statusFilter === 'all' ? ' selected' : ''}" data-value="all">All Statuses</div>
                            <div class="custom-option${_statusFilter === 'settled' ? ' selected' : ''}" data-value="settled">Settled</div>
                            <div class="custom-option${_statusFilter === 'partial' ? ' selected' : ''}" data-value="partial">Partially Paid</div>
                            <div class="custom-option${_statusFilter === 'pending' ? ' selected' : ''}" data-value="pending">Pending</div>
                        </div>
                        <input type="hidden" value="${_statusFilter}" onchange="Summary.setStatusFilter(this.value)">
                    </div>

                    <!-- Type Filter -->
                    <div class="custom-select-wrapper" style="width:140px;">
                        <div class="custom-select-trigger" style="justify-content:space-between; text-align:left; font-size:12.5px;">
                            <span>${_typeFilter === 'all' ? 'All Types' : (_typeFilter === 'domestic' ? 'Domestic' : 'International')}</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options">
                            <div class="custom-option${_typeFilter === 'all' ? ' selected' : ''}" data-value="all">All Types</div>
                            <div class="custom-option${_typeFilter === 'domestic' ? ' selected' : ''}" data-value="domestic">Domestic</div>
                            <div class="custom-option${_typeFilter === 'international' ? ' selected' : ''}" data-value="international">International</div>
                        </div>
                        <input type="hidden" value="${_typeFilter}" onchange="Summary.setTypeFilter(this.value)">
                    </div>

                    <!-- PO Number Filter -->
                    <div class="custom-select-wrapper searchable-select" data-search-placeholder="Search PO number..." data-options-width="280" style="width:170px;">
                        <div class="custom-select-trigger" style="justify-content:space-between; text-align:left; font-size:12.5px;">
                            <span>${_escapeHtml(_poFilter || 'All PO Numbers')}</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options roomy-options">
                            <div class="custom-option${_poFilter === '' ? ' selected' : ''}" data-value="">All PO Numbers</div>
                            ${poNumbers.map(p => `<div class="custom-option${_poFilter === p ? ' selected' : ''}" data-value="${_escapeHtml(p)}">${_escapeHtml(p)}</div>`).join('')}
                        </div>
                        <input type="hidden" value="${_escapeHtml(_poFilter)}" onchange="Summary.setPoFilter(this.value)">
                    </div>

                    <!-- Client Multi-Select -->
                    ${Dashboard.renderClientFilter('summary', { width: 170, anchor: 'right' })}

                    ${hasActiveFilters ? `
                        <button type="button" onclick="Summary.resetFilters()" style="background:transparent; border:none; color:#dc2626; font-size:12.5px; font-weight:600; cursor:pointer; padding:6px 8px;">
                            Clear filters
                        </button>
                    ` : ''}
                </div>
            </div>

            ${poSummaryHtml}

            <!-- Table Container -->
            <div style="background:#fff; border:1px solid rgba(0,0,0,0.07); border-radius:16px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.02);">
                <div style="overflow-x:auto;">
                    <table style="width:100%; border-collapse:collapse; text-align:left;">
                        <thead>
                            <tr>
                                <th class="sum-th" onclick="Summary.sortBy('invoiceNo')">Invoice No ${_sortIcon('invoiceNo')}</th>
                                <th class="sum-th" onclick="Summary.sortBy('date')">Date ${_sortIcon('date')}</th>
                                <th class="sum-th" onclick="Summary.sortBy('client')">Client ${_sortIcon('client')}</th>
                                <th class="sum-th" style="width:1%; white-space:nowrap;" title="Order Reference Number">Order Ref No.</th>
                                <th class="sum-th">Type</th>
                                <th class="sum-th" style="text-align:right;" onclick="Summary.sortBy('amount')">Amount ${_sortIcon('amount')}</th>
                                <th class="sum-th" style="text-align:right;" onclick="Summary.sortBy('receipt')">Receipt ${_sortIcon('receipt')}</th>
                                ${hasInternational ? `<th class="sum-th" style="text-align:right;" onclick="Summary.sortBy('exchangeDiff')">Exchange Loss/Gain ${_sortIcon('exchangeDiff')}</th>` : ''}
                                <th class="sum-th" style="text-align:right;" onclick="Summary.sortBy('pending')">Pending ${_sortIcon('pending')}</th>
                                <th class="sum-th" style="text-align:center; width:1%;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.length > 0 ? filtered.map(inv => _renderTableRow(inv, hasInternational)).join('') : _renderEmptyRow(hasInternational)}
                        </tbody>
                        ${tableFooterHtml}
                    </table>
                </div>
            </div>
        `;
    }

    function _sortIcon(col) {
        if (_sortBy !== col) return '<span style="opacity:0.25; margin-left:4px;">↕</span>';
        return _sortDir === 'asc'
            ? '<span style="color:#004d2c; margin-left:4px; font-weight:800;">↑</span>'
            : '<span style="color:#004d2c; margin-left:4px; font-weight:800;">↓</span>';
    }

    function _renderTableRow(inv, hasInternational) {
        const d = inv._details;
        const refNo = inv.refNumber || inv.invoiceNumber || '—';
        const client = inv.clientName || inv.consignorName || inv.client || '—';
        const dt = inv.date ? _formatDate(inv.date) : '—';
        const isDom = inv._type === 'domestic';

        const typeBadge = isDom
            ? '<span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(0,77,44,0.08); color:#004d2c;">Domestic</span>'
            : '<span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(37,99,235,0.08); color:#2563eb;">International</span>';

        // Format Pending Column: if fully settled show Settled text
        let pendingCellContent = '';
        if (d.isSettled) {
            pendingCellContent = `
                <div style="display:flex; justify-content:flex-end;">
                    <span class="badge-settled" title="Invoice fully paid">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Settled
                    </span>
                </div>`;
        } else if (d.isPartial) {
            pendingCellContent = `
                <div style="font-weight:700; color:#b45309; font-size:13px;">${_escapeHtml(PdfUtils.formatMoney(d.pendingINR, 'INR'))}</div>
                ${d.isForeign ? `<div style="font-size:11px; color:#b45309; font-weight:500; margin-top:1px;">${_escapeHtml(PdfUtils.formatMoney(d.pending, d.currency))}</div>` : ''}`;
        } else {
            pendingCellContent = `
                <div style="font-weight:700; color:#dc2626; font-size:13px;">${_escapeHtml(PdfUtils.formatMoney(d.pendingINR, 'INR'))}</div>
                ${d.isForeign ? `<div style="font-size:11px; color:#71717a; font-weight:500; margin-top:1px;">${_escapeHtml(PdfUtils.formatMoney(d.pending, d.currency))}</div>` : ''}`;
        }

        // Receipts Column
        let receiptCellContent = `
            <div style="font-weight:600; font-size:13px; color:${d.receivedINR > 0 ? '#18181b' : '#a1a1aa'};">
                ${_escapeHtml(PdfUtils.formatMoney(d.receivedINR, 'INR'))}
            </div>
            ${d.isForeign && d.received > 0 ? `<div style="font-size:11px; color:#71717a; font-weight:500; margin-top:2px;">${_escapeHtml(PdfUtils.formatMoney(d.received, d.currency))}</div>` : ''}`;

        // Exchange Loss / Gain Column
        let exchangeCellContent = '';
        if (!d.isForeign || !d.hasExchangeDiff) {
            exchangeCellContent = `<span style="color:#a1a1aa; font-weight:500;">—</span>`;
        } else if (d.exchangeDiff > 0.005) {
            exchangeCellContent = `<div style="font-weight:700; color:#167946; font-size:13px;">+${_escapeHtml(PdfUtils.formatMoney(d.exchangeDiff, 'INR'))}</div>`;
        } else if (d.exchangeDiff < -0.005) {
            exchangeCellContent = `<div style="font-weight:700; color:#dc2626; font-size:13px;">−${_escapeHtml(PdfUtils.formatMoney(Math.abs(d.exchangeDiff), 'INR'))}</div>`;
        } else {
            exchangeCellContent = `<div style="font-weight:600; color:#71717a; font-size:13px;">₹0.00</div>`;
        }

        return `
            <tr class="sum-row">
                <!-- 1. Invoice No -->
                <td class="sum-td" style="font-weight:700; white-space:nowrap;">
                    <a href="javascript:void(0)" onclick="Dashboard.viewPdf('INV', '${inv.id}')" style="color:#004d2c; text-decoration:none;" title="View Invoice PDF">
                        ${_escapeHtml(refNo)}
                    </a>
                </td>

                <!-- 2. Date -->
                <td class="sum-td" style="white-space:nowrap; color:#52525b;">${_escapeHtml(dt)}</td>

                <!-- 3. Client -->
                <td class="sum-td" style="font-weight:500; min-width:180px; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${_escapeHtml(client)}">
                    ${_escapeHtml(client)}
                </td>

                <!-- Order Reference Number (PO the invoice was raised against) -->
                <td class="sum-td" style="white-space:nowrap; color:#52525b;">${_escapeHtml(inv.poNumber || '—')}</td>

                <!-- 4. Type -->
                <td class="sum-td" style="white-space:nowrap;">${typeBadge}</td>

                <!-- 5. Amount (total invoice amount) -->
                <td class="sum-td" style="text-align:right; font-weight:700; white-space:nowrap;">
                    <div>${_escapeHtml(PdfUtils.formatMoney(d.totalINR, 'INR'))}</div>
                    ${d.isForeign ? `<div style="font-size:11px; color:#71717a; font-weight:500; margin-top:2px;">${_escapeHtml(PdfUtils.formatMoney(d.total, d.currency))}</div>` : ''}
                    ${d.credit > 0 ? `<div style="font-size:10.5px; color:#71717a; font-weight:500; margin-top:2px;">Net: ${_escapeHtml(PdfUtils.formatMoney(d.netBillableINR, 'INR'))}</div>` : ''}
                </td>

                <!-- 6. Receipt (how much receipt amount came or settled) -->
                <td class="sum-td" style="text-align:right; white-space:nowrap;">
                    ${receiptCellContent}
                </td>

                ${hasInternational ? `
                    <!-- 7. Exchange Loss/Gain -->
                    <td class="sum-td" style="text-align:right; white-space:nowrap;">
                        ${exchangeCellContent}
                    </td>
                ` : ''}

                <!-- 8. Pending (how much value is pending, or Settled text) -->
                <td class="sum-td" style="text-align:right; white-space:nowrap;">
                    ${pendingCellContent}
                </td>

                <!-- Actions -->
                <td class="sum-td" style="text-align:center; white-space:nowrap;">
                    <div style="display:inline-flex; align-items:center; gap:4px;">
                        <button type="button" class="btn-table-action" onclick="Dashboard.viewPdf('INV', '${inv.id}')" title="View PDF" style="padding:5px 7px; background:transparent; border:none; color:#52525b; border-radius:6px; cursor:pointer;" onmouseover="this.style.background='rgba(0,0,0,0.06)'" onmouseout="this.style.background='transparent'">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button type="button" class="btn-table-action" onclick="Dashboard.downloadPdf('INV', '${inv.id}')" title="Download PDF" style="padding:5px 7px; background:transparent; border:none; color:#52525b; border-radius:6px; cursor:pointer;" onmouseover="this.style.background='rgba(0,0,0,0.06)'" onmouseout="this.style.background='transparent'">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function _renderEmptyRow(hasInternational) {
        const span = hasInternational ? 10 : 9;
        return `
            <tr>
                <td colspan="${span}" style="text-align:center; padding:48px 16px; color:#71717a;">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 12px auto; display:block;"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                    <div style="font-size:14px; font-weight:600; color:#18181b; margin-bottom:4px;">No Invoices Found</div>
                    <div style="font-size:12.5px;">No invoices match the selected filter criteria.</div>
                </td>
            </tr>
        `;
    }

    function _formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return String(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = String(d.getDate()).padStart(2, '0');
        const m = months[d.getMonth()];
        const y = d.getFullYear();
        return `${day} ${m} ${y}`;
    }

    // --- Controls & Event Handlers ---

    function applySearch(val) {
        _search = val || '';
        currentPage = 1;
        render();
    }

    function setStatusFilter(val) {
        _statusFilter = val || 'all';
        currentPage = 1;
        render();
    }

    function setTypeFilter(val) {
        _typeFilter = val || 'all';
        currentPage = 1;
        render();
    }

    function setPoFilter(val) {
        _poFilter = val || '';
        currentPage = 1;
        render();
    }

    function toggleFilters() {
        _filtersVisible = !_filtersVisible;
        const el = document.getElementById('sum-filters-wrapper');
        if (el) el.style.display = _filtersVisible ? 'block' : 'none';
    }

    function resetFilters() {
        _search = '';
        _statusFilter = 'all';
        _typeFilter = 'all';
        _poFilter = '';
        _dateFilterMode = 'all';
        _filterStartDate = '';
        _filterEndDate = '';
        Dashboard.clearClientFilter('summary');
        currentPage = 1;
        render();
    }

    function openTimelinePopup() {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        _tempTab = _dateFilterMode === 'all' ? 'dates' : _dateFilterMode;

        if (_filterStartDate) {
            _tempStartDate = _filterStartDate;
        } else {
            _tempStartDate = `${yyyy}-${mm}-01`;
        }

        if (_filterEndDate) {
            _tempEndDate = _filterEndDate;
        } else {
            _tempEndDate = todayStr;
        }

        _tempStartMonth = _filterStartMonth || (today.getMonth() + 1);
        _tempStartYear = _filterStartYear || today.getFullYear();
        _tempEndMonth = _filterEndMonth || (today.getMonth() + 1);
        _tempEndYear = _filterEndYear || today.getFullYear();
        _tempSelectedFY = _filterSelectedFY || (_getAvailableFinancialYears()[0] || `${today.getFullYear()}-${String(today.getFullYear() + 1).slice(-2)}`);

        let overlay = document.getElementById('sum-timeline-popup-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'sum-timeline-popup-overlay';
        overlay.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:20000; align-items:center; justify-content:center; backdrop-filter:blur(3px);';
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTimelinePopup();
        });

        overlay.innerHTML = _timelinePopupHTML();
        document.body.appendChild(overlay);
    }

    function closeTimelinePopup() {
        const overlay = document.getElementById('sum-timeline-popup-overlay');
        if (overlay) overlay.remove();
    }

    function setTimelinePopupTab(tab) {
        _tempTab = tab;
        const overlay = document.getElementById('sum-timeline-popup-overlay');
        if (overlay) {
            overlay.innerHTML = _timelinePopupHTML();
        }
    }

    function updateTimelinePopupDates(startVal, endVal) {
        if (startVal !== null && startVal !== undefined) _tempStartDate = startVal;
        if (endVal !== null && endVal !== undefined) _tempEndDate = endVal;
        const showingEl = document.getElementById('sum-timeline-showing-text');
        if (showingEl) showingEl.textContent = _getTempShowingText();
    }

    function updateTimelinePopupMonths(type, val) {
        const num = parseInt(val, 10);
        if (isNaN(num)) return;
        if (type === 'startMonth') _tempStartMonth = num;
        else if (type === 'startYear') _tempStartYear = num;
        else if (type === 'endMonth') _tempEndMonth = num;
        else if (type === 'endYear') _tempEndYear = num;
        const showingEl = document.getElementById('sum-timeline-showing-text');
        if (showingEl) showingEl.textContent = _getTempShowingText();
    }

    function updateTimelinePopupFY(val) {
        if (val) _tempSelectedFY = val;
        const showingEl = document.getElementById('sum-timeline-showing-text');
        if (showingEl) showingEl.textContent = _getTempShowingText();
    }

    function applyTimelinePopup() {
        _dateFilterMode = _tempTab;
        if (_tempTab === 'dates') {
            _filterStartDate = _tempStartDate;
            _filterEndDate = _tempEndDate;
        } else if (_tempTab === 'months') {
            _filterStartMonth = _tempStartMonth;
            _filterStartYear = _tempStartYear;
            _filterEndMonth = _tempEndMonth;
            _filterEndYear = _tempEndYear;
        } else if (_tempTab === 'fy') {
            _filterSelectedFY = _tempSelectedFY;
        }
        currentPage = 1;
        closeTimelinePopup();
        render();
    }

    function applyAllTimeTimeline() {
        _dateFilterMode = 'all';
        _filterStartDate = '';
        _filterEndDate = '';
        currentPage = 1;
        closeTimelinePopup();
        render();
    }

    function _timelinePopupHTML() {
        const years = _getAvailableYears();
        const fys = _getAvailableFinancialYears();
        const monthNames = [
            { num: 1, name: 'Jan (01)' },
            { num: 2, name: 'Feb (02)' },
            { num: 3, name: 'Mar (03)' },
            { num: 4, name: 'Apr (04)' },
            { num: 5, name: 'May (05)' },
            { num: 6, name: 'Jun (06)' },
            { num: 7, name: 'Jul (07)' },
            { num: 8, name: 'Aug (08)' },
            { num: 9, name: 'Sep (09)' },
            { num: 10, name: 'Oct (10)' },
            { num: 11, name: 'Nov (11)' },
            { num: 12, name: 'Dec (12)' }
        ];

        let bodyContent = '';

        if (_tempTab === 'dates') {
            bodyContent = `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <!-- From and To Date Inputs -->
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:11px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.7px; display:block; margin-bottom:6px;">FROM DATE</label>
                            <input type="date" value="${_escapeHtml(_tempStartDate)}" 
                                onchange="Summary.updateTimelinePopupDates(this.value, null)"
                                style="width:100%; height:42px; padding:0 10px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; font-family:inherit;">
                        </div>
                        <div>
                            <label style="font-size:11px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.7px; display:block; margin-bottom:6px;">TO DATE</label>
                            <input type="date" value="${_escapeHtml(_tempEndDate)}" 
                                onchange="Summary.updateTimelinePopupDates(null, this.value)"
                                style="width:100%; height:42px; padding:0 10px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; font-family:inherit;">
                        </div>
                    </div>
                </div>
            `;
        } else if (_tempTab === 'months') {
            bodyContent = `
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.7px; display:block; margin-bottom:6px;">FROM (MONTH & YEAR)</span>
                        <div style="display:flex; gap:10px;">
                            <select onchange="Summary.updateTimelinePopupMonths('startMonth', this.value)"
                                style="flex:1.4; height:40px; padding:0 10px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; cursor:pointer;">
                                ${monthNames.map(m => `<option value="${m.num}" ${_tempStartMonth === m.num ? 'selected' : ''}>${m.name}</option>`).join('')}
                            </select>
                            <select onchange="Summary.updateTimelinePopupMonths('startYear', this.value)"
                                style="flex:1; height:40px; padding:0 10px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; cursor:pointer;">
                                ${years.map(y => `<option value="${y}" ${_tempStartYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.7px; display:block; margin-bottom:6px;">TO (MONTH & YEAR)</span>
                        <div style="display:flex; gap:10px;">
                            <select onchange="Summary.updateTimelinePopupMonths('endMonth', this.value)"
                                style="flex:1.4; height:40px; padding:0 10px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; cursor:pointer;">
                                ${monthNames.map(m => `<option value="${m.num}" ${_tempEndMonth === m.num ? 'selected' : ''}>${m.name}</option>`).join('')}
                            </select>
                            <select onchange="Summary.updateTimelinePopupMonths('endYear', this.value)"
                                style="flex:1; height:40px; padding:0 10px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; cursor:pointer;">
                                ${years.map(y => `<option value="${y}" ${_tempEndYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            `;
        } else if (_tempTab === 'fy') {
            bodyContent = `
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <div>
                        <span style="font-size:11px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.7px; display:block; margin-bottom:6px;">SELECT FINANCIAL YEAR</span>
                        <select onchange="Summary.updateTimelinePopupFY(this.value)"
                            style="width:100%; height:42px; padding:0 12px; background:#f4f4f5; border:1px solid rgba(0,0,0,0.08); border-radius:10px; font-size:13.5px; font-weight:600; color:#18181b; box-sizing:border-box; outline:none; cursor:pointer;">
                            ${fys.map(fy => `<option value="${fy}" ${_tempSelectedFY === fy ? 'selected' : ''}>Financial Year ${fy}</option>`).join('')}
                        </select>
                    </div>
                </div>
            `;
        }

        return `
            <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.08); border-radius:18px; width:430px; max-width:92vw; box-shadow:0 16px 48px rgba(0,0,0,0.18); text-align:left; font-family:'Inter', -apple-system, sans-serif; overflow:hidden;">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 22px; border-bottom:1px solid rgba(0,0,0,0.06);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#004d2c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <h3 style="font-size:16px; font-weight:700; color:#18181b; margin:0;">Filter Timeline / Period</h3>
                    </div>
                    <button type="button" onclick="Summary.closeTimelinePopup()" 
                        style="background:transparent; border:none; color:#a1a1aa; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; transition:all 0.15s;"
                        onmouseover="this.style.background='rgba(0,0,0,0.05)'; this.style.color='#18181b'" 
                        onmouseout="this.style.background='transparent'; this.style.color='#a1a1aa'">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <!-- Tabs -->
                <div style="padding:14px 22px 0 22px;">
                    <div style="display:flex; background:#f4f4f5; padding:3px; border-radius:10px; gap:3px;">
                        <button type="button" onclick="Summary.setTimelinePopupTab('dates')" 
                            style="flex:1; padding:7px 8px; font-size:12.5px; font-weight:700; border:none; border-radius:8px; cursor:pointer; transition:all 0.15s; ${_tempTab === 'dates' ? 'background:#fff; color:#18181b; box-shadow:0 1px 4px rgba(0,0,0,0.08);' : 'background:transparent; color:#71717a;'}">
                            Date Range
                        </button>
                        <button type="button" onclick="Summary.setTimelinePopupTab('months')" 
                            style="flex:1; padding:7px 8px; font-size:12.5px; font-weight:700; border:none; border-radius:8px; cursor:pointer; transition:all 0.15s; ${_tempTab === 'months' ? 'background:#fff; color:#18181b; box-shadow:0 1px 4px rgba(0,0,0,0.08);' : 'background:transparent; color:#71717a;'}">
                            Month & Year
                        </button>
                        <button type="button" onclick="Summary.setTimelinePopupTab('fy')" 
                            style="flex:1; padding:7px 8px; font-size:12.5px; font-weight:700; border:none; border-radius:8px; cursor:pointer; transition:all 0.15s; ${_tempTab === 'fy' ? 'background:#fff; color:#18181b; box-shadow:0 1px 4px rgba(0,0,0,0.08);' : 'background:transparent; color:#71717a;'}">
                            Financial Year
                        </button>
                    </div>
                </div>

                <!-- Body -->
                <div style="padding:18px 22px 14px 22px;">
                    ${bodyContent}

                    <!-- Active selection feedback -->
                    <div style="margin-top:16px; padding:9px 12px; background:rgba(0,77,44,0.05); border:1px solid rgba(0,77,44,0.12); border-radius:8px; font-size:12px; font-weight:500; color:#004d2c; display:flex; align-items:center; gap:6px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span>Selected: <strong id="sum-timeline-showing-text">${_escapeHtml(_getTempShowingText())}</strong></span>
                    </div>
                </div>

                <!-- Footer -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 22px; border-top:1px solid rgba(0,0,0,0.06); background:#fafafa;">
                    <button type="button" onclick="Summary.applyAllTimeTimeline()" 
                        style="background:transparent; border:none; color:#71717a; font-weight:600; cursor:pointer; font-size:13px; padding:6px 0; transition:color 0.15s;" 
                        onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color='#71717a'">
                        Show All Time
                    </button>
                    <div style="display:flex; gap:8px;">
                        <button type="button" onclick="Summary.closeTimelinePopup()" 
                            style="background:#f4f4f5; color:#52525b; font-weight:600; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:13px; transition:background 0.15s;"
                            onmouseover="this.style.background='#e4e4e7'" onmouseout="this.style.background='#f4f4f5'">
                            Cancel
                        </button>
                        <button type="button" onclick="Summary.applyTimelinePopup()" 
                            style="background:#004d2c; color:#fff; font-weight:700; border:none; padding:8px 18px; border-radius:8px; cursor:pointer; font-size:13px; box-shadow:0 2px 6px rgba(0,77,44,0.25); transition:background 0.15s;" 
                            onmouseover="this.style.background='#003d22'" onmouseout="this.style.background='#004d2c'">
                            Apply Filter
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    function sortBy(col) {
        if (_sortBy === col) {
            _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            _sortBy = col;
            _sortDir = col === 'date' ? 'desc' : 'asc';
        }
        currentPage = 1;
        render();
    }

    function changePage(p) {
        currentPage = p;
        render();
    }

    function changePageSize(sz) {
        pageSize = sz;
        currentPage = 1;
        render();
    }

    function exportExcel() {
        const allInvoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const allReceipts = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        const allReturns = (Storage.getAllSalesReturns && Storage.getAllSalesReturns()) || [];
        const clientSel = Dashboard.clientSelection('summary');
        const homeCur = 'INR';

        const processedList = allInvoices.map(inv => ({
            ...inv,
            _details: _calcInvoiceDetails(inv, allReceipts, allReturns),
            _type: _getInvoiceType(inv)
        }));

        const q = _search.trim().toLowerCase();
        const filtered = processedList.filter(item => {
            const party = (item.clientName || item.consignorName || item.client || '').trim();
            if (clientSel.size && !clientSel.has(party)) return false;
            if (_typeFilter !== 'all' && item._type !== _typeFilter) return false;
            if (_poFilter && (item.poNumber || '').trim().toLowerCase() !== _poFilter.toLowerCase()) return false;
            if (_statusFilter === 'settled' && !item._details.isSettled) return false;
            if (_statusFilter === 'pending' && item._details.status !== 'pending') return false;
            if (_statusFilter === 'partial' && !item._details.isPartial) return false;
            if (_dateFilterMode !== 'all') {
                const invDate = item.date;
                if (!invDate) return false;
                const { start, end } = _getActiveDateRange();
                if (start && invDate < start) return false;
                if (end && invDate > end) return false;
            }
            if (q) {
                const ref = String(item.refNumber || item.invoiceNumber || '').toLowerCase();
                const partyStr = party.toLowerCase();
                if (!ref.includes(q) && !partyStr.includes(q)) return false;
            }
            return true;
        });

        const hasInternational = filtered.some(item => item._type === 'international' || item._details.isForeign);
        const headers = ['Invoice No', 'Date', 'Client', 'Order Reference Number', 'Type', 'Amount (INR)', 'Bill Currency', 'Original Amount', 'Receipt (INR)', 'Original Receipt'];
        if (hasInternational) headers.push('Exchange Loss/Gain (INR)');
        headers.push('Pending (INR)', 'Original Pending', 'Status');

        const rows = [headers];

        let sumTotalINR = 0;
        let sumCreditINR = 0;
        let sumNetINR = 0;
        let sumReceivedINR = 0;
        let sumExchangeDiff = 0;
        let sumPendingINR = 0;

        filtered.forEach(item => {
            const inv = item;
            const d = item._details;
            sumTotalINR += d.totalINR;
            sumCreditINR += d.creditINR;
            sumNetINR += d.netBillableINR;
            sumReceivedINR += d.receivedINR;
            sumExchangeDiff += (d.exchangeDiff || 0);
            sumPendingINR += d.pendingINR;

            const rowData = [
                String(inv.refNumber || inv.invoiceNumber || ''),
                String(inv.date || ''),
                String(inv.clientName || inv.consignorName || inv.client || ''),
                String(inv.poNumber || ''),
                item._type === 'international' ? 'International' : 'Domestic',
                parseFloat(d.totalINR.toFixed(2)),
                String(d.currency),
                parseFloat(d.total.toFixed(2)),
                parseFloat(d.receivedINR.toFixed(2)),
                parseFloat(d.received.toFixed(2))
            ];
            if (hasInternational) {
                rowData.push(d.hasExchangeDiff ? parseFloat(d.exchangeDiff.toFixed(2)) : '');
            }
            rowData.push(
                parseFloat(d.pendingINR.toFixed(2)),
                parseFloat(d.pending.toFixed(2)),
                d.isSettled ? 'Settled' : (d.isPartial ? 'Partially Paid' : 'Pending')
            );
            rows.push(rowData);
        });

        sumTotalINR = Math.round(sumTotalINR * 100) / 100;
        sumCreditINR = Math.round(sumCreditINR * 100) / 100;
        sumNetINR = Math.round(sumNetINR * 100) / 100;
        sumReceivedINR = Math.round(sumReceivedINR * 100) / 100;
        sumExchangeDiff = Math.round(sumExchangeDiff * 100) / 100;
        sumPendingINR = Math.round(sumPendingINR * 100) / 100;

        if (filtered.length > 0) {
            const totRow = [
                'TOTAL', '', '', '', '',
                parseFloat(sumTotalINR.toFixed(2)),
                'INR',
                '',
                parseFloat(sumReceivedINR.toFixed(2)),
                ''
            ];
            if (hasInternational) {
                totRow.push(parseFloat(sumExchangeDiff.toFixed(2)));
            }
            totRow.push(
                parseFloat(sumPendingINR.toFixed(2)),
                '',
                sumPendingINR <= 0.005 ? 'Settled' : 'Pending'
            );
            rows.push(totRow);
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const xlsxLib = (typeof XLSX !== 'undefined') ? XLSX : (typeof window !== 'undefined' ? window.XLSX : null);

        if (xlsxLib && xlsxLib.utils) {
            const wb = xlsxLib.utils.book_new();
            const ws = xlsxLib.utils.aoa_to_sheet(rows);

            // Auto column widths
            const colWidths = headers.map((h, i) => {
                let maxLen = h.length;
                rows.forEach(row => {
                    if (row[i] !== undefined && row[i] !== null) {
                        const cellStr = String(row[i]);
                        if (cellStr.length > maxLen) maxLen = cellStr.length;
                    }
                });
                return { wch: Math.max(maxLen + 3, 10) };
            });
            ws['!cols'] = colWidths;

            xlsxLib.utils.book_append_sheet(wb, ws, 'Summary Report');
            xlsxLib.writeFile(wb, `Summary_Report_${dateStr}.xlsx`);
            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Summary report exported as Excel (.xlsx)', 'success');
            }
        } else {
            // Fallback to CSV if XLSX library is not loaded
            const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `Summary_Report_${dateStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Summary report exported as CSV', 'success');
            }
        }
    }

    return {
        render,
        applySearch,
        setStatusFilter,
        setTypeFilter,
        setPoFilter,
        toggleFilters,
        resetFilters,
        sortBy,
        changePage,
        changePageSize,
        exportExcel,
        exportCSV: exportExcel,
        openTimelinePopup,
        closeTimelinePopup,
        setTimelinePopupTab,
        updateTimelinePopupDates,
        updateTimelinePopupMonths,
        updateTimelinePopupFY,
        applyTimelinePopup,
        applyAllTimeTimeline,
        _getActiveDateRange,
        _getTimelineLabel,
        _calcInvoiceDetails
    };
})();

if (typeof window !== 'undefined') {
    window.Summary = Summary;
}
