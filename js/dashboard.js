/* ============================================
   Dashboard Module
   ============================================ */

const Dashboard = (() => {
    let allDocuments = [];
    let filtersVisible = false;
    let currentSearch = '';
    let currentType = '';
    let currentRegion = '';
    let currentMonth = '';
    let currentFy = '';
    let _openMenuBtn = null;
    let currentPage = 1;
    let pageSize = 10;

    // Domestic vs international for a document. Prefer the saved mode; fall back to
    // the ref-number marker (ORG/INT…) for legacy records that predate the field.
    // Purchase Orders carry no international mode, so they resolve to domestic.
    function _docRegion(doc) {
        if (doc.mode === 'international') return 'international';
        if (doc.mode === 'domestic') return 'domestic';
        return /\/INT(\/|\d)/i.test(doc.refNumber || '') ? 'international' : 'domestic';
    }

    function render() {
        _closeRowMenu();
        const container = document.getElementById('dashboard-content');
        allDocuments = Storage.getRecentDocuments(Infinity);

        container.innerHTML = _renderOverview();
    }

    // --- Premium stat card builder ---
    // `docType` ('PO' | 'QU' | 'INV' | 'ALL') makes the card open a popup listing
    // those documents when clicked.
    function _statCard(label, value, accent, accentSoft, iconPaths, docType) {
        // Only cards with a docType open a popup; Total Documents stays static.
        const clickAttrs = docType
            ? ` style="--accent:${accent}; --accent-soft:${accentSoft}; cursor:pointer;" onclick="Dashboard.openDocModal('${docType}')" title="View ${_escapeHtml(label)}"`
            : ` style="--accent:${accent}; --accent-soft:${accentSoft};"`;
        return `
            <div class="stat-card"${clickAttrs}>
                <div class="stat-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</svg>
                </div>
                <div class="stat-label">${label}</div>
                <div class="stat-value">${value}</div>
            </div>
        `;
    }

    // --- Table rendering helper ---
    function _renderRecentTable(docs, total = 0, hideForex = false, clientLabel = 'Client / Vendor', modalMode = false, singleValue = false) {
        // In the dashboard popups (modalMode) the Type column is dropped and the Date
        // column shows the date + time. For PO Issue / Quotation popups (singleValue)
        // the Forex Amount and Rate of Exchange columns are also dropped; the single
        // "Value" column shows the amount in the document's own currency, prefixed with
        // the ISO code (e.g. "USD $5,868.56", "INR ₹6,545.66").
        if (singleValue) hideForex = true;
        // Home (book) currency the converted "Value in" column is reported in.
        const homeCur = 'INR';
        const homeSym = PdfUtils.currencySymbol(homeCur);
        let rows = docs.map(doc => {
            // For Purchase Orders the document's own number is poNumber; for
            // Quotations/Invoices it's refNumber (poNumber there is the client's
            // received PO, not this document's number).
            const docNo = (doc.type === 'PO' ? (doc.poNumber || doc.refNumber) : (doc.refNumber || doc.poNumber)) || '-';
            const clientName = doc.clientName || doc.consignorName || '-';
            const date = modalMode ? _formatDateTime(doc) : (doc.date ? PdfUtils.formatDateDMY(doc.date) : '-');
            // In the dashboard's Type column every invoice is shown simply as
            // "Invoice" (both domestic and international). The "Tax Invoice"
            // wording for domestic still applies on the generated PDF only.
            const invLabel = 'Invoice';
            const badgeLabel = doc.type === 'PO' ? 'PO Issue' : (doc.type === 'QU' ? 'Quotation' : invLabel);
            const currencyCode = doc.currency || homeCur;
            const hasAmount = doc.grandTotal !== undefined && doc.grandTotal !== null && doc.grandTotal !== '';
            const isForeign = currencyCode !== homeCur;
            const rate = parseFloat(doc.exchangeRate);

            // Foreign-currency documents show the original amount + the exchange rate
            // used, then the value converted into the home currency. Home-currency
            // documents have no forex/rate and the total goes straight under "Value in".
            let forexCell = '—';
            let rateCell = '—';
            let valueCell = '-';
            if (singleValue) {
                // Single "Value" column in the popups: amount in the document's own
                // currency, prefixed with its ISO code (no home-currency conversion).
                if (hasAmount) {
                    valueCell = `${currencyCode} ${PdfUtils.formatMoney(doc.grandTotal, currencyCode)}`;
                }
            } else if (hasAmount) {
                if (isForeign) {
                    // Prefix the full ISO code before the symbol+amount (e.g.
                    // "CAD $1,096.00"), so dollar currencies aren't ambiguous.
                    forexCell = `${currencyCode} ${PdfUtils.formatMoney(doc.grandTotal, currencyCode)}`;
                    if (rate > 0) {
                        rateCell = `${homeSym}${PdfUtils.formatCurrency(rate, homeCur)}/${currencyCode}`;
                        valueCell = PdfUtils.formatMoney(FinanceUtils.truncate2(doc.grandTotal * rate), homeCur);
                    } else {
                        valueCell = '—';
                    }
                } else {
                    valueCell = PdfUtils.formatMoney(doc.grandTotal, homeCur);
                }
            }
            const hasRefFile = !!doc.referenceFilePath;

            return `
                <tr>
                    ${modalMode ? '' : `<td>${_escapeHtml(badgeLabel)}</td>`}
                    <td style="font-weight:600">${_escapeHtml(docNo)}</td>
                    <td>${date}</td>
                    <td>${_escapeHtml(clientName)}</td>
                    ${hideForex ? '' : `<td style="white-space:nowrap; color:#71717a;">${forexCell}</td>
                    <td style="white-space:nowrap; color:#71717a;">${rateCell}</td>`}
                    <td style="font-weight:600; white-space:nowrap;">${valueCell}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        <button class="btn-row-actions" onclick="Dashboard.toggleRowMenu(event,'${doc.type}','${doc.id}',${hasRefFile})" title="Actions" aria-label="Actions">⋮</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Keep the table (with its column headers) visible even when there are
        // no documents — show a single placeholder row instead of hiding it.
        if (!rows) {
            const colCount = (hideForex ? 6 : 8) - (modalMode ? 1 : 0);
            rows = `<tr><td colspan="${colCount}" style="padding:40px 20px; text-align:center; color:#a1a1aa; font-size:13px;">No documents to show.</td></tr>`;
        }

        const totalPages = Math.ceil(total / pageSize);
        let paginationHtml = '';
        if (total > 0) {
            paginationHtml = renderPagination({
                page: currentPage, pageSize, total, noun: 'documents',
                onPage: 'Dashboard.changePage', onSize: 'Dashboard.changePageSize'
            });
        }

        return `
            <div class="recent-table">
                <table>
                    <thead>
                        <tr>
                            ${modalMode ? '' : `<th>Type</th>`}
                            <th>Document No.</th>
                            <th>${modalMode ? 'Date and Time' : 'Date'}</th>
                            <th>${_escapeHtml(clientLabel)}</th>
                            ${hideForex ? '' : `<th>Forex Amount</th>
                            <th>Rate of Exchange</th>`}
                            <th>${singleValue ? 'Value' : `Value in ${_escapeHtml(homeSym)}`}</th>
                            <th style="text-align:center; width: 70px;">Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${paginationHtml}
        `;
    }

    // Dedicated table for the stat-card popups. Columns per type:
    //   PO  : Date and Time | Ref Number | Department | Supplier | Value | Actions
    //   QU  : Date and Time | Ref Number | Department | Client   | Value | Actions
    //   INV : Date and Time | Ref Number | Department | Client | Forex Amount |
    //         Rate of Exchange | Value in ₹ | Actions
    // Total amount received against one invoice (sum of all its receipts), in the
    // invoice's own currency — used for the Status / Remaining columns.
    function _receivedForInvoice(invId) {
        const rcs = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        return rcs.filter(r => r.invoiceId === invId)
            .reduce((s, r) => s + (Number(r.amountReceived) || 0), 0);
    }

    // Taxable value (amount excluding tax) of a document, in its own currency.
    // Uses the stored subtotal; older records without one fall back to the grand
    // total so excl. == incl. (no crash, just no tax split).
    function _taxableOf(d) {
        if (d && d.totalAmount !== undefined && d.totalAmount !== null && d.totalAmount !== '') {
            return Number(d.totalAmount) || 0;
        }
        return Number(d && d.grandTotal) || 0;
    }

    function _receivedForInvoiceInINR(invId) {
        const rcs = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        return rcs.filter(r => r.invoiceId === invId)
            .reduce((s, r) => {
                if (r.currency === 'INR') {
                    return s + (Number(r.amountReceived) || 0);
                }
                const amtInr = Number(r.amountInINR);
                if (amtInr > 0) {
                    return s + amtInr;
                }
                const bkRate = Number(r.bookingRate);
                if (bkRate > 0) {
                    let bankChargesINR = Number(r.bankCharges) || 0;
                    if (r.bankChargesType === 'percent') {
                        bankChargesINR = (Number(r.amountReceived) || 0) * bkRate * (bankChargesINR / 100);
                    }
                    return s + Math.max(0, (Number(r.amountReceived) * bkRate) - bankChargesINR);
                }
                return s;
            }, 0);
    }

    function _calculateForexGainLoss(doc) {
        const homeCur = 'INR';
        const currencyCode = doc.currency || homeCur;
        if (currencyCode === homeCur) return 0;

        const rate = parseFloat(doc.exchangeRate) || 0;
        if (rate <= 0) return 0;

        const rcs = (Storage.getAllReceipts && Storage.getAllReceipts()) || [];
        const invoiceReceipts = rcs.filter(r => r.invoiceId === doc.id);
        
        let totalDiff = 0;
        invoiceReceipts.forEach(r => {
            const rcvdCur = Number(r.amountReceived) || 0;
            const expectedINR = rcvdCur * rate;
            
            let actualINR = 0;
            if (r.currency === 'INR') {
                actualINR = Number(r.amountReceived) || 0;
            } else {
                const amtInr = Number(r.amountInINR);
                if (amtInr > 0) {
                    actualINR = amtInr;
                } else {
                    const bkRate = Number(r.bookingRate);
                    if (bkRate > 0) {
                        let bankChargesINR = Number(r.bankCharges) || 0;
                        if (r.bankChargesType === 'percent') {
                            bankChargesINR = (Number(r.amountReceived) || 0) * bkRate * (bankChargesINR / 100);
                        }
                        actualINR = Math.max(0, (Number(r.amountReceived) * bkRate) - bankChargesINR);
                    }
                }
            }
            totalDiff += (actualINR - expectedINR);
        });
        
        return totalDiff;
    }

    function _renderModalTable(docs, type) {
        const homeCur = 'INR';
        const homeSym = PdfUtils.currencySymbol(homeCur);
        const isInv = type === 'INV';
        const showStatus = false; // PO popup no longer shows a Status column
        const partyLabel = type === 'PO' ? 'Supplier' : (type === 'QU' || type === 'INV' ? 'Client' : 'Client / Vendor');

        let rows = docs.map(doc => {
            const docNo = (doc.type === 'PO' ? (doc.poNumber || doc.refNumber) : (doc.refNumber || doc.poNumber)) || '-';
            const party = doc.type === 'PO' ? (doc.consignorName || '-') : (doc.clientName || doc.consignorName || '-');
            const dept = doc.department || '—';
            const dt = doc.date ? PdfUtils.formatDateDMY(doc.date) : '-';
            const currencyCode = doc.currency || homeCur;
            const hasAmount = doc.grandTotal !== undefined && doc.grandTotal !== null && doc.grandTotal !== '';
            const isForeign = currencyCode !== homeCur;
            const rate = parseFloat(doc.exchangeRate);
            const hasRefFile = !!doc.referenceFilePath;

            let valueCells;
            if (isInv) {
                // Invoices keep the Forex / Rate / converted-value breakdown.
                let forexCell = '—', rateCell = '—', valueCell = '-';
                if (hasAmount) {
                    if (isForeign) {
                        forexCell = `${currencyCode} ${PdfUtils.formatMoney(doc.grandTotal, currencyCode)}`;
                        if (rate > 0) {
                            rateCell = `${homeSym}${PdfUtils.formatCurrency(rate, homeCur)}/${currencyCode}`;
                            valueCell = PdfUtils.formatMoney(FinanceUtils.truncate2(doc.grandTotal * rate), homeCur);
                        } else {
                            valueCell = '—';
                        }
                    } else {
                        valueCell = PdfUtils.formatMoney(doc.grandTotal, homeCur);
                    }
                }
                valueCells = `<td style="white-space:nowrap; color:#71717a;">${forexCell}</td>
                    <td style="white-space:nowrap; color:#71717a;">${rateCell}</td>
                    <td style="font-weight:600; white-space:nowrap;">${valueCell}</td>`;
            } else {
                // PO / Quotation: single ISO-prefixed Value in the document's own currency.
                let valueCell = '-';
                if (hasAmount) valueCell = `${currencyCode} ${PdfUtils.formatMoney(doc.grandTotal, currencyCode)}`;
                valueCells = `<td style="font-weight:600; white-space:nowrap;">${valueCell}</td>`;
            }

            const isDone = doc.status === 'completed';
            const statusCell = showStatus
                ? `<td style="text-align:center; white-space:nowrap;"><span style="display:inline-block; padding:3px 11px; border-radius:999px; font-size:12px; font-weight:700; color:${isDone ? '#0a7a4a' : '#b45309'}; background:${isDone ? 'rgba(10,122,74,0.12)' : 'rgba(180,83,9,0.12)'};">${isDone ? 'Completed' : 'Pending'}</span></td>`
                : '';

            // Payment Status / Remaining columns (invoices only, internal reference —
            // never printed to PDF). Derived from receipts logged against the invoice.
            let payCells = '';
            if (isInv) {
                const total = hasAmount ? (Number(doc.grandTotal) || 0) : 0;
                const received = _receivedForInvoice(doc.id);
                const remaining = Math.max(0, total - received);
                let receiptText, remainText;
                if (total <= 0) {
                    receiptText = '—';
                    remainText = '—';
                } else {
                    const receivedInHome = _receivedForInvoiceInINR(doc.id);
                    receiptText = PdfUtils.formatMoney(receivedInHome, homeCur);
                    remainText = PdfUtils.formatMoney(remaining, currencyCode);
                }

                const forexDiff = _calculateForexGainLoss(doc);
                let forexCell = '';
                if (doc.currency === homeCur || total <= 0 || _receivedForInvoice(doc.id) === 0) {
                    forexCell = '<td style="text-align:right; white-space:nowrap; color:#a1a1aa;">—</td>';
                } else {
                    const formattedDiff = PdfUtils.formatMoney(Math.abs(forexDiff), homeCur);
                    if (forexDiff < -0.01) {
                        forexCell = `<td style="text-align:right; white-space:nowrap; font-weight:600; color:#ef4444;">-${formattedDiff}</td>`;
                    } else if (forexDiff > 0.01) {
                        forexCell = `<td style="text-align:right; white-space:nowrap; font-weight:600; color:#167946;">+${formattedDiff}</td>`;
                    } else {
                        forexCell = `<td style="text-align:right; white-space:nowrap; font-weight:600; color:#71717a;">${formattedDiff}</td>`;
                    }
                }

                payCells = `
                    <td style="text-align:right; white-space:nowrap; font-weight:600;">${receiptText}</td>
                    <td style="text-align:right; white-space:nowrap; font-weight:600;">${remainText}</td>
                    ${forexCell}`;
            }

            const deptCell = isInv ? '' : `<td>${_escapeHtml(dept)}</td>`;

            return `
                <tr>
                    <td style="white-space:nowrap; width:1%;">${dt}</td>
                    <td style="font-weight:600; min-width:16ch; white-space:nowrap;">${_escapeHtml(docNo)}</td>
                    ${deptCell}
                    <td>${_escapeHtml(party)}</td>
                    ${valueCells}
                    ${statusCell}
                    ${payCells}
                    <td style="text-align:center; white-space:nowrap;">
                        <button class="btn-row-actions" onclick="Dashboard.toggleRowMenu(event,'${doc.type}','${doc.id}',${hasRefFile})" title="Actions" aria-label="Actions">⋮</button>
                    </td>
                </tr>`;
        }).join('');

        const colCount = isInv ? 10 : (showStatus ? 7 : 6);
        if (!rows) {
            rows = `<tr><td colspan="${colCount}" style="padding:40px 20px; text-align:center; color:#a1a1aa; font-size:13px;">No documents to show.</td></tr>`;
        }

        const refHead = isInv
            ? '<th style="white-space:nowrap; min-width:16ch;">INV ref No</th>'
            : '<th style="white-space:nowrap; min-width:16ch;">Ref Number</th>';

        const deptHead = isInv
            ? ''
            : '<th>Department</th>';

        const valueHead = isInv
            ? `<th>Forex Amount</th><th>Rate of Exchange</th><th>Value in ${_escapeHtml(homeSym)}</th>`
            : `<th>Value</th>`;

        const payHead = isInv
            ? '<th style="text-align:right;">Receipt Amount</th><th style="text-align:right;">Remaining Amount</th><th style="text-align:right;">Forex Loss/Gain</th>'
            : '';

        return `
            <div class="recent-table">
                <table>
                    <thead>
                        <tr>
                            <th style="white-space:nowrap; width:1%;">Date</th>
                            ${refHead}
                            ${deptHead}
                            <th>${_escapeHtml(partyLabel)}</th>
                            ${valueHead}
                            ${showStatus ? '<th style="text-align:center;">Status</th>' : ''}
                            ${payHead}
                            <th style="text-align:center; width: 70px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    function _renderEmptyState(message = "No documents generated yet.") {
        return `
            <div class="empty-state">
                <p>${_escapeHtml(message)}</p>
                ${message === "No documents generated yet." ? '<p style="color:#bbb; font-size:13px; margin-top:4px;">Create your first PO Issue or Quotation to get started.</p>' : ''}
            </div>
        `;
    }

    async function viewPdf(type, id) {
        // Open the tab synchronously inside the click handler so the browser keeps
        // the user-gesture and doesn't pop-up-block it. The PDF is rendered after an
        // async step (logo load), which would otherwise block the window.open call —
        // that was why opening a second document silently failed.
        const win = window.open('', '_blank');
        try {
            let data = null;
            if (type === 'PO') data = Storage.getPO(id);
            else if (type === 'QU') data = Storage.getQuotation(id);
            else if (type === 'INV') data = Storage.getInvoice(id);

            if (!data) {
                if (win) win.close();
                return;
            }

            if (type === 'PO') await PurchaseOrder.generatePDF(data, 'view', win);
            else if (type === 'QU') await Quotation.generatePDF(data, 'view', win);
            else if (type === 'INV') await Invoice.generatePDF(data, 'view', win);
        } catch (err) {
            console.error('View PDF failed:', err);
            if (win) win.close();
            App.showToast('Failed to view PDF: ' + err.message, 'error');
        }
    }

    // Open the uploaded reference file (quotation for a PO, or the collection
    // file carried into an Invoice) in a new tab.
    function viewRefFile(type, id) {
        let data = null;
        if (type === 'PO') data = Storage.getPO(id);
        else if (type === 'INV') data = Storage.getInvoice(id);
        else if (type === 'QU') data = Storage.getQuotation(id);
        const path = data && data.referenceFilePath;
        if (path) {
            window.open(path, '_blank');
        } else if (typeof App !== 'undefined' && App.showToast) {
            App.showToast('No reference file attached to this document.', 'info');
        }
    }

    async function downloadPdf(type, id) {
        try {
            let result;
            if (type === 'PO') {
                const data = Storage.getPO(id);
                if (data) {
                    result = await PurchaseOrder.generatePDF(data, 'download');
                }
            } else if (type === 'QU') {
                const data = Storage.getQuotation(id);
                if (data) {
                    result = await Quotation.generatePDF(data, 'download');
                }
            } else if (type === 'INV') {
                const data = Storage.getInvoice(id);
                if (data) {
                    result = await Invoice.generatePDF(data, 'download');
                }
            }

            if (result && result.savedToPath) {
                App.showConfirm(
                    'PDF Saved Successfully',
                    '',
                    () => {},
                    null,
                    true
                );
            } else if (result && result.cancelled) {
                // User cancelled re-download, do nothing
            } else if (result && result.downloaded) {
                App.showToast('PDF downloaded successfully!', 'success');
            }
        } catch (err) {
            console.error('Download PDF failed:', err);
            App.showToast('Failed to download PDF: ' + err.message, 'error');
        }
    }

    function deleteDoc(type, id, onDone) {
        const docLabel = type === 'PO' ? 'PO Issue' : (type === 'QU' ? 'Quotation' : 'Invoice');
        App.showConfirm(
            'Delete Document',
            `Are you sure you want to delete this ${docLabel}? This action cannot be undone.`,
            () => {
                if (type === 'PO') {
                    Storage.deletePO(id);
                } else if (type === 'QU') {
                    Storage.deleteQuotation(id);
                } else if (type === 'INV') {
                    Storage.deleteInvoice(id);
                }
                App.showToast(`${docLabel} deleted successfully!`, 'success');
                // Re-render every view that could be showing this row, NOW that the
                // deletion has actually happened (runs on the user's Confirm click,
                // not a racing timer). Covers: main dashboard, the open "all
                // documents" modal, and the owning module's list page. Each module's
                // renderDashboard() is a no-op when its page isn't mounted.
                render();
                if (document.getElementById('dashboard-doc-modal') && _modalType === type) {
                    _renderDocModalTable();
                }
                try {
                    if (type === 'PO' && typeof PurchaseOrder !== 'undefined') PurchaseOrder.renderDashboard();
                    else if (type === 'QU' && typeof Quotation !== 'undefined') Quotation.renderDashboard();
                    else if (type === 'INV' && typeof Invoice !== 'undefined') Invoice.renderDashboard();
                } catch (e) { console.error('deleteDoc re-render failed:', e); }
                if (typeof onDone === 'function') {
                    try { onDone(); } catch (e) { console.error('deleteDoc onDone failed:', e); }
                }
            }
        );
    }

    function reviseDoc(type, id) {
        closeDocModal();
        let data, docNumber, docNumField;
        if (type === 'PO') {
            data = Storage.getPO(id);
            docNumber = data ? (data.poNumber || '') : '';
            docNumField = 'poNumber';
        } else if (type === 'QU') {
            data = Storage.getQuotation(id);
            docNumber = data ? (data.refNumber || '') : '';
            docNumField = 'refNumber';
        } else if (type === 'INV') {
            data = Storage.getInvoice(id);
            docNumber = data ? (data.refNumber || '') : '';
            docNumField = 'refNumber';
        }

        if (!data) return;

        // Work on a deep copy — getPO/getQuotation/getInvoice return live references to
        // the in-memory cache, and below we delete the id and change the number. Mutating
        // the cached original would corrupt the existing record until the next reload.
        data = JSON.parse(JSON.stringify(data));

        // Strip an existing revision suffix (/R1, /R2 … or legacy /REVxx) to get the base number
        const REV_SUFFIX_RE = /\/R(?:EV)?\d+$/i;
        const baseNumber = docNumber.replace(REV_SUFFIX_RE, '');

        // Scan all documents of the same type to find the highest existing revision
        const allDocs = type === 'PO' ? Storage.getAllPOs() : (type === 'QU' ? Storage.getAllQuotations() : Storage.getAllInvoices());
        let maxRev = 0;
        allDocs.forEach(doc => {
            const num = doc[docNumField] || '';
            // Match documents with the same base number
            if (num === baseNumber || num.replace(REV_SUFFIX_RE, '') === baseNumber) {
                const revMatch = num.match(/\/R(?:EV)?(\d+)$/i);
                if (revMatch) {
                    const revNum = parseInt(revMatch[1], 10);
                    if (revNum > maxRev) maxRev = revNum;
                }
            }
        });

        const nextRev = maxRev + 1;
        const revSuffix = 'R' + nextRev;
        const revisedNumber = baseNumber + '/' + revSuffix;

        // Clear the id so the revised document saves as a new entry (preserving the original)
        delete data.id;

        if (type === 'PO') {
            data.poNumber = revisedNumber;
            PurchaseOrder.render(data);
            App.navigateTo('purchase-order');
        } else if (type === 'QU') {
            data.refNumber = revisedNumber;
            Quotation.render(data);
            App.navigateTo('quotation');
        } else if (type === 'INV') {
            data.refNumber = revisedNumber;
            Invoice.render(data);
            App.navigateTo('invoice');
        }

        App.showToast(`Document loaded for revision as ${revSuffix}`, 'success');
    }

    // Edit an existing document in place: load it into its form keeping the same id
    // and reference number, so saving overwrites the original record (no new entry,
    // no /R revision). Use this to correct a mistake on an already-created document.
    function editDoc(type, id) {
        closeDocModal();
        let data;
        if (type === 'PO') data = Storage.getPO(id);
        else if (type === 'QU') data = Storage.getQuotation(id);
        else if (type === 'INV') data = Storage.getInvoice(id);
        if (!data) return;

        // Deep copy so the form can't mutate the cached original; id is kept so the
        // save overwrites the same record.
        data = JSON.parse(JSON.stringify(data));

        // Keep data.id and the existing ref number untouched so the save overwrites.
        if (type === 'PO') {
            PurchaseOrder.render(data);
            App.navigateTo('purchase-order');
        } else if (type === 'QU') {
            Quotation.render(data);
            App.navigateTo('quotation');
        } else if (type === 'INV') {
            Invoice.render(data);
            App.navigateTo('invoice');
        }

        App.showToast('Document loaded for editing — same reference number will be kept', 'info');
    }

    // Duplicate an existing document: load all of its details into a fresh form, but
    // drop the id (so saving creates a new entry), reset the date to today and assign
    // the next ongoing serial number (auto-generated) instead of reusing the original
    // reference. Use this to quickly raise a new document just like an existing one.
    function duplicateDoc(type, id) {
        closeDocModal();
        let data;
        if (type === 'PO') data = Storage.getPO(id);
        else if (type === 'QU') data = Storage.getQuotation(id);
        else if (type === 'INV') data = Storage.getInvoice(id);
        if (!data) return;

        // Deep copy so the form can't mutate the cached original.
        data = JSON.parse(JSON.stringify(data));

        // New entry: no id, today's date, and let the form generate a fresh serial.
        delete data.id;
        const today = new Date();
        const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        data.date = todayISO;
        // Strip the original number so the form treats the reference as auto-generated.
        delete data.refNumber;
        delete data.poNumber;
        delete data.savedAt;

        // Render the form, then flip the reference input back to auto-generated and
        // populate it with the next ongoing serial number. render() marks the input
        // as non-auto when editData is present, so we re-enable it here.
        if (type === 'PO') {
            PurchaseOrder.render(data);
            App.navigateTo('purchase-order');
            const input = document.getElementById('po-number');
            if (input) {
                input.value = '';
                input.setAttribute('data-auto-generated', 'true');
                PurchaseOrder.updateAutoPONumber();
            }
        } else if (type === 'QU') {
            Quotation.render(data);
            App.navigateTo('quotation');
            const input = document.getElementById('qu-ref-number');
            if (input) {
                input.value = '';
                input.setAttribute('data-auto-generated', 'true');
                Quotation.updateAutoRefNumber();
            }
        } else if (type === 'INV') {
            Invoice.render(data);
            App.navigateTo('invoice');
            const input = document.getElementById('inv-ref-number');
            if (input) {
                input.value = '';
                input.setAttribute('data-auto-generated', 'true');
                Invoice.updateAutoRefNumber();
            }
        }

        App.showToast('Document duplicated — new reference number and today’s date applied', 'success');
    }

    // --- Row actions menu (single button → popup list) ---
    function toggleRowMenu(event, type, id, hasRefFile) {
        event.stopPropagation();
        const trigger = event.currentTarget;
        const existing = document.getElementById('row-actions-popup');
        const wasSame = existing && _openMenuBtn === trigger;
        _closeRowMenu();
        if (wasSame) return; // second click on the same button closes it

        _openMenuBtn = trigger;
        const menu = document.createElement('div');
        menu.id = 'row-actions-popup';
        menu.className = 'row-actions-popup';
        const refFileItem = hasRefFile
            ? `<button onclick="Dashboard.viewRefFile('${type}','${id}'); Dashboard._closeRowMenu();">View Reference File</button>`
            : '';
        // Receipt and Credit Note only apply to invoices.
        const invMoneyItems = type === 'INV'
            ? `<button onclick="Dashboard._closeRowMenu(); Receipts.openReceiptModal('${id}');">Receipt</button>
               <button onclick="Dashboard._closeRowMenu(); Receipts.openCreditNoteModal('${id}');">Credit Note</button>`
            : '';
        menu.innerHTML = `
            <button onclick="Dashboard.viewPdf('${type}','${id}'); Dashboard._closeRowMenu();">View</button>
            <button onclick="Dashboard.editDoc('${type}','${id}'); Dashboard._closeRowMenu();">Edit</button>
            <button onclick="Dashboard.reviseDoc('${type}','${id}'); Dashboard._closeRowMenu();">Revise</button>
            <button onclick="Dashboard.duplicateDoc('${type}','${id}'); Dashboard._closeRowMenu();">Duplicate</button>
            <button onclick="Dashboard.downloadPdf('${type}','${id}'); Dashboard._closeRowMenu();">Download</button>
            ${invMoneyItems}
            ${refFileItem}
            <button class="danger" onclick="Dashboard.deleteDoc('${type}','${id}'); Dashboard._closeRowMenu();">Delete</button>
        `;
        document.body.appendChild(menu);

        // Position the popup just under the trigger, right-aligned, flipping above
        // if it would run off the bottom of the viewport.
        const rect = trigger.getBoundingClientRect();
        let left = rect.right - menu.offsetWidth;
        if (left < 8) left = 8;
        let top = rect.bottom + 6;
        if (top + menu.offsetHeight > window.innerHeight - 8) {
            top = rect.top - menu.offsetHeight - 6;
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        setTimeout(() => document.addEventListener('click', _closeRowMenuOnOutside, true), 0);
    }

    function _closeRowMenuOnOutside(e) {
        const menu = document.getElementById('row-actions-popup');
        if (menu && !menu.contains(e.target) && e.target !== _openMenuBtn) {
            _closeRowMenu();
        }
    }

    function _closeRowMenu() {
        const menu = document.getElementById('row-actions-popup');
        if (menu) menu.remove();
        _openMenuBtn = null;
        document.removeEventListener('click', _closeRowMenuOnOutside, true);
    }

    // Date + time shown in the dashboard popups. Falls back to just the document
    // date when no savedAt timestamp is present.

    function _formatDateTime(doc) {
        const datePart = doc.date ? PdfUtils.formatDateDMY(doc.date) : '-';
        if (!doc.savedAt) return datePart;
        const d = new Date(doc.savedAt);
        if (isNaN(d.getTime())) return datePart;
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${datePart}, ${time}`;
    }

    function _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Home overview: sales + receivables ───────────────────────────────
    // The dashboard's headline numbers, in the book currency (INR): what was
    // invoiced per month, and what is still owed on those invoices. Everything
    // here derives from stored records — no separate ledger to keep in sync.
    let _ovFy = '';                       // '' = the current financial year
    let _ovMonth = '';                    // '' = all months in the FY, or 'YYYY-M' e.g. '2026-4'

    // A document's value in the book currency. A foreign invoice saved without an
    // exchange rate can't be converted, so it contributes 0 rather than a wrong
    // number — those are surfaced as a note under the chart.
    // A document's value in the book currency (INR). `field` picks gross
    // (grandTotal, incl. tax) or net (totalAmount, excl. tax); a document with no
    // net recorded — international invoices carry no tax — falls back to gross.
    function _homeValue(doc, field = 'grandTotal') {
        const raw = doc ? doc[field] : null;
        const total = Number(raw === undefined || raw === null || raw === '' ? (doc && doc.grandTotal) : raw) || 0;
        const cur = (doc && doc.currency) || 'INR';
        if (cur === 'INR') return total;
        const rate = parseFloat(doc && doc.exchangeRate) || 0;
        return rate > 0 ? total * rate : 0;
    }

    function _isUnconverted(doc) {
        const cur = (doc && doc.currency) || 'INR';
        return cur !== 'INR' && !(parseFloat(doc && doc.exchangeRate) > 0);
    }

    // Receipts against one invoice, in INR (foreign receipts converted via the
    // stored booking rate).
    function _receivedHome(inv) {
        return _receivedForInvoiceInINR(inv.id);
    }

    // Months of a financial year (Apr–Mar, "2026-2027"), oldest first.
    function _fyMonths(fy) {
        const out = [];
        const startYear = parseInt(String(fy).split('-')[0], 10) || new Date().getFullYear();
        for (let i = 0; i < 12; i++) {
            const m = 3 + i;                              // 0-indexed April
            out.push({ year: startYear + Math.floor(m / 12), month: (m % 12) + 1 });
        }
        return out;
    }

    const _MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const _MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    // Invoiced value per month of the financial year, net of credit notes raised
    // against those invoices (a sales return reduces the month it belongs to).
    // Both headline measures per month of the financial year: what was invoiced
    // (net of credit notes) and how much of it is still owed. One pass over the
    // invoices, so the two series always agree with each other.
    function _monthlySeries(fy) {
        const invoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        const returns = (Storage.getAllSalesReturns && Storage.getAllSalesReturns()) || [];
        // Credit notes are deducted from both figures: the gross one loses the
        // tax-inclusive credit, the net one the ex-tax portion (equal when the
        // invoice carried no GST).
        const creditByInv = {};
        const creditNetByInv = {};
        returns.forEach(r => {
            if (!r || !r.invoiceId) return;
            const gross = Number(r.creditAmount) || 0;
            const net = Number(r.creditNet !== undefined ? r.creditNet : r.creditAmount) || 0;
            creditByInv[r.invoiceId] = (creditByInv[r.invoiceId] || 0) + gross;
            creditNetByInv[r.invoiceId] = (creditNetByInv[r.invoiceId] || 0) + net;
        });

        const months = _fyMonths(fy);
        const cells = {};
        months.forEach(o => {
            cells[`${o.year}-${o.month}`] = {
                sales: 0, salesNet: 0, received: 0,
                salesDom: 0, salesIntl: 0, receivedDom: 0, receivedIntl: 0
            };
        });
        let unconverted = 0;

        invoices.forEach(inv => {
            if (!inv || !inv.date) return;
            const d = new Date(inv.date);
            if (isNaN(d.getTime())) return;
            const cell = cells[`${d.getFullYear()}-${d.getMonth() + 1}`];
            if (!cell) return;
            if (_isUnconverted(inv)) { unconverted++; return; }

            const total = _homeValue(inv);
            const paid = Math.min(total, _receivedHome(inv));
            const sales = Math.max(0, total - (creditByInv[inv.id] || 0));
            cell.sales += sales;
            cell.salesNet += Math.max(0, _homeValue(inv, 'totalAmount') - (creditNetByInv[inv.id] || 0));
            cell.received += paid;

            // The chart plots domestic and international side by side, so each
            // invoice also lands in its own region's pair of bars.
            if (_docRegion(inv) === 'international') {
                cell.salesIntl += sales;
                cell.receivedIntl += paid;
            } else {
                cell.salesDom += sales;
                cell.receivedDom += paid;
            }
        });

        return {
            unconverted,
            bars: months.map(o => {
                const c = cells[`${o.year}-${o.month}`];
                return {
                    year: o.year,
                    month: o.month,
                    key: `${o.year}-${o.month}`,
                    label: `${_MONTH_ABBR[o.month - 1]} ${String(o.year).slice(2)}`,
                    fullLabel: `${_MONTH_NAMES[o.month - 1]} ${o.year}`,
                    sales: c.sales,
                    salesNet: c.salesNet,
                    received: c.received,
                    salesDom: c.salesDom,
                    salesIntl: c.salesIntl,
                    receivedDom: c.receivedDom,
                    receivedIntl: c.receivedIntl
                };
            })
        };
    }

    // What has been invoiced, what came back, and what is still owed — in the
    // book currency (INR).
    function _receivables() {
        const invoices = (Storage.getAllInvoices && Storage.getAllInvoices()) || [];
        let outstanding = 0, received = 0, invoiced = 0;

        invoices.forEach(inv => {
            if (!inv || _isUnconverted(inv)) return;
            const total = _homeValue(inv);
            if (total <= 0) return;
            invoiced += total;

            // _receivedHome already reports in the book currency, so it compares
            // directly against the converted invoice total.
            const paid = Math.min(total, _receivedHome(inv));
            received += paid;

            const due = total - paid;
            if (due <= 0.005) return;                  // settled (sub-paisa rounding)
            outstanding += due;
        });

        return { outstanding, received, invoiced };
    }

    // A "nice" axis top so bars fill the plot at any magnitude, and the tick
    // labels stay round numbers.
    function _niceScale(maxVal) {
        if (!(maxVal > 0)) return { top: 1, ticks: 4, step: 0.25 };
        const rough = maxVal / 4;
        const pow = Math.pow(10, Math.floor(Math.log10(rough)));
        const n = rough / pow;
        const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
        let top = Math.ceil(maxVal / step) * step;
        if (top > 0 && maxVal / top > 0.85) top += step;   // headroom for the value tag
        return { top, ticks: Math.round(top / step), step };
    }

    // Compact money for axis ticks: ₹12.5L, ₹1.2Cr.
    function _shortMoney(v) {
        const sym = PdfUtils.currencySymbol('INR');
        if (Math.abs(v) >= 1e7) return `${sym}${(v / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
        if (Math.abs(v) >= 1e5) return `${sym}${(v / 1e5).toFixed(2).replace(/\.?0+$/, '')}L`;
        if (Math.abs(v) >= 1e3) return `${sym}${(v / 1e3).toFixed(1).replace(/\.?0+$/, '')}K`;
        return `${sym}${Math.round(v)}`;
    }

    // Grouped CSS bar chart — no chart library, same technique as the Sales page.
    // Each month shows two bars side by side: invoiced, and collected. Bar and
    // gridline positions are percentages, so the plot fills whatever height the
    // layout gives it and the dashboard never needs to scroll.
    const SERIES = [
        { key: 'salesDom', label: 'Domestic Sales', color: '#12855a' },
        { key: 'salesIntl', label: 'International Sales', color: '#6cc39b' },
        { key: 'receivedDom', label: 'Domestic Received', color: '#2563eb' },
        { key: 'receivedIntl', label: 'International Received', color: '#93b4f5' }
    ];

    function _renderBars(bars, selectedKey = '') {
        const max = bars.reduce((m, b) => Math.max(m, ...SERIES.map(sr => b[sr.key] || 0)), 0);
        const sc = _niceScale(max);
        let ticks = '', grid = '';
        for (let i = sc.ticks; i >= 0; i--) ticks += `<div style="line-height:1;">${i === 0 ? '0' : _escapeHtml(_shortMoney(i * sc.step))}</div>`;
        for (let i = 0; i <= sc.ticks; i++) {
            const pct = (i / sc.ticks) * 100;
            grid += `<div class="dbc-grid-line" style="bottom:${pct}%; border-top:1px ${i === 0 ? 'solid rgba(0,0,0,0.16)' : 'dashed rgba(0,0,0,0.06)'};"></div>`;
        }

        const cols = bars.map(b => {
            const isSelected = selectedKey && b.key === selectedKey;
            const isDimmed = selectedKey && !isSelected;
            const colStyle = isSelected
                ? 'background:rgba(0,77,44,0.05); border-radius:8px 8px 0 0; outline:1.5px solid rgba(0,77,44,0.25); cursor:pointer;'
                : (isDimmed ? 'opacity:0.38; transition:opacity 0.2s; cursor:pointer;' : 'cursor:pointer;');

            const bar = (sr) => {
                const v = b[sr.key];
                const h = max > 0 && v > 0 ? Math.max(0.8, (v / sc.top) * 100) : 0;
                // The figure sits above its own bar and appears on hover — pinned to
                // the bar, so it does not chase the cursor.
                return `<div class="dbc-bar${v > 0 ? '' : ' dbc-zero'}" style="height:${h}%; background:${sr.color};" title="${_escapeHtml(sr.label)}"
                             ><span class="dbc-val">${_escapeHtml(sr.label)}: ${_escapeHtml(PdfUtils.formatMoney(v, 'INR'))}</span></div>`;
            };

            const xLabelStyle = isSelected
                ? 'font-weight:800; color:#004d2c;'
                : '';

            return `
                <div class="dbc-col" style="${colStyle}"
                     onclick="Dashboard.setOverviewMonth('${isSelected ? '' : b.key}')"
                     title="Click to ${isSelected ? 'show all months' : 'filter by ' + _escapeHtml(b.fullLabel || b.label)}"
                     ${isDimmed ? 'onmouseover="this.style.opacity=\'0.85\'" onmouseout="this.style.opacity=\'0.38\'"' : ''}>
                    <div class="dbc-bars">${SERIES.map(bar).join('')}</div>
                    <div class="dbc-x" style="${xLabelStyle}">${_escapeHtml(b.label)}${isSelected ? '<span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:#004d2c; margin-left:3px; vertical-align:middle;"></span>' : ''}</div>
                </div>`;
        }).join('');

        return `
            <div class="dbc-wrap">
                <div class="dbc-axis">${ticks}</div>
                <div class="dbc-plot">
                    <div class="dbc-cols">${grid}${cols}</div>
                </div>
            </div>`;
    }

    // Headline tile: label, big money value, and a one-line explanation.
    function _kpiTile(label, value, hint, accent) {
        return `
            <div style="background:#fff; border:1px solid rgba(0,0,0,0.07); border-radius:16px; padding:18px 20px; box-shadow:0 4px 20px rgba(0,0,0,0.02); border-top:3px solid ${accent}; min-width:0;">
                <div style="font-size:11.5px; font-weight:700; color:#71717a; text-transform:uppercase; letter-spacing:0.6px;">${_escapeHtml(label)}</div>
                <div style="font-size:24px; font-weight:800; color:#18181b; letter-spacing:-0.6px; margin-top:8px; word-break:break-all;">${_escapeHtml(value)}</div>
                <div style="font-size:11.5px; color:#a1a1aa; margin-top:4px;">${_escapeHtml(hint)}</div>
            </div>`;
    }

    function setOverviewFy(fy) {
        _ovFy = fy || '';
        if (_ovMonth) {
            const activeFy = _ovFy || Storage.getFinancialYear(new Date().toISOString().slice(0, 10));
            const valid = _fyMonths(activeFy).some(m => `${m.year}-${m.month}` === _ovMonth);
            if (!valid) _ovMonth = '';
        }
        render();
    }

    function setOverviewMonth(monthKey) {
        _ovMonth = monthKey || '';
        render();
    }

    // The overview block: Month & FY pickers, four headline tiles, and the two bar charts.
    function _renderOverview() {
        const fy = _ovFy || Storage.getFinancialYear(new Date().toISOString().slice(0, 10));
        const series = _monthlySeries(fy);
        const ar = _receivables();
        const cur = 'INR';
        const fySales = series.bars.reduce((t, b) => t + b.sales, 0);
        const fySalesNet = series.bars.reduce((t, b) => t + b.salesNet, 0);

        const fys = [...new Set(((Storage.getAllInvoices && Storage.getAllInvoices()) || [])
            .map(d => d.date ? Storage.getFinancialYear(d.date) : '').filter(Boolean))].sort().reverse();
        if (!fys.includes(fy)) fys.unshift(fy);

        const fyMonthsList = _fyMonths(fy);
        const selectedBar = _ovMonth ? series.bars.find(b => b.key === _ovMonth) : null;
        if (!selectedBar && _ovMonth) {
            _ovMonth = '';
        }
        const monthTriggerText = selectedBar ? selectedBar.fullLabel : 'All Months';

        let displaySales, displaySalesNet, displayReceived, displayPending, collectedPct;
        let salesHint, salesNetHint, receivedHint, pendingHint;

        if (selectedBar) {
            displaySales = selectedBar.sales;
            displaySalesNet = selectedBar.salesNet;
            displayReceived = selectedBar.received;
            displayPending = Math.max(0, displaySales - displayReceived);
            collectedPct = displaySales > 0 ? Math.round((displayReceived / displaySales) * 100) : 0;

            salesHint = `Invoiced in ${selectedBar.fullLabel} incl. tax, net of returns`;
            salesNetHint = `Invoiced in ${selectedBar.fullLabel} excl. tax, net of returns`;
            receivedHint = `${collectedPct}% collected on ${selectedBar.fullLabel} invoices`;
            pendingHint = `Pending for ${selectedBar.fullLabel} invoices`;
        } else {
            displaySales = fySales;
            displaySalesNet = fySalesNet;
            displayReceived = ar.received;
            displayPending = ar.outstanding;
            collectedPct = ar.invoiced > 0 ? Math.round((ar.received / ar.invoiced) * 100) : 0;

            salesHint = `Invoiced in FY ${fy} incl. tax, net of returns`;
            salesNetHint = `Invoiced in FY ${fy} excl. tax, net of returns`;
            receivedHint = `${collectedPct}% of everything invoiced`;
            pendingHint = 'Invoiced and not yet received';
        }

        const legend = SERIES.map(sr => `
            <span style="display:inline-flex; align-items:center; gap:7px;">
                <span style="width:13px; height:13px; border-radius:3px; background:${sr.color};"></span>${sr.label}
            </span>`).join('');

        return `
            <style>
                /* X-label strip reserved below the plot area, so the axis ticks and
                   the gridlines both measure against the bars' own box. */
                .dbc-wrap{ display:flex; gap:12px; align-items:stretch; flex:1 1 auto; min-height:140px; }
                .dbc-wrap *{ box-sizing:border-box; }
                .dbc-axis{ display:flex; flex-direction:column; justify-content:space-between;
                    padding-bottom:26px; font-size:10.5px; color:#a1a1aa; text-align:right; flex:0 0 auto; }
                .dbc-plot{ position:relative; flex:1 1 auto; min-width:0; }
                .dbc-cols{ position:absolute; left:0; right:0; top:0; bottom:26px;
                    display:flex; align-items:flex-end; justify-content:space-around; gap:6px; }
                .dbc-grid-line{ position:absolute; left:0; right:0; }
                .dbc-col{ position:relative; height:100%; display:flex; flex-direction:column;
                    justify-content:flex-end; align-items:center; flex:1 1 0; min-width:0; }
                .dbc-bars{ display:flex; align-items:flex-end; justify-content:center; gap:2px; width:100%; height:100%; }

                /* Flat bars: solid fill, no extrusion, no motion. */
                .dbc-bar{ position:relative; flex:1 1 0; min-width:0; max-width:13px; align-self:flex-end;
                    border-radius:3px 3px 0 0; }
                .dbc-zero{ background:none !important; }

                .dbc-x{ position:absolute; top:100%; left:0; right:0; margin-top:9px; text-align:center;
                    font-size:10.5px; font-weight:600; color:#71717a; white-space:nowrap; }

                /* Hover value: the number alone, pinned above its own bar. */
                .dbc-val{ position:absolute; bottom:100%; left:50%; transform:translateX(-50%);
                    margin-bottom:8px; font-size:11.5px; font-weight:800; letter-spacing:-0.2px; color:#000;
                    white-space:nowrap; pointer-events:none; visibility:hidden;
                    text-shadow:0 1px 0 #fff, 0 0 6px rgba(255,255,255,.95); }
                .dbc-bar:hover .dbc-val{ visibility:visible; }

                /* The dashboard holds a fixed set of tiles + one chart, so it sizes to
                   the viewport and the chart absorbs the slack instead of scrolling. */
                #dashboard-content{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
                .dbc-card{ flex:1 1 auto; min-height:0; min-width:0; display:flex; flex-direction:column;
                    background:#fff; border:1px solid rgba(0,0,0,0.07); border-radius:18px; padding:22px;
                    box-shadow:0 4px 20px rgba(0,0,0,0.02); }
            </style>

            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px; flex:0 0 auto;">
                <div style="font-size:15px; font-weight:800; color:#18181b; letter-spacing:-0.2px;">Overview</div>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <!-- Month Filter (Left of Financial Year) -->
                    <div class="custom-select-wrapper" style="width:165px;">
                        <div class="custom-select-trigger" style="justify-content:space-between; text-align:left; font-size:12.5px;">
                            <span>${_escapeHtml(monthTriggerText)}</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options" style="max-height:220px; overflow-y:auto;">
                            <div class="custom-option${!_ovMonth ? ' selected' : ''}" data-value="">All Months</div>
                            ${fyMonthsList.map(m => {
                                const key = `${m.year}-${m.month}`;
                                const label = `${_MONTH_NAMES[m.month - 1]} ${m.year}`;
                                return `<div class="custom-option${_ovMonth === key ? ' selected' : ''}" data-value="${key}">${_escapeHtml(label)}</div>`;
                            }).join('')}
                        </div>
                        <input type="hidden" value="${_escapeHtml(_ovMonth)}" onchange="Dashboard.setOverviewMonth(this.value)">
                    </div>

                    <!-- Financial Year Filter -->
                    <div class="custom-select-wrapper" style="width:150px;">
                        <div class="custom-select-trigger" style="justify-content:space-between; text-align:left; font-size:12.5px;">
                            <span>FY ${_escapeHtml(fy)}</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options">
                            ${fys.map(f => `<div class="custom-option${f === fy ? ' selected' : ''}" data-value="${_escapeHtml(f)}">FY ${_escapeHtml(f)}</div>`).join('')}
                        </div>
                        <input type="hidden" value="${_escapeHtml(fy)}" onchange="Dashboard.setOverviewFy(this.value)">
                    </div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:16px; margin-bottom:18px; flex:0 0 auto;">
                ${_kpiTile('Total Sales (Gross)', PdfUtils.formatMoney(displaySales, cur), salesHint, SERIES[0].color)}
                ${_kpiTile('Total Sales (Net)', PdfUtils.formatMoney(displaySalesNet, cur), salesNetHint, '#0f766e')}
                ${_kpiTile('Received', PdfUtils.formatMoney(displayReceived, cur), receivedHint, '#2563eb')}
                ${_kpiTile('Pending', PdfUtils.formatMoney(displayPending, cur), pendingHint, '#d97706')}
            </div>

            <div class="dbc-card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:16px; flex:0 0 auto;">
                    <div>
                        <div style="font-size:15px; font-weight:800; color:#18181b; letter-spacing:-0.2px;">Sales &amp; Received</div>
                        <div style="font-size:12px; color:#71717a; margin-top:3px;">${selectedBar ? selectedBar.fullLabel + ' · ' : 'Per month · '}FY ${_escapeHtml(fy)} · ${_escapeHtml(cur)}</div>
                    </div>
                    <div style="display:flex; gap:18px; align-items:center; font-size:12px; color:#52525b;">${legend}</div>
                </div>
                ${_renderBars(series.bars, _ovMonth)}
                ${series.unconverted ? `<div style="margin-top:14px; font-size:11.5px; color:#a16207; background:rgba(217,119,6,0.08); border-radius:8px; padding:8px 10px;">${series.unconverted} foreign invoice(s) have no exchange rate saved and are excluded.</div>` : ''}
            </div>`;
    }

    // ── Shared pagination bar ────────────────────────────────────────────
    // The app's one pagination look: "Showing X to Y of N <noun>" + a records
    // selector on the left, Prev / Page n of m / Next on the right. `onPage` and
    // `onSize` are the qualified handler names called from the inline markup
    // (e.g. 'Invoice.changeDashPage'), each receiving one number.
    const PAGE_SIZES = [10, 25, 50, 100];

    function renderPagination(o) {
        const total = Number(o.total) || 0;
        if (total <= 0) return '';
        const pageSize = Number(o.pageSize) || PAGE_SIZES[0];
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = Math.min(Math.max(1, Number(o.page) || 1), totalPages);
        const startIdx = (page - 1) * pageSize;
        const noun = o.noun || 'records';
        return `
            <div class="pagination-container" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 18px; padding-top: 14px; border-top: 1px solid rgba(0,0,0,0.06);">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 13px; color: #71717a;">Showing <b>${startIdx + 1}</b> to <b>${Math.min(startIdx + pageSize, total)}</b> of <b>${total}</b> ${_escapeHtml(noun)}</span>
                    <div class="custom-select-wrapper" style="width: 130px;">
                        <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; padding: 6px 12px; font-size: 12.5px;">
                            <span>${pageSize} Records</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options">
                            ${PAGE_SIZES.map(n => `<div class="custom-option${pageSize === n ? ' selected' : ''}" data-value="${n}">${n} Records</div>`).join('')}
                        </div>
                        <input type="hidden" value="${pageSize}" onchange="${o.onSize}(parseInt(this.value))">
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button type="button" class="pagination-btn" onclick="${o.onPage}(${page - 1})" ${page <= 1 ? 'disabled' : ''} style="padding: 6px 12px; font-size: 12.5px;">&larr; Prev</button>
                    <span class="pagination-page-indicator" style="font-size: 13px; font-weight: 600; padding: 0 8px;">Page ${page} of ${totalPages}</span>
                    <button type="button" class="pagination-btn" onclick="${o.onPage}(${page + 1})" ${page >= totalPages ? 'disabled' : ''} style="padding: 6px 12px; font-size: 12.5px;">Next &rarr;</button>
                </div>
            </div>`;
    }

    // ── Client / Vendor multi-select filter ──────────────────────────────
    // The party a document belongs to: client on QU/INV, consignor on PO.
    function _partyOf(doc) {
        return ((doc && (doc.clientName || doc.consignorName)) || '').trim();
    }

    // Distinct parties present in the current documents, bucketed by the group
    // recorded on the client master (vendors carry `group`). Named groups first
    // (sorted), ungrouped last. Returns [{ group, members: [names] }].
    // Pure: bucket distinct party names by the group recorded on the vendor
    // master. Named groups sorted first, ungrouped ('') last; members sorted.
    function _bucketByGroup(names, vendors) {
        const groupByName = new Map();
        (vendors || []).forEach(v => {
            const nm = (v.name || '').trim().toLowerCase();
            if (nm && v.group && String(v.group).trim()) groupByName.set(nm, String(v.group).trim());
        });
        const buckets = new Map();   // group ('' = ungrouped) -> [names]
        Array.from(new Set(names)).map(n => String(n).trim()).filter(Boolean)
            .sort((a, b) => a.localeCompare(b)).forEach(n => {
                const g = groupByName.get(n.toLowerCase()) || '';
                if (!buckets.has(g)) buckets.set(g, []);
                buckets.get(g).push(n);
            });
        const named = Array.from(buckets.keys()).filter(g => g).sort((a, b) => a.localeCompare(b));
        const out = named.map(g => ({ group: g, members: buckets.get(g) }));
        if (buckets.has('')) out.push({ group: '', members: buckets.get('') });
        return out;
    }

    // One instance per filter in the app, keyed by an instance name that also
    // derives the DOM ids ('dash' = dashboard bar, 'modal' = documents popup,
    // and one per module dashboard). Each keeps its own selection +
    // expanded-group state. Module dashboards register their own docs source
    // and change hook via registerClientFilter.
    const _clientFilters = {};
    function _cf(inst) {
        if (!_clientFilters[inst]) _clientFilters[inst] = { sel: new Set(), expanded: new Set() };
        return _clientFilters[inst];
    }

    // docs(): the records whose parties populate this filter.
    // onChange(): re-render whatever that filter drives. allLabel: empty-state text.
    function registerClientFilter(inst, docs, onChange, allLabel) {
        Object.assign(_cf(inst), { docs, onChange, allLabel });
    }

    function clientSelection(inst) {
        return _cf(inst).sel;
    }

    function _clientDocs(inst) {
        const f = _cf(inst);
        if (f.docs) return f.docs();
        return inst === 'modal' ? _modalBaseDocs() : allDocuments;
    }
    function _clientChanged(inst) {
        const f = _cf(inst);
        if (f.onChange) return f.onChange();
        if (inst === 'modal') _renderDocModalTable(); else applyFilters();
    }
    function _clientGroupsForFilter(inst) {
        const names = _clientDocs(inst).map(_partyOf).filter(Boolean);
        return _bucketByGroup(names, (Storage.getAllVendors && Storage.getAllVendors()) || []);
    }

    // An individual client row (checkable). `indented` when shown under a group.
    function _clientOptRow(inst, name, indented) {
        const sel = _cf(inst).sel.has(name);
        return `<div class="client-opt${sel ? ' selected' : ''}" data-client="${_escapeHtml(name)}" role="option" aria-selected="${sel}"
                     style="display:flex;align-items:center;padding:7px 12px 7px ${indented ? '30' : '12'}px;cursor:pointer;font-size:13px;${sel ? 'background:rgba(0,77,44,0.06);' : ''}">
                    <input type="checkbox" tabindex="-1" style="pointer-events:none;margin-right:8px;accent-color:#004d2c;" ${sel ? 'checked' : ''}>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escapeHtml(name)}</span>
                </div>`;
    }

    // A group row: checkbox selects/clears ALL members; the chevron expands it.
    function _groupRow(group, allSel, count, expanded) {
        const chevron = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        return `<div class="client-opt${allSel ? ' selected' : ''}" data-group="${_escapeHtml(group)}" role="option" aria-selected="${allSel}"
                     style="display:flex;align-items:center;padding:8px 12px;cursor:pointer;font-size:13px;${allSel ? 'background:rgba(0,77,44,0.06);' : ''}">
                    <input type="checkbox" tabindex="-1" style="pointer-events:none;margin-right:8px;accent-color:#004d2c;" ${allSel ? 'checked' : ''}>
                    <span style="font-weight:700;color:#18181b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escapeHtml(group)}</span>
                    <span style="margin-left:auto;color:#a1a1aa;font-size:11px;padding:0 8px;">${count}</span>
                    <span data-expand="${_escapeHtml(group)}" title="${expanded ? 'Hide' : 'Show'} clients"
                          style="display:inline-flex;align-items:center;color:#71717a;cursor:pointer;transform:rotate(${expanded ? '180deg' : '0deg'});transition:transform .15s;">${chevron}</span>
                </div>`;
    }

    // Dropdown list: each GROUP as one row first (expandable to check members),
    // then ungrouped clients individually. Searching auto-expands groups.
    function _renderClientOptions(inst, search) {
        const q = (search || '').toLowerCase().trim();
        const sel = _cf(inst).sel;
        const expandedSet = _cf(inst).expanded;
        const groups = _clientGroupsForFilter(inst);
        let html = '';
        let groupRows = 0;

        groups.forEach(({ group, members }) => {
            if (!group) return;
            const groupMatches = !!q && group.toLowerCase().includes(q);
            const matched = q ? (groupMatches ? members : members.filter(n => n.toLowerCase().includes(q))) : members;
            if (q && !groupMatches && matched.length === 0) return;
            groupRows++;
            const allSel = members.length > 0 && members.every(n => sel.has(n));
            const expanded = q ? true : expandedSet.has(group);
            html += _groupRow(group, allSel, members.length, expanded);
            if (expanded) matched.forEach(n => { html += _clientOptRow(inst, n, true); });
        });

        const ungrouped = (groups.find(b => b.group === '') || { members: [] }).members;
        const visible = ungrouped.filter(n => !q || n.toLowerCase().includes(q));
        if (groupRows && visible.length) html += `<div style="border-top:1px solid rgba(0,0,0,0.06);"></div>`;
        visible.forEach(n => { html += _clientOptRow(inst, n, false); });

        if (!html) html = `<div style="padding:14px 12px;color:#a1a1aa;font-size:12px;text-align:center;">No matching clients.</div>`;
        return html;
    }

    function _toggleGroupExpand(inst, group) {
        const ex = _cf(inst).expanded;
        if (ex.has(group)) ex.delete(group); else ex.add(group);
        const opts = document.getElementById(`client-filter-${inst}-options`);
        const search = document.getElementById(`client-filter-${inst}-search`);
        if (opts) opts.innerHTML = _renderClientOptions(inst, search ? search.value : '');
    }

    // Selected "entries" for the trigger label: a fully-selected group → its name
    // once; a partial group → each selected member; plus ungrouped selections.
    function _selectedClientEntries(inst) {
        const sel = _cf(inst).sel;
        const labels = [];
        _clientGroupsForFilter(inst).forEach(({ group, members }) => {
            if (!group) { members.forEach(n => { if (sel.has(n)) labels.push(n); }); return; }
            if (members.length && members.every(n => sel.has(n))) labels.push(group);
            else members.forEach(n => { if (sel.has(n)) labels.push(n); });
        });
        return labels;
    }

    function _clientFilterLabel(inst) {
        const labels = _selectedClientEntries(inst);
        if (labels.length === 0) return _cf(inst).allLabel || 'All Clients';
        if (labels.length === 1) return labels[0];
        return `${labels.length} selected`;
    }

    // Reusable filter cell. opts: { width, label, anchor:'left'|'right', modal }.
    function _alignClientPanel(inst) {
        const panel = document.getElementById(`client-filter-${inst}-panel`);
        const wrapper = document.getElementById(`client-filter-${inst}-wrapper`);
        if (!panel || !wrapper) return;
        const vpWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        if (vpWidth <= 0) return;
        const wrapRect = wrapper.getBoundingClientRect();
        const panelWidth = 260;
        if (wrapRect.left + panelWidth > vpWidth - 12 && wrapRect.right >= panelWidth) {
            panel.style.left = 'auto';
            panel.style.right = '0';
        } else if (wrapRect.right - panelWidth < 12 && (vpWidth - wrapRect.left) >= panelWidth) {
            panel.style.left = '0';
            panel.style.right = 'auto';
        }
    }

    function _renderClientFilter(inst, opts) {
        opts = opts || {};
        const width = opts.width || 180;
        const anchor = opts.anchor === 'right' ? 'right:0;left:auto;' : 'left:0;right:auto;';
        const labelHtml = opts.label
            ? `<span style="font-size:10px;font-weight:700;color:#8e8e93;text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:4px;">${_escapeHtml(opts.label)}</span>` : '';
        const triggerStyle = opts.modal
            ? 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 14px;background:#f2f2f7;border:none;border-radius:12px;cursor:pointer;font-size:13px;color:#1c1c1e;height:38px;box-sizing:border-box;'
            : 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 12px;background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:8px;cursor:pointer;font-size:13px;color:#3f3f46;';
        return `
            <div style="display:flex;flex-direction:column;text-align:left;">
                ${labelHtml}
                <div id="client-filter-${inst}-wrapper" style="position:relative;width:${width}px;">
                    <div onclick="Dashboard.toggleClientFilter('${inst}')" style="${triggerStyle}">
                        <span id="client-filter-${inst}-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escapeHtml(_clientFilterLabel(inst))}</span>
                        <div class="arrow" style="border:solid #71717a;border-width:0 1.5px 1.5px 0;display:inline-block;padding:2.5px;transform:rotate(45deg);flex:0 0 auto;"></div>
                    </div>
                    <div id="client-filter-${inst}-panel" onclick="event.stopPropagation()" style="display:none;position:absolute;top:calc(100% + 4px);${anchor}width:260px;max-width:calc(100vw - 24px);box-sizing:border-box;background:#fff;border:1px solid rgba(0,0,0,0.12);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:1000;overflow:hidden;">
                        <div style="padding:8px;border-bottom:1px solid rgba(0,0,0,0.06);display:flex;gap:6px;align-items:center;">
                            <input id="client-filter-${inst}-search" type="text" placeholder="Search client / vendor…" oninput="Dashboard.filterClientOptions('${inst}')"
                                   style="flex:1;min-width:0;padding:7px 10px;border:1px solid rgba(0,0,0,0.12);border-radius:6px;font-size:12.5px;box-sizing:border-box;">
                            <button type="button" onclick="Dashboard.clearClientFilter('${inst}')" title="Clear selection"
                                    style="border:none;background:transparent;color:#004d2c;font-size:12px;font-weight:600;cursor:pointer;padding:4px 6px;white-space:nowrap;flex:0 0 auto;">Clear</button>
                        </div>
                        <div id="client-filter-${inst}-options" onclick="Dashboard.onClientOptionClick('${inst}', event)" style="max-height:260px;overflow-y:auto;">${_renderClientOptions(inst, '')}</div>
                    </div>
                </div>
            </div>`;
    }

    function toggleClientFilter(inst) {
        const panel = document.getElementById(`client-filter-${inst}-panel`);
        if (!panel) return;
        const willOpen = (panel.style.display !== 'block');
        panel.style.display = willOpen ? 'block' : 'none';
        if (willOpen) {
            _alignClientPanel(inst);
            const rect = panel.getBoundingClientRect();
            const docWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            if (rect.right > docWidth - 8) {
                panel.style.left = 'auto';
                panel.style.right = '0';
            }
        }
    }

    function onClientOptionClick(inst, e) {
        const exp = e.target.closest('[data-expand]');
        if (exp) { _toggleGroupExpand(inst, exp.getAttribute('data-expand')); return; }
        const g = e.target.closest('[data-group]');
        if (g) { _toggleClientGroup(inst, g.getAttribute('data-group')); return; }
        const c = e.target.closest('[data-client]');
        if (c) { _toggleClientSelection(inst, c.getAttribute('data-client')); }
    }

    function _toggleClientSelection(inst, name) {
        const sel = _cf(inst).sel;
        if (sel.has(name)) sel.delete(name); else sel.add(name);
        _afterClientChange(inst);
    }

    function _toggleClientGroup(inst, group) {
        const sel = _cf(inst).sel;
        const bucket = _clientGroupsForFilter(inst).find(b => b.group === group);
        if (!bucket) return;
        const allSel = bucket.members.every(n => sel.has(n));
        bucket.members.forEach(n => { if (allSel) sel.delete(n); else sel.add(n); });
        _afterClientChange(inst);
    }

    function clearClientFilter(inst) {
        _cf(inst).sel.clear();
        _afterClientChange(inst);
    }

    // The running serial buried in a reference number: ORG/0105/2627 -> 105,
    // ORG001/ABC001/PO/26-27 -> 1, ORG/INT001/25-26 -> 1. The financial year is
    // always the last "/" segment, and the org-wide serial is the first number
    // before it in every format we issue. -1 when a hand-edited ref has none.
    function _serialOf(doc) {
        const parts = String((doc && (doc.refNumber || doc.poNumber)) || '').split('/');
        if (parts.length > 1) parts.pop();
        const nums = parts.join('/').match(/\d+/g);
        return nums ? parseInt(nums[0], 10) : -1;
    }

    // Order a document dashboard newest-first: latest financial year on top and,
    // within a year, the highest serial on top — so serials run in ascending order
    // reading from the bottom row up. Serials restart each financial year, which is
    // why the year is compared first. Date and save order only break exact ties.
    function compareBySerial(a, b) {
        const fyA = a.date ? Storage.getFinancialYear(a.date) : '';
        const fyB = b.date ? Storage.getFinancialYear(b.date) : '';
        if (fyA !== fyB) return fyB.localeCompare(fyA);

        const sA = _serialOf(a), sB = _serialOf(b);
        if (sA !== sB) return sB - sA;

        const dtA = a.date || '', dtB = b.date || '';
        if (dtA !== dtB) return dtB.localeCompare(dtA);
        return (b.savedAt || b.id || '').localeCompare(a.savedAt || a.id || '');
    }

    // A module dashboard repaints its whole container on every keystroke, which
    // destroys the filter search box the user is typing into — so only the first
    // letter lands. Run the render, then put focus and the caret back.
    function keepFocus(render) {
        const el = document.activeElement;
        const id = el && el.id;
        let start = null, end = null;
        try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* not a text input */ }

        render();

        if (!id) return;
        const next = document.getElementById(id);
        if (!next || next === document.activeElement) return;
        next.focus();
        if (start != null) { try { next.setSelectionRange(start, end); } catch (e) { /* not a text input */ } }
    }

    function filterClientOptions(inst) {
        const opts = document.getElementById(`client-filter-${inst}-options`);
        const search = document.getElementById(`client-filter-${inst}-search`);
        if (opts) opts.innerHTML = _renderClientOptions(inst, search ? search.value : '');
    }

    // Repaint options + label (panel stays open, search kept), then refresh the
    // instance's table. A module's onChange may rebuild its whole dashboard and
    // wipe this panel, so the open state + search text are restored afterwards.
    function _repaintClientPanel(inst, searchText) {
        const opts = document.getElementById(`client-filter-${inst}-options`);
        if (opts) opts.innerHTML = _renderClientOptions(inst, searchText);
        const label = document.getElementById(`client-filter-${inst}-label`);
        if (label) label.textContent = _clientFilterLabel(inst);
    }

    function _afterClientChange(inst) {
        const searchEl = document.getElementById(`client-filter-${inst}-search`);
        const searchText = searchEl ? searchEl.value : '';
        const panel = document.getElementById(`client-filter-${inst}-panel`);
        const wasOpen = !!panel && panel.style.display === 'block';

        _repaintClientPanel(inst, searchText);
        const done = _clientChanged(inst);

        if (!wasOpen) return;
        const restore = () => {
            const freshPanel = document.getElementById(`client-filter-${inst}-panel`);
            if (!freshPanel || freshPanel.style.display === 'block') return;   // survived the re-render
            freshPanel.style.display = 'block';
            _alignClientPanel(inst);
            const freshSearch = document.getElementById(`client-filter-${inst}-search`);
            if (freshSearch) freshSearch.value = searchText;
            _repaintClientPanel(inst, searchText);
        };
        // An async onChange (Sales) repaints after its promise settles.
        if (done && typeof done.then === 'function') done.then(restore, restore); else restore();
    }

    // Close any open client panel when clicking outside its wrapper (bound once).
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            Object.keys(_clientFilters).forEach(inst => {
                const wrap = document.getElementById(`client-filter-${inst}-wrapper`);
                const panel = document.getElementById(`client-filter-${inst}-panel`);
                if (panel && panel.style.display === 'block' && wrap && !wrap.contains(e.target)) {
                    panel.style.display = 'none';
                }
            });
        });
    }

    function applyFilters(keepPage = false) {
        const searchInput = document.getElementById('filter-search');
        const typeInput = document.getElementById('filter-type');
        const regionInput = document.getElementById('filter-region');
        const monthInput = document.getElementById('filter-month');
        const fyInput = document.getElementById('filter-fy');

        if (!keepPage) {
            currentPage = 1;
        }

        // The filter controls only exist once there is at least one document.
        // When they're absent (e.g. a brand-new account) we must still paint the
        // empty state — returning early here used to leave the section blank.
        if (!searchInput || !typeInput || !monthInput || !fyInput) {
            const tc = document.getElementById('recent-table-container');
            if (tc) {
                const total = allDocuments.length;
                const totalPages = Math.ceil(total / pageSize);
                if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
                const paginated = allDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize);
                tc.innerHTML = total === 0
                    ? _renderEmptyState()
                    : _renderRecentTable(paginated, total);
            }
            return;
        }

        currentSearch = searchInput.value;
        currentType = typeInput.value;
        currentRegion = regionInput ? regionInput.value : '';
        currentMonth = monthInput.value;
        currentFy = fyInput.value;

        const searchQuery = currentSearch.toLowerCase().trim();
        const typeFilter = currentType;
        const regionFilter = currentRegion;
        const monthFilter = currentMonth;
        const fyFilter = currentFy;

        const filtered = allDocuments.filter(doc => {
            const docNo = `${doc.refNumber || ''} ${doc.poNumber || ''}`.toLowerCase();
            const name = (doc.consignorName || doc.clientName || '').toLowerCase();
            const matchesSearch = !searchQuery || docNo.includes(searchQuery) || name.includes(searchQuery);

            const matchesType = !typeFilter || doc.type === typeFilter;

            const matchesRegion = !regionFilter || _docRegion(doc) === regionFilter;

            const dashSel = _clientFilters.dash.sel;
            const matchesClient = dashSel.size === 0 || dashSel.has(_partyOf(doc));

            let matchesMonth = true;
            if (monthFilter && doc.date) {
                const month = doc.date.split('-')[1];
                matchesMonth = month === monthFilter;
            }

            let matchesFY = true;
            if (fyFilter && doc.date) {
                const fy = Storage.getFinancialYear(doc.date);
                matchesFY = fy === fyFilter;
            }

            return matchesSearch && matchesType && matchesRegion && matchesMonth && matchesFY && matchesClient;
        });

        const tableContainer = document.getElementById('recent-table-container');
        if (tableContainer) {
            if (allDocuments.length === 0) {
                tableContainer.innerHTML = _renderEmptyState();
            } else if (filtered.length > 0) {
                const total = filtered.length;
                const totalPages = Math.ceil(total / pageSize);
                if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
                const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
                tableContainer.innerHTML = _renderRecentTable(paginated, total);
            } else {
                tableContainer.innerHTML = _renderEmptyState("No matching documents found.");
            }
        }
    }

    function toggleFilters() {
        const wrapper = document.getElementById('dashboard-filters-wrapper');
        const btn = document.getElementById('btn-toggle-filters');
        if (!wrapper) return;

        if (wrapper.style.display === 'none') {
            wrapper.style.display = 'block';
            filtersVisible = true;
            if (btn) btn.classList.add('active');
        } else {
            wrapper.style.display = 'none';
            filtersVisible = false;
            if (btn) btn.classList.remove('active');
        }
    }

    function changePage(p) {
        currentPage = p;
        applyFilters(true);
    }

    function changePageSize(size) {
        pageSize = size;
        currentPage = 1;
        applyFilters(true);
    }

    // --- Stat-card document popup -------------------------------------------
    // Which document set the popup is currently showing, and (for Quotations /
    // Invoices) the Domestic/International/All region filter within it.
    let _modalType = null;   // 'PO' | 'QU' | 'INV' | 'ALL'
    let _modalRegion = '';   // '' (all) | 'domestic' | 'international'
    let _modalSearch = '';   // free-text filter (ref / party / department)
    let _modalPage = 1;
    let _modalPageSize = 10;
    let _modalTimeframe = 'all'; // 'all' | 'fy' | 'custom'
    let _modalSelectedFY = '';   // e.g. '2026-2027'
    let _modalCustomStart = '';  // e.g. '2026-04'
    let _modalCustomEnd = '';    // e.g. '2026-07'

    // Temporary variables for Select Timeline Popup Modal
    let _tempTab = 'custom'; // 'custom' | 'fy'
    let _tempStartMonth = 1;
    let _tempStartYear = 2026;
    let _tempEndMonth = 1;
    let _tempEndYear = 2026;
    let _tempSelectedFY = '';
    const _monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    function _getAvailableFinancialYears() {
        const years = new Set();
        const currentFY = Storage.getFinancialYear();
        if (currentFY) years.add(currentFY);
        
        allDocuments.forEach(doc => {
            if (doc.date) {
                const fy = Storage.getFinancialYear(doc.date);
                if (fy) years.add(fy);
            }
        });
        return Array.from(years).sort((a, b) => b.localeCompare(a));
    }

    function _formatMonthYearText(ymString) {
        if (!ymString) return '—';
        const parts = ymString.split('-');
        if (parts.length !== 2) return ymString;
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const fullMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = fullMonths[monthNum - 1] || '';
        return `${monthName} ${year}`;
    }

    function _getTimelineLabel() {
        if (_modalTimeframe === 'all') return 'All Time';
        if (_modalTimeframe === 'fy') return `FY ${_modalSelectedFY}`;
        if (_modalTimeframe === 'custom') {
            if (_modalCustomStart === _modalCustomEnd) {
                return _formatMonthYearText(_modalCustomStart);
            }
            return `${_formatMonthYearText(_modalCustomStart)} - ${_formatMonthYearText(_modalCustomEnd)}`;
        }
        return 'All Time';
    }

    function _getAvailableYears() {
        const years = new Set();
        const currentYear = new Date().getFullYear();
        years.add(currentYear);
        allDocuments.forEach(doc => {
            if (doc.date) {
                const y = parseInt(doc.date.substring(0, 4), 10);
                if (y) years.add(y);
            }
        });
        return Array.from(years).sort((a, b) => b - a);
    }

    function _getPopupShowingText() {
        if (_tempTab === 'custom') {
            const startMName = _monthNames[_tempStartMonth - 1] || '';
            const endMName = _monthNames[_tempEndMonth - 1] || '';
            if (_tempStartMonth === _tempEndMonth && _tempStartYear === _tempEndYear) {
                return `${startMName} ${_tempStartYear}`;
            }
            return `${startMName} ${_tempStartYear} – ${endMName} ${_tempEndYear}`;
        } else if (_tempTab === 'fy') {
            return `FY ${_tempSelectedFY}`;
        }
        return 'All Time';
    }

    // Documents matching the popup's current type + region + search. The region
    // filter only applies to Quotations and Invoices (POs are always domestic;
    // ALL spans both).
    // Modal docs by type + region + timeline only (no search, no client filter).
    // This is the population the modal's client-filter dropdown is built from.
    function _modalBaseDocs() {
        const regionApplies = (_modalType === 'QU' || _modalType === 'INV');
        return allDocuments.filter(doc => {
            if (_modalType !== 'ALL' && doc.type !== _modalType) return false;
            if (regionApplies && _modalRegion && _docRegion(doc) !== _modalRegion) return false;

            if (doc.date) {
                if (_modalTimeframe === 'fy') {
                    if (Storage.getFinancialYear(doc.date) !== _modalSelectedFY) return false;
                } else if (_modalTimeframe === 'custom') {
                    const docYM = doc.date.substring(0, 7); // 'YYYY-MM'
                    if (_modalCustomStart && docYM < _modalCustomStart) return false;
                    if (_modalCustomEnd && docYM > _modalCustomEnd) return false;
                }
            } else {
                if (_modalTimeframe !== 'all') return false;
            }
            return true;
        });
    }

    // Report exports follow the popup's filters by default. A module dashboard
    // (e.g. Invoice) passes its own { type, docs } to openDownloadFormatDialog
    // so the same report is generated from that dashboard's filtered list.
    let _reportOverride = null;
    const _reportDocs = () => _reportOverride ? _reportOverride.docs : _modalFilteredDocs();
    const _reportType = () => _reportOverride ? _reportOverride.type : _modalType;

    function _modalFilteredDocs() {
        const q = _modalSearch.trim().toLowerCase();
        const sel = _cf('modal').sel;
        return _modalBaseDocs().filter(doc => {
            if (sel.size && !sel.has(_partyOf(doc))) return false;
            if (q) {
                const docNo = (doc.type === 'PO' ? (doc.poNumber || doc.refNumber) : (doc.refNumber || doc.poNumber)) || '';
                const party = doc.type === 'PO' ? (doc.consignorName || '') : (doc.clientName || doc.consignorName || '');
                const dept = doc.department || '';
                const hay = `${docNo} ${party} ${dept}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }

    // The controls row (count + search + region toggle). Rendered into its own
    // container so the region toggle can refresh without rebuilding the whole
    // modal — rebuilding the modal caused a visible "blink" and dropped focus.
    function _docModalControlsHTML() {
        const showToggle = _modalType === 'QU' || _modalType === 'INV';
        const searchLabel = _modalType === 'PO' ? 'supplier' : 'client';

        // Accent matched to the document type's stat card, for a cohesive premium look.
        const accentMap = { PO: '#2e7d32', QU: '#6366f1', INV: '#d97706', ALL: '#0f172a' };
        const accent = accentMap[_modalType] || '#004d2c';
        const accentSoft = accent + '22'; // ~13% alpha (8-digit hex)

        const hasSearch = !!(_modalSearch && _modalSearch.trim());

        const pill = (val, label) => {
            const active = _modalRegion === val;
            const base = 'position:relative; padding:8px 18px; font-size:12.5px; font-weight:600; border:none; border-radius:99px; cursor:pointer; transition:all .2s ease; letter-spacing:0.1px; height:34px; box-sizing:border-box;';
            const style = active
                ? base + ` background:linear-gradient(180deg, ${accent}, ${accent}); color:#fff; box-shadow:0 2px 8px ${accentSoft}, 0 1px 2px rgba(0,0,0,0.12);`
                : base + ' background:transparent; color:#71717a;';
            const hover = active ? '' : ` onmouseover="this.style.color='#18181b'" onmouseout="this.style.color='#71717a'"`;
            return `<button type="button" onclick="Dashboard.setDocModalRegion('${val}')" style="${style}"${hover}>${label}</button>`;
        };
        const toggle = showToggle
            ? `<div style="display:inline-flex; align-items:center; background:#f1f1f4; padding:3px; border-radius:12px; gap:3px; box-shadow:inset 0 1px 2px rgba(0,0,0,0.06); height:40px; box-sizing:border-box;">
                   ${pill('domestic', 'Domestic')}${pill('international', 'International')}${pill('', 'All')}
               </div>`
            : '';

        const searchBar = `
            <div style="display:flex; flex-direction:column; text-align:left; flex:1 1 340px; max-width:460px; width:100%; box-sizing:border-box;">
                <span style="font-size:10px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.8px; display:block; margin-bottom:4px;">SEARCH</span>
                <div style="position:relative; display:flex; align-items:center; height:38px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute; left:12px; pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="dashboard-doc-modal-search" type="text" value="${_escapeHtml(_modalSearch)}" oninput="Dashboard.setDocModalSearch(this.value)" placeholder="Search ref, ${searchLabel}, department…"
                        style="width:100%; padding:9px 34px 9px 36px; font-size:13px; color:#18181b; border:1px solid rgba(0,0,0,0.10); border-radius:12px; outline:none; background:#fff; box-shadow:inset 0 1px 2px rgba(0,0,0,0.03); transition:border-color .18s ease, box-shadow .18s ease; height:38px; box-sizing:border-box;"
                        onfocus="this.style.borderColor='${accent}'; this.style.boxShadow='0 0 0 3px ${accentSoft}';"
                        onblur="this.style.borderColor='rgba(0,0,0,0.10)'; this.style.boxShadow='inset 0 1px 2px rgba(0,0,0,0.03)';">
                    <button type="button" id="dashboard-doc-modal-clear" onclick="Dashboard.setDocModalSearch('')" title="Clear search"
                        style="position:absolute; right:8px; display:${hasSearch ? 'inline-flex' : 'none'}; align-items:center; justify-content:center; width:22px; height:22px; border:none; border-radius:50%; background:rgba(0,0,0,0.06); color:#71717a; cursor:pointer; transition:background .15s;"
                        onmouseover="this.style.background='rgba(0,0,0,0.12)'" onmouseout="this.style.background='rgba(0,0,0,0.06)'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
        `;

        const timelineSelect = `
            <div class="custom-select-wrapper" id="modal-timeline-wrapper" style="position:relative; display:inline-block; text-align:left;">
                <span style="font-size:10px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.8px; display:block; margin-bottom:4px;">TIMELINE</span>
                <div class="custom-select-trigger" onclick="Dashboard.openTimelinePopup()" 
                    style="display:inline-flex; align-items:center; justify-content:space-between; padding:8px 16px; background:#f2f2f7; border-radius:12px; cursor:pointer; font-size:13.5px; font-weight:600; color:#1c1c1e; min-width:140px; border:none; box-shadow:0 1px 2px rgba(0,0,0,0.05); transition:background 0.2s; height:38px; box-sizing:border-box;"
                    onmouseover="this.style.background='#e5e5ea'" onmouseout="this.style.background='#f2f2f7'">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#71717a;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <span>${_getTimelineLabel()}</span>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#71717a;"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
            </div>
        `;

        const regionSelector = showToggle ? `
            <div style="display:flex; flex-direction:column; text-align:left;">
                <span style="font-size:10px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.8px; display:block; margin-bottom:4px;">Region</span>
                ${toggle}
            </div>
        ` : '';

        // Client/vendor multi-select (same component as the dashboard bar).
        const clientSelector = _renderClientFilter('modal', { width: 170, label: _modalType === 'PO' ? 'Supplier' : 'Client', anchor: 'right', modal: true });

        const countSelector = `
            <div style="display:flex; flex-direction:column; align-items:flex-start;">
                <span style="font-size:10px; font-weight:700; color:#8e8e93; text-transform:uppercase; letter-spacing:0.8px; display:block; margin-bottom:4px; opacity:0; pointer-events:none;">Actions</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span id="dashboard-doc-modal-count" style="font-size:12px; font-weight:600; color:#52525b; background:${accentSoft}; padding:8px 14px; border-radius:12px; white-space:nowrap; height:38px; box-sizing:border-box; display:inline-flex; align-items:center; border:1px solid rgba(0,0,0,0.03);"></span>
                </div>
            </div>
        `;

        return `
            <div style="display:flex; align-items:flex-end; gap:16px; flex-wrap:nowrap;
                 padding:13px 16px; background:linear-gradient(180deg,#ffffff,#fbfbfc);
                 border:1px solid rgba(0,0,0,0.07); border-radius:16px; box-shadow:0 6px 20px rgba(0,0,0,0.045); width:100%; box-sizing:border-box;">
                ${searchBar}
                <div style="display:flex; align-items:flex-end; gap:16px; margin-left:auto;">
                    ${timelineSelect}
                    ${regionSelector}
                    ${clientSelector}
                    ${countSelector}
                </div>
            </div>`;
    }

    function _docModalInnerHTML() {
        const titleMap = { PO: 'PO Issue', QU: 'Quotations', INV: 'Invoices', ALL: 'All Documents' };
        return `
            <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:16px; padding:24px; width:1664px; max-width:96vw; height:85vh; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 15px 45px rgba(0,0,0,0.15); text-align:left;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:20px;">
                    <h3 style="font-size:18px; font-weight:700; color:#18181b; margin:0;">${titleMap[_modalType] || 'Documents'}</h3>
                    <button type="button" onclick="Dashboard.closeDocModal()" style="display:inline-flex; align-items:center; gap:7px; padding:9px 16px; font-size:13px; font-weight:600; background:#f4f4f5; border:1px solid rgba(0,0,0,0.1); color:#27272a; border-radius:9px; cursor:pointer; transition:all 0.15s;" onmouseover="this.style.background='#e8e8ea'" onmouseout="this.style.background='#f4f4f5'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Close
                    </button>
                </div>
                <div id="dashboard-doc-modal-controls" style="margin-bottom:16px;">${_docModalControlsHTML()}</div>
                <div id="dashboard-doc-modal-table" style="overflow:auto; flex:1;"></div>
                <div id="dashboard-doc-modal-pagination"></div>
                <div id="dashboard-doc-modal-total"></div>
            </div>`;
    }

    function _renderDocModalTable() {
        const tc = document.getElementById('dashboard-doc-modal-table');
        if (!tc) return;
        const docs = _modalFilteredDocs();
        const total = docs.length;
        const totalPages = Math.max(1, Math.ceil(total / _modalPageSize));
        if (_modalPage > totalPages) _modalPage = totalPages;
        const paginated = docs.slice((_modalPage - 1) * _modalPageSize, _modalPage * _modalPageSize);

        // Per-type popup table (Date and Time | Ref Number | Department | party |
        // value… | Actions). Always rendered with its headers — even with no rows
        // a placeholder row is shown rather than hiding the whole table.
        tc.innerHTML = _renderModalTable(paginated, _modalType);

        const pc = document.getElementById('dashboard-doc-modal-pagination');
        if (pc) pc.innerHTML = renderPagination({
            page: _modalPage, pageSize: _modalPageSize, total, noun: 'documents',
            onPage: 'Dashboard.setDocModalPage', onSize: 'Dashboard.setDocModalPageSize'
        });

        const countEl = document.getElementById('dashboard-doc-modal-count');
        if (countEl) countEl.textContent = `${total} document${total === 1 ? '' : 's'}`;

        // Invoice popup: a floating summary bar at the bottom totalling the value of
        // ALL currently-filtered invoices (in home currency), so the user can type a
        // client name and instantly see that client's invoice count + total value.
        const totalEl = document.getElementById('dashboard-doc-modal-total');
        if (totalEl) {
            if (_modalType !== 'INV') {
                totalEl.innerHTML = '';
            } else {
                const homeCur = 'INR';
                let sum = 0, unconverted = 0, totalReceiptAmt = 0, totalReceivable = 0;
                docs.forEach(d => {
                    if (d.grandTotal === undefined || d.grandTotal === null || d.grandTotal === '') return;
                    const gt = parseFloat(d.grandTotal) || 0;
                    const cur = d.currency || homeCur;
                    let valInHome = 0;
                    if (cur === homeCur) {
                        valInHome = gt;
                    } else {
                        const rate = parseFloat(d.exchangeRate);
                        if (rate > 0) valInHome = FinanceUtils.truncate2(gt * rate); else unconverted += 1;
                    }
                    sum = FinanceUtils.truncate2(sum + valInHome);
                    
                    const cur_rate = cur === homeCur ? 1 : parseFloat(d.exchangeRate);
                    if (cur === homeCur || cur_rate > 0) {
                        totalReceiptAmt += _receivedForInvoiceInINR(d.id);
                    }

                    const received = _receivedForInvoice(d.id);
                    const remaining = Math.max(0, gt - received);
                    if (remaining > 0) {
                        if (cur === homeCur) {
                            totalReceivable = FinanceUtils.truncate2(totalReceivable + remaining);
                        } else {
                            const rate = parseFloat(d.exchangeRate) || 0;
                            if (rate > 0) {
                                totalReceivable = FinanceUtils.truncate2(totalReceivable + remaining * rate);
                            }
                        }
                    }
                });
                const note = unconverted > 0
                    ? `<span style="font-size:11px; color:#a1a1aa; font-weight:500; margin-left:8px;">(${unconverted} foreign invoice${unconverted === 1 ? '' : 's'} without a rate excluded)</span>`
                    : '';
                totalEl.innerHTML = `
                    <div style="margin-top:14px; padding:15px 20px; display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap;
                         background:linear-gradient(180deg,#fffaf3,#fff7ec); border:1px solid rgba(217,119,6,0.22); border-radius:14px;
                         box-shadow:0 8px 24px rgba(217,119,6,0.10);">
                        <div style="display:flex; flex-direction:column; gap:4px; text-align:left;">
                            <span style="font-size:13px; color:#52525b; font-weight:600;">Total of ${total} invoice${total === 1 ? '' : 's'}${note}</span>
                            <div style="font-size:13px; color:#71717a; font-weight:500; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                                <span>Total Invoice Amount: <strong style="color:#18181b;">${PdfUtils.formatMoney(sum, homeCur)}</strong></span>
                                <span style="color:#d4d4d8;">|</span>
                                <span>Receipt Amount: <strong style="color:#18181b;">${PdfUtils.formatMoney(totalReceiptAmt, homeCur)}</strong></span>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:11px; color:#71717a; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:2px;">Total Receivable</span>
                            <span style="font-size:20px; font-weight:800; color:#18181b; letter-spacing:-0.4px;">${PdfUtils.formatMoney(totalReceivable, homeCur)}</span>
                        </div>
                    </div>`;
            }
        }
    }

    function setDocModalPage(p) {
        _modalPage = Math.max(1, p);
        _renderDocModalTable();
    }

    function setDocModalPageSize(size) {
        _modalPageSize = size;
        _modalPage = 1;
        _renderDocModalTable();
    }

    function openDocModal(type) {
        _modalType = type;
        _modalRegion = '';
        _modalSearch = '';
        _clientFilters.modal.sel.clear();       // start each modal with no client filter
        _clientFilters.modal.expanded.clear();
        _modalPage = 1;
        _modalTimeframe = 'all';
        _modalSelectedFY = Storage.getFinancialYear();
        
        const today = new Date();
        const year = today.getFullYear();
        const monthStr = String(today.getMonth() + 1).padStart(2, '0');
        _modalCustomStart = `${year}-${monthStr}`;
        _modalCustomEnd = `${year}-${monthStr}`;

        let modal = document.getElementById('dashboard-doc-modal');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.id = 'dashboard-doc-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:15000; align-items:center; justify-content:center; backdrop-filter:blur(4px); font-family:\'Inter\', -apple-system, sans-serif;';
        modal.innerHTML = _docModalInnerHTML();
        // Closes only via the ✕ button — clicking the backdrop does NOT dismiss it.
        document.body.appendChild(modal);

        _renderDocModalTable();
    }

    function _timelinePopupHTML() {
        const years = _getAvailableYears();
        const startMonthSelect = `
            <div class="custom-select-wrapper" style="flex:1;">
                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: #f2f2f7; border: none; border-radius: 12px; font-weight: 600; color: #1c1c1e; height: 42px; padding: 10px 14px; box-sizing: border-box;">
                    <span>${_monthNames[_tempStartMonth - 1]}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options" style="max-height: 200px; overflow-y: auto;">
                    ${_monthNames.map((m, idx) => `<div class="custom-option${_tempStartMonth === (idx+1) ? ' selected' : ''}" data-value="${idx+1}">${m}</div>`).join('')}
                </div>
                <input type="hidden" id="timeline-popup-start-month" value="${_tempStartMonth}" onchange="Dashboard.updateTimelinePopupUI()">
            </div>
        `;
        const startYearSelect = `
            <div class="custom-select-wrapper" style="flex:1;">
                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: #f2f2f7; border: none; border-radius: 12px; font-weight: 600; color: #1c1c1e; height: 42px; padding: 10px 14px; box-sizing: border-box;">
                    <span>${_tempStartYear}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options" style="max-height: 200px; overflow-y: auto;">
                    ${years.map(y => `<div class="custom-option${_tempStartYear === y ? ' selected' : ''}" data-value="${y}">${y}</div>`).join('')}
                </div>
                <input type="hidden" id="timeline-popup-start-year" value="${_tempStartYear}" onchange="Dashboard.updateTimelinePopupUI()">
            </div>
        `;
        const endMonthSelect = `
            <div class="custom-select-wrapper" style="flex:1;">
                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: #f2f2f7; border: none; border-radius: 12px; font-weight: 600; color: #1c1c1e; height: 42px; padding: 10px 14px; box-sizing: border-box;">
                    <span>${_monthNames[_tempEndMonth - 1]}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options" style="max-height: 200px; overflow-y: auto;">
                    ${_monthNames.map((m, idx) => `<div class="custom-option${_tempEndMonth === (idx+1) ? ' selected' : ''}" data-value="${idx+1}">${m}</div>`).join('')}
                </div>
                <input type="hidden" id="timeline-popup-end-month" value="${_tempEndMonth}" onchange="Dashboard.updateTimelinePopupUI()">
            </div>
        `;
        const endYearSelect = `
            <div class="custom-select-wrapper" style="flex:1;">
                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: #f2f2f7; border: none; border-radius: 12px; font-weight: 600; color: #1c1c1e; height: 42px; padding: 10px 14px; box-sizing: border-box;">
                    <span>${_tempEndYear}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options" style="max-height: 200px; overflow-y: auto;">
                    ${years.map(y => `<div class="custom-option${_tempEndYear === y ? ' selected' : ''}" data-value="${y}">${y}</div>`).join('')}
                </div>
                <input type="hidden" id="timeline-popup-end-year" value="${_tempEndYear}" onchange="Dashboard.updateTimelinePopupUI()">
            </div>
        `;

        const bodyContent = _tempTab === 'custom' ? `
            <div style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
                <div>
                    <span style="font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; display: block; margin-bottom: 6px;">FROM</span>
                    <div style="display: flex; gap: 10px;">
                        ${startMonthSelect}
                        ${startYearSelect}
                    </div>
                </div>
                <div>
                    <span style="font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; display: block; margin-bottom: 6px;">TO</span>
                    <div style="display: flex; gap: 10px;">
                        ${endMonthSelect}
                        ${endYearSelect}
                    </div>
                </div>
            </div>
        ` : `
            <div style="display: flex; flex-direction: column; gap: 14px; text-align: left;">
                <div>
                    <span style="font-size: 11px; font-weight: 700; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.8px; display: block; margin-bottom: 6px;">SELECT FINANCIAL YEAR</span>
                    <div class="custom-select-wrapper" style="width:100%;">
                        <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; background: #f2f2f7; border: none; border-radius: 12px; font-weight: 600; color: #1c1c1e; height: 42px; padding: 10px 14px; box-sizing: border-box;">
                            <span>FY ${_tempSelectedFY}</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options" style="max-height: 200px; overflow-y: auto;">
                            ${_getAvailableFinancialYears().map(fy => `<div class="custom-option${_tempSelectedFY === fy ? ' selected' : ''}" data-value="${fy}">FY ${fy}</div>`).join('')}
                        </div>
                        <input type="hidden" id="timeline-popup-fy-select" value="${_tempSelectedFY}" onchange="Dashboard.updateTimelinePopupUI()">
                    </div>
                </div>
            </div>
        `;

        return `
            <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:20px; width:440px; box-shadow:0 15px 45px rgba(0,0,0,0.2); text-align:left; font-family:'Inter', -apple-system, sans-serif;">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:20px 24px; border-bottom:1px solid rgba(0,0,0,0.06);">
                    <h3 style="font-size:18px; font-weight:700; color:#1c1c1e; margin:0;">Select Timeline</h3>
                    <button type="button" onclick="Dashboard.closeTimelinePopup()" 
                        style="background:transparent; border:none; color:#8e8e93; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; transition:background 0.2s;"
                        onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                
                <!-- Body -->
                <div style="display:flex; flex-direction:column; gap:20px; padding:20px 24px;">
                    <!-- Segmented Switch -->
                    <div style="display:flex; background:#f2f2f7; padding:4px; border-radius:14px; gap:4px;">
                        <button type="button" onclick="Dashboard.setTimelinePopupTab('custom')" 
                            style="flex:1; padding:10px; font-size:13px; font-weight:700; border:none; border-radius:10px; cursor:pointer; transition:all 0.2s;
                            ${_tempTab === 'custom' 
                                ? 'background:#fff; color:#1c1c1e; box-shadow:0 2px 6px rgba(0,0,0,0.08);' 
                                : 'background:transparent; color:#71717a;'
                            }">
                            MM/YYYY – MM/YYYY
                        </button>
                        <button type="button" onclick="Dashboard.setTimelinePopupTab('fy')" 
                            style="flex:1; padding:10px; font-size:13px; font-weight:700; border:none; border-radius:10px; cursor:pointer; transition:all 0.2s;
                            ${_tempTab === 'fy' 
                                ? 'background:#fff; color:#1c1c1e; box-shadow:0 2px 6px rgba(0,0,0,0.08);' 
                                : 'background:transparent; color:#71717a;'
                            }">
                            Financial Year
                        </button>
                    </div>

                    <!-- Dynamic form based on tab selection -->
                    ${bodyContent}

                    <!-- Showing text indicator -->
                    <div style="font-size:13px; font-weight:600; color:#8e8e93; margin-top:2px;">
                        Showing: <span style="color:#1c1c1e; font-weight:700;" id="timeline-popup-showing-range">${_getPopupShowingText()}</span>
                    </div>
                </div>

                <!-- Footer -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-top:1px solid rgba(0,0,0,0.06); background:#fcfcfd; border-bottom-left-radius:20px; border-bottom-right-radius:20px;">
                    <button type="button" onclick="Dashboard.applyAllTimeTimeline()" 
                        style="background:transparent; border:none; color:#71717a; font-weight:600; cursor:pointer; font-size:13.5px; padding:8px 0;" 
                        onmouseover="this.style.color='#1c1c1e'" onmouseout="this.style.color='#71717a'">
                        Show All Time
                    </button>
                    <button type="button" onclick="Dashboard.applyTimelinePopup()" 
                        style="background:#004d2c; color:#fff; font-weight:700; border:none; padding:10px 24px; border-radius:10px; cursor:pointer; font-size:13.5px; transition:background 0.2s;" 
                        onmouseover="this.style.background='#003d22'" onmouseout="this.style.background='#004d2c'">
                        Done
                    </button>
                </div>
            </div>
        `;
    }

    function openTimelinePopup() {
        const today = new Date();
        _tempTab = _modalTimeframe === 'fy' ? 'fy' : 'custom';
        _tempSelectedFY = _modalSelectedFY || Storage.getFinancialYear();

        if (_modalCustomStart) {
            const parts = _modalCustomStart.split('-');
            _tempStartYear = parseInt(parts[0], 10);
            _tempStartMonth = parseInt(parts[1], 10);
        } else {
            _tempStartYear = today.getFullYear();
            _tempStartMonth = today.getMonth() + 1;
        }

        if (_modalCustomEnd) {
            const parts = _modalCustomEnd.split('-');
            _tempEndYear = parseInt(parts[0], 10);
            _tempEndMonth = parseInt(parts[1], 10);
        } else {
            _tempEndYear = today.getFullYear();
            _tempEndMonth = today.getMonth() + 1;
        }

        let overlay = document.getElementById('timeline-popup-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'timeline-popup-overlay';
        overlay.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:20000; align-items:center; justify-content:center; backdrop-filter:blur(3px);';
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeTimelinePopup();
        });

        overlay.innerHTML = _timelinePopupHTML();
        document.body.appendChild(overlay);
    }

    function closeTimelinePopup() {
        const overlay = document.getElementById('timeline-popup-overlay');
        if (overlay) overlay.remove();
    }

    function setTimelinePopupTab(tab) {
        _tempTab = tab;
        const overlay = document.getElementById('timeline-popup-overlay');
        if (overlay) {
            overlay.innerHTML = _timelinePopupHTML();
        }
    }

    function updateTimelinePopupUI() {
        if (_tempTab === 'custom') {
            const startM = document.getElementById('timeline-popup-start-month')?.value;
            const startY = document.getElementById('timeline-popup-start-year')?.value;
            const endM = document.getElementById('timeline-popup-end-month')?.value;
            const endY = document.getElementById('timeline-popup-end-year')?.value;
            
            if (startM) _tempStartMonth = parseInt(startM, 10);
            if (startY) _tempStartYear = parseInt(startY, 10);
            if (endM) _tempEndMonth = parseInt(endM, 10);
            if (endY) _tempEndYear = parseInt(endY, 10);
        } else if (_tempTab === 'fy') {
            const fyVal = document.getElementById('timeline-popup-fy-select')?.value;
            if (fyVal) _tempSelectedFY = fyVal;
        }

        const showingRange = document.getElementById('timeline-popup-showing-range');
        if (showingRange) {
            showingRange.textContent = _getPopupShowingText();
        }
    }

    function applyTimelinePopup() {
        if (_tempTab === 'custom') {
            _modalTimeframe = 'custom';
            const smStr = String(_tempStartMonth).padStart(2, '0');
            const emStr = String(_tempEndMonth).padStart(2, '0');
            _modalCustomStart = `${_tempStartYear}-${smStr}`;
            _modalCustomEnd = `${_tempEndYear}-${emStr}`;
        } else if (_tempTab === 'fy') {
            _modalTimeframe = 'fy';
            _modalSelectedFY = _tempSelectedFY;
        }

        _modalPage = 1;
        closeTimelinePopup();

        const controls = document.getElementById('dashboard-doc-modal-controls');
        if (controls) controls.innerHTML = _docModalControlsHTML();
        _renderDocModalTable();
    }

    function applyAllTimeTimeline() {
        _modalTimeframe = 'all';
        _modalPage = 1;
        closeTimelinePopup();

        const controls = document.getElementById('dashboard-doc-modal-controls');
        if (controls) controls.innerHTML = _docModalControlsHTML();
        _renderDocModalTable();
    }

    function setDocModalRegion(region) {
        _modalRegion = (region === 'domestic' || region === 'international') ? region : '';
        _modalPage = 1;
        // Refresh only the controls row (so the active pill updates) and the table —
        // rebuilding the whole modal caused a visible blink.
        const controls = document.getElementById('dashboard-doc-modal-controls');
        if (controls) controls.innerHTML = _docModalControlsHTML();
        _renderDocModalTable();
    }

    function setDocModalSearch(value) {
        _modalSearch = value || '';
        _modalPage = 1;
        // Only the table re-renders, so the search input keeps focus while typing.
        // Sync the input + clear button here without rebuilding the controls row.
        const input = document.getElementById('dashboard-doc-modal-search');
        if (input && input.value !== _modalSearch) input.value = _modalSearch;
        const clear = document.getElementById('dashboard-doc-modal-clear');
        if (clear) clear.style.display = _modalSearch.trim() ? 'inline-flex' : 'none';
        _renderDocModalTable();
    }

    function openDownloadFormatDialog(override) {
        _reportOverride = override || null;
        let overlay = document.getElementById('download-format-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'download-format-overlay';
        overlay.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:20000; align-items:center; justify-content:center; backdrop-filter:blur(3px); font-family:\'Inter\', -apple-system, sans-serif;';
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeDownloadFormatDialog();
        });

        const accentMap = { PO: '#2e7d32', QU: '#6366f1', INV: '#d97706', ALL: '#0f172a' };
        const accent = accentMap[_reportType()] || '#004d2c';

        overlay.innerHTML = `
            <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:20px; width:400px; box-shadow:0 15px 45px rgba(0,0,0,0.2); text-align:left; overflow:hidden;">
                <!-- Header -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:20px 24px; border-bottom:1px solid rgba(0,0,0,0.06);">
                    <h3 style="font-size:18px; font-weight:700; color:#1c1c1e; margin:0;">Download Report</h3>
                    <button type="button" onclick="Dashboard.closeDownloadFormatDialog()" 
                        style="background:transparent; border:none; color:#8e8e93; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; transition:background 0.2s;"
                        onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background='transparent'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                
                <!-- Body -->
                <div style="padding:24px; display:flex; flex-direction:column; gap:16px;">
                    <p style="margin:0; font-size:14px; color:#52525b; font-weight:500; line-height:1.5;">
                        Select your preferred format to export the filtered document list.
                    </p>
                    
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <!-- PDF Option -->
                        <button type="button" onclick="Dashboard.triggerDownload('pdf')" 
                            style="display:flex; align-items:center; gap:12px; padding:14px 20px; background:#fff; border:1.5px solid rgba(0,0,0,0.1); border-radius:14px; cursor:pointer; transition:all 0.2s; text-align:left; width:100%;"
                            onmouseover="this.style.borderColor='${accent}'; this.style.background='${accent}08';"
                            onmouseout="this.style.borderColor='rgba(0,0,0,0.1)'; this.style.background='#fff';">
                            <div style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:10px; background:#fef2f2; color:#dc2626;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
                            </div>
                            <div>
                                <div style="font-size:14.5px; font-weight:700; color:#1c1c1e;">PDF Document</div>
                                <div style="font-size:12px; color:#71717a; font-weight:500; margin-top:2px;">Landscape format (ideal for printing)</div>
                            </div>
                        </button>

                        <!-- Excel Option -->
                        <button type="button" onclick="Dashboard.triggerDownload('excel')" 
                            style="display:flex; align-items:center; gap:12px; padding:14px 20px; background:#fff; border:1.5px solid rgba(0,0,0,0.1); border-radius:14px; cursor:pointer; transition:all 0.2s; text-align:left; width:100%;"
                            onmouseover="this.style.borderColor='${accent}'; this.style.background='${accent}08';"
                            onmouseout="this.style.borderColor='rgba(0,0,0,0.1)'; this.style.background='#fff';">
                            <div style="display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:10px; background:#f0fdf4; color:#16a34a;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
                            </div>
                            <div>
                                <div style="font-size:14.5px; font-weight:700; color:#1c1c1e;">Excel Spreadsheet</div>
                                <div style="font-size:12px; color:#71717a; font-weight:500; margin-top:2px;">Standard spreadsheet .xlsx file</div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    function closeDownloadFormatDialog() {
        const overlay = document.getElementById('download-format-overlay');
        if (overlay) overlay.remove();
    }

    function triggerDownload(format) {
        closeDownloadFormatDialog();
        if (format === 'pdf') {
            generateReportPDF();
        } else if (format === 'excel') {
            generateReportExcel();
        }
    }

    async function generateReportPDF() {
        const docs = _reportDocs();
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        let doc = new jsPDF('l', 'mm', 'a4');
        
        const hasArimo = !!PdfUtils.registerCurrencyFont(doc);
        const reportFont = hasArimo ? 'Arimo' : 'helvetica';
        
        const homeCur = 'INR';
        const homeSym = PdfUtils.currencySymbol(homeCur);
        const isInv = _reportType() === 'INV';
        
        // Render exact brand header (details left, logo right)
        const logo = await PdfUtils.getLogoBase64();
        let y = 5;
        y = PdfUtils.drawLetterhead(doc, logo, 297, 12, y, true);
        
        // Brand slanted divider bar
        y += 0.5;
        doc.setFillColor(243, 123, 33);
        doc.rect(12, y, 273, 2, 'F');
        doc.setFillColor(0, 77, 44);
        doc.rect(12, y, 180, 2, 'F');
        
        y += 8;
        
        // Title and inline metadata
        doc.setFont(reportFont, 'bold');
        doc.setFontSize(14);
        doc.setTextColor(0, 77, 44);
        const titleMap = { PO: 'PURCHASE ORDERS REPORT', QU: 'QUOTATIONS REPORT', INV: 'Receipts Summary', ALL: 'ALL DOCUMENTS REPORT' };
        const reportTitle = titleMap[_reportType()] || 'DOCUMENT LIST REPORT';
        doc.text(reportTitle, 12, y);

        doc.setFont(reportFont, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(82, 82, 91);
        
        let statsText = `Total Records: ${docs.length}  |  Generated: ${new Date().toLocaleString()}`;
        doc.text(statsText, 285, y, { align: 'right' });
        
        y += 6;
        
        let headers = [];
        let colAlignments = {};
        
        if (isInv) {
            headers = [
                "Date",
                "INV Ref No",
                "Client",
                "Forex Amount",
                "Rate of Exchange",
                `Excl. Tax (${homeSym})`,
                `Incl. Tax (${homeSym})`,
                "Receipt Amount",
                "Remaining Amount",
                "Forex Loss/Gain"
            ];
        } else {
            const partyLabel = _reportType() === 'PO' ? 'Supplier' : (_reportType() === 'QU' ? 'Client' : 'Client / Vendor');
            headers = ["Date", "Ref Number", "Department", partyLabel, "Value"];
            colAlignments = {
                0: { halign: 'center' },
                1: { halign: 'left' },
                2: { halign: 'left' },
                3: { halign: 'left' },
                4: { halign: 'right' }
            };
        }
        
        const rows = docs.map(d => {
            const dt = d.date ? PdfUtils.formatDateDMY(d.date) : '-';
            const docNo = (d.type === 'PO' ? (d.poNumber || d.refNumber) : (d.refNumber || d.poNumber)) || '-';
            const party = d.type === 'PO' ? (d.consignorName || '-') : (d.clientName || d.consignorName || '-');
            const dept = d.department || '—';
            
            const currencyCode = d.currency || homeCur;
            const isForeign = currencyCode !== homeCur;
            const rate = parseFloat(d.exchangeRate) || 0;
            const hasAmount = d.grandTotal !== undefined && d.grandTotal !== null && d.grandTotal !== '';
            
            if (isInv) {
                let forexVal = '—';
                let rateVal = '—';
                let exclVal = '—';   // value excluding tax (subtotal) in home currency
                let inclVal = '—';   // value including tax (grand total) in home currency
                if (hasAmount) {
                    const exclBase = _taxableOf(d);
                    if (isForeign) {
                        forexVal = `${currencyCode} ${PdfUtils.formatMoney(d.grandTotal, currencyCode)}`;
                        if (rate > 0) {
                            rateVal = `${homeSym}${PdfUtils.formatCurrency(rate, homeCur)}/${currencyCode}`;
                            exclVal = PdfUtils.formatMoney(exclBase * rate, homeCur);
                            inclVal = PdfUtils.formatMoney(d.grandTotal * rate, homeCur);
                        }
                    } else {
                        exclVal = PdfUtils.formatMoney(exclBase, homeCur);
                        inclVal = PdfUtils.formatMoney(d.grandTotal, homeCur);
                    }
                }

                const total = hasAmount ? (Number(d.grandTotal) || 0) : 0;
                const received = _receivedForInvoice(d.id);
                const remaining = Math.max(0, total - received);
                
                let receiptText = '—', remainText = '—';
                if (total > 0) {
                    const receivedInHome = _receivedForInvoiceInINR(d.id);
                    receiptText = PdfUtils.formatMoney(receivedInHome, homeCur);
                    remainText = PdfUtils.formatMoney(remaining, currencyCode);
                }
                
                const forexDiff = _calculateForexGainLoss(d);
                let forexText = '—';
                if (d.currency !== homeCur && total > 0 && _receivedForInvoice(d.id) > 0) {
                    const formattedDiff = PdfUtils.formatMoney(Math.abs(forexDiff), homeCur);
                    if (forexDiff < -0.01) {
                        forexText = `-${formattedDiff}`;
                    } else if (forexDiff > 0.01) {
                        forexText = `+${formattedDiff}`;
                    } else {
                        forexText = formattedDiff;
                    }
                }
                
                return [dt, docNo, party, forexVal, rateVal, exclVal, inclVal, receiptText, remainText, forexText];
            } else {
                let valText = '-';
                if (hasAmount) {
                    valText = `${currencyCode} ${PdfUtils.formatMoney(d.grandTotal, currencyCode)}`;
                }
                return [dt, docNo, dept, party, valText];
            }
        });

        // Compute footer values
        let footRow = [];
        let totalValSum = 0;      // incl. tax (grand total) in home currency
        let totalExclSum = 0;     // excl. tax (subtotal) in home currency
        let totalReceiptSum = 0;
        let totalRemainingSum = 0;

        docs.forEach(d => {
            const total = (Number(d.grandTotal) || 0);
            const rate = parseFloat(d.exchangeRate) || 1;
            const isForeign = d.currency !== homeCur;
            const hasAmount = d.grandTotal !== undefined && d.grandTotal !== null && d.grandTotal !== '';
            if (hasAmount) {
                const valInHome = isForeign && rate > 0 ? (total * rate) : total;
                totalValSum += valInHome;
                const excl = _taxableOf(d);
                totalExclSum += isForeign && rate > 0 ? (excl * rate) : excl;
                if (isInv) {
                    totalReceiptSum += _receivedForInvoiceInINR(d.id);
                    
                    const received = _receivedForInvoice(d.id);
                    const remaining = Math.max(0, total - received);
                    if (remaining > 0) {
                        if (!isForeign) {
                            totalRemainingSum += remaining;
                        } else {
                            const r = parseFloat(d.exchangeRate) || 0;
                            if (r > 0) {
                                totalRemainingSum += remaining * r;
                            }
                        }
                    }
                }
            }
        });

        if (isInv) {
            footRow = [
                "Receipts Summary",
                "",
                "",
                "",
                "",
                PdfUtils.formatMoney(totalExclSum, homeCur),
                PdfUtils.formatMoney(totalValSum, homeCur),
                PdfUtils.formatMoney(totalReceiptSum, homeCur),
                PdfUtils.formatMoney(totalRemainingSum, homeCur),
                ""
            ];
        } else {
            footRow = [
                "Total Summary",
                "",
                "",
                "",
                `${homeCur} ${PdfUtils.formatMoney(totalValSum, homeCur)}`
            ];
        }
        
        // Draw AutoTable
        doc.autoTable({
            startY: y + 2,
            head: [headers],
            body: rows,
            foot: [footRow],
            margin: { left: 12, right: 12, bottom: 15 },
            styles: {
                font: reportFont,
                fontSize: 8,
                cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
                lineColor: [228, 228, 231],
                lineWidth: 0.1,
                textColor: [39, 39, 42]
            },
            headStyles: {
                fillColor: [244, 244, 245],
                textColor: [82, 82, 91],
                fontStyle: 'bold',
                lineWidth: 0.1,
                lineColor: [228, 228, 231]
            },
            footStyles: {
                fillColor: [232, 245, 236], // soft green brand accent background
                textColor: [0, 77, 44],      // dark green brand accent text
                fontStyle: 'bold',
                lineWidth: 0.1,
                lineColor: [200, 225, 208]
            },
            didParseCell: function(data) {
                const rightAlignCols = isInv ? [3, 5, 6, 7, 8, 9] : [4];
                const centerAlignCols = isInv ? [0, 4] : [0];
                
                if (rightAlignCols.includes(data.column.index)) {
                    data.cell.styles.halign = 'right';
                } else if (centerAlignCols.includes(data.column.index)) {
                    data.cell.styles.halign = 'center';
                } else {
                    data.cell.styles.halign = 'left';
                }
            },
            theme: 'grid'
        });
        
        // Footers & Page number loop
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont(reportFont, 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(161, 161, 170);
            doc.text(`Page ${i} of ${totalPages}`, 297 - 12, 210 - 8, { align: 'right' });
        }
        
        doc = await PdfUtils.flattenToImagePdf(doc);
        const dateStr = new Date().toISOString().slice(0, 10);
        doc.save(`${_reportType()}_Document_Report_${dateStr}.pdf`);
    }

    function generateReportExcel() {
        const docs = _reportDocs();
        const XLSX = window.XLSX;
        if (!XLSX) {
            console.error("SheetJS (XLSX) library not found.");
            return;
        }

        const homeCur = 'INR';
        const homeSym = PdfUtils.currencySymbol(homeCur);
        const isInv = _reportType() === 'INV';

        const titleMap = { PO: 'Purchase Orders Report', QU: 'Quotations Report', INV: 'Receipts Summary', ALL: 'All Documents Report' };
        const reportTitle = titleMap[_reportType()] || 'Document List Report';

        const wsData = [
            [], // Row 1
            [], // Row 2
            [], // Row 3
            ["", "", "", "", reportTitle], // Row 4 (E4)
            ["", "", "", "", "", "", `Generated On: ${new Date().toLocaleString()}`], // Row 5 (G5)
            [] // Row 6
        ];

        let headers = [];
        if (isInv) {
            headers = [
                "Date",
                "INV Ref No",
                "Client",
                "Forex Amount",
                "Rate of Exchange",
                `Excl. Tax (${homeCur})`,
                `Incl. Tax (${homeCur})`,
                "Receipt Amount",
                "Remaining Amount",
                "Forex Loss/Gain"
            ];
        } else {
            const partyLabel = _reportType() === 'PO' ? 'Supplier' : (_reportType() === 'QU' ? 'Client' : 'Client / Vendor');
            headers = ["Date", "Ref Number", "Department", partyLabel, "Value"];
        }
        wsData.push(headers);
        wsData.push([]); // Row 8
        wsData.push([]); // Row 9

        let totalValSum = 0;      // incl. tax (grand total) in home currency
        let totalExclSum = 0;     // excl. tax (subtotal) in home currency
        let totalReceiptSum = 0;
        let totalRemainingSum = 0;

        docs.forEach(d => {
            const dt = d.date ? PdfUtils.formatDateDMY(d.date) : '-';
            const docNo = (d.type === 'PO' ? (d.poNumber || d.refNumber) : (d.refNumber || d.poNumber)) || '-';
            const party = d.type === 'PO' ? (d.consignorName || '-') : (d.clientName || d.consignorName || '-');
            const dept = d.department || '—';

            const currencyCode = d.currency || homeCur;
            const isForeign = currencyCode !== homeCur;
            const rate = parseFloat(d.exchangeRate) || 0;
            const hasAmount = d.grandTotal !== undefined && d.grandTotal !== null && d.grandTotal !== '';

            if (isInv) {
                let forexVal = '—';
                let rateVal = '—';
                let homeVal = 0;    // incl. tax in home currency
                let exclHome = 0;   // excl. tax in home currency
                if (hasAmount) {
                    const exclBase = _taxableOf(d);
                    if (isForeign) {
                        forexVal = `${currencyCode} ${PdfUtils.formatMoney(d.grandTotal, currencyCode)}`;
                        if (rate > 0) {
                            rateVal = `${homeSym}${PdfUtils.formatCurrency(rate, homeCur)}/${currencyCode}`;
                            homeVal = FinanceUtils.truncate2(d.grandTotal * rate);
                            exclHome = FinanceUtils.truncate2(exclBase * rate);
                        }
                    } else {
                        homeVal = FinanceUtils.truncate2(Number(d.grandTotal) || 0);
                        exclHome = FinanceUtils.truncate2(exclBase);
                    }
                }
                totalValSum = FinanceUtils.truncate2(totalValSum + homeVal);
                totalExclSum = FinanceUtils.truncate2(totalExclSum + exclHome);

                const total = hasAmount ? (Number(d.grandTotal) || 0) : 0;
                const received = _receivedForInvoice(d.id);
                const remaining = Math.max(0, total - received);

                let receiptVal = 0;
                let remainVal = '—';
                if (total > 0) {
                    receiptVal = _receivedForInvoiceInINR(d.id);
                    remainVal = `${currencyCode} ${PdfUtils.formatMoney(remaining, currencyCode)}`;
                    
                    if (remaining > 0) {
                        if (currencyCode === homeCur) {
                            totalRemainingSum += remaining;
                        } else {
                            if (rate > 0) {
                                totalRemainingSum += remaining * rate;
                            }
                        }
                    }
                }
                totalReceiptSum += receiptVal;

                const forexDiff = _calculateForexGainLoss(d);
                let forexText = '—';
                if (d.currency !== homeCur && total > 0 && _receivedForInvoice(d.id) > 0) {
                    const formattedDiff = PdfUtils.formatMoney(Math.abs(forexDiff), homeCur);
                    if (forexDiff < -0.01) {
                        forexText = `-${formattedDiff}`;
                    } else if (forexDiff > 0.01) {
                        forexText = `+${formattedDiff}`;
                    } else {
                        forexText = formattedDiff;
                    }
                }

                wsData.push([
                    dt,
                    docNo,
                    party,
                    forexVal,
                    rateVal,
                    exclHome ? PdfUtils.formatMoney(exclHome, homeCur) : '—',
                    homeVal ? PdfUtils.formatMoney(homeVal, homeCur) : '—',
                    receiptVal ? PdfUtils.formatMoney(receiptVal, homeCur) : '—',
                    remainVal,
                    forexText
                ]);
            } else {
                let valVal = 0;
                let valText = '-';
                if (hasAmount) {
                    const total = (Number(d.grandTotal) || 0);
                    const rate = parseFloat(d.exchangeRate) || 1;
                    valVal = d.currency && d.currency !== homeCur ? (total * rate) : total;
                    valText = `${currencyCode} ${PdfUtils.formatMoney(d.grandTotal, currencyCode)}`;
                }
                totalValSum += valVal;
                wsData.push([dt, docNo, dept, party, valText]);
            }
        });

        wsData.push([]);
        if (isInv) {
            wsData.push([
                "Total Summary",
                "",
                "",
                "",
                "",
                PdfUtils.formatMoney(totalExclSum, homeCur),
                PdfUtils.formatMoney(totalValSum, homeCur),
                PdfUtils.formatMoney(totalReceiptSum, homeCur),
                PdfUtils.formatMoney(totalRemainingSum, homeCur),
                ""
            ]);
        } else {
            wsData.push([
                "Total Summary",
                "",
                "",
                "",
                `${homeCur} ${PdfUtils.formatMoney(totalValSum, homeCur)}`
            ]);
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        
        const colWidths = headers.map((h, i) => {
            let maxLen = h.length;
            wsData.forEach(row => {
                if (row[i] !== undefined && row[i] !== null) {
                    const cellStr = String(row[i]);
                    if (cellStr.length > maxLen) maxLen = cellStr.length;
                }
            });
            return { wch: maxLen + 3 };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, "Document Report");
        
        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `${_reportType()}_Document_Report_${dateStr}.xlsx`);
    }

    function closeDocModal() {
        const modal = document.getElementById('dashboard-doc-modal');
        if (modal) modal.remove();
        _modalType = null;
    }

    return { setOverviewFy, setOverviewMonth, _monthlySeries, _receivables, _renderOverview, renderPagination, renderClientFilter: _renderClientFilter, registerClientFilter, clientSelection, keepFocus, compareBySerial,
        render, viewPdf, viewRefFile, downloadPdf, deleteDoc, reviseDoc, editDoc, duplicateDoc, toggleRowMenu, _closeRowMenu, applyFilters, toggleFilters, changePage, changePageSize, openDocModal, closeDocModal, setDocModalRegion, setDocModalSearch, setDocModalPage, setDocModalPageSize, openTimelinePopup, closeTimelinePopup, setTimelinePopupTab, updateTimelinePopupUI, applyTimelinePopup, applyAllTimeTimeline, openDownloadFormatDialog, closeDownloadFormatDialog, triggerDownload, toggleClientFilter, onClientOptionClick, clearClientFilter, filterClientOptions, _bucketByGroup };
})();
