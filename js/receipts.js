/* ============================================
   Receipts & Sales Returns Module
   --------------------------------------------
   - Receipt: record a payment received against an invoice (cash / cheque /
     bank). Bank payments pick from a managed list of receipt banks (add/delete).
   - Credit Note: record a credit raised against an invoice; surfaces in the
     "Sales Returns" dashboard. Keeps the invoice's own reference number.
   ============================================ */

const Receipts = (() => {

    // Working state for the currently-open receipt modal.
    let _rcp = null; // { editId, invId, invoiceRef, total, currency, clientName, amount, mode, chequeNumber, bankId, date }
    // Working state for the currently-open credit-note modal.
    let _crn = null; // { editId, invId, invoiceRef, total, currency, clientName, amount, reason, date }

    // Pagination state for the two dashboards.
    let _rcpPage = 1, _rcpPageSize = 10;
    let _retPage = 1, _retPageSize = 10;
    let _retGstFilter = 'all'; // 'all' | 'inclusive' | 'exclusive'
    let _retSearch = '';       // free-text quick search over the sales returns table

    // --- small helpers -------------------------------------------------------
    function _esc(str) {
        if (str === undefined || str === null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _money(amount, currency) {
        try { return PdfUtils.formatMoney(Number(amount) || 0, currency || 'INR'); }
        catch (e) { return String(Number(amount) || 0); }
    }

    function _todayISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _fmtDate(iso) {
        if (!iso) return '-';
        try { return PdfUtils.formatDateDMY(iso); } catch (e) { return iso; }
    }

    // Build the app's styled custom-select (matches the pagination / invoice
    // dropdowns) so our filters and pickers don't fall back to the raw browser
    // <select>. `options` = [{value, label}]; `onchange` is the JS run when a
    // value is picked (fired via the hidden input's change event). Pass
    // `floating: true` for dropdowns inside a modal so the list renders as a
    // fixed layer and isn't clipped by the card's overflow.
    function _customSelect(options, selected, onchange, width, floating, id, searchable) {
        const sel = options.find(o => String(o.value) === String(selected)) || options[0] || { value: '', label: '' };
        const opts = options.map(o =>
            `<div class="custom-option${String(o.value) === String(selected) ? ' selected' : ''}" data-value="${_esc(String(o.value))}">${_esc(o.label)}</div>`
        ).join('');
        return `
            <div class="custom-select-wrapper${floating ? ' floating-select' : ''}${searchable ? ' searchable-select' : ''}" style="width:${width || '100%'};">
                <div class="custom-select-trigger" style="justify-content:space-between; text-align:left;">
                    <span>${_esc(sel.label)}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options">${opts}</div>
                <input type="hidden"${id ? ` id="${id}"` : ''} value="${_esc(String(selected))}" onchange="${onchange || ''}">
            </div>`;
    }

    // Reporting departments — same list the invoice offers (reference only).
    const _RCP_DEPARTMENTS = ['Engineering', 'Consulting', 'Projects', 'Support'];

    // Sum of payments already recorded against an invoice (excludes the one
    // being edited, if any).
    function _receivedSoFar(invId, excludeId) {
        return Storage.getAllReceipts()
            .filter(r => r.invoiceId === invId && r.id !== excludeId)
            .reduce((s, r) => s + (Number(r.amountReceived) || 0), 0);
    }

    // ========================================================================
    // Generic overlay
    // ========================================================================
    function _closeOverlay() {
        const ov = document.getElementById('receipts-overlay');
        if (ov) ov.remove();
    }

    function _openOverlay(innerHTML, maxWidth = '520px', opts = {}) {
        _closeOverlay();
        const center = opts && opts.center;
        const ov = document.createElement('div');
        ov.id = 'receipts-overlay';
        const align = center ? 'center' : 'flex-start';
        const bg = center
            ? 'background:rgba(15,23,42,0.55); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);'
            : 'background:rgba(0,0,0,0.45);';
        ov.style.cssText = `position:fixed; inset:0; ${bg} z-index:16000; display:flex; align-items:${align}; justify-content:center; overflow-y:auto; padding:40px 16px;`;
        const cardShadow = center ? '0 30px 80px rgba(0,0,0,0.35)' : '0 20px 60px rgba(0,0,0,0.25)';
        ov.innerHTML = `
            <div style="background:#fff; border-radius:18px; width:100%; max-width:${maxWidth}; box-shadow:${cardShadow}; overflow:hidden; margin:auto; transition: max-width 0.22s ease-in-out;">
                ${innerHTML}
            </div>`;
        // Intentionally NOT closing on backdrop click — the modal only closes via its
        // Close / Cancel button (prevents accidental data loss while filling a form).
        document.body.appendChild(ov);
        return ov;
    }

    // ========================================================================
    // RECEIPT
    // ========================================================================
    function openReceiptModal(invId) {
        const inv = Storage.getInvoice(invId);
        if (!inv) { App.showToast('Invoice not found', 'error'); return; }

        const prior = _receivedSoFar(invId);
        const total = Number(inv.grandTotal) || 0;
        
        if (total > 0 && prior >= total) {
            const clearedDate = _getInvoiceClearedDate(invId);
            const receivedInHome = _receivedForInvoiceInHomeCurrency(invId);
            const remaining = Math.max(0, total - prior);
            const forexDiff = _calculateForexGainLossForInvoice(inv);
            
            _renderClearedInvoicePopup(inv, clearedDate, receivedInHome, remaining, forexDiff);
            return;
        }

        _rcp = {
            editId: null,
            invId,
            invoiceRef: inv.refNumber || '',
            total,
            currency: inv.currency || (Storage.getOrgInfo().defaultCurrency || 'INR'),
            clientName: inv.clientName || '',
            amount: '',
            mode: 'cash',
            chequeNumber: '',
            bankId: '',
            date: _todayISO(),
            remarks: '',
            addingBank: false,
            bookingRate: '',
            bankCharges: '',
            bankChargesType: 'amount',
            amountInINR: ''
        };

        _renderReceiptModal();
    }

    // Edit an existing receipt — same modal, prefilled, save overwrites the record.
    function editReceipt(id) {
        const r = Storage.getReceipt(id);
        if (!r) { App.showToast('Receipt not found', 'error'); return; }
        // Advance receipts (not tied to an invoice) use the dedicated advance
        // modal so add + edit share the exact same popup.
        if (r.isAdvance || !r.invoiceId) { editAdvanceReceipt(id, r); return; }
        _rcp = {
            editId: id,
            invId: r.invoiceId,
            invoiceRef: r.invoiceRef || '',
            total: Number(r.invoiceTotal) || 0,
            currency: r.currency || (Storage.getOrgInfo().defaultCurrency || 'INR'),
            clientName: r.clientName || '',
            amount: r.amountReceived,
            mode: r.mode || 'cash',
            chequeNumber: r.chequeNumber || '',
            bankId: r.bankId || '',
            date: r.date || _todayISO(),
            remarks: r.remarks || '',
            addingBank: false,
            bookingRate: r.bookingRate || '',
            bankCharges: r.bankCharges || '',
            bankChargesType: r.bankChargesType || 'amount',
            amountInINR: r.amountInINR || ''
        };
        _renderReceiptModal();
    }

    function _renderReceiptModal() {
        const prior = _receivedSoFar(_rcp.invId, _rcp.editId);
        const outstanding = _rcp.total - prior;
        const editing = !!_rcp.editId;

        _openOverlay(`
            <div style="padding:20px 24px; border-bottom:1px solid rgba(0,0,0,0.07); display:flex; align-items:center; justify-content:space-between;">
                <div>
                    <div style="font-size:17px; font-weight:800; color:#18181b;">${editing ? 'Edit Receipt' : 'Record Receipt'}</div>
                    <div style="font-size:12px; color:#71717a; margin-top:2px;">Invoice ${_esc(_rcp.invoiceRef)}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <label style="font-size:12px; font-weight:600; color:#52525b; margin:0; white-space:nowrap;">Date:</label>
                    <input id="rcp-date" type="date" max="9999-12-31" value="${_rcp.date}"
                        style="padding:6px 10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13px; width:140px; background:#fff;">
                </div>
            </div>
            <div style="padding:18px 24px;">
                <div style="background:rgba(0,77,44,0.06); border:1px solid rgba(0,77,44,0.12); border-radius:10px; padding:14px 16px; margin-bottom:18px;">
                    <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
                        <span style="color:#71717a;">Total amount of this invoice</span>
                        <span style="font-weight:800; color:#18181b;">${_money(_rcp.total, _rcp.currency)}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:#71717a;">
                        <span>Already received${editing ? ' (excl. this)' : ''}</span><span>${_money(prior, _rcp.currency)}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:${outstanding > 0 ? '#f37b21' : '#0a7a4a'}; margin-top:4px;">
                        <span>Outstanding</span><span style="font-weight:700;">${_money(outstanding, _rcp.currency)}</span>
                    </div>
                </div>

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">How much did you receive? <span style="color:#ef4444;">*</span></label>
                <div style="position:relative; width:100%; margin-bottom:14px;">
                    <input id="rcp-amount" type="number" min="0" step="0.01" value="${_rcp.amount === '' ? '' : _rcp.amount}" placeholder="Enter amount received"
                        oninput="Receipts._setAmount(this.value)"
                        style="width:100%; padding:10px 125px 10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; box-sizing:border-box;">
                    <button type="button" onclick="Receipts._fillOutstanding(${outstanding})"
                        style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:#004d2c; color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:background 0.15s;"
                        onmouseover="this.style.background='#00331e'" onmouseout="this.style.background='#004d2c'">
                        ${prior === 0 ? 'add total' : 'add outstanding'}
                    </button>
                </div>

                ${_rcp.currency !== 'INR' ? `
                <style>
                .charges-type-inline-select .custom-select-trigger {
                    border: none !important;
                    background: transparent !important;
                    height: 100% !important;
                    padding: 0 8px 0 12px !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                }
                .charges-type-inline-select .custom-options {
                    right: 0 !important;
                    left: auto !important;
                    width: 80px !important;
                }
                </style>
                <div style="background:rgba(243,123,33,0.02); border:1px solid rgba(243,123,33,0.12); border-radius:12px; padding:16px; margin-bottom:18px; box-shadow:0 2px 8px rgba(243,123,33,0.02);">
                    <div style="font-size:11.5px; font-weight:800; color:#f37b21; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
                        <span style="width:5px; height:5px; border-radius:50%; background:#f37b21; display:inline-block;"></span>
                        International Exchange Details
                    </div>
                    <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                        <div style="flex:1; min-width:110px;">
                            <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Booking Rate</label>
                            <input id="rcp-booking-rate" type="number" min="0" step="any" value="${_rcp.bookingRate || ''}" placeholder="e.g. 83.50"
                                oninput="Receipts._setBookingRate(this.value)"
                                style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13.5px; background:#fff; box-sizing:border-box; height:38px;">
                        </div>
                        <div style="flex:1.5; min-width:180px;">
                            <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Bank Charges</label>
                            <div class="charges-type-inline-select" style="position:relative; width:100%; height:38px;">
                                <input id="rcp-bank-charges" type="number" min="0" step="any" value="${_rcp.bankCharges || ''}" placeholder="Charges"
                                    oninput="Receipts._setBankCharges(this.value)"
                                    style="width:100%; padding:10px 80px 10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13.5px; background:#fff; box-sizing:border-box; margin:0; height:38px;">
                                <div style="position:absolute; right:1px; top:1px; bottom:1px; width:70px; display:flex; align-items:center; border-left:1px solid rgba(0,0,0,0.15); background:#f4f4f5; border-top-right-radius:7px; border-bottom-right-radius:7px;">
                                    ${_customSelect([{ value: 'amount', label: 'INR' }, { value: 'percent', label: '%' }], _rcp.bankChargesType, "Receipts._setBankChargesType(this.value)", '100%', false, 'rcp-bank-charges-type')}
                                </div>
                            </div>
                        </div>
                        <div style="flex:1; min-width:125px;">
                            <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Amount in INR</label>
                            <input id="rcp-amount-inr" type="number" min="0" step="any" value="${_rcp.amountInINR || ''}" placeholder="INR Value"
                                oninput="Receipts._setAmountInINR(this.value)"
                                style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13.5px; background:#f4f4f5; font-weight:700; box-sizing:border-box; color:#18181b; height:38px;">
                        </div>
                    </div>
                </div>
                ` : ''}

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Received via <span style="color:#ef4444;">*</span></label>
                <div id="rcp-mode-row" style="display:flex; gap:8px; margin-bottom:14px;">
                    ${_modeBtn('cash', 'Cash')}
                    ${_modeBtn('cheque', 'Cheque')}
                    ${_modeBtn('bank', 'Bank')}
                </div>

                <div id="rcp-mode-detail" style="height:84px; max-height:84px; overflow-y:auto; padding:6px 12px; border:1px solid rgba(0,0,0,0.08); border-radius:10px; background:rgba(0,0,0,0.015); box-sizing:border-box; margin-bottom:14px;"></div>

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Remarks</label>
                <textarea id="rcp-remarks" rows="2" placeholder="Optional notes about this receipt"
                    oninput="Receipts._setRemarks(this.value)"
                    style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; margin-bottom:14px; resize:vertical;">${_esc(_rcp.remarks)}</textarea>
            </div>
            <div style="padding:16px 24px; display:flex; justify-content:flex-end; gap:10px;">
                <button onclick="Receipts._close()" class="btn btn-secondary">Cancel</button>
                <button onclick="Receipts.saveReceipt()" class="btn btn-primary">${editing ? 'Update Receipt' : 'Save Receipt'}</button>
            </div>
        `, '1350px');

        _renderModeDetail();
    }

    function _recalculateAmountInINR() {
        if (!_rcp || _rcp.currency === 'INR') return;
        
        const amtEl = document.getElementById('rcp-amount');
        const rateEl = document.getElementById('rcp-booking-rate');
        const chargesEl = document.getElementById('rcp-bank-charges');
        const typeEl = document.getElementById('rcp-bank-charges-type');
        const inrEl = document.getElementById('rcp-amount-inr');
        
        if (!inrEl) return;
        
        const amt = amtEl ? parseFloat(amtEl.value) || 0 : 0;
        const rate = rateEl ? parseFloat(rateEl.value) || 0 : 0;
        const charges = chargesEl ? parseFloat(chargesEl.value) || 0 : 0;
        const type = typeEl ? typeEl.value : 'amount';
        
        let bankChargesINR = charges;
        if (type === 'percent') {
            bankChargesINR = amt * rate * (charges / 100);
        }
        
        const inrVal = (amt * rate) - bankChargesINR;
        
        _rcp.amountInINR = inrVal > 0 ? inrVal.toFixed(2) : '0.00';
        inrEl.value = _rcp.amountInINR;
    }

    function _setBookingRate(v) { 
        if (_rcp) _rcp.bookingRate = v; 
        _recalculateAmountInINR();
    }
    function _setBankCharges(v) { 
        if (_rcp) _rcp.bankCharges = v; 
        _recalculateAmountInINR();
    }
    function _setAmountInINR(v) { 
        if (_rcp) _rcp.amountInINR = v; 
    }
    function _setBankChargesType(v) {
        if (_rcp) _rcp.bankChargesType = v;
        _recalculateAmountInINR();
    }

    function _modeBtn(mode, label) {
        const active = _rcp && _rcp.mode === mode;
        return `<button type="button" onclick="Receipts._setMode('${mode}')"
            style="flex:1; padding:10px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
            border:1px solid ${active ? '#004d2c' : 'rgba(0,0,0,0.15)'};
            background:${active ? 'rgba(0,77,44,0.08)' : '#fff'};
            color:${active ? '#004d2c' : '#52525b'};">${label}</button>`;
    }

    function _setAmount(v) { 
        if (_rcp) _rcp.amount = v; 
        _recalculateAmountInINR();
    }
    function _fillOutstanding(v) {
        if (!_rcp) return;
        _rcp.amount = v > 0 ? v : 0;
        const el = document.getElementById('rcp-amount');
        if (el) el.value = _rcp.amount;
        _recalculateAmountInINR();
    }

    function _setMode(mode) {
        if (!_rcp) return;
        _rcp.mode = mode;
        // Re-paint the mode buttons + detail section.
        const row = document.getElementById('rcp-mode-row');
        if (row) row.innerHTML = _modeBtn('cash', 'Cash') + _modeBtn('cheque', 'Cheque') + _modeBtn('bank', 'Bank');
        _renderModeDetail();
    }

    function _closeSubOverlay() {
        const ov = document.getElementById('receipts-suboverlay');
        if (ov) ov.remove();
    }

    function _getUnsettledInvoicesForClient(clientName, currentInvId) {
        const allInvs = Storage.getAllInvoices() || [];
        return allInvs.filter(inv => {
            if (inv.clientName !== clientName) return false;
            if (inv.id === currentInvId) return false;
            
            const total = Number(inv.grandTotal) || 0;
            if (total <= 0) return false;
            
            const received = _receivedSoFar(inv.id);
            return received < total;
        });
    }

    function _handleOverpayment(amount, outstanding) {
        const remaining = amount - outstanding;
        const currency = _rcp.currency;
        const clientName = _rcp.clientName;
        const formattedRemaining = _money(remaining, currency);
        const formattedOutstanding = _money(outstanding, currency);
        
        const unsettledInvoices = _getUnsettledInvoicesForClient(clientName, _rcp.invId);
        
        let pastInvoicesOptionsHtml = '';
        if (unsettledInvoices.length > 0) {
            pastInvoicesOptionsHtml = `
                <div style="margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 16px;">
                    <div style="font-size: 13px; font-weight: 700; color: #52525b; margin-bottom: 10px;">Option 2: Apply to a Past Invoice</div>
                    <div style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto; padding-right: 4px;">
                        ${unsettledInvoices.map(inv => {
                            const invTotal = Number(inv.grandTotal) || 0;
                            const invReceived = _receivedSoFar(inv.id);
                            const invOutstanding = Math.max(0, invTotal - invReceived);
                            return `
                                <button type="button" onclick="Receipts._applyOverpaymentToPastInvoice('${inv.id}', ${outstanding}, ${remaining}, '${_esc(inv.refNumber)}')"
                                    style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; background: #fff; cursor: pointer; text-align: left; transition: all 0.15s;"
                                    onmouseover="this.style.background='rgba(0,77,44,0.04)'; this.style.borderColor='#004d2c';"
                                    onmouseout="this.style.background='#fff'; this.style.borderColor='rgba(0,0,0,0.12)';">
                                    <div>
                                        <div style="font-size: 13px; font-weight: 700; color: #18181b;">${_esc(inv.refNumber)}</div>
                                        <div style="font-size: 11px; color: #71717a; margin-top: 2px;">Date: ${inv.date ? PdfUtils.formatDateDMY(inv.date) : '—'}</div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-size: 13px; font-weight: 700; color: #b45309;">${_money(invOutstanding, inv.currency)}</div>
                                        <div style="font-size: 10px; color: #a1a1aa; margin-top: 2px;">Outstanding</div>
                                    </div>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            pastInvoicesOptionsHtml = `
                <div style="margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 16px; text-align: center; color: #71717a; font-size: 13px;">
                    <em>This client has no other past unsettled invoices.</em>
                </div>
            `;
        }

        const html = `
            <div style="padding: 20px 24px; border-bottom: 1px solid rgba(0,0,0,0.07); display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <div style="font-size: 16px; font-weight: 800; color: #18181b;">Handle Overpayment</div>
                    <div style="font-size: 12px; color: #ef4444; margin-top: 2px; font-weight: 600;">Amount exceeds outstanding by ${formattedRemaining}</div>
                </div>
                <button type="button" onclick="Receipts._closeSubOverlay()" style="border:none; background:transparent; font-size: 18px; color: #71717a; cursor: pointer;">&times;</button>
            </div>
            <div style="padding: 20px 24px;">
                <p style="font-size: 13.5px; color: #52525b; line-height: 1.5; margin: 0 0 16px 0;">
                    You are recording a receipt of <strong>${_money(amount, currency)}</strong>, which is greater than the outstanding balance of <strong>${formattedOutstanding}</strong> for Invoice ${_esc(_rcp.invoiceRef)}.
                </p>
                <div style="background: rgba(0,77,44,0.04); border: 1px solid rgba(0,77,44,0.08); border-radius: 10px; padding: 12px 14px; font-size: 13px; margin-bottom: 18px;">
                    <div style="color: #27272a; font-weight: 600; display: flex; justify-content: space-between;">
                        <span>To apply to this Invoice:</span>
                        <span>${formattedOutstanding}</span>
                    </div>
                    <div style="color: #ef4444; font-weight: 700; display: flex; justify-content: space-between; margin-top: 4px;">
                        <span>Remaining Balance:</span>
                        <span>${formattedRemaining}</span>
                    </div>
                </div>
                
                <div>
                    <div style="font-size: 13px; font-weight: 700; color: #52525b; margin-bottom: 8px;">Option 1: Save Balance as Advance</div>
                    <button type="button" onclick="Receipts._applyOverpaymentAsAdvance(${outstanding}, ${remaining})"
                        style="width: 100%; padding: 10px 14px; background: #004d2c; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; justify-content: space-between; transition: background 0.15s;"
                        onmouseover="this.style.background='#003d22'" onmouseout="this.style.background='#004d2c'">
                        <span>Save ${formattedRemaining} as Advance Receipt</span>
                        <span>&rarr;</span>
                    </button>
                </div>

                ${pastInvoicesOptionsHtml}
            </div>
            <div style="padding: 14px 24px; border-top: 1px solid rgba(0,0,0,0.07); display: flex; justify-content: flex-end; background: #f9fafb;">
                <button type="button" onclick="Receipts._closeSubOverlay()" class="btn btn-secondary">Cancel</button>
            </div>
        `;
        _openSubOverlay(html, '480px');
    }

    function _compileReceiptObject(amount, invoiceId, invoiceRef, isAdvance, customReceiptNumber) {
        const dateEl = document.getElementById('rcp-date');
        const date = dateEl && dateEl.value ? dateEl.value : _todayISO();
        
        const remarksEl = document.getElementById('rcp-remarks');
        let remarks = remarksEl ? (remarksEl.value || '') : (_rcp.remarks || '');
        if (isAdvance) {
            remarks = `Advance receipt split from Invoice overpayment of ${_rcp.invoiceRef}. ` + remarks;
        } else if (invoiceId && invoiceId !== _rcp.invId) {
            remarks = `Receipt split from Invoice overpayment of ${_rcp.invoiceRef}. ` + remarks;
        }

        let receiptNumber = customReceiptNumber;
        let id = undefined;
        if (!receiptNumber) {
            if (_rcp.editId && !isAdvance && invoiceId === _rcp.invId) {
                id = _rcp.editId;
                const existing = Storage.getReceipt(_rcp.editId);
                receiptNumber = existing ? existing.receiptNumber : '';
            } else {
                const fy = Storage.getFinancialYear(date);
                const fyShort = Storage.getFinancialYearShort(date);
                const serial = Storage.incrementSerialNumber('RCP', '', fy);
                receiptNumber = `${Storage.getOrgInfo().serialPrefix}/RCP/${String(serial).padStart(4, '0')}/${fyShort}`;
            }
        }

        const bank = _rcp.mode === 'bank' ? Storage.getReceiptBank(_rcp.bankId) : null;
        
        let bookingRate = '';
        let bankCharges = '';
        let bankChargesType = 'amount';
        let amountInINR = '';
        
        if (_rcp.currency !== 'INR') {
            const bookingRateEl = document.getElementById('rcp-booking-rate');
            const bankChargesEl = document.getElementById('rcp-bank-charges');
            const bankChargesTypeEl = document.getElementById('rcp-bank-charges-type');
            const amountInInrEl = document.getElementById('rcp-amount-inr');
            
            const origAmt = Number(_rcp.amount) || 0;
            const ratio = origAmt > 0 ? (amount / origAmt) : 0;
            
            bookingRate = bookingRateEl ? (bookingRateEl.value || '').trim() : '';
            
            const origCharges = bankChargesEl ? parseFloat(bankChargesEl.value) || 0 : 0;
            bankChargesType = bankChargesTypeEl ? (bankChargesTypeEl.value || 'amount').trim() : 'amount';
            if (bankChargesType === 'amount') {
                bankCharges = String(Math.round(origCharges * ratio * 100) / 100);
            } else {
                bankCharges = String(origCharges);
            }
            
            const origInr = amountInInrEl ? parseFloat(amountInInrEl.value) || 0 : 0;
            amountInINR = String(Math.round(origInr * ratio * 100) / 100);
        }

        return {
            id,
            invoiceId,
            invoiceRef,
            isAdvance,
            clientType: _rcp.clientType || (_rcp.currency === 'INR' ? 'domestic' : 'international'),
            receiptNumber,
            date,
            invoiceTotal: invoiceId ? (Number(Storage.getInvoice(invoiceId)?.grandTotal) || 0) : 0,
            amountReceived: amount,
            currency: _rcp.currency,
            clientName: _rcp.clientName,
            mode: _rcp.mode,
            chequeNumber: _rcp.mode === 'cheque' ? (_rcp.chequeNumber || '') : '',
            bankId: bank ? bank.id : '',
            bankName: bank ? bank.bankName : '',
            bankAccount: bank ? bank.accountNumber : '',
            bankIfsc: bank ? bank.ifsc : '',
            bankBranch: bank ? bank.branch : '',
            remarks: remarks.trim(),
            bookingRate,
            bankCharges,
            bankChargesType,
            amountInINR
        };
    }

    function _applyOverpaymentAsAdvance(outstanding, remaining) {
        const mainReceipt = _compileReceiptObject(outstanding, _rcp.invId, _rcp.invoiceRef, false);
        const advReceipt = _compileReceiptObject(remaining, null, '', true);
        Storage.saveReceiptsBatch([mainReceipt, advReceipt]);
        
        _closeSubOverlay();
        _closeOverlay();
        App.showToast(`Saved outstanding as receipt, and ${remaining} as Advance Receipt`, 'success');
        
        if (typeof renderReceipts === 'function') renderReceipts();
        if (typeof Dashboard !== 'undefined' && Dashboard.render) Dashboard.render();
    }

    function _applyOverpaymentToPastInvoice(pastInvoiceId, outstanding, remaining, pastInvoiceRef) {
        const mainReceipt = _compileReceiptObject(outstanding, _rcp.invId, _rcp.invoiceRef, false);
        const pastReceipt = _compileReceiptObject(remaining, pastInvoiceId, pastInvoiceRef, false);
        Storage.saveReceiptsBatch([mainReceipt, pastReceipt]);
        
        _closeSubOverlay();
        _closeOverlay();
        App.showToast(`Saved outstanding as receipt, and applied ${remaining} to Invoice ${pastInvoiceRef}`, 'success');
        
        if (typeof renderReceipts === 'function') renderReceipts();
        if (typeof Dashboard !== 'undefined' && Dashboard.render) Dashboard.render();
    }

    function _openSubOverlay(innerHTML, maxWidth = '520px') {
        _closeSubOverlay();
        const ov = document.createElement('div');
        ov.id = 'receipts-suboverlay';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.4); backdrop-filter:blur(3px); z-index:17000; display:flex; align-items:center; justify-content:center; padding:40px 16px; font-family:\'Inter\', -apple-system, sans-serif;';
        
        ov.innerHTML = `
            <div style="background:#fff; border-radius:18px; width:100%; max-width:${maxWidth}; box-shadow:0 25px 70px rgba(0,0,0,0.3); overflow:hidden; margin:auto;">
                ${innerHTML}
            </div>`;
        document.body.appendChild(ov);
        return ov;
    }

    function _getInvoiceClearedDate(invId) {
        const rcs = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        const invoiceReceipts = rcs.filter(r => r.invoiceId === invId);
        if (invoiceReceipts.length === 0) return '—';
        
        invoiceReceipts.sort((a, b) => new Date(a.date) - new Date(b.date));
        const latestReceipt = invoiceReceipts[invoiceReceipts.length - 1];
        return latestReceipt.date ? PdfUtils.formatDateDMY(latestReceipt.date) : '—';
    }

    // The rupees a receipt actually brought in: the INR value entered on the
    // receipt when there is one, else the forex amount at its booking rate less
    // bank charges. A home-currency receipt is already in rupees.
    function _receiptReceivedINR(r) {
        if (!r) return 0;
        if (r.currency === 'INR') return Number(r.amountReceived) || 0;

        const entered = Number(r.amountInINR);
        if (entered > 0) return entered;

        const bkRate = Number(r.bookingRate);
        if (!(bkRate > 0)) return 0;
        let charges = Number(r.bankCharges) || 0;
        if (r.bankChargesType === 'percent') {
            charges = (Number(r.amountReceived) || 0) * bkRate * (charges / 100);
        }
        return Math.max(0, (Number(r.amountReceived) || 0) * bkRate - charges);
    }

    // An invoice is closed once the user confirms no further money is coming in.
    // Until then a part payment's shortfall is just an unpaid balance, so no
    // exchange gain or loss is realised yet.
    function _isForexClosed(inv) {
        return !!(inv && inv.forexClosed);
    }

    // A receipt row's rupee figures. `diff` is the exchange gain (+) or loss (-)
    // realised by this receipt: what the money was actually worth in rupees,
    // against what the forex received was worth at the rate the invoice was booked
    // at. It stays null until the invoice is closed — and null always for rupee
    // receipts, which carry no exchange exposure. `closable` marks the rows whose
    // invoice could be closed, so the row menu can offer it.
    function _receiptINR(r) {
        const isForex = (r.currency || 'INR') !== 'INR';
        if (!isForex) {
            return { isForex, invoiceTotalINR: null, receivedINR: null, diff: null, closed: false, closable: false };
        }

        const inv = (r.invoiceId && Storage.getInvoice) ? Storage.getInvoice(r.invoiceId) : null;
        const invRate = parseFloat(inv && inv.exchangeRate) || 0;
        const receivedINR = _receiptReceivedINR(r);
        const closed = _isForexClosed(inv);

        return {
            isForex,
            invoiceTotalINR: invRate > 0 ? (Number(r.invoiceTotal) || 0) * invRate : null,
            receivedINR,
            diff: (closed && invRate > 0) ? receivedINR - (Number(r.amountReceived) || 0) * invRate : null,
            closed,
            closable: !!inv && invRate > 0
        };
    }

    // Realised exchange differences, one entry per closed foreign-currency
    // invoice. A gain is other income, a loss is expenditure; both are reported,
    // and neither is netted off turnover. Dated by the day the invoice was closed,
    // since that is when the difference is realised.
    function otherIncomeEntries() {
        const invoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        return invoices.filter(inv => _isForexClosed(inv) && (parseFloat(inv.exchangeRate) || 0) > 0)
            .map(inv => {
                const diff = _calculateForexGainLossForInvoice(inv);
                return {
                    invoiceId: inv.id,
                    invoiceRef: inv.refNumber || '',
                    clientName: inv.clientName || '',
                    currency: inv.currency || 'INR',
                    date: inv.forexClosedAt || inv.date || '',
                    mode: (inv.mode === 'international' || /\/INT(\/|\d)/i.test(inv.refNumber || '')) ? 'international' : 'domestic',
                    gain: diff > 0 ? diff : 0,
                    loss: diff < 0 ? -diff : 0,
                    amount: diff
                };
            })
            .filter(e => e.amount !== 0);
    }

    // Confirm before closing: closing realises the exchange gain or loss, which
    // then counts as other income (gain) or expenditure (loss).
    function closeInvoiceForex(receiptId) {
        const r = Storage.getReceipt(receiptId);
        const inv = r && r.invoiceId ? Storage.getInvoice(r.invoiceId) : null;
        if (!inv) { App.showToast('Linked invoice not found', 'error'); return; }

        const rate = parseFloat(inv.exchangeRate) || 0;
        if (!(rate > 0)) { App.showToast('This invoice has no exchange rate recorded', 'error'); return; }

        const cur = inv.currency || 'INR';
        const billed = Number(inv.grandTotal) || 0;
        const receivedForex = (Storage.getAllReceipts() || [])
            .filter(x => x.invoiceId === inv.id)
            .reduce((t, x) => t + (Number(x.amountReceived) || 0), 0);

        // What gets recorded is the exchange movement on the money actually
        // received — the same figure the receipt rows will show.
        const diff = _calculateForexGainLossForInvoice(inv);
        const verdict = diff >= 0
            ? `an exchange gain of ${_money(diff, 'INR')} (other income)`
            : `an exchange loss of ${_money(Math.abs(diff), 'INR')} (expenditure)`;

        // Closing short leaves an uncollected balance. That is a write-off, not an
        // exchange difference, so it is called out separately and not recorded here.
        const shortForex = billed - receivedForex;
        const shortNote = shortForex > 0.005
            ? ` ${_money(shortForex, cur)} of the ${_money(billed, cur)} invoiced was never received; that balance is written off, not counted as an exchange difference.`
            : '';

        App.showConfirm(
            `Close ${inv.refNumber || 'invoice'}?`,
            `Confirm that no further payment is expected against this invoice. `
            + `Received ${_money(receivedForex, cur)} of ${_money(billed, cur)} — `
            + `closing records ${verdict}.` + shortNote,
            () => {
                inv.forexClosed = true;
                inv.forexClosedAt = _todayISO();
                Storage.saveInvoice(inv);
                App.showToast(`${inv.refNumber || 'Invoice'} closed`, 'success');
                renderReceipts();
            }
        );
    }

    function reopenInvoiceForex(receiptId) {
        const r = Storage.getReceipt(receiptId);
        const inv = r && r.invoiceId ? Storage.getInvoice(r.invoiceId) : null;
        if (!inv) { App.showToast('Linked invoice not found', 'error'); return; }
        inv.forexClosed = false;
        inv.forexClosedAt = '';
        Storage.saveInvoice(inv);
        App.showToast(`${inv.refNumber || 'Invoice'} reopened`, 'success');
        renderReceipts();
    }

    function _receivedForInvoiceInHomeCurrency(invId) {
        const rcs = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        return rcs.filter(r => r.invoiceId === invId)
            .reduce((s, r) => s + _receiptReceivedINR(r), 0);
    }

    function _calculateForexGainLossForInvoice(inv) {
        const homeCur = 'INR';
        const currencyCode = inv.currency || homeCur;
        if (currencyCode === homeCur) return 0;

        const rate = parseFloat(inv.exchangeRate) || 0;
        if (rate <= 0) return 0;

        const rcs = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        const invoiceReceipts = rcs.filter(r => r.invoiceId === inv.id);
        
        return invoiceReceipts.reduce(
            (s, r) => s + (_receiptReceivedINR(r) - (Number(r.amountReceived) || 0) * rate), 0);
    }

    function _renderClearedInvoicePopup(inv, clearedDate, priorInHome, remaining, forexDiff) {
        const homeCur = 'INR';
        const homeSym = PdfUtils.currencySymbol(homeCur);
        const currencyCode = inv.currency || homeCur;
        const total = Number(inv.grandTotal) || 0;
        
        let forexAmountText = '—';
        let rateOfExchangeText = '—';
        let valueInHomeText = '—';
        
        if (currencyCode !== homeCur) {
            forexAmountText = `${currencyCode} ${PdfUtils.formatMoney(total, currencyCode)}`;
            const rate = parseFloat(inv.exchangeRate) || 0;
            if (rate > 0) {
                rateOfExchangeText = `${homeSym}${PdfUtils.formatCurrency(rate, homeCur)}/${currencyCode}`;
                valueInHomeText = PdfUtils.formatMoney(total * rate, homeCur);
            }
        } else {
            valueInHomeText = PdfUtils.formatMoney(total, homeCur);
        }
        
        const receiptAmtText = PdfUtils.formatMoney(priorInHome, homeCur);
        const remainText = PdfUtils.formatMoney(remaining, currencyCode);
        
        let forexLossGainHtml = '<span style="color:#71717a;">—</span>';
        if (currencyCode !== homeCur && total > 0) {
            const formattedDiff = PdfUtils.formatMoney(Math.abs(forexDiff), homeCur);
            if (forexDiff < -0.01) {
                forexLossGainHtml = `<span style="font-weight:700; color:#ef4444;">-${formattedDiff} (Loss)</span>`;
            } else if (forexDiff > 0.01) {
                forexLossGainHtml = `<span style="font-weight:700; color:#167946;">+${formattedDiff} (Gain)</span>`;
            } else {
                forexLossGainHtml = `<span style="color:#71717a;">${formattedDiff}</span>`;
            }
        }

        const html = `
            <div style="padding:20px 24px; border-bottom:1px solid rgba(0,0,0,0.07); display:flex; align-items:center; justify-content:space-between; background:linear-gradient(135deg, rgba(10,122,74,0.05) 0%, rgba(22,121,70,0.02) 100%);">
                <div>
                    <div style="font-size:18px; font-weight:800; color:#0a7a4a; display:flex; align-items:center; gap:8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="color:#0a7a4a;"><polyline points="20 6 9 17 4 12"/></svg>
                        Invoice Cleared
                    </div>
                    <div style="font-size:12px; color:#71717a; margin-top:2px;">Invoice ${_esc(inv.refNumber)}</div>
                </div>
                <button onclick="Receipts._close()" style="border:none; background:rgba(0,0,0,0.04); width:32px; height:32px; border-radius:50%; font-size:20px; line-height:1; color:#71717a; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s;" onmouseover="this.style.background='rgba(0,0,0,0.08)';" onmouseout="this.style.background='rgba(0,0,0,0.04)';">&times;</button>
            </div>
            <div style="padding:24px;">
                <div style="background:rgba(10,122,74,0.06); border:1px solid rgba(10,122,74,0.12); border-radius:12px; padding:16px; margin-bottom:20px; text-align:center;">
                    <div style="font-size:14.5px; font-weight:700; color:#0a7a4a; line-height:1.4;">
                        This invoice bill has been fully cleared on <span style="text-decoration:underline;">${clearedDate}</span>!
                    </div>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:12px; font-size:13.5px; color:#52525b;">
                    <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f4f4f5;">
                        <span style="font-weight:500; color:#71717a;">Forex Amount</span>
                        <span style="font-weight:700; color:#18181b;">${forexAmountText}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f4f4f5;">
                        <span style="font-weight:500; color:#71717a;">Rate of Exchange</span>
                        <span style="font-weight:700; color:#18181b;">${rateOfExchangeText}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f4f4f5;">
                        <span style="font-weight:500; color:#71717a;">Value in ${homeSym}</span>
                        <span style="font-weight:700; color:#18181b;">${valueInHomeText}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f4f4f5;">
                        <span style="font-weight:500; color:#71717a;">Receipt Amount</span>
                        <span style="font-weight:700; color:#18181b;">${receiptAmtText}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f4f4f5;">
                        <span style="font-weight:500; color:#71717a;">Remaining Amount</span>
                        <span style="font-weight:700; color:#0a7a4a;">${remainText}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f4f4f5;">
                        <span style="font-weight:500; color:#71717a;">Forex Loss/Gain</span>
                        <span>${forexLossGainHtml}</span>
                    </div>
                </div>
            </div>
            <div style="padding:16px 24px; display:flex; justify-content:flex-end; background:#f9fafb; border-top:1px solid rgba(0,0,0,0.07);">
                <button onclick="Receipts._close()" class="btn btn-primary">Close</button>
            </div>
        `;
        
        _openOverlay(html, '460px');
    }

    function _setCheque(v) { if (_rcp) _rcp.chequeNumber = v; }
    function _setRemarks(v) { if (_rcp) _rcp.remarks = v; }

    function _renderInlineBankPicker() {
        const banks = Storage.getAllReceiptBanks();
        if (banks.length === 0) {
            return `<div style="font-size:12px; color:#71717a; padding:12px 0; text-align:center;">No bank accounts added yet. Click "+ Add Bank" to add one.</div>`;
        }
        return `
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:8px;">
                ${banks.map(b => {
                    const sel = _rcp.bankId === b.id;
                    return `
                        <div style="border:1px solid ${sel ? '#004d2c' : 'rgba(0,0,0,0.12)'}; background:${sel ? 'rgba(0,77,44,0.03)' : '#fff'}; border-radius:8px; padding:5px 10px; display:flex; align-items:center; gap:8px; cursor:pointer; transition: all 0.2s;"
                            onclick="Receipts._selectBankInline('${b.id}')">
                            <div style="width:14px; height:14px; border-radius:50%; border:2px solid ${sel ? '#004d2c' : '#cbd5e1'}; flex:0 0 auto; display:flex; align-items:center; justify-content:center;">
                                ${sel ? '<span style="width:8px;height:8px;border-radius:50%;background:#004d2c;display:block;"></span>' : ''}
                            </div>
                            <div style="flex:1; min-width:0; font-size:12px; line-height:1.2;">
                                <div style="font-weight:700; color:#18181b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_esc(b.bankName)}</div>
                                <div style="color:#52525b; margin-top:2px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                    A/c: ${_esc(b.accountNumber)} &middot; IFSC: ${_esc(b.ifsc || '—')}
                                </div>
                            </div>
                            <button type="button" title="Delete bank" onclick="event.stopPropagation(); Receipts._deleteBankInline('${b.id}')"
                                style="border:none; background:transparent; color:#ef4444; font-size:16px; cursor:pointer; line-height:1; padding:0 2px;">&times;</button>
                        </div>`;
                }).join('')}
            </div>`;
    }

    function _selectBankInline(id) {
        if (_rcp) {
            _rcp.bankId = id;
            _renderModeDetail();
        }
    }

    function _deleteBankInline(id) {
        if (confirm('Delete this bank account?')) {
            Storage.deleteReceiptBank(id);
            if (_rcp && _rcp.bankId === id) _rcp.bankId = '';
            _renderModeDetail();
        }
    }

    function _openAddBankPopup() {
        _openSubOverlay(`
            <div style="padding:16px 20px; border-bottom:1px solid rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:space-between; background:linear-gradient(135deg, rgba(0,77,44,0.03) 0%, rgba(0,0,0,0.02) 100%);">
                <div style="font-size:15px; font-weight:800; color:#18181b;">Add Bank Account</div>
                <button type="button" onclick="Receipts._closeSubOverlay()" style="border:none; background:transparent; font-size:18px; color:#71717a; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:20px; font-family:'Inter', sans-serif;">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
                    <div>
                        <label style="display:block; font-size:11px; font-weight:600; color:#52525b; margin-bottom:4px;">Bank Name *</label>
                        <input id="pop-rbk-name" type="text" placeholder="e.g. HDFC Bank" style="width:100%; padding:9px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:11px; font-weight:600; color:#52525b; margin-bottom:4px;">Account Number *</label>
                        <input id="pop-rbk-acc" type="text" placeholder="e.g. 501002..." style="width:100%; padding:9px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:11px; font-weight:600; color:#52525b; margin-bottom:4px;">IFSC / SWIFT</label>
                        <input id="pop-rbk-ifsc" type="text" placeholder="e.g. HDFC0001234" style="width:100%; padding:9px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block; font-size:11px; font-weight:600; color:#52525b; margin-bottom:4px;">Branch</label>
                        <input id="pop-rbk-branch" type="text" placeholder="e.g. Mumbai Main" style="width:100%; padding:9px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13px; box-sizing:border-box;">
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button type="button" onclick="Receipts._closeSubOverlay()" class="btn btn-secondary">Cancel</button>
                    <button type="button" onclick="Receipts._saveBankFromPopup()" class="btn btn-primary">Add Account</button>
                </div>
            </div>
        `, '520px');
    }

    function _saveBankFromPopup() {
        const name = ((document.getElementById('pop-rbk-name') || {}).value || '').trim();
        const acc = ((document.getElementById('pop-rbk-acc') || {}).value || '').trim();
        const ifsc = ((document.getElementById('pop-rbk-ifsc') || {}).value || '').trim();
        const branch = ((document.getElementById('pop-rbk-branch') || {}).value || '').trim();

        if (!name || !acc) {
            App.showToast('Bank Name and Account Number are required.', 'error');
            return;
        }

        const saved = Storage.saveReceiptBank({ bankName: name, accountNumber: acc, ifsc, branch });
        _rcp.bankId = saved.id;
        _closeSubOverlay();
        _renderModeDetail();
    }

    function _renderModeDetail() {
        const box = document.getElementById('rcp-mode-detail');
        if (!box || !_rcp) return;

        if (_rcp.mode === 'cheque') {
            box.innerHTML = `
                <div style="display:flex; flex-direction:column; justify-content:center; height:100%;">
                    <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Cheque or Reference Number <span style="color:#ef4444;">*</span></label>
                    <input id="rcp-cheque-num-inline" type="text" value="${_esc(_rcp.chequeNumber || '')}" placeholder="Enter cheque number or reference"
                        oninput="Receipts._setCheque(this.value)"
                        style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:13.5px; box-sizing:border-box; background:#fff;">
                </div>`;
            return;
        }

        if (_rcp.mode === 'bank') {
            box.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; height:100%; gap:20px;">
                    <div style="flex:1; display:flex; flex-direction:column; justify-content:center; height:100%; min-width:0;">
                        <div style="font-size:11px; font-weight:800; color:#004d2c; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; margin-top:-4px;">Select Bank Account</div>
                        <div style="flex:1; overflow-y:auto; padding-right:4px;">
                            ${_renderInlineBankPicker()}
                        </div>
                    </div>
                    <div style="flex:0 0 auto; display:flex; align-items:center; justify-content:center; height:100%;">
                        <button type="button" onclick="Receipts._openAddBankPopup()" style="padding:10px 20px; font-size:13px; border-radius:8px; font-weight:700; background:#004d2c; color:#fff; border:none; cursor:pointer; transition:background .15s; box-shadow:0 2px 6px rgba(0,77,44,0.15);" onmouseover="this.style.background='#003d22';" onmouseout="this.style.background='#004d2c';">+ Add Bank</button>
                    </div>
                </div>`;
            return;
        }

        // Cash — nothing extra.
        box.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#71717a; font-size:13px; font-style:italic;">No additional details required for cash.</div>`;
    }

    function saveReceipt() {
        if (!_rcp) return;
        const amount = Number(_rcp.amount);
        if (!amount || amount <= 0) { App.showToast('Enter a valid amount received', 'error'); return; }
        if (_rcp.mode === 'bank' && !_rcp.bankId) { App.showToast('Select (or add) a bank', 'error'); return; }

        const prior = _receivedSoFar(_rcp.invId, _rcp.editId);
        const outstanding = _rcp.total - prior;
        
        if (amount > outstanding) {
            _handleOverpayment(amount, Math.max(0, outstanding));
            return;
        }

        const dateEl = document.getElementById('rcp-date');
        const date = dateEl && dateEl.value ? dateEl.value : _todayISO();

        const remarksEl = document.getElementById('rcp-remarks');
        const remarks = remarksEl ? (remarksEl.value || '') : (_rcp.remarks || '');

        // Editing keeps the original receipt number + id; a new receipt gets the
        // next running serial for the financial year.
        let receiptNumber;
        if (_rcp.editId) {
            const existing = Storage.getReceipt(_rcp.editId);
            receiptNumber = existing ? existing.receiptNumber : '';
        } else {
            const fy = Storage.getFinancialYear(date);
            const fyShort = Storage.getFinancialYearShort(date);
            const serial = Storage.incrementSerialNumber('RCP', '', fy);
            receiptNumber = `${Storage.getOrgInfo().serialPrefix}/RCP/${String(serial).padStart(4, '0')}/${fyShort}`;
        }

        const bank = _rcp.mode === 'bank' ? Storage.getReceiptBank(_rcp.bankId) : null;

        const bookingRateEl = document.getElementById('rcp-booking-rate');
        const bankChargesEl = document.getElementById('rcp-bank-charges');
        const bankChargesTypeEl = document.getElementById('rcp-bank-charges-type');
        const amountInInrEl = document.getElementById('rcp-amount-inr');
        const bookingRate = bookingRateEl ? (bookingRateEl.value || '').trim() : '';
        const bankCharges = bankChargesEl ? (bankChargesEl.value || '').trim() : '';
        const bankChargesType = bankChargesTypeEl ? (bankChargesTypeEl.value || 'amount').trim() : 'amount';
        const amountInINR = amountInInrEl ? (amountInInrEl.value || '').trim() : '';

        Storage.saveReceipt({
            id: _rcp.editId || undefined,
            invoiceId: _rcp.invId,
            invoiceRef: _rcp.invoiceRef,
            receiptNumber,
            date,
            invoiceTotal: _rcp.total,
            amountReceived: amount,
            currency: _rcp.currency,
            clientName: _rcp.clientName,
            mode: _rcp.mode,
            chequeNumber: _rcp.mode === 'cheque' ? (_rcp.chequeNumber || '') : '',
            bankId: bank ? bank.id : '',
            bankName: bank ? bank.bankName : '',
            bankAccount: bank ? bank.accountNumber : '',
            bankIfsc: bank ? bank.ifsc : '',
            bankBranch: bank ? bank.branch : '',
            remarks: remarks.trim(),
            bookingRate: _rcp.currency !== 'INR' ? bookingRate : '',
            bankCharges: _rcp.currency !== 'INR' ? bankCharges : '',
            bankChargesType: _rcp.currency !== 'INR' ? bankChargesType : 'amount',
            amountInINR: _rcp.currency !== 'INR' ? amountInINR : ''
        });

        _closeOverlay();
        App.showToast(`Receipt ${receiptNumber} ${_rcp.editId ? 'updated' : 'saved'}`, 'success');
        renderReceipts(); // keep the (possibly open) receipts dashboard in sync
        // Refresh the dashboard so an open invoice popup updates its Status/Remaining.
        if (typeof Dashboard !== 'undefined' && Dashboard.render) Dashboard.render();
    }

    // ========================================================================
    // ADVANCE RECEIPT
    // ------------------------------------------------------------------------
    // A payment received from a client in advance — not tied to any invoice.
    // Reuses the same `_rcp` state + payment-mode helpers as Record Receipt, but
    // collects a client (domestic / international) instead of a linked invoice.
    // ========================================================================
    function _previewReceiptNumber(dateISO) {
        const fy = Storage.getFinancialYear(dateISO);
        const fyShort = Storage.getFinancialYearShort(dateISO);
        const serial = Storage.peekNextSerialNumber('RCP', '', fy);
        return `${Storage.getOrgInfo().serialPrefix}/RCP/${String(serial).padStart(4, '0')}/${fyShort}`;
    }

    function openAdvanceReceiptModal() {
        _rcp = {
            editId: null,
            isAdvance: true,
            invId: null,
            invoiceRef: '',
            clientType: 'domestic',
            clientId: '',
            clientName: '',
            total: 0,
            currency: 'INR',
            amount: '',
            mode: 'cash',
            chequeNumber: '',
            bankId: '',
            date: _todayISO(),
            remarks: '',
            addingBank: false,
            bookingRate: '',
            bankCharges: '',
            bankChargesType: 'amount',
            amountInINR: ''
        };
        _renderAdvanceModal();
    }

    // Edit an existing advance receipt — same advance modal, prefilled, save
    // overwrites the record (keeping its original id + receipt number).
    function editAdvanceReceipt(id, r) {
        r = r || Storage.getReceipt(id);
        if (!r) { App.showToast('Receipt not found', 'error'); return; }
        const clientType = r.clientType || 'domestic';
        // The saved record stores the client name; resolve back to the client id
        // so the dropdown preselects correctly.
        const match = Storage.getAllVendors().find(v =>
            v.name === r.clientName && (v.clientType || 'domestic') === clientType);
        _rcp = {
            editId: id,
            isAdvance: true,
            invId: null,
            invoiceRef: '',
            receiptNumber: r.receiptNumber || '',
            clientType,
            clientId: match ? match.id : '',
            clientName: r.clientName || '',
            total: 0,
            currency: r.currency || 'INR',
            amount: r.amountReceived,
            mode: r.mode || 'cash',
            chequeNumber: r.chequeNumber || '',
            bankId: r.bankId || '',
            date: r.date || _todayISO(),
            remarks: r.remarks || '',
            orderDate: r.orderDate || '',
            orderRef: r.orderRef || '',
            projectCode: r.projectCode || '',
            shippedVia: r.shippedVia || '',
            department: r.department || '',
            terms: r.terms || '',
            addingBank: false,
            bookingRate: r.bookingRate || '',
            bankCharges: r.bankCharges || '',
            bankChargesType: r.bankChargesType || 'amount',
            amountInINR: r.amountInINR || ''
        };
        _renderAdvanceModal();
    }

    function _advTypeBtn(t, label) {
        const active = _rcp && _rcp.clientType === t;
        return `<button type="button" onclick="Receipts._setAdvClientType('${t}')"
            style="flex:1; padding:10px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
            border:1px solid ${active ? '#004d2c' : 'rgba(0,0,0,0.15)'};
            background:${active ? 'rgba(0,77,44,0.08)' : '#fff'};
            color:${active ? '#004d2c' : '#52525b'};">${label}</button>`;
    }

    // Client-type toggle + client dropdown (+ currency for international). Kept in
    // its own re-rendered block so switching type refreshes the client list.
    function _advClientBlockHTML() {
        const clients = Storage.getAllVendors().filter(v => (v.clientType || 'domestic') === _rcp.clientType);
        
        // Group clients
        const uniqueGroups = [...new Set(clients.filter(c => c.group).map(c => c.group.trim()))].sort();
        const standaloneClients = clients.filter(c => !c.group);

        const activeVendor = _rcp.clientId ? clients.find(c => c.id === _rcp.clientId) : null;
        const activeGroup = activeVendor && activeVendor.group ? activeVendor.group : (_rcp._tempGroup || '');

        const mainOpts = [{ value: '', label: '— Select a client —' }]
            .concat(uniqueGroups.map(g => ({ value: 'GROUP:' + g, label: g })))
            .concat(standaloneClients.map(c => ({ value: c.id, label: c.name })));

        const selectedMainVal = activeGroup ? 'GROUP:' + activeGroup : _rcp.clientId;

        let subSelectHTML = '';
        if (activeGroup) {
            const subClients = clients.filter(c => c.group === activeGroup);
            const subOpts = [{ value: '', label: '— Select Client —' }]
                .concat(subClients.map(c => ({ value: c.id, label: c.subGroup || c.name })));
            subSelectHTML = `
                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin:12px 0 6px;">Select Client <span style="color:#ef4444;">*</span></label>
                <div style="margin-bottom:12px;">${_customSelect(subOpts, _rcp.clientId, 'Receipts._setAdvClient(this.value)', '100%', true, null, true)}</div>
            `;
        }

        const intl = _rcp.clientType === 'international';
        const curOpts = Object.keys(PdfUtils.CURRENCY_MAP).filter(c => c !== 'INR').map(c => ({ value: c, label: c }));
        return `
            <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Client type <span style="color:#ef4444;">*</span></label>
            <div style="display:flex; gap:8px; margin-bottom:12px;">
                ${_advTypeBtn('domestic', 'Domestic')}
                ${_advTypeBtn('international', 'International')}
            </div>
            <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Select Client <span style="color:#ef4444;">*</span></label>
            <div style="margin-bottom:12px;">${_customSelect(mainOpts, selectedMainVal, 'Receipts._setAdvGroup(this.value)', '100%', true, null, true)}</div>
            ${subSelectHTML}
            ${clients.length === 0 ? `<div style="font-size:12px; color:#a1a1aa; margin:-6px 0 12px;">No ${_rcp.clientType} clients saved yet. Add one from an invoice first.</div>` : ''}
            ${intl ? `
            <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Currency</label>
            <div>${_customSelect(curOpts, _rcp.currency, 'Receipts._setAdvCurrency(this.value)', '100%', true)}</div>` : ''}`;
    }

    function _captureAdvanceFormValues() {
        if (!_rcp) return;
        const val = id => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };
        _rcp.date = val('rcp-date') || _rcp.date;
        _rcp.amount = val('rcp-amount') || _rcp.amount;
        _rcp.remarks = val('rcp-remarks') || _rcp.remarks;
        _rcp.orderDate = val('adv-order-date') || _rcp.orderDate;
        _rcp.orderRef = val('adv-order-ref') || _rcp.orderRef;
        _rcp.projectCode = val('adv-project-code') || _rcp.projectCode;
        _rcp.shippedVia = val('adv-shipped-via') || _rcp.shippedVia;
        
        const deptEl = document.getElementById('adv-department');
        if (deptEl) _rcp.department = deptEl.value;

        _rcp.terms = val('adv-order-terms') || _rcp.terms;
        _rcp.bookingRate = val('rcp-booking-rate') || _rcp.bookingRate;
        _rcp.bankCharges = val('rcp-bank-charges') || _rcp.bankCharges;
        _rcp.amountInINR = val('rcp-amount-inr') || _rcp.amountInINR;
    }

    function _setAdvClientType(t) {
        if (!_rcp) return;
        _captureAdvanceFormValues();
        _rcp.clientType = t;
        _rcp.clientId = '';
        _rcp.clientName = '';
        _rcp._tempGroup = '';
        _rcp.currency = t === 'domestic' ? 'INR' : (_rcp.currency && _rcp.currency !== 'INR' ? _rcp.currency : 'USD');
        _renderAdvanceModal();
    }
    function _setAdvGroup(gVal) {
        if (!_rcp) return;
        _captureAdvanceFormValues();
        const clients = Storage.getAllVendors().filter(v => (v.clientType || 'domestic') === _rcp.clientType);
        if (gVal.startsWith('GROUP:')) {
            const gName = gVal.substring(6);
            _rcp._tempGroup = gName;
            _rcp.clientId = '';
            _rcp.clientName = '';
        } else {
            _rcp._tempGroup = '';
            _rcp.clientId = gVal;
            const c = clients.find(x => x.id === gVal);
            _rcp.clientName = c ? c.name : '';
        }
        _renderAdvanceModal();
    }
    function _setAdvClient(id) {
        if (!_rcp) return;
        _rcp.clientId = id;
        const c = Storage.getVendor(id);
        _rcp.clientName = c ? c.name : '';
    }
    function _setAdvCurrency(cur) {
        if (!_rcp) return;
        _captureAdvanceFormValues();
        _rcp.currency = cur;
        _renderAdvanceModal();
    }

    function _renderAdvanceModal() {
        const inputStyle = 'width:100%; padding:9px 12px; border:1px solid rgba(0,0,0,0.12); border-radius:9px; font-size:13.5px; background:#fff; box-sizing:border-box;';
        const sectionStyle = 'border:1px solid rgba(0,0,0,0.06); border-radius:14px; padding:16px 16px 14px; background:linear-gradient(180deg,#fbfbfc 0%,#f6f7f8 100%);';
        const sectionHead = 'font-size:11px; font-weight:800; color:#004d2c; text-transform:uppercase; letter-spacing:0.6px; margin-bottom:12px; display:flex; align-items:center; gap:8px;';
        const dot = '<span style="width:6px; height:6px; border-radius:50%; background:#f37b21; display:inline-block;"></span>';
        const labelStyle = 'display:block; font-size:11.5px; font-weight:600; color:#52525b; margin-bottom:5px;';
        const editing = !!_rcp.editId;
        const deptOpts = [{ value: '', label: '— None —' }].concat(_RCP_DEPARTMENTS.map(d => ({ value: d, label: d })));
        const deptSelect = _customSelect(deptOpts, _rcp.department || '', '', '100%', true, 'adv-department');
        _openOverlay(`
            <div style="padding:16px 26px 14px; border-bottom:1px solid rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:space-between; background:linear-gradient(135deg, rgba(0,77,44,0.05) 0%, rgba(243,123,33,0.04) 100%);">
                <div>
                    <div style="font-size:19px; font-weight:800; color:#18181b; letter-spacing:-0.3px;">${editing ? 'Edit Advance Receipt' : 'Advance Receipt'}</div>
                    <div style="font-size:12px; color:#71717a; margin-top:2px;">Advance payment received from a client</div>
                </div>
                <button onclick="Receipts._close()" style="border:none; background:rgba(0,0,0,0.04); width:32px; height:32px; border-radius:50%; font-size:20px; line-height:1; color:#71717a; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s;" onmouseover="this.style.background='rgba(0,0,0,0.08)';" onmouseout="this.style.background='rgba(0,0,0,0.04)';">&times;</button>
            </div>
            <div style="padding:18px 26px;">
                <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:stretch;">
                    <div style="${sectionStyle} flex:1; min-width:280px;">
                        <div style="${sectionHead}">${dot} Client &amp; Details</div>
                        <div style="display:flex; gap:10px; margin-bottom:11px; flex-wrap:wrap;">
                            <div style="flex:1; min-width:150px;">
                                <label style="${labelStyle}">Receipt number</label>
                                <input type="text" value="${_esc(editing ? _rcp.receiptNumber : _previewReceiptNumber(_rcp.date))}" readonly title="${editing ? 'Receipt number' : 'Auto-generated on save'}"
                                    style="${inputStyle} background:#f7f7f8; color:#52525b;">
                            </div>
                            <div style="flex:1; min-width:130px;">
                                <label style="${labelStyle}">Date <span style="color:#ef4444;">*</span></label>
                                <input id="rcp-date" type="date" max="9999-12-31" value="${_rcp.date}" style="${inputStyle}">
                            </div>
                        </div>
                        <div id="adv-client-block">${_advClientBlockHTML()}</div>
                    </div>

                    <div style="${sectionStyle} flex:1; min-width:280px;">
                        <div style="${sectionHead}">${dot} Payment</div>
                        <label style="${labelStyle}">Amount received <span style="color:#ef4444;">*</span></label>
                        <input id="rcp-amount" type="number" min="0" step="0.01" value="${_rcp.amount === '' ? '' : _rcp.amount}" placeholder="How much did you receive?"
                            oninput="Receipts._setAmount(this.value)" style="${inputStyle} margin-bottom:11px;">

                        ${_rcp.currency !== 'INR' ? `
                        <style>
                        .charges-type-inline-select .custom-select-trigger {
                            border: none !important;
                            background: transparent !important;
                            height: 100% !important;
                            padding: 0 8px 0 12px !important;
                            border-radius: 0 !important;
                            box-shadow: none !important;
                        }
                        .charges-type-inline-select .custom-options {
                            right: 0 !important;
                            left: auto !important;
                            width: 80px !important;
                        }
                        </style>
                        <div style="background:rgba(243,123,33,0.02); border:1px solid rgba(243,123,33,0.12); border-radius:12px; padding:16px; margin-bottom:11px; box-shadow:0 2px 8px rgba(243,123,33,0.02);">
                            <div style="font-size:11px; font-weight:800; color:#f37b21; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
                                <span style="width:5px; height:5px; border-radius:50%; background:#f37b21; display:inline-block;"></span>
                                Exchange Details
                            </div>
                            <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
                                <div style="flex:1; min-width:110px;">
                                    <label style="${labelStyle}">Booking Rate</label>
                                    <input id="rcp-booking-rate" type="number" min="0" step="any" value="${_rcp.bookingRate || ''}" placeholder="Rate (INR)"
                                        oninput="Receipts._setBookingRate(this.value)" style="${inputStyle} height:38px;">
                                </div>
                                <div style="flex:1.5; min-width:180px;">
                                    <label style="${labelStyle}">Bank Charges</label>
                                    <div class="charges-type-inline-select" style="position:relative; width:100%; height:38px;">
                                        <input id="rcp-bank-charges" type="number" min="0" step="any" value="${_rcp.bankCharges || ''}" placeholder="Charges"
                                            oninput="Receipts._setBankCharges(this.value)" style="${inputStyle} padding-right:80px; margin:0; height:38px;">
                                        <div style="position:absolute; right:1px; top:1px; bottom:1px; width:70px; display:flex; align-items:center; border-left:1px solid rgba(0,0,0,0.12); background:#f4f4f5; border-top-right-radius:8px; border-bottom-right-radius:8px;">
                                            ${_customSelect([{ value: 'amount', label: 'INR' }, { value: 'percent', label: '%' }], _rcp.bankChargesType, "Receipts._setBankChargesType(this.value)", '100%', false, 'rcp-bank-charges-type')}
                                        </div>
                                    </div>
                                </div>
                                <div style="flex:1; min-width:125px;">
                                    <label style="${labelStyle}">Amount in INR</label>
                                    <input id="rcp-amount-inr" type="number" min="0" step="any" value="${_rcp.amountInINR || ''}" placeholder="INR Value"
                                        oninput="Receipts._setAmountInINR(this.value)" style="${inputStyle} background:#f4f4f5; font-weight:700; color:#18181b; height:38px;">
                                </div>
                            </div>
                        </div>
                        ` : ''}

                        <label style="${labelStyle}">Received via <span style="color:#ef4444;">*</span></label>
                        <div id="rcp-mode-row" style="display:flex; gap:8px; margin-bottom:11px;">
                            ${_modeBtn('cash', 'Cash')}
                            ${_modeBtn('cheque', 'Cheque')}
                            ${_modeBtn('bank', 'Bank')}
                        </div>
                        <div id="rcp-mode-detail"></div>

                        <label style="${labelStyle} margin-top:11px;">Remarks</label>
                        <textarea id="rcp-remarks" rows="2" placeholder="Optional notes about this advance"
                            oninput="Receipts._setRemarks(this.value)" style="${inputStyle} resize:vertical;">${_esc(_rcp.remarks)}</textarea>
                    </div>

                    <div style="${sectionStyle} flex:1.5; min-width:340px;">
                        <div style="${sectionHead}">${dot} Order Details <span style="text-transform:none; font-weight:500; color:#a1a1aa; letter-spacing:0; margin-left:2px;">(optional)</span></div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:11px 14px;">
                            <div>
                                <label style="${labelStyle}">Order Date</label>
                                <input id="adv-order-date" type="date" max="9999-12-31" value="${_esc(_rcp.orderDate || '')}" style="${inputStyle}">
                            </div>
                            <div>
                                <label style="${labelStyle}">Order Reference Number</label>
                                <input id="adv-order-ref" type="text" value="${_esc(_rcp.orderRef || '')}" placeholder="e.g., PO-123" style="${inputStyle}">
                            </div>
                            <div>
                                <label style="${labelStyle}">Project Code</label>
                                <input id="adv-project-code" type="text" value="${_esc(_rcp.projectCode || '')}" placeholder="e.g., PRJ-2026-01" style="${inputStyle}">
                            </div>
                            <div>
                                <label style="${labelStyle}">Data Shipped Via</label>
                                <input id="adv-shipped-via" type="text" value="${_esc(_rcp.shippedVia || '')}" placeholder="e.g., INTERNET" style="${inputStyle}">
                            </div>
                            <div>
                                <label style="${labelStyle}">Department</label>
                                ${deptSelect}
                            </div>
                            <div>
                                <label style="${labelStyle}">Terms</label>
                                <input id="adv-order-terms" type="text" value="${_esc(_rcp.terms || '')}" placeholder="e.g., Wire transfer to Axis Bank" style="${inputStyle}">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div style="padding:14px 26px; border-top:1px solid rgba(0,0,0,0.06); display:flex; justify-content:flex-end; gap:12px; background:#fbfbfc;">
                <button onclick="Receipts._close()" class="btn btn-secondary">Cancel</button>
                <button onclick="Receipts.saveAdvanceReceipt()" class="btn btn-primary">${editing ? 'Update Advance Receipt' : 'Save Advance Receipt'}</button>
            </div>
        `, 'min(1500px, 96vw)', { center: true });

        _renderModeDetail();
    }

    function saveAdvanceReceipt() {
        if (!_rcp) return;
        if (!_rcp.clientId || !_rcp.clientName) { App.showToast('Select a client', 'error'); return; }
        const amount = Number((document.getElementById('rcp-amount') || {}).value);
        if (!amount || amount <= 0) { App.showToast('Enter a valid amount received', 'error'); return; }
        if (_rcp.mode === 'bank' && !_rcp.bankId) { App.showToast('Select (or add) a bank', 'error'); return; }

        const dateEl = document.getElementById('rcp-date');
        const date = dateEl && dateEl.value ? dateEl.value : _todayISO();
        const remarksEl = document.getElementById('rcp-remarks');
        const remarks = remarksEl ? (remarksEl.value || '') : (_rcp.remarks || '');
        const _val = id => ((document.getElementById(id) || {}).value || '').trim();

        // Editing keeps the original receipt number + id; a new advance receipt
        // gets the next running serial for the financial year.
        let receiptNumber;
        if (_rcp.editId) {
            const existing = Storage.getReceipt(_rcp.editId);
            receiptNumber = existing ? existing.receiptNumber : (_rcp.receiptNumber || '');
        } else {
            const fy = Storage.getFinancialYear(date);
            const fyShort = Storage.getFinancialYearShort(date);
            const serial = Storage.incrementSerialNumber('RCP', '', fy);
            receiptNumber = `${Storage.getOrgInfo().serialPrefix}/RCP/${String(serial).padStart(4, '0')}/${fyShort}`;
        }

        const bank = _rcp.mode === 'bank' ? Storage.getReceiptBank(_rcp.bankId) : null;

        const bookingRateEl = document.getElementById('rcp-booking-rate');
        const bankChargesEl = document.getElementById('rcp-bank-charges');
        const bankChargesTypeEl = document.getElementById('rcp-bank-charges-type');
        const amountInInrEl = document.getElementById('rcp-amount-inr');
        const bookingRate = bookingRateEl ? (bookingRateEl.value || '').trim() : '';
        const bankCharges = bankChargesEl ? (bankChargesEl.value || '').trim() : '';
        const bankChargesType = bankChargesTypeEl ? (bankChargesTypeEl.value || 'amount').trim() : 'amount';
        const amountInINR = amountInInrEl ? (amountInInrEl.value || '').trim() : '';

        Storage.saveReceipt({
            id: _rcp.editId || undefined,
            invoiceId: null,
            invoiceRef: '',
            isAdvance: true,
            clientType: _rcp.clientType,
            receiptNumber,
            date,
            invoiceTotal: 0,
            amountReceived: amount,
            currency: _rcp.currency,
            clientName: _rcp.clientName,
            mode: _rcp.mode,
            chequeNumber: _rcp.mode === 'cheque' ? (_rcp.chequeNumber || '') : '',
            bankId: bank ? bank.id : '',
            bankName: bank ? bank.bankName : '',
            bankAccount: bank ? bank.accountNumber : '',
            bankIfsc: bank ? bank.ifsc : '',
            bankBranch: bank ? bank.branch : '',
            remarks: remarks.trim(),
            // Order metadata (reference only, mirrors the invoice's order section).
            orderDate: _val('adv-order-date'),
            orderRef: _val('adv-order-ref'),
            projectCode: _val('adv-project-code'),
            shippedVia: _val('adv-shipped-via'),
            department: _val('adv-department'),
            terms: _val('adv-order-terms'),
            bookingRate: _rcp.currency !== 'INR' ? bookingRate : '',
            bankCharges: _rcp.currency !== 'INR' ? bankCharges : '',
            bankChargesType: _rcp.currency !== 'INR' ? bankChargesType : 'amount',
            amountInINR: _rcp.currency !== 'INR' ? amountInINR : ''
        });

        _closeOverlay();
        App.showToast(`Advance receipt ${receiptNumber} ${_rcp.editId ? 'updated' : 'saved'}`, 'success');
        renderReceipts();
    }

    // ========================================================================
    // RECEIPTS FILTER + DOWNLOAD
    // ========================================================================
    // Date filter shared with the "Select Timeline" modal (same UX as Sales).
    // `rangeMode` only drives the modal's toggle; filtering is always the
    // startM/startY → endM/endY month span. Defaults to the current financial year.
    let _rcpFilter = null;
    let _rcpSearch = ''; // free-text quick search over the receipts table
    const _RCP_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    function _defaultReceiptFilter() {
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth() + 1;
        const fyStart = m >= 4 ? y : y - 1;
        return { rangeMode: 'fy', startM: 4, startY: fyStart, endM: 3, endY: fyStart + 1 };
    }

    function _applyReceiptFilter(list) {
        const f = _rcpFilter;
        if (!f) return list;
        const start = f.startY * 12 + (f.startM - 1);
        const end = f.endY * 12 + (f.endM - 1);
        return list.filter(r => {
            if (!r.date) return false;
            const d = new Date(r.date);
            if (isNaN(d.getTime())) return false;
            const ym = d.getFullYear() * 12 + d.getMonth();
            return ym >= start && ym <= end;
        });
    }

    // Human label for the active range: a single month ("July 2026"), a full
    // financial year ("FY 2026-27"), or an explicit span.
    function _receiptRangeLabel() {
        const f = _rcpFilter;
        if (!f) return 'All';
        if (f.rangeMode === 'fy') {
            return `FY ${f.startY}-${String(f.endY).slice(-2)}`;
        }
        if (f.startM === f.endM && f.startY === f.endY) return `${_RCP_MONTHS[f.startM - 1]} ${f.startY}`;
        return `${_RCP_MONTHS[f.startM - 1]} ${f.startY} – ${_RCP_MONTHS[f.endM - 1]} ${f.endY}`;
    }

    function _receiptYears() {
        const set = new Set();
        const cy = new Date().getFullYear();
        for (let y = cy - 5; y <= cy + 1; y++) set.add(y);
        Storage.getAllReceipts().forEach(r => { if (r.date) { const d = new Date(r.date); if (!isNaN(d.getTime())) set.add(d.getFullYear()); } });
        set.add(_rcpFilter ? _rcpFilter.startY : cy);
        return [...set].sort((a, b) => b - a);
    }

    // Timeline trigger (calendar chip) + Download, matching the Sales layout.
    function _receiptFilterHTML() {
        return `
            <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:16px;">
                <div style="position:relative; flex:1 1 260px; max-width:380px; min-width:200px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="rcp-search-input" type="text" value="${_esc(_rcpSearch)}" placeholder="Search receipt no, invoice, client…"
                        oninput="Dashboard.keepFocus(Receipts._setReceiptSearch.bind(null, this.value))"
                        style="width:100%; box-sizing:border-box; padding:9px 12px 9px 36px; font-size:13px; color:#18181b; background:#fff; border:1px solid rgba(0,0,0,0.12); border-radius:10px;">
                </div>
                ${Dashboard.renderClientFilter('rcp', { width: 180 })}
                <div style="flex:1 1 auto;"></div>
                <button type="button" onclick="Receipts.openReceiptTimeline()"
                    style="display:inline-flex; align-items:center; gap:9px; padding:9px 14px; font-size:13px; font-weight:600; color:#18181b; background:rgba(0,0,0,0.05); border:none; border-radius:10px; cursor:pointer;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span>${_esc(_receiptRangeLabel())}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <button type="button" onclick="Receipts.downloadReceiptsReport()" class="btn btn-secondary" style="padding:9px 16px; display:inline-flex; align-items:center; gap:8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                </button>
            </div>`;
    }

    // --- "Select Timeline" modal (mirrors Sales) -----------------------------
    function _tlSelect(handler, options, sel, width) {
        const match = options.find(o => String(o.v) === String(sel));
        const label = match ? match.label : (options[0] ? options[0].label : '');
        return `
            <div class="custom-select-wrapper" style="width:${width};">
                <div class="custom-select-trigger" style="justify-content:space-between; text-align:left; background:rgba(0,0,0,0.05); border:none; border-radius:10px; font-weight:600; color:#18181b;">
                    <span>${_esc(label)}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options">
                    ${options.map(o => `<div class="custom-option${String(o.v) === String(sel) ? ' selected' : ''}" data-value="${_esc(String(o.v))}">${_esc(o.label)}</div>`).join('')}
                </div>
                <input type="hidden" value="${_esc(String(sel))}" onchange="${handler}">
            </div>`;
    }

    function openReceiptTimeline() {
        closeReceiptTimeline();
        if (!_rcpFilter) _rcpFilter = _defaultReceiptFilter();
        const accent = '#004d2c';
        const ov = document.createElement('div');
        ov.id = 'rcp-timeline-modal';
        ov.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.45); backdrop-filter:blur(3px); display:flex; align-items:flex-start; justify-content:center; z-index:16000; padding:80px 16px; overflow:auto;';
        ov.innerHTML = `
            <div style="background:#fff; border-radius:16px; width:100%; max-width:440px; box-shadow:0 20px 60px rgba(0,0,0,0.25); overflow:visible;">
                <div style="padding:18px 22px; border-bottom:1px solid rgba(0,0,0,0.07); display:flex; align-items:center; justify-content:space-between;">
                    <div style="font-size:16px; font-weight:800; color:#18181b;">Select Timeline</div>
                    <button onclick="Receipts.closeReceiptTimeline()" style="border:none; background:transparent; font-size:22px; line-height:1; color:#a1a1aa; cursor:pointer;">&times;</button>
                </div>
                <div style="padding:20px 22px;" id="rcp-timeline-body"></div>
                <div style="padding:14px 22px; border-top:1px solid rgba(0,0,0,0.07); display:flex; justify-content:flex-end;">
                    <button onclick="Receipts.closeReceiptTimeline()" style="padding:9px 22px; font-size:13px; font-weight:700; border:none; border-radius:10px; background:${accent}; color:#fff; cursor:pointer;">Done</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        _renderReceiptTimelineBody();
    }

    function closeReceiptTimeline() {
        const m = document.getElementById('rcp-timeline-modal');
        if (m) m.remove();
    }

    function _renderReceiptTimelineBody() {
        const box = document.getElementById('rcp-timeline-body');
        if (!box) return;
        const years = _receiptYears();
        const lbl = t => `<label style="display:block; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:6px;">${t}</label>`;

        const modeBtn = (v, label) => {
            const active = _rcpFilter.rangeMode === v;
            const base = 'flex:1; padding:10px 12px; font-size:12.5px; font-weight:600; border:none; border-radius:8px; cursor:pointer; transition:all .15s;';
            const style = active
                ? base + ' background:#fff; color:#18181b; box-shadow:0 1px 3px rgba(0,0,0,0.12);'
                : base + ' background:transparent; color:#71717a;';
            return `<button type="button" onclick="Receipts._rcpSetRangeMode('${v}')" style="${style}">${label}</button>`;
        };
        const toggle = `<div style="display:flex; background:rgba(0,0,0,0.05); padding:4px; border-radius:10px; gap:3px; margin-bottom:18px;">${modeBtn('months', 'MM/YYYY – MM/YYYY')}${modeBtn('fy', 'Financial Year')}</div>`;

        let controls;
        if (_rcpFilter.rangeMode === 'fy') {
            const fyOptions = years.map(y => ({ v: y, label: `FY ${y}-${String(y + 1).slice(-2)}` }));
            const cur = _rcpFilter.startM >= 4 ? _rcpFilter.startY : _rcpFilter.startY - 1;
            controls = lbl('Financial Year') + _tlSelect('Receipts._rcpSetFinancialYear(this.value)', fyOptions, cur, '100%');
        } else {
            const months = _RCP_MONTHS.map((m, i) => ({ v: i + 1, label: m }));
            const yrs = years.map(y => ({ v: y, label: String(y) }));
            controls = `
                ${lbl('From')}
                <div style="display:flex; gap:8px; margin-bottom:16px;">
                    ${_tlSelect("Receipts._rcpSetField('startM', this.value)", months, _rcpFilter.startM, '100%')}
                    ${_tlSelect("Receipts._rcpSetField('startY', this.value)", yrs, _rcpFilter.startY, '120px')}
                </div>
                ${lbl('To')}
                <div style="display:flex; gap:8px;">
                    ${_tlSelect("Receipts._rcpSetField('endM', this.value)", months, _rcpFilter.endM, '100%')}
                    ${_tlSelect("Receipts._rcpSetField('endY', this.value)", yrs, _rcpFilter.endY, '120px')}
                </div>`;
        }

        box.innerHTML = toggle + controls +
            `<div style="margin-top:18px; font-size:12.5px; color:#71717a;">Showing: <b style="color:#18181b;">${_esc(_receiptRangeLabel())}</b></div>`;
    }

    function _rcpAfterFilterChange() {
        _rcpPage = 1;
        renderReceipts();
        _renderReceiptTimelineBody();
    }

    // Quick-search handler. Re-renders the table then restores focus + caret to
    // the search box so typing stays uninterrupted.
    function _setReceiptSearch(v) {
        _rcpSearch = v;
        _rcpPage = 1;
        renderReceipts();
    }

    function _setReturnSearch(v) {
        _retSearch = v;
        _retPage = 1;
        renderSalesReturns();
    }

    function _rcpSetRangeMode(mode) {
        if (!_rcpFilter) _rcpFilter = _defaultReceiptFilter();
        if (mode === 'fy') {
            const y = _rcpFilter.startM >= 4 ? _rcpFilter.startY : _rcpFilter.startY - 1;
            _rcpSetFinancialYear(y);
            return;
        }
        _rcpFilter.rangeMode = 'months';
        _rcpAfterFilterChange();
    }

    function _rcpSetFinancialYear(v) {
        const y = parseInt(v, 10);
        if (!y) return;
        _rcpFilter.startM = 4; _rcpFilter.startY = y; _rcpFilter.endM = 3; _rcpFilter.endY = y + 1;
        _rcpFilter.rangeMode = 'fy';
        _rcpAfterFilterChange();
    }

    function _rcpSetField(field, val) {
        if (!_rcpFilter) _rcpFilter = _defaultReceiptFilter();
        _rcpFilter[field] = parseInt(val, 10) || _rcpFilter[field];
        _rcpFilter.rangeMode = 'months';
        _rcpAfterFilterChange();
    }

    function _rcpModeText(r) {
        const modeLabel = { cash: 'Cash', cheque: 'Cheque', bank: 'Bank' };
        let s = modeLabel[r.mode] || r.mode || '-';
        if (r.mode === 'cheque' && r.chequeNumber) s += ` (${r.chequeNumber})`;
        else if (r.mode === 'bank' && r.bankName) s += ` (${r.bankName})`;
        return s;
    }

    // Settlement status of the invoice a receipt is against: Settled once the sum
    // of all its receipts covers the invoice total, else Partial. Advance receipts
    // (no linked invoice) are labelled "Advance".
    function _receiptStatus(r) {
        if (r.isAdvance || !r.invoiceId) return 'Advance';
        const total = Number(r.invoiceTotal) || 0;
        if (total <= 0) return 'Settled';
        const received = Storage.getAllReceipts()
            .filter(x => x.invoiceId === r.invoiceId)
            .reduce((s, x) => s + (Number(x.amountReceived) || 0), 0);
        return received >= total - 0.01 ? 'Settled' : 'Partial';
    }

    // Ask before generating the report — confirm the period being exported.
    function downloadReceiptsReport() {
        const receipts = _applyReceiptFilter(Storage.getAllReceipts());
        if (!receipts.length) { App.showToast('No receipts in the selected period.', 'info'); return; }
        const count = receipts.length;
        App.showConfirm(
            'Download receipts report',
            `Download a PDF of ${count} receipt${count === 1 ? '' : 's'} for ${_receiptRangeLabel()}?`,
            () => { _doDownloadReceiptsReport(receipts); }
        );
    }

    async function _doDownloadReceiptsReport(receipts) {
        try {
            const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
            let doc = new jsPDF('p', 'mm', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 10;
            const contentWidth = pageWidth - 2 * margin;
            const curFont = PdfUtils.registerCurrencyFont(doc);
            const tableFont = curFont || 'helvetica';
            let y = 5;

            const logo = await PdfUtils.getLogoBase64();
            y = PdfUtils.drawLetterhead(doc, logo, pageWidth, margin, y, true);

            // Slanted green/orange bar (same look as the other report PDFs).
            const greenWidth = contentWidth * 0.82, slantWidth = 4, barH = 2;
            doc.setFillColor(243, 123, 33);
            doc.rect(margin, y, contentWidth, barH, 'F');
            doc.setFillColor(0, 77, 44);
            doc.lines([[greenWidth + slantWidth, 0], [-slantWidth, barH], [-greenWidth, 0]], margin, y, [1, 1], 'F', true);
            y += 12;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(15);
            doc.setTextColor(0, 77, 44);
            doc.text('Receipts Report', pageWidth / 2, y, { align: 'center' });
            y += 7;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11.5);
            doc.setTextColor(51, 51, 51);
            doc.text(_receiptRangeLabel(), pageWidth / 2, y, { align: 'center' });
            y += 6;

            let totalReceived = 0;
            const homeCur = Storage.getOrgInfo().defaultCurrency || 'INR';
            const body = receipts.map(r => {
                totalReceived += Number(r.amountReceived) || 0;
                return [
                    _fmtDate(r.date),
                    r.isAdvance ? 'Advance Receipt' : (r.invoiceRef || '-'),
                    r.clientName || '-',
                    Number(r.invoiceTotal) > 0 ? _money(r.invoiceTotal, r.currency) : '-',
                    _money(r.amountReceived, r.currency),
                    _rcpModeText(r),
                    _receiptStatus(r)
                ];
            });

            doc.autoTable({
                startY: y,
                head: [['Date Created', 'Invoice Ref', 'Client', 'Total Amount', 'Received', 'Mode', 'Status']],
                body,
                theme: 'grid',
                styles: { font: tableFont, fontSize: 9, cellPadding: 2.4, textColor: [45, 45, 45], lineColor: [222, 226, 224], lineWidth: 0.1, halign: 'center', valign: 'middle', overflow: 'linebreak' },
                headStyles: { font: tableFont, fontStyle: 'bold', fontSize: 9, fillColor: [0, 77, 44], textColor: [255, 255, 255], lineColor: [0, 77, 44], lineWidth: 0.1, halign: 'center', valign: 'middle' },
                margin: { left: margin, right: margin }
            });

            doc = await PdfUtils.flattenToImagePdf(doc);
            doc.save(`Receipts_Report_${_receiptRangeLabel().replace(/[^\w]+/g, '_')}.pdf`);
            App.showToast('Receipts report downloaded.', 'success');
        } catch (e) {
            console.error('Receipts report error', e);
            App.showToast('Could not generate the report: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    // ========================================================================
    // CREDIT NOTE  → Sales Returns
    // ========================================================================
    // Effective GST rate (%) for an invoice: IGST for inter-state, else CGST+SGST.
    function _invGstRate(inv) {
        if (inv.isInterState) return Number(inv.igstRate) || 0;
        return (Number(inv.cgstRate) || 0) + (Number(inv.sgstRate) || 0);
    }

    // Next credit-note number for a date, without consuming the serial.
    function _previewCreditNoteNumber(dateISO) {
        const fy = Storage.getFinancialYear(dateISO);
        const serial = Storage.peekNextSerialNumber('CN', '', fy);
        return `${Storage.getOrgInfo().serialPrefix}/CN/${String(serial).padStart(3, '0')}`;
    }

    function openCreditNoteModal(invId) {
        const inv = Storage.getInvoice(invId);
        if (!inv) { App.showToast('Invoice not found', 'error'); return; }
        const grand = Number(inv.grandTotal) || 0;
        const sub = inv.totalAmount !== undefined ? (Number(inv.totalAmount) || 0) : grand;
        const gstEnabled = inv.gstEnabled === true && grand > sub;
        const items = (inv.items || []).map(item => ({
            ...item,
            reducedQty: 0,
            originalQty: Number(item.qty) || 0
        }));
        _crn = {
            editId: null,
            invId,
            invoiceRef: inv.refNumber || '',
            total: grand,                 // grand total (incl. GST) — canonical invoice value
            subtotal: sub,                // total excl. GST
            grandTotal: grand,
            gstEnabled,
            gstRate: gstEnabled ? _invGstRate(inv) : 0,
            currency: inv.currency || (Storage.getOrgInfo().defaultCurrency || 'INR'),
            clientName: inv.clientName || '',
            amount: '',
            gstInclusive: true,           // how the entered credit amount is interpreted
            reason: '',
            date: _todayISO(),
            creditNoteNumber: _previewCreditNoteNumber(_todayISO()),
            items
        };
        _renderCreditModal();
    }

    // Edit an existing credit note — same modal, prefilled, save overwrites it.
    function editSalesReturn(id) {
        const r = Storage.getSalesReturn(id);
        if (!r) { App.showToast('Credit note not found', 'error'); return; }
        const grand = Number(r.invoiceTotal) || 0;
        const sub = r.invoiceSubtotal !== undefined ? (Number(r.invoiceSubtotal) || 0) : grand;
        const gstEnabled = r.gstEnabled === true && grand > sub;
        const inv = Storage.getInvoice(r.invoiceId);
        const originalItems = inv ? (inv.items || []) : [];
        const items = originalItems.map(item => {
            const savedItem = (r.items || []).find(it => it.sno === item.sno || it.specification === item.specification);
            return {
                ...item,
                reducedQty: savedItem ? (Number(savedItem.reducedQty) || 0) : 0,
                originalQty: Number(item.qty) || 0
            };
        });
        _crn = {
            editId: id,
            invId: r.invoiceId,
            invoiceRef: r.invoiceRef || '',
            total: grand,
            subtotal: sub,
            grandTotal: grand,
            gstEnabled,
            gstRate: Number(r.gstRate) || 0,
            currency: r.currency || (Storage.getOrgInfo().defaultCurrency || 'INR'),
            clientName: r.clientName || '',
            amount: r.creditAmount,
            gstInclusive: r.gstInclusive !== undefined ? !!r.gstInclusive : true,
            reason: r.reason || '',
            date: r.date || _todayISO(),
            creditNoteNumber: r.creditNoteNumber || r.refNumber || '',
            items
        };
        _renderCreditModal();
    }

    function _renderCreditModal() {
        const editing = !!_crn.editId;
        const gst = _crn.gstEnabled;

        const summary = gst
            ? `
                <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
                    <span style="color:#71717a;">Total (excl. GST)</span>
                    <span style="font-weight:600; color:#18181b;">${_money(_crn.subtotal, _crn.currency)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#71717a; margin-bottom:6px;">
                    <span>GST (${_crn.gstRate}%)</span>
                    <span>${_money(_crn.grandTotal - _crn.subtotal, _crn.currency)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:13px; border-top:1px solid rgba(243,123,33,0.2); padding-top:6px;">
                    <span style="color:#71717a;">Grand Total (incl. GST)</span>
                    <span style="font-weight:800; color:#18181b;">${_money(_crn.grandTotal, _crn.currency)}</span>
                </div>`
            : `
                <div style="display:flex; justify-content:space-between; font-size:13px;">
                    <span style="color:#71717a;">Total invoice amount</span>
                    <span style="font-weight:800; color:#18181b;">${_money(_crn.grandTotal, _crn.currency)}</span>
                </div>`;

        const gstToggle = gst
            ? `
                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">The amount entered is <span style="color:#ef4444;">*</span></label>
                <div id="crn-gst-row" style="display:flex; gap:8px; margin-bottom:12px;">
                    ${_crnGstBtn(true, 'Including GST')}
                    ${_crnGstBtn(false, 'Excluding GST')}
                </div>`
            : '';

        let itemsHtml = '';
        if (_crn.items && _crn.items.length > 0) {
            const rows = _crn.items.map((it, idx) => {
                const maxQty = it.originalQty;
                return `
                    <tr style="border-bottom:1px solid rgba(0,0,0,0.04);">
                        <td style="font-size:12px; padding:8px 6px; color:#18181b;">${_esc(it.specification)}</td>
                        <td style="font-size:12px; padding:8px 6px; text-align:center; color:#71717a;">${maxQty} ${it.uom || ''}</td>
                        <td style="font-size:12px; padding:8px 6px; text-align:right; color:#71717a;">${_money(it.rate, _crn.currency)}</td>
                        <td style="padding:4px; text-align:center; width:90px;">
                            <input type="number" min="0" max="${maxQty}" step="any" value="${it.reducedQty || 0}"
                                oninput="Receipts._setItemReducedQty(${idx}, this.value)"
                                style="width:100%; padding:5px 6px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; font-size:12px; text-align:center;">
                        </td>
                        <td style="font-size:12px; padding:8px 6px; text-align:right; font-weight:600; color:#18181b; width:100px;" id="crn-item-credit-${idx}">
                            ${_money((Number(it.reducedQty) || 0) * (Number(it.rate) || 0), _crn.currency)}
                        </td>
                    </tr>`;
            }).join('');

            itemsHtml = `
                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin:12px 0 6px;">Reduce Item Quantities (Optional)</label>
                <div style="border:1px solid rgba(0,0,0,0.08); border-radius:8px; overflow:hidden; margin-bottom:14px; background:#fafafa; max-height:200px; overflow-y:auto;">
                    <table style="width:100%; border-collapse:collapse; text-align:left;">
                        <thead>
                            <tr style="background:rgba(0,0,0,0.03); border-bottom:1px solid rgba(0,0,0,0.08); position:sticky; top:0; z-index:1;">
                                <th style="font-size:11px; font-weight:700; padding:8px 6px; color:#52525b;">Item</th>
                                <th style="font-size:11px; font-weight:700; text-align:center; padding:8px 6px; color:#52525b; width:70px;">Orig Qty</th>
                                <th style="font-size:11px; font-weight:700; text-align:right; padding:8px 6px; color:#52525b; width:80px;">Rate</th>
                                <th style="font-size:11px; font-weight:700; text-align:center; padding:8px 6px; color:#52525b; width:90px;">Reduce Qty</th>
                                <th style="font-size:11px; font-weight:700; text-align:right; padding:8px 6px; color:#52525b; width:100px;">Credit (exTax)</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        _openOverlay(`
            <div style="padding:20px 24px; border-bottom:1px solid rgba(0,0,0,0.07); display:flex; align-items:center; justify-content:space-between;">
                <div>
                    <div style="font-size:17px; font-weight:800; color:#18181b;">${editing ? 'Edit Credit Note' : 'Credit Note'}</div>
                    <div style="font-size:12px; color:#71717a; margin-top:2px;">Invoice ${_esc(_crn.invoiceRef)}</div>
                </div>
                <button onclick="Receipts._close()" style="border:none; background:transparent; font-size:22px; line-height:1; color:#a1a1aa; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:18px 24px;">
                <div style="background:rgba(243,123,33,0.07); border:1px solid rgba(243,123,33,0.18); border-radius:10px; padding:14px 16px; margin-bottom:18px;">
                    ${summary}
                </div>

                ${itemsHtml}

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Reference number <span style="color:#ef4444;">*</span></label>
                <input id="crn-number" type="text" value="${_esc(_crn.creditNoteNumber)}" placeholder="e.g. ORG/CN/001"
                    style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; margin-bottom:14px;">

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Credit note amount <span style="color:#ef4444;">*</span></label>
                <input id="crn-amount" type="number" min="0" step="0.01" value="${_crn.amount === '' ? '' : _crn.amount}" placeholder="How much credit will you give?"
                    oninput="Receipts._setCreditAmount(this.value)"
                    style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; margin-bottom:8px;">
                <button type="button" onclick="Receipts._fillCreditTotal(${_crn.grandTotal})" style="border:none; background:transparent; color:#004d2c; font-size:12px; font-weight:600; cursor:pointer; padding:0 0 14px;">Use total invoice amount (${_money(_crn.grandTotal, _crn.currency)})</button>

                ${gstToggle}

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin:2px 0 6px;">Reason / Notes</label>
                <textarea id="crn-reason" rows="2" placeholder="Optional"
                    style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; margin-bottom:14px; resize:vertical;">${_esc(_crn.reason)}</textarea>

                <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Date</label>
                <input id="crn-date" type="date" max="9999-12-31" value="${_crn.date}"
                    style="width:100%; padding:10px 12px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px;">
            </div>
            <div style="padding:16px 24px; border-top:1px solid rgba(0,0,0,0.07); display:flex; justify-content:flex-end; gap:10px;">
                <button onclick="Receipts._close()" class="btn btn-secondary">Cancel</button>
                <button onclick="Receipts.saveCreditNote()" class="btn btn-primary">${editing ? 'Update Credit Note' : 'Save Credit Note'}</button>
            </div>
        `, '650px');
    }

    function _crnGstBtn(inclusive, label) {
        const active = _crn && !!_crn.gstInclusive === inclusive;
        return `<button type="button" onclick="Receipts._setCreditGstMode(${inclusive})"
            style="flex:1; padding:9px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
            border:1px solid ${active ? 'var(--logo-green)' : 'rgba(0,0,0,0.15)'};
            background:${active ? 'var(--logo-green-soft)' : '#fff'};
            color:${active ? 'var(--logo-green)' : '#52525b'};">${label}</button>`;
    }

    // Resolve the entered amount into { net, gst, gross } using the invoice's GST
    // rate and the user's including/excluding choice.
    function _computeCredit() {
        const amount = Number(_crn.amount) || 0;
        const rate = Number(_crn.gstRate) || 0;
        if (!_crn.gstEnabled || rate <= 0) {
            return { net: FinanceUtils.truncate2(amount), gst: 0, gross: FinanceUtils.truncate2(amount) };
        }
        if (_crn.gstInclusive) {
            const net = FinanceUtils.truncate2(amount / (1 + rate / 100));
            return { net, gst: FinanceUtils.truncate2(amount - net), gross: FinanceUtils.truncate2(amount) };
        }
        // If Excluding GST option is chosen, do not add GST on top of the credit note amount
        return { net: FinanceUtils.truncate2(amount), gst: 0, gross: FinanceUtils.truncate2(amount) };
    }

    function _creditBreakdownHTML() {
        return '';
    }

    function _refreshCreditBreakdown() {
        const box = document.getElementById('crn-breakdown');
        if (box) box.innerHTML = _creditBreakdownHTML();
    }

    function _setCreditAmount(v) {
        if (!_crn) return;
        _crn.amount = v;
        _refreshCreditBreakdown();
    }

    function _setCreditGstMode(inclusive) {
        if (!_crn) return;
        _crn.gstInclusive = !!inclusive;
        const row = document.getElementById('crn-gst-row');
        if (row) row.innerHTML = _crnGstBtn(true, 'Including GST') + _crnGstBtn(false, 'Excluding GST');
        _refreshCreditBreakdown();
    }

    function _fillCreditTotal(v) {
        if (!_crn) return;
        const val = (Number(v) > 0) ? v : 0;
        // "Use total invoice amount" fills the grand total, so interpret it as inclusive.
        if (_crn.gstEnabled) _crn.gstInclusive = true;
        _crn.amount = val;
        const el = document.getElementById('crn-amount');
        if (el) el.value = val;
        const row = document.getElementById('crn-gst-row');
        if (row) row.innerHTML = _crnGstBtn(true, 'Including GST') + _crnGstBtn(false, 'Excluding GST');
        _refreshCreditBreakdown();
    }

    function _setItemReducedQty(idx, val) {
        if (!_crn || !_crn.items || !_crn.items[idx]) return;
        const item = _crn.items[idx];
        const num = Math.min(item.originalQty, Math.max(0, Number(val) || 0));
        item.reducedQty = num;
        
        const creditCell = document.getElementById(`crn-item-credit-${idx}`);
        if (creditCell) {
            creditCell.innerHTML = _money(num * (Number(item.rate) || 0), _crn.currency);
        }
        
        _recalcCreditFromItems();
    }

    function _recalcCreditFromItems() {
        if (!_crn || !_crn.items) return;
        const netCredit = FinanceUtils.truncate2(_crn.items.reduce((s, it) => s + FinanceUtils.truncate2((Number(it.reducedQty) || 0) * (Number(it.rate) || 0)), 0));
        
        let amount = netCredit;
        if (_crn.gstEnabled && _crn.gstInclusive) {
            amount = netCredit * (1 + (Number(_crn.gstRate) || 0) / 100);
        }
        amount = Math.round(amount * 100) / 100;
        _crn.amount = amount;
        
        const el = document.getElementById('crn-amount');
        if (el) el.value = amount === 0 ? '' : amount;
        
        _refreshCreditBreakdown();
    }

    function saveCreditNote() {
        if (!_crn) return;

        const amount = Number((document.getElementById('crn-amount') || {}).value);
        if (!amount || amount <= 0) { App.showToast('Enter a valid credit note amount', 'error'); return; }
        _crn.amount = amount;

        const c = _computeCredit();
        if (_crn.grandTotal > 0 && c.gross > _crn.grandTotal + 0.01) {
            App.showToast('Credit note amount cannot exceed the invoice total', 'error');
            return;
        }

        const dateEl = document.getElementById('crn-date');
        const date = dateEl && dateEl.value ? dateEl.value : _todayISO();
        const reason = (document.getElementById('crn-reason') || {}).value || '';

        // The reference number is user-editable; fall back to the auto series only
        // when the field was cleared, and only then consume a serial.
        let creditNoteNumber = ((document.getElementById('crn-number') || {}).value || '').trim();
        if (!creditNoteNumber) {
            if (_crn.editId) {
                const existing = Storage.getSalesReturn(_crn.editId);
                creditNoteNumber = existing ? (existing.creditNoteNumber || existing.refNumber) : '';
            } else {
                const fy = Storage.getFinancialYear(date);
                const serial = Storage.incrementSerialNumber('CN', '', fy);
                creditNoteNumber = `${Storage.getOrgInfo().serialPrefix}/CN/${String(serial).padStart(3, '0')}`;
            }
        }
        const clash = (Storage.getAllSalesReturns() || [])
            .some(r => r.id !== _crn.editId && (r.creditNoteNumber || '').trim().toLowerCase() === creditNoteNumber.toLowerCase());
        if (clash) { App.showToast(`Reference number ${creditNoteNumber} is already used`, 'error'); return; }
        _crn.creditNoteNumber = creditNoteNumber;

        const itemsToSave = (_crn.items || [])
            .filter(it => (Number(it.reducedQty) || 0) > 0)
            .map(it => ({
                sno: it.sno,
                specification: it.specification,
                qty: Number(it.reducedQty),
                originalQty: it.originalQty,
                uom: it.uom,
                rate: Number(it.rate) || 0,
                amount: (Number(it.reducedQty) || 0) * (Number(it.rate) || 0)
            }));

        Storage.saveSalesReturn({
            id: _crn.editId || undefined,
            invoiceId: _crn.invId,
            invoiceRef: _crn.invoiceRef,
            creditNoteNumber,
            date,
            invoiceTotal: _crn.total,
            invoiceSubtotal: _crn.subtotal,
            creditAmount: c.gross,
            creditNet: c.net,
            creditGst: c.gst,
            gstEnabled: _crn.gstEnabled,
            gstRate: _crn.gstRate,
            gstInclusive: _crn.gstInclusive,
            currency: _crn.currency,
            clientName: _crn.clientName,
            reason: reason.trim(),
            items: itemsToSave
        });

        _closeOverlay();
        App.showToast(`Credit note ${creditNoteNumber} ${_crn.editId ? 'updated' : 'saved to Sales Returns'}`, 'success');
        renderSalesReturns();
    }

    // ========================================================================
    // DASHBOARDS
    // ========================================================================
    function renderReceipts() {
        const container = document.getElementById('receipts-content');
        if (!container) return;

        Dashboard.registerClientFilter('rcp', () => Storage.getAllReceipts(),
            () => { _rcpPage = 1; renderReceipts(); });

        if (!_rcpFilter) _rcpFilter = _defaultReceiptFilter();
        let receipts = _applyReceiptFilter(Storage.getAllReceipts());
        const rcpClientSel = Dashboard.clientSelection('rcp');
        if (rcpClientSel.size) receipts = receipts.filter(r => rcpClientSel.has((r.clientName || '').trim()));
        const q = (_rcpSearch || '').trim().toLowerCase();
        if (q) {
            receipts = receipts.filter(r => [
                r.receiptNumber, r.invoiceRef, r.clientName, r.chequeNumber, r.bankName,
                r.isAdvance ? 'advance receipt' : ''
            ].some(f => String(f || '').toLowerCase().includes(q)));
        }
        const totalReceived = receipts.reduce((s, r) => s + (Number(r.amountReceived) || 0), 0);
        const homeCur = Storage.getOrgInfo().defaultCurrency || 'INR';

        const modeLabel = { cash: 'Cash', cheque: 'Cheque', bank: 'Bank' };

        // Paginate.
        const total = receipts.length;
        const totalPages = Math.max(1, Math.ceil(total / _rcpPageSize));
        if (_rcpPage > totalPages) _rcpPage = totalPages;
        const pageItems = receipts.slice((_rcpPage - 1) * _rcpPageSize, _rcpPage * _rcpPageSize);

        const rows = pageItems.map(r => {
            let modeCell = modeLabel[r.mode] || r.mode || '-';
            if (r.mode === 'cheque' && r.chequeNumber) modeCell += ` (${_esc(r.chequeNumber)})`;
            else if (r.mode === 'bank' && r.bankName) modeCell += ` (${_esc(r.bankName)})`;

            // Money worth more in rupees than the invoice was booked at is a gain
            // (green); less is a loss (red).
            const fx = _receiptINR(r);
            let fxCell = '—';
            if (fx.diff !== null) {
                fxCell = `<span style="font-weight:700; color:${fx.diff >= 0 ? '#0a7a4a' : '#dc2626'};"
                                title="Exchange ${fx.diff >= 0 ? 'gain' : 'loss'}">${fx.diff >= 0 ? '+' : '−'}${_money(Math.abs(fx.diff), 'INR')}</span>`;
            } else if (fx.closable) {
                // Still collecting — nothing is realised until the invoice is closed.
                fxCell = `<span style="font-size:11px; font-weight:600; color:#a16207; background:rgba(161,98,7,0.10); border-radius:999px; padding:2px 8px; white-space:nowrap;"
                                title="Close the invoice to realise the exchange gain or loss">Pending close</span>`;
            }
            return `
                <tr>
                    <td style="font-weight:600;">${_esc(r.receiptNumber || '-')}</td>
                    <td>${_fmtDate(r.date)}</td>
                    <td>${r.isAdvance ? '<span style="color:#f37b21; font-weight:600;">Advance Receipt</span>' : _esc(r.invoiceRef || '-')}</td>
                    <td>${_esc(r.clientName || '-')}</td>
                    <td style="white-space:nowrap; color:#71717a;">${_money(r.invoiceTotal, r.currency)}</td>
                    <td style="white-space:nowrap; color:#71717a;">${fx.invoiceTotalINR === null ? '—' : _money(fx.invoiceTotalINR, 'INR')}</td>
                    <td style="font-weight:600; white-space:nowrap; color:#0a7a4a;">${_money(r.amountReceived, r.currency)}</td>
                    <td style="font-weight:600; white-space:nowrap; color:#0a7a4a;">${fx.receivedINR === null ? '—' : _money(fx.receivedINR, 'INR')}</td>
                    <td style="white-space:nowrap;">${fxCell}</td>
                    <td>${modeCell}</td>
                    <td style="text-align:right; white-space:nowrap;">
                        <div style="display:inline-flex; gap:6px; align-items:center; justify-content:flex-end;">
                            <button class="btn-row-actions" style="display:inline-flex; align-items:center; justify-content:center;" title="View" aria-label="View" onclick="Receipts.viewReceipt('${r.id}')">${_IC_EYE}</button>
                            <button class="btn-row-actions" style="display:inline-flex; align-items:center; justify-content:center;" title="Download" aria-label="Download" onclick="Receipts.downloadReceipt('${r.id}')">${_IC_DOWNLOAD}</button>
                            <button class="btn-row-actions" title="More actions" aria-label="More actions" onclick="Receipts._toggleRowMenu(event,'rcp','${r.id}')">⋮</button>
                        </div>
                    </td>
                </tr>`;
        }).join('');

        const anyReceipts = Storage.getAllReceipts().length > 0;
        const emptyMsg = anyReceipts
            ? 'No receipts in the selected period. Adjust the Timeline filter to see more.'
            : 'No receipts recorded yet. Use the &ldquo;Receipt&rdquo; action on an invoice in the dashboard, or add an Advance Receipt.';
        const body = rows || `<tr><td colspan="11" style="padding:40px 20px; text-align:center; color:#a1a1aa; font-size:13px;">${emptyMsg}</td></tr>`;

        container.innerHTML = `
            <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:16px;">
                <div class="page-header-back">
                    <button type="button" class="btn btn-secondary" onclick="App.navigateTo('invoice')"
                        style="display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                        <span>Back to Dashboard</span>
                    </button>
                </div>
                <div>
                    <h1>Receipts</h1>
                    <p>Payments received against invoices</p>
                </div>
                <button onclick="Receipts.openAdvanceReceiptModal()" class="btn btn-primary" style="margin-bottom:6px; white-space:nowrap;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Advance Receipt
                </button>
            </div>
            <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:18px;">
                ${_statCard('Receipts recorded', String(receipts.length), _IC.receipt)}
                ${_statCard('Total received', _money(totalReceived, homeCur), _IC.wallet)}
            </div>
            ${_receiptFilterHTML()}
            <div class="recent-table">
                <table>
                    <thead>
                        <tr>
                            <th>Receipt No.</th><th>Date Created</th><th>Invoice Ref</th><th>Client</th>
                            <th>Invoice Total</th><th>INR</th><th>Received</th><th>INR</th>
                            <th>Exchange Loss/Gain</th><th>Mode</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
            ${_paginationHTML(total, _rcpPage, _rcpPageSize, 'setReceiptPage', 'setReceiptPageSize', 'receipts')}`;
    }

    function renderSalesReturns() {
        const container = document.getElementById('sales-returns-content');
        if (!container) return;

        Dashboard.registerClientFilter('ret', () => Storage.getAllSalesReturns(),
            () => { _retPage = 1; renderSalesReturns(); });

        const returns = Storage.getAllSalesReturns();

        // Filter by GST mode
        let filteredReturns = returns;
        if (_retGstFilter === 'inclusive') {
            filteredReturns = returns.filter(r => r.gstEnabled && r.gstInclusive);
        } else if (_retGstFilter === 'exclusive') {
            filteredReturns = returns.filter(r => r.gstEnabled && !r.gstInclusive);
        }

        const retClientSel = Dashboard.clientSelection('ret');
        const retQ = (_retSearch || '').trim().toLowerCase();
        filteredReturns = filteredReturns.filter(r => {
            if (retClientSel.size && !retClientSel.has((r.clientName || '').trim())) return false;
            if (retQ && ![r.creditNoteNumber, r.invoiceRef, r.clientName, r.reason]
                .some(v => String(v || '').toLowerCase().includes(retQ))) return false;
            return true;
        });

        const totalCredit = filteredReturns.reduce((s, r) => s + (Number(r.creditAmount) || 0), 0);
        const homeCur = Storage.getOrgInfo().defaultCurrency || 'INR';

        // Paginate.
        const total = filteredReturns.length;
        const totalPages = Math.max(1, Math.ceil(total / _retPageSize));
        if (_retPage > totalPages) _retPage = totalPages;
        const pageItems = filteredReturns.slice((_retPage - 1) * _retPageSize, _retPage * _retPageSize);

        const rows = pageItems.map(r => `
            <tr>
                <td style="width:44px; padding-right:0;">${_rowBadge(_ROW_DOC)}</td>
                <td style="font-weight:600;">${_esc(r.creditNoteNumber || '-')}</td>
                <td>${_fmtDate(r.date)}</td>
                <td style="font-weight:600; color:#71717a;">${_esc(r.invoiceRef || '-')}</td>
                <td>${_esc(r.clientName || '-')}</td>
                <td style="white-space:nowrap; color:#71717a;">${_money(r.invoiceTotal, r.currency)}</td>
                <td style="font-weight:600; white-space:nowrap; color:#f37b21;">${_money(r.creditAmount, r.currency)}</td>
                <td>${_esc(r.reason || '—')}</td>
                <td style="text-align:right; white-space:nowrap;">
                    <button class="btn-row-actions" title="Actions" aria-label="Actions" onclick="Receipts._toggleRowMenu(event,'ret','${r.id}')">⋮</button>
                </td>
            </tr>`).join('');

        const body = rows || `<tr><td colspan="9" style="padding:40px 20px; text-align:center; color:#a1a1aa; font-size:13px;">No credit notes matching filter. Use the &ldquo;Credit Note&rdquo; action on an invoice in the dashboard.</td></tr>`;

        // Render header with GST Filter pills
        container.innerHTML = `
            <div class="page-header" style="display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:16px;">
                <div>
                    <h1>Sales Returns</h1>
                    <p>Credit notes raised against invoices</p>
                </div>
                <div style="display:inline-flex; background:rgba(0,0,0,0.05); padding:4px; border-radius:10px; gap:2px; margin-bottom: 6px;">
                    <button type="button" onclick="Receipts.setGstFilter('all')" style="padding:7px 16px; font-size:12px; font-weight:600; border:none; border-radius:7px; cursor:pointer; transition:all .15s; ${_retGstFilter === 'all' ? 'background:#fff; color:#18181b; box-shadow:0 1px 3px rgba(0,0,0,0.10);' : 'background:transparent; color:#71717a;' }">All</button>
                    <button type="button" onclick="Receipts.setGstFilter('inclusive')" style="padding:7px 16px; font-size:12px; font-weight:600; border:none; border-radius:7px; cursor:pointer; transition:all .15s; ${_retGstFilter === 'inclusive' ? 'background:#fff; color:#18181b; box-shadow:0 1px 3px rgba(0,0,0,0.10);' : 'background:transparent; color:#71717a;' }">Including GST</button>
                    <button type="button" onclick="Receipts.setGstFilter('exclusive')" style="padding:7px 16px; font-size:12px; font-weight:600; border:none; border-radius:7px; cursor:pointer; transition:all .15s; ${_retGstFilter === 'exclusive' ? 'background:#fff; color:#18181b; box-shadow:0 1px 3px rgba(0,0,0,0.10);' : 'background:transparent; color:#71717a;' }">Excluding GST</button>
                </div>
            </div>
            <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:18px;">
                ${_statCard('Credit notes', String(filteredReturns.length), _IC.note)}
                ${_statCard('Total credited', _money(totalCredit, homeCur), _IC.refund)}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:16px;">
                <div style="position:relative; flex:1 1 260px; max-width:380px; min-width:200px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="ret-search-input" type="text" value="${_esc(_retSearch)}" placeholder="Search CN ref, invoice, client…"
                        oninput="Dashboard.keepFocus(Receipts._setReturnSearch.bind(null, this.value))"
                        style="width:100%; box-sizing:border-box; padding:9px 12px 9px 36px; font-size:13px; color:#18181b; background:#fff; border:1px solid rgba(0,0,0,0.12); border-radius:10px;">
                </div>
                ${Dashboard.renderClientFilter('ret', { width: 180 })}
                <div style="flex:1 1 auto;"></div>
            </div>
            <div class="recent-table">
                <table>
                    <thead>
                        <tr>
                            <th></th><th>CN Ref</th><th>Date</th><th>Invoice Ref</th><th>Client</th>
                            <th>Invoice Total</th><th>Credit Amount</th><th>Reason</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
            ${_paginationHTML(total, _retPage, _retPageSize, 'setReturnPage', 'setReturnPageSize', 'credit notes')}`;
    }

    function _paginationHTML(total, page, pageSize, fnPage, fnSize, noun) {
        return Dashboard.renderPagination({
            page, pageSize, total, noun,
            onPage: `Receipts.${fnPage}`, onSize: `Receipts.${fnSize}`
        });
    }

    function setReceiptPage(p) {
        _rcpPage = Math.max(1, p);
        renderReceipts();
    }
    function setReceiptPageSize(n) {
        _rcpPageSize = n;
        _rcpPage = 1;
        renderReceipts();
    }
    function setReturnPage(p) {
        _retPage = Math.max(1, p);
        renderSalesReturns();
    }
    function setReturnPageSize(n) {
        _retPageSize = n;
        _retPage = 1;
        renderSalesReturns();
    }

    function _statCard(label, value, iconSvg) {
        return `
            <div style="flex:1 1 200px; min-width:200px; background:#fff; border:1px solid rgba(0,0,0,0.06); border-radius:14px; padding:18px 22px; box-shadow:0 2px 10px rgba(0,0,0,0.03); display:flex; align-items:center; gap:16px;">
                <div style="width:56px; height:56px; border-radius:14px; background:rgba(0,77,44,0.08); color:#004d2c; display:flex; align-items:center; justify-content:center; flex:0 0 auto;">${iconSvg || ''}</div>
                <div style="min-width:0;">
                    <div style="font-size:12px; color:#71717a; font-weight:600; margin-bottom:6px;">${label}</div>
                    <div style="font-size:24px; font-weight:800; color:#18181b; letter-spacing:-0.5px;">${value}</div>
                </div>
            </div>`;
    }

    // --- icon set (Lucide-style, stroke = currentColor) ----------------------
    const _IC = {
        receipt: '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/></svg>',
        wallet: '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
        note: '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        refund: '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>'
    };

    // Small leading-cell badge icon for table rows.
    function _rowBadge(iconSvg) {
        return `<span style="width:36px; height:36px; border-radius:50%; background:rgba(0,77,44,0.08); color:#004d2c; display:inline-flex; align-items:center; justify-content:center;">${iconSvg}</span>`;
    }

    const _ROW_DOC = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    // Row action icons pulled out of the ⋮ menu (View + Download).
    const _IC_EYE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const _IC_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

    function deleteReceipt(id) {
        App.showConfirm('Delete receipt', 'Are you sure you want to delete this receipt? This cannot be undone.', () => {
            Storage.deleteReceipt(id);
            renderReceipts();
            if (typeof Dashboard !== 'undefined' && Dashboard.render) Dashboard.render();
            App.showToast('Receipt deleted', 'success');
        });
    }

    function deleteSalesReturn(id) {
        App.showConfirm('Delete credit note', 'Are you sure you want to delete this credit note? This cannot be undone.', () => {
            Storage.deleteSalesReturn(id);
            renderSalesReturns();
            App.showToast('Credit note deleted', 'success');
        });
    }

    // ========================================================================
    // Row actions menu (View / Edit / Delete) — shared by both tables
    // ========================================================================
    let _rowMenuBtn = null;

    function _closeRowMenu() {
        const m = document.getElementById('receipts-row-popup');
        if (m) m.remove();
        _rowMenuBtn = null;
        document.removeEventListener('click', _closeRowMenuOutside, true);
    }

    function _closeRowMenuOutside(e) {
        const m = document.getElementById('receipts-row-popup');
        if (m && !m.contains(e.target) && e.target !== _rowMenuBtn) _closeRowMenu();
    }

    function _toggleRowMenu(event, kind, id) {
        event.stopPropagation();
        const trigger = event.currentTarget;
        const wasSame = document.getElementById('receipts-row-popup') && _rowMenuBtn === trigger;
        _closeRowMenu();
        if (wasSame) return;

        _rowMenuBtn = trigger;
        const menu = document.createElement('div');
        menu.id = 'receipts-row-popup';
        menu.className = 'row-actions-popup';
        const edit = kind === 'rcp' ? `Receipts.editReceipt('${id}')` : `Receipts.editSalesReturn('${id}')`;
        const del = kind === 'rcp' ? `Receipts.deleteReceipt('${id}')` : `Receipts.deleteSalesReturn('${id}')`;
        // Receipts surface View + Download as inline row icons, so the menu only
        // holds Edit/Delete. Sales returns keep View in the menu.
        const viewBtn = kind === 'rcp'
            ? ''
            : `<button onclick="Receipts._closeRowMenu(); Receipts.viewSalesReturn('${id}');">View</button>`;
        const clientPdfBtn = kind === 'rcp'
            ? `<button onclick="Receipts._closeRowMenu(); Receipts.downloadClientReceipt('${id}');">Client PDF</button>`
            : '';
        // Only forex receipts with a rated invoice can be closed; the label flips
        // once the invoice is closed so the action can be undone.
        let closeBtn = '';
        if (kind === 'rcp') {
            const fx = _receiptINR(Storage.getReceipt(id) || {});
            if (fx.closable) {
                closeBtn = fx.closed
                    ? `<button onclick="Receipts._closeRowMenu(); Receipts.reopenInvoiceForex('${id}');">Reopen invoice</button>`
                    : `<button onclick="Receipts._closeRowMenu(); Receipts.closeInvoiceForex('${id}');">Close invoice</button>`;
            }
        }
        menu.innerHTML = `
            ${viewBtn}
            ${clientPdfBtn}
            ${closeBtn}
            <button onclick="Receipts._closeRowMenu(); ${edit};">Edit</button>
            <button class="danger" onclick="Receipts._closeRowMenu(); ${del};">Delete</button>`;
        document.body.appendChild(menu);

        const rect = trigger.getBoundingClientRect();
        let left = rect.right - menu.offsetWidth;
        if (left < 8) left = 8;
        let top = rect.bottom + 6;
        if (top + menu.offsetHeight > window.innerHeight - 8) top = rect.top - menu.offsetHeight - 6;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        setTimeout(() => document.addEventListener('click', _closeRowMenuOutside, true), 0);
    }

    // ========================================================================
    // View (read-only) — receipts open as a PDF; sales returns render via Invoice.
    // ========================================================================
    // "Mode of Payment" cell — just the method: Cash / Cheque / Bank.
    function _modeLabelText(r) {
        return ({ cash: 'Cash', cheque: 'Cheque', bank: 'Bank' })[r.mode] || r.mode || '-';
    }

    // "Bank / Cheque Details" cell — the cheque number, or the bank name +
    // account number (each on its own line). Cash has no extra details.
    function _modeDetailText(r) {
        if (r.mode === 'cheque') return r.chequeNumber ? 'Cheque No. ' + r.chequeNumber : '-';
        if (r.mode === 'bank') {
            const parts = [];
            if (r.bankName) parts.push(r.bankName);
            if (r.bankAccount) parts.push('A/c ' + r.bankAccount);
            return parts.length ? parts.join('\n') : '-';
        }
        return '-';
    }

    // Client details for the receipt PDF's "From" block. A normal receipt pulls
    // address / contact / GST from its linked invoice; an advance receipt (no
    // invoice) resolves the saved client from the vendor list by name + type.
    function _receiptClientDetails(r) {
        if (r.invoiceId) {
            const inv = Storage.getInvoice(r.invoiceId);
            if (inv) {
                return {
                    name: r.clientName || inv.clientName || '-',
                    address: inv.clientAddress || '',
                    contactPerson: inv.clientContactPerson || '',
                    gst: inv.clientGST || '',
                    contact: inv.clientContact || '',
                    email: inv.clientEmail || ''
                };
            }
        }
        const type = r.clientType || 'domestic';
        const v = (Storage.getAllVendors() || []).find(x =>
            x.name === r.clientName && (x.clientType || 'domestic') === type);
        return {
            name: r.clientName || '-',
            address: v ? (v.address || '') : '',
            contactPerson: v ? (v.contactPerson || '') : '',
            gst: v ? (v.gst || '') : '',
            contact: v ? (v.contact || v.phone || '') : '',
            email: v ? (v.email || '') : ''
        };
    }

    // Build a single-receipt PDF (letterhead + slanted bar + details table),
    // matching the look of the Receipts Report. Shared by view + download.
    async function _buildReceiptDoc(r, flatten = true) {
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        let doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 10;
        const contentWidth = pageWidth - 2 * margin;
        const curFont = PdfUtils.registerCurrencyFont(doc);
        const tableFont = curFont || 'helvetica';
        let y = 5;

        const logo = await PdfUtils.getLogoBase64();
        y = PdfUtils.drawLetterhead(doc, logo, pageWidth, margin, y, true);

        // Slanted green/orange bar (same look as the other report PDFs).
        const greenWidth = contentWidth * 0.82, slantWidth = 4, barH = 2;
        doc.setFillColor(243, 123, 33);
        doc.rect(margin, y, contentWidth, barH, 'F');
        doc.setFillColor(0, 77, 44);
        doc.lines([[greenWidth + slantWidth, 0], [-slantWidth, barH], [-greenWidth, 0]], margin, y, [1, 1], 'F', true);
        y += 12;

        // Centred heading.
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(0, 77, 44);
        doc.text(r.isAdvance ? 'Advance Receipt' : 'Receipt', pageWidth / 2, y, { align: 'center' });
        y += 9;

        const tableStyles = { font: tableFont, fontSize: 9.5, cellPadding: 2.6, textColor: [45, 45, 45], lineColor: [222, 226, 224], lineWidth: 0.1, halign: 'center', valign: 'middle', overflow: 'linebreak' };
        const headStyles = { font: tableFont, fontStyle: 'bold', fontSize: 9.5, fillColor: [0, 77, 44], textColor: [255, 255, 255], lineColor: [0, 77, 44], lineWidth: 0.1, halign: 'center', valign: 'middle' };

        // ---- TO (left) + Receipt No./Date (right) — invoice-style header ----
        const client = _receiptClientDetails(r);
        const blockTopY = y;

        // Right column — Receipt No. + Date, top-aligned with TO.
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        let metaY = blockTopY;
        doc.text(`Receipt No.: ${r.receiptNumber || '-'}`, pageWidth - margin, metaY, { align: 'right' });
        metaY += 5;
        doc.text(`Date: ${_fmtDate(r.date)}`, pageWidth - margin, metaY, { align: 'right' });

        // Left column — From: with an orange underline, then client details.
        y = blockTopY;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(0, 77, 44);
        doc.text('From:', margin, y);
        doc.setDrawColor(243, 123, 33);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 1.5, margin + 80, y + 1.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        const clientNameLines = doc.splitTextToSize(client.name || '', 80);
        doc.text(clientNameLines, margin, y + 6);

        let addrY = y + 6 + (clientNameLines.length * 4.5) + 0.5;
        doc.setFont('helvetica', 'normal');
        if (client.address) {
            client.address.split('\n').forEach(line => {
                doc.splitTextToSize(line, 80).forEach(l => { doc.text(l, margin, addrY); addrY += 4.5; });
            });
        }
        doc.setFont('helvetica', 'normal');
        if (client.contactPerson) { doc.text(client.contactPerson, margin, addrY); addrY += 4.5; }
        if (client.contact) { doc.text(client.contact, margin, addrY); addrY += 4.5; }
        if (client.email) { doc.text(client.email, margin, addrY); addrY += 4.5; }
        if (client.gst) { doc.setFont('helvetica', 'bold'); doc.text('GST: ' + client.gst, margin, addrY); addrY += 4.5; }

        y = Math.max(addrY, metaY + 5) + 4;

        // ---- Advance receipts: order details table first (fields entered) ----
        if (r.isAdvance) {
            const orderCols = [
                { label: 'Order Date', value: r.orderDate ? _fmtDate(r.orderDate) : '' },
                { label: 'Order Reference Number', value: r.orderRef || '' },
                { label: 'Project Code', value: r.projectCode || '' },
                { label: 'Data Shipped Via', value: r.shippedVia || '' }
            ].filter(c => c.value && String(c.value).trim());

            if (orderCols.length) {
                doc.autoTable({
                    startY: y,
                    head: [orderCols.map(c => c.label)],
                    body: [orderCols.map(c => c.value)],
                    theme: 'grid',
                    styles: tableStyles,
                    headStyles,
                    margin: { left: margin, right: margin }
                });
                y = doc.lastAutoTable.finalY + 5;
            }
        }

        // ---- Main table. Mode + its bank/cheque details are separate columns;
        //      advance receipts drop the invoice columns. ----
        const isIntl = r.currency && r.currency !== 'INR';
        const isCash = r.mode === 'cash';

        const headCols = [];
        const bodyCols = [];

        if (r.isAdvance) {
            headCols.push('Received Amount');
            bodyCols.push(_money(r.amountReceived, r.currency));
        } else {
            headCols.push('Invoice Ref', 'Invoice Total', 'Received');
            bodyCols.push(
                r.invoiceRef || '-',
                Number(r.invoiceTotal) > 0 ? _money(r.invoiceTotal, r.currency) : '-',
                _money(r.amountReceived, r.currency)
            );
        }

        if (isIntl) {
            headCols.push('Booking Rate', 'Bank Charges', 'Amount in INR');
            bodyCols.push(
                r.bookingRate || '-',
                r.bankCharges ? _money(r.bankCharges, 'INR') : '-',
                r.amountInINR ? _money(r.amountInINR, 'INR') : '-'
            );
        }

        headCols.push('Mode of Payment');
        bodyCols.push(_modeLabelText(r));

        if (!isCash) {
            headCols.push('Bank / Cheque Details');
            bodyCols.push(_modeDetailText(r));
        }

        const head = [headCols];
        const body = [bodyCols];

        // Add Amount in Words row inside the table (matches invoice tables)
        const amtWords = PdfUtils.amountInWords(r.amountReceived, r.currency);
        if (amtWords) {
            const totalCols = headCols.length;
            body.push([
                {
                    content: amtWords,
                    colSpan: totalCols,
                    styles: {
                        halign: 'left',
                        fontStyle: 'bold',
                        textColor: [51, 51, 51],
                        lineColor: [222, 226, 224],
                        lineWidth: 0.1
                    }
                }
            ]);
        }

        doc.autoTable({
            startY: y,
            head,
            body,
            theme: 'grid',
            styles: tableStyles,
            headStyles,
            margin: { left: margin, right: margin }
        });
        y = doc.lastAutoTable.finalY;



        // ---- Remarks (heading + text) — only when the receipt has remarks ----
        const remarks = (r.remarks || '').trim();
        if (remarks) {
            let ry2 = y + 8;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('Remarks', margin, ry2);
            doc.setDrawColor(243, 123, 33);
            doc.setLineWidth(0.5);
            doc.line(margin, ry2 + 1.5, margin + 40, ry2 + 1.5);
            ry2 += 7;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.setTextColor(51, 51, 51);
            doc.text(doc.splitTextToSize(remarks, contentWidth), margin, ry2);
        }

        // Flatten only for the downloaded file; the preview skips it and opens fast.
        return flatten ? await PdfUtils.flattenToImagePdf(doc) : doc;
    }

    // View a receipt as a PDF in a new browser tab.
    async function viewReceipt(id) {
        const r = Storage.getReceipt(id);
        if (!r) { App.showToast('Receipt not found', 'error'); return; }
        const win = window.open('', '_blank');
        try {
            const doc = await _buildReceiptDoc(r, false);
            PdfUtils.openPdfPreview(doc, win, `${r.receiptNumber || 'Receipt'} Preview`);
        } catch (e) {
            if (win) win.close();
            console.error('Receipt view error', e);
            App.showToast('Could not open receipt: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    // Download a single receipt as a PDF.
    async function downloadReceipt(id) {
        const r = Storage.getReceipt(id);
        if (!r) { App.showToast('Receipt not found', 'error'); return; }
        try {
            const doc = await _buildReceiptDoc(r);
            doc.save(`${(r.receiptNumber || 'Receipt').replace(/[^\w]+/g, '_')}.pdf`);
            App.showToast('Receipt downloaded.', 'success');
        } catch (e) {
            console.error('Receipt download error', e);
            App.showToast('Could not download receipt: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    // Helper to generate the structured narration text based on payment mode and receipt type
    // Generate the dedicated Client PDF document structure
    async function _buildClientReceiptDoc(r) {
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        let doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 10;
        const contentWidth = pageWidth - 2 * margin;
        const curFont = PdfUtils.registerCurrencyFont(doc);
        let y = 5;

        const logo = await PdfUtils.getLogoBase64();
        y = PdfUtils.drawLetterhead(doc, logo, pageWidth, margin, y, true);

        // Slanted green/orange bar (same look as the other report PDFs)
        const greenWidth = contentWidth * 0.82, slantWidth = 4, barH = 2;
        doc.setFillColor(243, 123, 33);
        doc.rect(margin, y, contentWidth, barH, 'F');
        doc.setFillColor(0, 77, 44);
        doc.lines([[greenWidth + slantWidth, 0], [-slantWidth, barH], [-greenWidth, 0]], margin, y, [1, 1], 'F', true);
        y += 12;

        // Centred heading (always "Receipt" for clients)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(0, 77, 44);
        doc.text('Receipt', pageWidth / 2, y, { align: 'center' });
        y += 9;

        // TO (left) + Receipt No./Date (right)
        const client = _receiptClientDetails(r);
        const blockTopY = y;

        // Right column — Receipt No. + Date
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        let metaY = blockTopY;
        doc.text(`Receipt No.: ${r.receiptNumber || '-'}`, pageWidth - margin, metaY, { align: 'right' });
        metaY += 5;
        doc.text(`Date: ${_fmtDate(r.date)}`, pageWidth - margin, metaY, { align: 'right' });

        // Left column — From:
        y = blockTopY;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(0, 77, 44);
        doc.text('From:', margin, y);
        doc.setDrawColor(243, 123, 33);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 1.5, margin + 40, y + 1.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        const clientNameLines = doc.splitTextToSize(client.name || '', 80);
        doc.text(clientNameLines, margin, y + 6);

        let addrY = y + 6 + (clientNameLines.length * 4.5) + 0.5;
        doc.setFont('helvetica', 'normal');
        if (client.address) {
            client.address.split('\n').forEach(line => {
                doc.splitTextToSize(line, 80).forEach(l => { doc.text(l, margin, addrY); addrY += 4.5; });
            });
        }
        doc.setFont('helvetica', 'normal');
        if (client.contactPerson) { doc.text(client.contactPerson, margin, addrY); addrY += 4.5; }
        if (client.contact) { doc.text(client.contact, margin, addrY); addrY += 4.5; }
        if (client.email) { doc.text(client.email, margin, addrY); addrY += 4.5; }
        if (client.gst) { doc.setFont('helvetica', 'bold'); doc.text('GST: ' + client.gst, margin, addrY); addrY += 4.5; }
        y = Math.max(addrY, metaY + 5) + 8;

        // ---- Towards heading ----
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(0, 77, 44);
        doc.text('Towards', margin, y);
        doc.setDrawColor(243, 123, 33);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 1.5, margin + 20, y + 1.5);
        
        // ---- Amount Box adjacent on the right ----
        const rightEdge = pageWidth - margin;
        const boxWidth = 50;
        const boxHeight = 11;
        const boxX = rightEdge - boxWidth;
        const boxY = y - 2;
        
        doc.setDrawColor(0, 77, 44);
        doc.setLineWidth(0.5);
        doc.setFillColor(232, 245, 236);
        doc.roundedRect(boxX, boxY, boxWidth, boxHeight, 1.5, 1.5, 'FD');
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(0, 77, 44);
        if (curFont) doc.setFont(curFont, 'bold');
        const amtText = _money(r.amountReceived, r.currency);
        doc.text(amtText, boxX + (boxWidth / 2), boxY + 7, { align: 'center' });
        
        // Reset to standard font
        doc.setFont('helvetica', 'normal');
        
        // ---- Value of Towards on the left ----
        y += 7.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(51, 51, 51);
        const towardsText = r.isAdvance || !r.invoiceId ? 'Advance Payment' : `Invoice No. ${r.invoiceRef || '-'}`;
        const towardsLines = doc.splitTextToSize(towardsText, 110);
        doc.text(towardsLines, margin, y);
        const towardsBottomY = y + (towardsLines.length * 4.5);
        
        // ---- Amount in Words below the box ----
        const wordsY = boxY + boxHeight + 4.5;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(82, 82, 91);
        const wordsText = 'Amount in words: ' + PdfUtils.amountInWords(r.amountReceived, r.currency);
        const wordsLines = doc.splitTextToSize(wordsText, 100);
        let curWordsY = wordsY;
        wordsLines.forEach(line => {
            doc.text(line, rightEdge, curWordsY, { align: 'right' });
            curWordsY += 4;
        });
        
        // Reset standard font
        doc.setFont('helvetica', 'normal');
        
        // Update y to flow below both columns
        y = Math.max(towardsBottomY, curWordsY) + 8;

        // ---- Remarks (if present) ----
        const remarks = (r.remarks || '').trim();
        if (remarks) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('Remarks', margin, y);
            doc.setDrawColor(243, 123, 33);
            doc.setLineWidth(0.5);
            doc.line(margin, y + 1.5, margin + 20, y + 1.5);
            y += 7.5;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.setTextColor(51, 51, 51);
            doc.text(doc.splitTextToSize(remarks, contentWidth), margin, y);
            y += 15;
        }

        // ---- Authorized Signatory signature/stamp box at bottom right ----
        let sigY = y + 12;
        if (sigY + 25 > 285) {
            doc.addPage();
            sigY = 20;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        doc.text('For ' + (PdfUtils.activeCompany().name || ''), rightEdge, sigY, { align: 'right' });
        
        // Print " - SD " placeholder centered over "Authorized signatory"
        // Equal spacing: 7mm above SD, 7mm below SD.
        sigY += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        const authSignW = doc.getTextWidth('Authorized signatory');
        const authSignCenter = rightEdge - authSignW / 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(51, 51, 51);
        doc.text(' - SD ', authSignCenter, sigY, { align: 'center' });
        sigY += 7;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(90, 90, 90);
        doc.text('Authorized signatory', rightEdge, sigY, { align: 'right' });

        return await PdfUtils.flattenToImagePdf(doc);
    }

    // Download client receipt as PDF
    async function downloadClientReceipt(id) {
        const r = Storage.getReceipt(id);
        if (!r) { App.showToast('Receipt not found', 'error'); return; }
        try {
            const doc = await _buildClientReceiptDoc(r);
            doc.save(`Client_${(r.receiptNumber || 'Receipt').replace(/[^\w]+/g, '_')}.pdf`);
            App.showToast('Client receipt downloaded.', 'success');
        } catch (e) {
            console.error('Client receipt download error', e);
            App.showToast('Could not download client receipt: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    // Build the narrations list for a credit note PDF: the reason/remarks the
    // user entered when creating the credit note is shown first, followed by any
    // narrations carried over from the credit note or its source invoice.
    function _creditNoteNarrations(r, inv) {
        const terms = (r.termsAndConditions || inv.termsAndConditions || []).slice();
        const reason = (r.reason || '').trim();
        if (reason && !terms.some(t => (t || '').trim() === `Reason: ${reason}`)) {
            terms.unshift(`Reason: ${reason}`);
        }
        return terms;
    }

    // Particulars for a credit note PDF. Priority:
    //   1. The explicit per-item reductions saved on the credit note (partial
    //      returns done by reducing quantities).
    //   2. The source invoice's own line items, so the credit note's particulars
    //      mirror the invoice exactly (amount-only credit notes).
    //   3. A single generic line as a last resort (invoice has no items).
    function _creditNoteItems(r, inv) {
        if (r.items && r.items.length > 0) return r.items;
        if (inv && inv.items && inv.items.length > 0) return inv.items;
        return [{
            sno: 1,
            specification: `Credit note adjust for invoice ${r.invoiceRef}` + (r.reason ? ` - ${r.reason}` : ''),
            qty: 1,
            uom: 'Nos',
            rate: r.creditNet || r.creditAmount,
            amount: r.creditNet || r.creditAmount
        }];
    }

    async function viewSalesReturn(id) {
        const r = Storage.getSalesReturn(id);
        if (!r) { App.showToast('Credit note not found', 'error'); return; }
        const inv = Storage.getInvoice(r.invoiceId);
        if (!inv) { App.showToast('Invoice not found', 'error'); return; }

        const pdfData = {
            ...inv,
            id: r.id,
            isCreditNote: true,
            creditNoteNumber: r.creditNoteNumber || r.invoiceRef,
            invoiceRef: r.invoiceRef,
            date: r.date,
            gstEnabled: r.gstEnabled,
            gstRate: r.gstRate,
            currency: r.currency,
            totalAmount: r.creditNet,
            grandTotal: r.creditAmount,
            creditAmount: r.creditAmount,
            creditNet: r.creditNet,
            creditGst: r.creditGst,
            reason: r.reason,
            items: _creditNoteItems(r, inv),
            termsAndConditions: _creditNoteNarrations(r, inv),
            conditions: r.conditions || inv.conditions || []
        };

        const win = window.open('', '_blank');
        try {
            await Invoice.generatePDF(pdfData, 'view', win);
        } catch (err) {
            if (win) win.close();
            App.showToast('Failed to view PDF: ' + err.message, 'error');
        }
    }

    function setGstFilter(val) {
        _retGstFilter = val;
        _retPage = 1;
        renderSalesReturns();
    }

    return {
        openReceiptModal, saveReceipt, editReceipt, viewReceipt, downloadReceipt, downloadClientReceipt,
        openAdvanceReceiptModal, saveAdvanceReceipt,
        openCreditNoteModal, saveCreditNote, editSalesReturn, viewSalesReturn,
        _fillCreditTotal, _setCreditAmount, _setCreditGstMode,
        renderReceipts, renderSalesReturns,
        setReceiptPage, setReceiptPageSize, setReturnPage, setReturnPageSize,
        openReceiptTimeline, closeReceiptTimeline, downloadReceiptsReport,
        _setReceiptSearch,
        _setReturnSearch,
        _rcpSetRangeMode, _rcpSetFinancialYear, _rcpSetField,
        deleteReceipt, deleteSalesReturn, setGstFilter,
        // internal handlers referenced from inline markup
        _close: _closeOverlay,
        _setAmount, _fillOutstanding, _setMode, _setCheque, _setRemarks,
        _setBookingRate, _setBankCharges, _setBankChargesType, _setAmountInINR,
        _setAdvClientType, _setAdvClient, _setAdvGroup, _setAdvCurrency,
        _toggleRowMenu, _closeRowMenu, closeInvoiceForex, reopenInvoiceForex, otherIncomeEntries, _setItemReducedQty,
        _closeSubOverlay, _openAddBankPopup, _saveBankFromPopup,
        _selectBankInline, _deleteBankInline,
        _applyOverpaymentAsAdvance, _applyOverpaymentToPastInvoice
    };
})();
