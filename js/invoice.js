/* ============================================
   Invoice Module — form
   ============================================ */

const Invoice = (() => {
    // Default company details
    const COMPANY = PdfUtils.COMPANY;

    const CURRENCY_MAP = PdfUtils.CURRENCY_MAP;

    let itemCount = 1;
    let invoiceTermCount = 0;
    let invoiceConditionCount = 0;
    // Invoice mode: 'domestic' (INR + GST, IFSC bank) or 'international' (foreign currency, no GST, SWIFT banks)
    let _invMode = 'domestic';
    // When editing an existing invoice, this holds its id so saving overwrites the
    // same record (same ref number) instead of creating a new one. null = new doc.
    let _editingId = null;
    // When this invoice was started from a Proforma ("Generate Invoice"), this holds
    // the source proforma id. It is removed from the Proforma dashboard only once the
    // invoice is actually generated. null = not from a proforma.
    let _sourceProformaId = null;
    // When this invoice is generated from a PO Received received PO, that PO's id —
    // used to mark the PO completed once the invoice is saved. null = not from a PO.
    let _sourceTmId = null;
    // Reference file carried over from the matched PO Received collection document
    let _invRefFile = null;

    // Dashboard state
    let _currentView = 'dashboard';
    let _dashSearch = '';
    let _dashType = '';
    let _dashMonth = '';
    let _dashFy = '';
    let _dashDept = '';
    let _dashPo = '';
    let _dashPage = 1;
    let _dashPageSize = 10;
    let _dashFiltersVisible = false;
    let _dashFilteredDocs = [];   // last rendered filtered list, used by the report download

    function isFormActive() {
        return _currentView === 'form';
    }

    function resetToDashboard() {
        _currentView = 'dashboard';
        const dashView = document.getElementById('inv-dashboard-view');
        const formView = document.getElementById('inv-form-view');
        if (dashView) dashView.style.display = 'block';
        if (formView) formView.style.display = 'none';
        renderDashboard();
    }

    function showDashboardView() {
        _currentView = 'dashboard';
        const dashView = document.getElementById('inv-dashboard-view');
        const formView = document.getElementById('inv-form-view');
        if (dashView) dashView.style.display = 'block';
        if (formView) formView.style.display = 'none';
        renderDashboard();
    }

    function ensureTypeModal() {
        let modal = document.getElementById('invoice-type-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'invoice-type-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.45); z-index: 25000; align-items: center; justify-content: center; backdrop-filter: blur(8px);';
        modal.onclick = function(e) {
            if (e.target === modal) closeTypeModal();
        };
        modal.innerHTML = `
        <div class="modal-card"
            style="background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 20px; padding: 32px 28px; width: 520px; max-width: 95vw; box-shadow: 0 25px 60px rgba(15, 23, 42, 0.2); text-align: center; font-family: 'Inter', -apple-system, sans-serif; position: relative; animation: modalPopIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);">
            <button type="button" onclick="Invoice.closeTypeModal()"
                style="position: absolute; top: 16px; right: 16px; background: #f1f5f9; border: none; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: #64748b; cursor: pointer; transition: all 0.2s ease;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 14px; background: rgba(22, 101, 52, 0.1); color: #166534; margin-bottom: 12px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <line x1="2" y1="10" x2="22" y2="10"></line>
                    <line x1="7" y1="15" x2="7.01" y2="15"></line>
                    <line x1="11" y1="15" x2="13" y2="15"></line>
                </svg>
            </div>
            <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0;">Create Invoice</h2>
            <p style="font-size: 13.5px; color: #64748b; margin: 0 0 24px 0;">Select the invoice format to proceed with tailored pricing and terms</p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 4px;">
                <div class="qu-type-card qu-type-card-dom" onclick="Invoice.selectTypeAndCreate('domestic')"
                    style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 22px 16px; cursor: pointer; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; position: relative;">
                    <div style="position: absolute; top: 10px; right: 10px; background: rgba(22, 101, 52, 0.08); color: #166534; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; letter-spacing: 0.3px;">INR</div>
                    <div>
                        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">Domestic Invoice</h3>
                        <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.4;">GST breakdown & INR currency</p>
                    </div>
                    <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #166534;">
                        <span>Select Domestic</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </div>
                </div>
                <div class="qu-type-card qu-type-card-intl" onclick="Invoice.selectTypeAndCreate('international')"
                    style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 22px 16px; cursor: pointer; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; position: relative;">
                    <div style="position: absolute; top: 10px; right: 10px; background: rgba(30, 64, 175, 0.08); color: #1e40af; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; letter-spacing: 0.3px;">GLOBAL</div>
                    <div>
                        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">International Invoice</h3>
                        <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.4;">Multi-currency, wire details & export formats</p>
                    </div>
                    <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #1e40af;">
                        <span>Select International</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                            <polyline points="12 5 19 12 12 19"></polyline>
                        </svg>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        return modal;
    }

    function openTypeModal() {
        const modal = ensureTypeModal();
        if (modal) modal.style.display = 'flex';
    }

    function closeTypeModal() {
        const modal = document.getElementById('invoice-type-modal');
        if (modal) modal.style.display = 'none';
    }

    function selectTypeAndCreate(mode) {
        closeTypeModal();
        showCreateView(mode);
    }

    function showCreateView(mode = 'domestic') {
        _currentView = 'form';
        _invMode = (mode === 'international') ? 'international' : 'domestic';
        const dashView = document.getElementById('inv-dashboard-view');
        const formView = document.getElementById('inv-form-view');
        if (dashView) dashView.style.display = 'none';
        if (formView) formView.style.display = 'block';
        const isIntl = _invMode === 'international';
        const titleEl = document.getElementById('inv-page-title');
        const subEl = document.getElementById('inv-page-subtitle');
        if (titleEl) titleEl.textContent = isIntl ? 'International Tax Invoice' : 'Domestic Tax Invoice';
        if (subEl) subEl.textContent = isIntl
            ? 'Create and generate a new international tax invoice'
            : 'Create and generate a new domestic tax invoice';
        render(null, _invMode);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showEditView(invIdOrData) {
        const data = typeof invIdOrData === 'string' ? Storage.getInvoice(invIdOrData) : invIdOrData;
        _currentView = 'form';
        const dashView = document.getElementById('inv-dashboard-view');
        const formView = document.getElementById('inv-form-view');
        if (dashView) dashView.style.display = 'none';
        if (formView) formView.style.display = 'block';
        const titleEl = document.getElementById('inv-page-title');
        const subEl = document.getElementById('inv-page-subtitle');
        const refNo = data ? (data.refNumber || '') : '';
        if (titleEl) titleEl.textContent = refNo ? `Edit Invoice — ${refNo}` : 'Edit Invoice';
        if (subEl) subEl.textContent = 'Modify and regenerate this Invoice';
        render(data);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function downloadDashReport() {
        // Dashboard's report generators key off doc.type; raw invoice records lack it.
        Dashboard.openDownloadFormatDialog({ type: 'INV', docs: _dashFilteredDocs.map(d => ({ ...d, type: 'INV' })) });
    }

    function toggleDashFilters() {
        _dashFiltersVisible = !_dashFiltersVisible;
        const el = document.getElementById('inv-dash-filters-wrapper');
        if (el) el.style.display = _dashFiltersVisible ? 'block' : 'none';
        const btn = document.getElementById('btn-inv-dash-filter-toggle');
        if (btn) btn.classList.toggle('active', _dashFiltersVisible);
    }

    function applyDashFilters() {
        const searchInput = document.getElementById('inv-dash-filter-search');
        const typeInput = document.getElementById('inv-dash-filter-type');
        const monthInput = document.getElementById('inv-dash-filter-month');
        const fyInput = document.getElementById('inv-dash-filter-fy');
        const deptInput = document.getElementById('inv-dash-filter-dept');
        const poInput = document.getElementById('inv-dash-filter-po');

        if (searchInput) _dashSearch = searchInput.value || '';
        if (typeInput) _dashType = typeInput.value || '';
        if (monthInput) _dashMonth = monthInput.value || '';
        if (fyInput) _dashFy = fyInput.value || '';
        if (deptInput) _dashDept = deptInput.value || '';
        if (poInput) _dashPo = poInput.value || '';

        _dashPage = 1;
        renderDashboard();
    }

    function resetDashFilters() {
        Dashboard.clientSelection('inv').clear();
        _dashSearch = '';
        _dashType = '';
        _dashMonth = '';
        _dashFy = '';
        _dashDept = '';
        _dashPo = '';
        _dashPage = 1;
        renderDashboard();
    }

    function changeDashPage(p) {
        _dashPage = p;
        renderDashboard();
    }

    function changeDashPageSize(sz) {
        _dashPageSize = sz;
        _dashPage = 1;
        renderDashboard();
    }

    function deleteINVDash(id) {
        Dashboard.deleteDoc('INV', id, renderDashboard);
    }

    function renderDashboard() {
        const container = document.getElementById('inv-dashboard-content');
        if (!container) return;

        const docs = (typeof Storage !== 'undefined' && Storage.getAllInvoices) ? (Storage.getAllInvoices() || []) : [];
        Dashboard.registerClientFilter('inv', () => docs, () => { _dashPage = 1; renderDashboard(); });
        const homeCur = 'INR';

        const uniqueFys = [...new Set(docs.map(d => d.date ? Storage.getFinancialYear(d.date) : '').filter(Boolean))].sort();

        // 2. Filter options mapping
        const monthNames = {
            '': 'All Months', '01': 'January', '02': 'February', '03': 'March', '04': 'April',
            '05': 'May', '06': 'June', '07': 'July', '08': 'August', '09': 'September',
            '10': 'October', '11': 'November', '12': 'December'
        };
        const monthLabel = monthNames[_dashMonth] || 'All Months';
        const fyLabel = _dashFy || 'All FY';
        const deptLabel = _dashDept || 'All Departments';
        // PO numbers come from the Order Reference Numbers of received purchase orders.
        const poNumbers = [...new Set(((Storage.getAllTMs && Storage.getAllTMs()) || [])
            .map(tm => ((tm && tm.details && tm.details.poNumber) || '').trim()).filter(Boolean))].sort();
        const typeLabel = _dashType === 'domestic' ? 'Domestic' : (_dashType === 'international' ? 'International' : 'All Types');

        // 3. Filter data
        const clientSel = Dashboard.clientSelection('inv');
        let filtered = docs.filter(doc => {
            const q = _dashSearch.toLowerCase().trim();
            if (q) {
                const no = (doc.refNumber || '').toLowerCase();
                const cl = (doc.clientName || '').toLowerCase();
                const dept = (doc.department || '').toLowerCase();
                const items = (doc.items || []).map(i => (i.description || '').toLowerCase()).join(' ');
                if (!no.includes(q) && !cl.includes(q) && !dept.includes(q) && !items.includes(q)) return false;
            }
            if (_dashType) {
                const docMode = doc.mode || 'domestic';
                if (docMode !== _dashType) return false;
            }
            if (clientSel.size && !clientSel.has((doc.clientName || '').trim())) return false;
            if (_dashMonth) {
                const m = (doc.date || '').split('-')[1];
                if (m !== _dashMonth) return false;
            }
            if (_dashFy) {
                const fy = doc.date ? Storage.getFinancialYear(doc.date) : '';
                if (fy !== _dashFy) return false;
            }
            if (_dashDept && (doc.department || '') !== _dashDept) return false;
            if (_dashPo && (doc.poNumber || '').trim().toLowerCase() !== _dashPo.toLowerCase()) return false;
            return true;
        });

        filtered.sort(Dashboard.compareBySerial);

        _dashFilteredDocs = filtered;

        const totalFiltered = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / _dashPageSize));
        if (_dashPage > totalPages) _dashPage = totalPages;
        if (_dashPage < 1) _dashPage = 1;
        const startIdx = (_dashPage - 1) * _dashPageSize;
        const pageDocs = filtered.slice(startIdx, startIdx + _dashPageSize);

        const hasActiveFilters = !!(_dashSearch || _dashType || clientSel.size || _dashMonth || _dashFy || _dashDept || _dashPo);

        // International invoices carry no GST, so Excl./Incl. GST are always the
        // same number. Filtered to International, drop the Excl. column, call the
        // remaining one Amount, and show what it converted to in the home
        // currency at the rate entered when the invoice was generated.
        const isIntlView = _dashType === 'international';

        // 4. Build Table Rows
        let rowsHtml = pageDocs.map(doc => {
            const docNo = doc.refNumber || '-';
            const dateStr = doc.date ? PdfUtils.formatDateDMY(doc.date) : '-';
            const client = doc.clientName || '-';
            const mode = doc.mode || 'domestic';
            const isDomestic = mode === 'domestic';
            const cur = doc.currency || (isDomestic ? 'INR' : 'USD');

            let exclAmt = 0;
            let inclAmt = 0;
            if (doc.isCreditNote) {
                exclAmt = Number(doc.creditNet !== undefined ? doc.creditNet : doc.creditAmount) || 0;
                inclAmt = Number(doc.creditAmount) || 0;
            } else {
                if (doc.totalAmount !== undefined && doc.totalAmount !== null && doc.totalAmount !== '') {
                    exclAmt = Number(doc.totalAmount) || 0;
                } else if (doc.subtotal !== undefined && doc.subtotal !== null && doc.subtotal !== '') {
                    exclAmt = Number(doc.subtotal) || 0;
                } else if (Array.isArray(doc.items) && doc.items.length > 0) {
                    exclAmt = doc.items.reduce((s, it) => s + (Number(it.amount) || ((Number(it.qty) || 0) * (Number(it.rate) || 0)) || 0), 0);
                } else if (doc.grandTotal !== undefined && doc.grandTotal !== null) {
                    exclAmt = Number(doc.grandTotal) || 0;
                }

                if (doc.grandTotal !== undefined && doc.grandTotal !== null && doc.grandTotal !== '') {
                    inclAmt = Number(doc.grandTotal) || 0;
                } else {
                    inclAmt = exclAmt;
                }
            }
            // Match the PDF: with Round Off on, domestic INR totals print rounded.
            if (isDomestic && cur === 'INR' && Storage.getINVColumnVisibility
                && Storage.getINVColumnVisibility().roundOff === true) {
                inclAmt = Math.round(inclAmt);
            }

            const curSym = PdfUtils.currencySymbol(cur);
            const exclStr = `${curSym} ${PdfUtils.formatCurrency(exclAmt, cur)}`;
            const inclStr = `${curSym} ${PdfUtils.formatCurrency(inclAmt, cur)}`;
            const hasRef = !!doc.referenceFilePath;

            // reportValue is the total already converted at save time; fall back to
            // the stored rate for older records, and show a dash when neither exists.
            let homeStr = '-';
            if (isIntlView) {
                const rate = Number(doc.exchangeRate) || 0;
                const homeAmt = (doc.reportValue !== undefined && doc.reportValue !== null && doc.reportValue !== '')
                    ? Number(doc.reportValue) || 0
                    : (rate > 0 ? inclAmt * rate : null);
                if (homeAmt !== null) {
                    homeStr = `${PdfUtils.currencySymbol(homeCur)} ${PdfUtils.formatCurrency(homeAmt, homeCur)}`;
                }
            }

            return `
                <tr>
                    <td style="font-weight: 600; text-align: left;">
                        <a href="javascript:void(0)" onclick="Dashboard.viewPdf('INV','${doc.id}')" style="color: #166534; text-decoration: none; font-weight: 700; border-bottom: 1px dashed rgba(22,101,52,0.4);" title="Click to view PDF">
                            ${_escapeHtml(docNo)}
                        </a>
                    </td>
                    <td style="white-space: nowrap; color: #52525b; text-align: left;">${dateStr}</td>
                    <td style="font-weight: 500; color: #27272a; text-align: left;">${_escapeHtml(client)}</td>
                    <td style="white-space: nowrap; color: #52525b; text-align: left;">${_escapeHtml(doc.poNumber || '-')}</td>
                    <td style="white-space: nowrap; text-align: left;">
                        <span class="${isDomestic ? 'badge-inv-dom' : 'badge-inv-intl'}">
                            ${isDomestic ? 'Domestic' : 'International'}
                        </span>
                    </td>
                    ${isIntlView ? '' : `<td style="font-weight: 600; color: #3f3f46; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums;">${exclStr}</td>`}
                    <td style="font-weight: 700; color: #166534; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums;">${inclStr}</td>
                    ${isIntlView ? `<td style="font-weight: 600; color: #3f3f46; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums;">${homeStr}</td>` : ''}
                    <td style="text-align: center; white-space: nowrap; width: 110px;">
                        <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            <button type="button" class="btn-icon-action" onclick="Dashboard.viewPdf('INV','${doc.id}')" title="View PDF" aria-label="View PDF" style="padding: 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); background: #fff; cursor: pointer; color: #166534; display: inline-flex; align-items: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button type="button" class="btn-icon-action" onclick="Dashboard.downloadPdf('INV','${doc.id}')" title="Download PDF" aria-label="Download PDF" style="padding: 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); background: #fff; cursor: pointer; color: #2563eb; display: inline-flex; align-items: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </button>
                            <button type="button" class="btn-row-actions" onclick="Dashboard.toggleRowMenu(event,'INV','${doc.id}',${hasRef})" title="More Actions" aria-label="More Actions">⋮</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (!rowsHtml) {
            rowsHtml = `
                <tr>
                    <td colspan="8" style="padding: 50px 20px; text-align: center; color: #71717a;">
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(22,101,52,0.08); display: flex; align-items: center; justify-content: center; color: #166534;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line><line x1="7" y1="15" x2="7.01" y2="15"></line><line x1="11" y1="15" x2="13" y2="15"></line></svg>
                            </div>
                            <div style="font-size: 15px; font-weight: 600; color: #18181b;">${docs.length === 0 ? 'No Invoices issued yet' : 'No Invoices match your filters'}</div>
                            <p style="margin: 0; font-size: 13px; color: #71717a; max-width: 420px;">
                                ${docs.length === 0 ? 'Click "Create Invoice" above to issue your first invoice.' : 'Try changing your search terms or clearing active filters to see all invoices.'}
                            </p>
                            ${hasActiveFilters ? `
                            <button type="button" class="btn btn-secondary" onclick="Invoice.resetDashFilters()" style="padding: 6px 14px; font-size: 12.5px; margin-top: 6px;">
                                Clear Filters
                            </button>
                            ` : `
                            <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
                                <button type="button" class="btn btn-primary btn-create-po-dash" onclick="Invoice.openTypeModal()" style="padding: 9px 20px; font-size: 13.5px; font-weight: 600; background: #166534; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; color: #fff;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    <span>Create Invoice</span>
                                </button>
                            </div>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }

        // 5. Pagination markup
        let paginationHtml = '';
        if (totalFiltered > 0) {
            paginationHtml = Dashboard.renderPagination({
                page: _dashPage, pageSize: _dashPageSize, total: totalFiltered, noun: 'invoices',
                onPage: 'Invoice.changeDashPage', onSize: 'Invoice.changeDashPageSize'
            });
        }

        // 6. Assemble HTML
        container.innerHTML = `
            <!-- Table Card Section -->
            <div class="recent-section" style="background: #fff; border: 1px solid rgba(0,0,0,0.07); border-radius: 18px; padding: 22px; box-shadow: 0 4px 20px rgba(0,0,0,0.02);">
                <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
                    <div>
                        <h2 style="font-size: 17.5px; font-weight: 700; color: #18181b; margin: 0 0 3px;">Issued Invoices</h2>
                        <p style="margin: 0; font-size: 12.5px; color: #71717a;">All domestic and international invoices issued to clients</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="btn btn-add${_dashFiltersVisible ? ' active' : ''}" id="btn-inv-dash-filter-toggle" onclick="Invoice.toggleDashFilters()" style="padding: 7px 14px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                            <span>Filter</span>
                            ${hasActiveFilters ? '<span style="width:7px; height:7px; border-radius:50%; background:#166534; display:inline-block;"></span>' : ''}
                        </button>
                        <button type="button" class="btn btn-add" onclick="Invoice.downloadDashReport()" title="Download report" aria-label="Download report" style="padding: 7px 14px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            <span>Download</span>
                        </button>
                    </div>
                </div>

                <!-- Filters Bar (Collapsible) -->
                <div id="inv-dash-filters-wrapper" style="display: ${_dashFiltersVisible ? 'block' : 'none'}; margin-bottom: 18px; padding: 14px 16px; background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.05); border-radius: 10px;">
                    <div class="dashboard-filters" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="inv-dash-filter-search" class="dashboard-filter-input" placeholder="Search Invoice No, Client, Items..." oninput="Dashboard.keepFocus(Invoice.applyDashFilters)" style="width: 250px; font-size: 13px;" value="${_escapeAttr(_dashSearch)}">

                        <!-- Type Filter -->
                        <div class="custom-select-wrapper" style="width: 140px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(typeLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashType === '' ? ' selected' : ''}" data-value="">All Types</div>
                                <div class="custom-option${_dashType === 'domestic' ? ' selected' : ''}" data-value="domestic">Domestic</div>
                                <div class="custom-option${_dashType === 'international' ? ' selected' : ''}" data-value="international">International</div>
                            </div>
                            <input type="hidden" id="inv-dash-filter-type" value="${_escapeAttr(_dashType)}" onchange="Invoice.applyDashFilters()">
                        </div>

                        <!-- Client Filter (shared grouped multi-select) -->
                        ${Dashboard.renderClientFilter('inv', { width: 170 })}

                        <!-- Month Filter -->
                        <div class="custom-select-wrapper" style="width: 135px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(monthLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashMonth === '' ? ' selected' : ''}" data-value="">All Months</div>
                                ${Object.keys(monthNames).filter(Boolean).map(k => `<div class="custom-option${_dashMonth === k ? ' selected' : ''}" data-value="${k}">${monthNames[k]}</div>`).join('')}
                            </div>
                            <input type="hidden" id="inv-dash-filter-month" value="${_escapeAttr(_dashMonth)}" onchange="Invoice.applyDashFilters()">
                        </div>

                        <!-- FY Filter -->
                        <div class="custom-select-wrapper" style="width: 120px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(fyLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashFy === '' ? ' selected' : ''}" data-value="">All FY</div>
                                ${uniqueFys.map(f => `<div class="custom-option${_dashFy === f ? ' selected' : ''}" data-value="${_escapeAttr(f)}">${f}</div>`).join('')}
                            </div>
                            <input type="hidden" id="inv-dash-filter-fy" value="${_escapeAttr(_dashFy)}" onchange="Invoice.applyDashFilters()">
                        </div>

                        <!-- Department Filter -->
                        <div class="custom-select-wrapper" style="width: 155px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(deptLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashDept === '' ? ' selected' : ''}" data-value="">All Departments</div>
                                ${DEPARTMENTS.map(d => `<div class="custom-option${_dashDept === d ? ' selected' : ''}" data-value="${_escapeAttr(d)}">${d}</div>`).join('')}
                            </div>
                            <input type="hidden" id="inv-dash-filter-dept" value="${_escapeAttr(_dashDept)}" onchange="Invoice.applyDashFilters()">
                        </div>

                        <!-- PO Number Filter -->
                        <div class="custom-select-wrapper searchable-select" data-search-placeholder="Search PO number..." data-options-width="280" style="width: 170px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(_dashPo || 'All PO Numbers')}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options roomy-options">
                                <div class="custom-option${_dashPo === '' ? ' selected' : ''}" data-value="">All PO Numbers</div>
                                ${poNumbers.map(p => `<div class="custom-option${_dashPo === p ? ' selected' : ''}" data-value="${_escapeAttr(p)}">${_escapeHtml(p)}</div>`).join('')}
                            </div>
                            <input type="hidden" id="inv-dash-filter-po" value="${_escapeAttr(_dashPo)}" onchange="Invoice.applyDashFilters()">
                        </div>

                        ${hasActiveFilters ? `
                            <button type="button" class="btn btn-secondary" onclick="Invoice.resetDashFilters()" style="padding: 7px 14px; font-size: 12.5px; border-radius: 8px;">
                                Clear Filters
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Table -->
                <div class="recent-table" style="overflow-x: auto;">
                    <table>
                        <thead>
                            <tr>
                                <th style="text-align: left;">Invoice No</th>
                                <th style="text-align: left;">Date</th>
                                <th style="text-align: left;">Client</th>
                                <th style="text-align: left; width: 1%; white-space: nowrap;" title="Order Reference Number">Order Ref No.</th>
                                <th style="text-align: left;">Type</th>
                                ${isIntlView ? '' : '<th style="text-align: right;">Excl. GST</th>'}
                                <th style="text-align: right;">${isIntlView ? 'Amount' : 'Incl. GST'}</th>
                                ${isIntlView ? `<th style="text-align: right;">${_escapeHtml(homeCur)}</th>` : ''}
                                <th style="text-align: center; width: 110px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Pagination -->
                ${paginationHtml}
            </div>
        `;
    }


    // Reporting departments (reference only — not mandatory, not printed on the PDF).
    // Used so sales can be reviewed department-wise. Selecting one in a PO Received
    // collection carries through to its Proforma and Invoice.
    const DEPARTMENTS = ['Engineering', 'Consulting', 'Projects', 'Support'];

    // Build the Department custom-select markup with `selected` pre-chosen (blank =
    // none). Behaviour is handled by the shared custom-select click handler in app.js.
    function _departmentSelectHTML(selected) {
        const sel = selected || '';
        const opts = ['', ...DEPARTMENTS].map(d => {
            const lbl = d || '— None —';
            return `<div class="custom-option${d === sel ? ' selected' : ''}" data-value="${_escapeAttr(d)}">${_escapeHtml(lbl)}</div>`;
        }).join('');
        return `
            <div class="custom-select-wrapper">
                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                    <span>${_escapeHtml(sel || 'Select department')}</span>
                    <div class="arrow"></div>
                </div>
                <div class="custom-options">${opts}</div>
                <input type="hidden" id="inv-department" value="${_escapeAttr(sel)}">
            </div>`;
    }

    // Programmatically set the Department select (used by the import/auto-fill path).
    function _applyDepartment(val) {
        const hidden = document.getElementById('inv-department');
        if (!hidden) return;
        const v = val || '';
        hidden.value = v;
        const wrapper = hidden.closest('.custom-select-wrapper');
        if (!wrapper) return;
        const span = wrapper.querySelector('.custom-select-trigger span');
        if (span) span.textContent = v || 'Select department';
        wrapper.querySelectorAll('.custom-option').forEach(o => {
            o.classList.toggle('selected', (o.dataset.value || '') === v);
        });
    }

    // Currencies available per mode (domestic = INR only; international = everything except INR)
    const DOMESTIC_CURRENCIES = ['INR'];
    function _currenciesForMode() {
        return _invMode === 'domestic' ? DOMESTIC_CURRENCIES : Object.keys(PdfUtils.CURRENCY_MAP).filter(c => c !== 'INR');
    }
    function _defaultCurrencyForMode() {
        return _invMode === 'domestic' ? 'INR' : 'USD';
    }
    // Effective tax settings driven by mode: international never has GST;
    // domestic respects the user's GST toggle (it is optional, not mandatory).
    function _effectiveSettings() {
        const s = Storage.getSettings();
        if (_invMode === 'international') return { ...s, gstEnabled: false };
        return s;
    }
    // Detect mode from a pasted/typed reference number (ORG/DOM/... or ORG/INT/...)
    function _modeFromRef(ref) {
        const r = (ref || '').trim();
        const org = Storage.ORG_CODE;
        // PO Received ref: ORG/DOM/001/26-27 or ORG/INT/001/26-27 (and legacy ORG/TM/<INT|DOM>/...)
        const tm = new RegExp(`^${org}\\/(?:TM\\/)?(INT|DOM)\\b`, 'i').exec(r);
        if (tm) return tm[1].toUpperCase() === 'INT' ? 'international' : 'domestic';
        // Invoice ref: ORG/INT001/26-27 (international) or ORG/001/26-27 (domestic)
        if (new RegExp(`^${org}\\/INT\\d`, 'i').test(r)) return 'international';
        if (new RegExp(`^${org}\\/\\d`, 'i').test(r)) return 'domestic';
        if (new RegExp(`^${org}\\d`, 'i').test(r)) return 'domestic'; // legacy domestic format ORG001/26-27
        return null;
    }

    // Clients are kept separate per mode. A client's clientType tags it as
    // 'domestic' or 'international'; untagged (legacy) clients count as domestic.
    function _clientsForMode() {
        return Storage.getAllVendors().filter(c => (c.clientType || 'domestic') === _invMode);
    }

    // Reflect the active mode in the read-only badge + show the matching bank section
    function _applyModeUI() {
        const label = document.getElementById('inv-mode-label');
        if (label) label.textContent = _invMode === 'international' ? 'International' : 'Domestic';
        // Page heading reflects the mode
        const title = document.getElementById('inv-page-title');
        const subtitle = document.getElementById('inv-page-subtitle');
        if (title) title.textContent = _invMode === 'international' ? 'International Tax Invoice' : 'Domestic Tax Invoice';
        if (subtitle) subtitle.textContent = _invMode === 'international'
            ? 'Create and generate a new international tax invoice'
            : 'Create and generate a new domestic tax invoice';
        const dom = document.getElementById('inv-domestic-bank-section');
        const intl = document.getElementById('inv-intl-bank-section');
        if (dom) dom.style.display = _invMode === 'domestic' ? '' : 'none';
        if (intl) intl.style.display = _invMode === 'international' ? '' : 'none';
        // International invoices never have GST/TAX — hide those toggles entirely
        const gstTaxBlock = document.getElementById('inv-gst-tax-block');
        if (gstTaxBlock) gstTaxBlock.style.display = _invMode === 'international' ? 'none' : '';
        // International clients have no GST — hide the client GST field too
        const gstGroup = document.getElementById('inv-client-gst-group');
        if (gstGroup) gstGroup.style.display = _invMode === 'international' ? 'none' : '';
        if (_invMode === 'international') {
            const gst = document.getElementById('inv-client-gst');
            if (gst) gst.value = '';
        }
    }

    // Rebuild every item's currency dropdown to match the current mode
    function _rebuildCurrencyOptions() {
        const currencies = _currenciesForMode();
        const target = _defaultCurrencyForMode();
        document.querySelectorAll('#inv-items-body tr').forEach(row => {
            const wrapper = row.querySelector('.currency-select');
            const hidden = row.querySelector('.item-currency');
            if (!wrapper || !hidden) return;
            const optionsBox = wrapper.querySelector('.custom-options');
            if (optionsBox) {
                optionsBox.innerHTML = App.buildCurrencyOptionsHTML(currencies, target);
            }
            hidden.value = target;
            const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
            if (triggerSpan) triggerSpan.textContent = target;
            // Hide the selector entirely when only one currency is allowed (domestic = INR)
            wrapper.style.display = currencies.length <= 1 ? 'none' : '';
        });
    }

    function setMode(mode) {
        if (mode !== 'domestic' && mode !== 'international') return;
        _invMode = mode;
        _applyModeUI();
        _rebuildCurrencyOptions();
        updateClientDropdown(); // clients are separate per mode
        const refInput = document.getElementById('inv-ref-number');
        if (refInput && refInput.getAttribute('data-auto-generated') === 'true') {
            updateAutoRefNumber();
        }
        recalcTax();
    }

    function render(editData = null, modeOverride = null) {
        const container = document.getElementById('inv-content');
        if (!container) return;

        // Automatically switch view container if editData is provided
        if (editData) {
            _currentView = 'form';
            const dashView = document.getElementById('inv-dashboard-view');
            const formView = document.getElementById('inv-form-view');
            if (dashView) dashView.style.display = 'none';
            if (formView) formView.style.display = 'block';
            const title = document.getElementById('inv-page-title');
            const subtitle = document.getElementById('inv-page-subtitle');
            if (title && editData.refNumber) {
                title.textContent = `Edit Invoice — ${editData.refNumber}`;
                if (subtitle) subtitle.textContent = 'Modify and regenerate this Invoice';
            }
        }

        // Editing keeps the document id (so save overwrites). Revise strips the id
        // (so save creates a new revision). New documents have no id.
        _editingId = (editData && editData.id) ? editData.id : null;
        // A fresh render clears any pending proforma link; ProformaInvoice.generateInvoice
        // re-sets it right after calling render().
        _sourceProformaId = null;
        // Carry the source received-PO id (if this invoice is generated from one).
        _sourceTmId = (editData && editData.sourceTmId) ? editData.sourceTmId : null;

        // Resolve invoice mode before the form (and its items) are built
        if (modeOverride === 'domestic' || modeOverride === 'international') {
            _invMode = modeOverride;
        } else if (editData && (editData.mode === 'domestic' || editData.mode === 'international')) {
            _invMode = editData.mode;
        } else if (editData && editData.refNumber) {
            _invMode = _modeFromRef(editData.refNumber) || 'domestic';
        } else {
            _invMode = 'domestic';
        }

        const clients = _clientsForMode();

        let selectedClientId = '';
        let selectedClientName = '— Select a saved client —';
        if (editData && editData.clientName) {
            const matchedClient = clients.find(c => c.name === editData.clientName);
            if (matchedClient) {
                selectedClientId = matchedClient.id;
                selectedClientName = matchedClient.name;
            } else {
                selectedClientName = editData.clientName;
            }
        }

        const clientCustomOptions = clients.map(v =>
            `<div class="custom-option${v.id === selectedClientId ? ' selected' : ''}" data-value="${v.id}">${_escapeAttr(v.name)}</div>`
        ).join('');

        container.innerHTML = `
            <!-- Invoice Header & Client -->
            <div class="form-container">
                <div class="form-row">
                    <div class="form-group">
                        <label>Invoice number <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="inv-ref-number" placeholder="e.g., ORG/0001/2627" value="${editData ? _escapeAttr(editData.refNumber) : ''}" data-auto-generated="${editData ? 'false' : 'true'}">
                    </div>
                    <div class="form-group">
                        <label>Date <span style="color: #ef4444;">*</span></label>
                        <input type="date" id="inv-date" max="9999-12-31" value="${editData ? editData.date : _todayISO()}" onchange="Invoice.updateAutoRefNumber()">
                    </div>
                </div>

                <div class="form-row" style="margin-top: 16px;">
                    <div class="form-group">
                        <label>Select Client <span style="color: #ef4444;">*</span></label>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            <div style="display:flex; gap:8px;">
                                <div class="custom-select-wrapper searchable-select" style="flex:1">
                                    <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                        <span>${_escapeAttr(selectedClientName)}</span>
                                    </div>
                                    <div class="custom-options" id="inv-client-custom-options">
                                        <div class="custom-option${selectedClientId === '' ? ' selected' : ''}" data-value="">— Select a saved client —</div>
                                        ${clientCustomOptions}
                                    </div>
                                    <input type="hidden" id="inv-client-select" value="${selectedClientId}">
                                </div>
                                <button class="btn btn-add" onclick="Invoice.showAddClient()" style="white-space:nowrap">+ Add New</button>
                            </div>
                            <!-- Sub Group select -->
                            <div id="inv-sub-client-wrapper" class="custom-select-wrapper searchable-select" style="display:none; width:100%;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>— Select Client —</span>
                                </div>
                                <div class="custom-options" id="inv-sub-client-custom-options">
                                </div>
                                <input type="hidden" id="inv-sub-client-select" value="">
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Reference</label>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="inv-ref-mode" placeholder="e.g., Email, Phone call, Letter" value="${editData && editData.referenceMode ? _escapeAttr(editData.referenceMode) : ''}" style="flex:1;">
                            <button id="inv-ref-file-btn" class="btn btn-add" type="button" onclick="Invoice.triggerRefFileUpload()" style="white-space:nowrap; ${editData && editData.referenceFilePath ? 'display:none;' : ''}">+ Add File</button>
                        </div>
                        <div id="inv-ref-file-indicator" style="margin-top:6px; font-size:12px; color:var(--text-secondary); ${editData && editData.referenceFilePath ? '' : 'display:none;'}">
                            📎 <a id="inv-ref-file-link" onclick="Invoice.viewRefFile()" title="View attached file" style="color:var(--accent-green); cursor:pointer; text-decoration:underline;">${editData && editData.referenceFilePath ? _escapeHtml(editData.referenceFileName || editData.referenceFilePath.split('/').pop() || 'Attached File') : ''}</a>
                            <span onclick="Invoice.removeRefFile()" title="Remove file" style="cursor:pointer; color:#ef4444; margin-left:8px; font-weight:700;">✕</span>
                        </div>
                        <input type="file" id="inv-ref-file-input" accept=".pdf,application/pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style="display:none" onchange="Invoice.handleRefFileUpload(this)">
                    </div>
                </div>

                <!-- Client details fields (hidden by default) -->
                <div id="inv-client-fields" style="display:none;">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Company Name</label>
                            <input type="text" id="inv-client-name" placeholder="Client company name" value="${editData ? _escapeAttr(editData.clientName) : ''}">
                        </div>
                        <div class="form-group" id="inv-client-gst-group">
                            <label>GST</label>
                            <input type="text" id="inv-client-gst" placeholder="GST number" value="${editData ? _escapeAttr(editData.clientGST) : ''}">
                        </div>
                    </div>
                    <div class="form-row single">
                        <div class="form-group">
                            <label>Address</label>
                            <textarea id="inv-client-address" rows="2" placeholder="Full address">${editData ? _escapeHtml(editData.clientAddress) : ''}</textarea>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Contact Person Name</label>
                            <input type="text" id="inv-client-contact-person" placeholder="Contact person name" value="${editData ? _escapeAttr(editData.clientContactPerson) : ''}">
                        </div>
                        <div class="form-group"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Contact</label>
                            <input type="text" id="inv-client-contact" placeholder="Phone number" value="${editData ? _escapeAttr(editData.clientContact) : ''}">
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="inv-client-email" placeholder="Email address" value="${editData ? _escapeAttr(editData.clientEmail) : ''}">
                        </div>
                    </div>
                    <div id="inv-client-save-actions" style="display:none; gap:8px; margin-top:16px;">
                        <button class="btn btn-generate" style="padding:10px 24px; font-size:13px;" onclick="Invoice.saveNewClient()">Save</button>
                        <button class="btn btn-secondary" style="padding:10px 20px; font-size:13px;" onclick="Invoice.hideAddClient()">Cancel</button>
                    </div>
                </div>
            </div>

            <!-- Order Metadata Section -->
            <div class="form-container">
                <div id="inv-order-metadata-fields">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Order Date</label>
                            <input type="date" id="inv-order-date" max="9999-12-31" value="${editData && (editData.poDate || editData.jobDate) ? (editData.poDate || editData.jobDate) : ''}">
                        </div>
                        <div class="form-group">
                            <label>Order Reference Number</label>
                            <input type="text" id="inv-order-ref" placeholder="e.g., PO-123" value="${editData && editData.poNumber ? _escapeAttr(editData.poNumber) : ''}">
                        </div>
                    </div>
                    <div class="form-row" style="margin-top: 16px;">
                        <div class="form-group">
                            <label>Project Code</label>
                            <input type="text" id="inv-project-code" placeholder="e.g., PRJ-2026-01" value="${editData && editData.projectCode ? _escapeAttr(editData.projectCode) : ''}">
                        </div>
                        <div class="form-group">
                            <label>Data Shipped Via</label>
                            <input type="text" id="inv-order-shipped-via" placeholder="e.g., INTERNET" value="${editData && editData.shippedVia ? _escapeAttr(editData.shippedVia) : ''}">
                        </div>
                    </div>
                    <div class="form-row" style="margin-top: 16px;">
                        <div class="form-group">
                            <label>Department</label>
                            ${_departmentSelectHTML(editData ? editData.department : '')}
                        </div>
                        <div class="form-group">
                            <label>Terms</label>
                            <input type="text" id="inv-order-terms" placeholder="e.g., Wire transfer to Axis Bank" value="${editData && typeof editData.terms === 'string' ? _escapeAttr(editData.terms) : ''}">
                        </div>
                    </div>
                </div>
            </div>

            <!-- Item Details (Second Container) -->
            <div class="form-container">
                <div class="items-table-wrapper">
                    <table class="items-table" id="inv-items-table">
                        <thead>
                            <tr>
                                <th class="col-sno">S.No</th>
                                <th class="col-desc">Detailed Specification</th>
                                <th class="col-hours">UOM</th>
                                <th class="col-qty">Quantity</th>
                                <th class="col-rate">Unit Rate</th>
                                <th class="col-amount">Amount</th>
                                <th class="col-actions"></th>
                            </tr>
                        </thead>
                        <tbody id="inv-items-body">
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:10px">
                    <button class="btn btn-add" onclick="Invoice.addItem()">+ Add Item</button>
                </div>
                <div style="margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 16px;">
                    <div class="total-row" id="inv-subtotal-row" style="display: none;">
                        <span class="total-label">Sub Total (excl. GST):</span>
                        <span class="total-value" id="inv-subtotal-display">0.00</span>
                    </div>
                    <div class="total-row" id="inv-cgst-row" style="display: none;">
                        <span class="total-label" id="inv-cgst-label">CGST Amount:</span>
                        <span class="total-value" id="inv-cgst-display">0.00</span>
                    </div>
                    <div class="total-row" id="inv-sgst-row" style="display: none;">
                        <span class="total-label" id="inv-sgst-label">SGST Amount:</span>
                        <span class="total-value" id="inv-sgst-display">0.00</span>
                    </div>
                    <div class="total-row" id="inv-igst-row" style="display: none;">
                        <span class="total-label" id="inv-igst-label">IGST Amount:</span>
                        <span class="total-value" id="inv-igst-display">0.00</span>
                    </div>
                    <div class="total-row" style="display: flex; justify-content: flex-end; gap: 16px;">
                        <span class="total-label" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">Grand Total:</span>
                        <span class="total-value" id="inv-total-display" style="font-size: 15px; font-weight: 700; color: var(--text-primary); min-width: 120px; text-align: right;">0.00</span>
                    </div>
                </div>
            </div>

            <!-- Bank Details Container (Domestic — IFSC) -->
            <div class="form-container" id="inv-domestic-bank-section">
                <div class="form-section-title">Bank Details</div>
                <div class="form-row" style="margin-top: 16px;">
                    <div class="form-group">
                        <label>Beneficiary Bank (IFSC) <span style="color: #ef4444;">*</span></label>
                        <div class="custom-select-wrapper">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                <span id="inv-domestic-bank-trigger">— Select Bank —</span>
                            </div>
                            <div class="custom-options" id="inv-domestic-bank-custom-options">
                                <div class="custom-option selected" data-value="">— Select Bank —</div>
                            </div>
                            <input type="hidden" id="inv-domestic-bank-select" value="" onchange="Invoice.onDomesticBankSelect()">
                        </div>
                        <div style="display:flex; gap:8px; margin-top:10px;">
                            <button class="btn btn-add" onclick="Invoice.showAddDomesticBank()" style="flex:1; white-space:nowrap">+ Add Bank</button>
                            <button class="btn btn-secondary" id="inv-domestic-bank-edit-btn" onclick="Invoice.showEditDomesticBank()" style="flex:1; white-space:nowrap;">Edit Bank</button>
                        </div>
                    </div>
                    <div class="form-group"></div>
                </div>
            </div>

            <!-- Bank Details Container (International — SWIFT) -->
            <div class="form-container" id="inv-intl-bank-section">
                <div class="form-section-title">Bank Details</div>

                <div class="form-row three-col" id="inv-intl-bank-row" style="margin-top: 16px;">
                    <div class="form-group" id="inv-corr-bank-group">
                        <label>Receiver's Correspondent Bank</label>
                        <div class="custom-select-wrapper">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                <span id="inv-corr-bank-trigger">— Select Correspondent Bank —</span>
                            </div>
                            <div class="custom-options" id="inv-corr-bank-custom-options">
                                <div class="custom-option selected" data-value="">— Select Correspondent Bank —</div>
                            </div>
                            <input type="hidden" id="inv-corr-bank-select" value="" onchange="Invoice.onCorrBankSelect()">
                        </div>
                        <div style="display:flex; gap:8px; margin-top:10px;">
                            <button class="btn btn-add" onclick="Invoice.showAddCorrBank()" style="flex:1; white-space:nowrap">+ Add Bank</button>
                            <button class="btn btn-secondary" id="inv-corr-bank-edit-btn" onclick="Invoice.showEditCorrBank()" style="flex:1; white-space:nowrap;">Edit Bank</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Beneficiary Bank</label>
                        <div class="custom-select-wrapper">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                <span id="inv-benef-bank-trigger">— Select Beneficiary Bank —</span>
                            </div>
                            <div class="custom-options" id="inv-benef-bank-custom-options">
                                <div class="custom-option selected" data-value="">— Select Beneficiary Bank —</div>
                            </div>
                            <input type="hidden" id="inv-benef-bank-select" value="" onchange="Invoice.onBenefBankSelect()">
                        </div>
                        <div style="display:flex; gap:8px; margin-top:10px;">
                            <button class="btn btn-add" onclick="Invoice.showAddBenefBank()" style="flex:1; white-space:nowrap">+ Add Bank</button>
                            <button class="btn btn-secondary" id="inv-benef-bank-edit-btn" onclick="Invoice.showEditBenefBank()" style="flex:1; white-space:nowrap;">Edit Bank</button>
                        </div>
                    </div>
                    <div class="form-group" id="inv-ult-benef-group">
                        <label>Ultimate Beneficiary</label>
                        <div class="custom-select-wrapper">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                <span id="inv-ult-benef-trigger">— Select Ultimate Beneficiary —</span>
                            </div>
                            <div class="custom-options" id="inv-ult-benef-custom-options">
                                <div class="custom-option selected" data-value="">— Select Ultimate Beneficiary —</div>
                            </div>
                            <input type="hidden" id="inv-ult-benef-select" value="" onchange="Invoice.onUltBenefSelect()">
                        </div>
                        <div style="display:flex; gap:8px; margin-top:10px;">
                            <button class="btn btn-add" onclick="Invoice.showAddUltBenef()" style="flex:1; white-space:nowrap">+ Add Beneficiary</button>
                            <button class="btn btn-secondary" id="inv-ult-benef-edit-btn" onclick="Invoice.showEditUltBenef()" style="flex:1; white-space:nowrap;">Edit Beneficiary</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Narrations (formerly "Terms & Conditions") -->
            <div class="form-container">
                <div class="form-section-title">Narrations</div>
                <div class="dynamic-list" id="inv-terms-list" style="margin-top: 16px; display: flex; flex-direction: column; gap: 8px;"></div>
                <div style="display: flex; gap: 8px; margin-top: 12px;">
                    <button class="btn btn-add" onclick="Invoice.addTerm()">+ Add Narration</button>
                </div>
            </div>

            <!-- Generate Button -->
            <div class="form-container" id="inv-generate-row" style="text-align: center; padding: 20px 0;">
                <button class="btn btn-secondary" onclick="Invoice.save()" style="padding: 12px 40px; font-size: 14px; margin-right: 12px;">Save</button>
                <button class="btn btn-generate" onclick="Invoice.saveAndDownload()" style="padding: 12px 40px; font-size: 14px;">Save &amp; Download</button>
            </div>
        `;

        const invRefInput = document.getElementById('inv-ref-number');
        if (invRefInput) {
            invRefInput.addEventListener('input', () => {
                invRefInput.setAttribute('data-auto-generated', 'false');
                // Auto-select Domestic / International from the pasted ref marker
                const detected = _modeFromRef(invRefInput.value);
                if (detected && detected !== _invMode) setMode(detected);
            });
            invRefInput.addEventListener('change', () => {
                const detected = _modeFromRef(invRefInput.value);
                if (detected && detected !== _invMode) setMode(detected);
            });
        }

        // Auto-fill from a saved PO Received document when the Order Reference
        // Number matches the one entered on that PO.
        const orderRefInput = document.getElementById('inv-order-ref');
        if (orderRefInput) {
            orderRefInput.addEventListener('change', () => {
                _tryAutoFillFromPoReceived(orderRefInput.value.trim());
            });
        }

        const clientNameInput = document.getElementById('inv-client-name');
        if (clientNameInput) {
            clientNameInput.addEventListener('input', () => {
                Invoice.updateAutoRefNumber();
            });
        }

        const clientGstInput = document.getElementById('inv-client-gst');
        if (clientGstInput) {
            clientGstInput.addEventListener('input', () => {
                Invoice.recalcTax();
            });
        }

        Invoice.updateAutoRefNumber();

        // On edit/revise the client is already saved — keep the detail fields collapsed
        // and just show the selected client in the dropdown (cleaner; data is retained).

        // Initialize items table
        itemCount = 0;
        _invRefFile = (editData && editData.referenceFilePath)
            ? { 
                fileName: editData.referenceFileName || editData.referenceFilePath.split('/').pop() || 'Attached File', 
                filePath: editData.referenceFilePath 
              }
            : null;
        const tbody = document.getElementById('inv-items-body');
        if (tbody) tbody.innerHTML = '';

        if (editData && editData.items && editData.items.length > 0) {
            editData.items.forEach(it => {
                addItem(it);
            });
        } else {
            addItem();
        }

        // Initialize correspondent banks dropdown
        updateCorrBankDropdown();
        const corrId = editData ? (editData.corrBank?.id || editData.corrBankId) : null;
        if (corrId) {
            const sel = document.getElementById('inv-corr-bank-select');
            if (sel) {
                sel.value = corrId;
                sel.dispatchEvent(new Event('change'));
            }
        }

        // Initialize beneficiary banks dropdown
        updateBenefBankDropdown();
        const benefId = editData ? (editData.benefBank?.id || editData.benefBankId) : null;
        if (benefId) {
            const sel = document.getElementById('inv-benef-bank-select');
            if (sel) {
                sel.value = benefId;
                sel.dispatchEvent(new Event('change'));
            }
        }

        // Initialize ultimate beneficiary dropdown
        updateUltBenefDropdown();
        const ultId = editData ? (editData.ultBenef?.id || editData.ultBenefId) : null;
        if (ultId) {
            const sel = document.getElementById('inv-ult-benef-select');
            if (sel) {
                sel.value = ultId;
                sel.dispatchEvent(new Event('change'));
            }
        }

        // Initialize domestic (IFSC) bank dropdown
        updateDomesticBankDropdown();
        if (editData && editData.domesticBank && editData.domesticBank.id) {
            const sel = document.getElementById('inv-domestic-bank-select');
            if (sel) {
                sel.value = editData.domesticBank.id;
                sel.dispatchEvent(new Event('change'));
            }
        }

        // Reflect the resolved mode in the toggle, bank sections and currency options
        _applyModeUI();
        _rebuildCurrencyOptions();

        if (editData && editData.currency) {
            setTimeout(() => {
                const dummy = document.createElement('input');
                dummy.value = editData.currency;
                handleCurrencyChange(dummy);
            }, 0);
        }

        _setupColumnSettings();

        // Load Terms and Conditions
        const termsList = document.getElementById('inv-terms-list');
        if (termsList) termsList.innerHTML = '';
        invoiceTermCount = 0;
        
        let termsToLoad = [];
        if (editData && editData.termsAndConditions) {
            termsToLoad = editData.termsAndConditions;
        } else if (editData && editData.terms) {
            termsToLoad = Array.isArray(editData.terms) ? editData.terms : [editData.terms];
        } else {
            const settings = Storage.getSettings();
            termsToLoad = settings.poDefaultTerms || [];
        }
        
        if (termsToLoad.length > 0) {
            termsToLoad.forEach(t => addTerm(t));
        } else {
            addTerm();
        }

        // Load Milestones
        const conditionsList = document.getElementById('inv-conditions-list');
        if (conditionsList) conditionsList.innerHTML = '';
        invoiceConditionCount = 0;
        
        let conditionsToLoad = [];
        if (editData && editData.milestones) {
            conditionsToLoad = editData.milestones;
        } else if (editData && editData.conditions) {
            conditionsToLoad = editData.conditions;
        } else {
            const settings = Storage.getSettings();
            conditionsToLoad = settings.poDefaultConditions || [];
        }
        
        if (conditionsToLoad.length > 0) {
            conditionsToLoad.forEach(c => addCondition(c));
        } else {
            addCondition();
        }

        const settings = Storage.getSettings();

        // Sync settings with the document's saved tax settings if revising/editing.
        // Never do this for international documents: their gstEnabled is always false
        // (GST never applies abroad), and persisting that to the global setting would
        // wrongly disable GST for subsequent domestic documents. International GST is
        // already handled by mode via _effectiveSettings().
        if (editData && editData.gstEnabled !== undefined && _invMode !== 'international') {
            settings.gstEnabled = !!editData.gstEnabled;
            Storage.saveSettings(settings);

            // Sync all checkboxes across forms
            const poGst = document.getElementById('po-gst-toggle');
            const quGst = document.getElementById('qu-gst-toggle');
            if (poGst) poGst.checked = settings.gstEnabled;
            if (quGst) quGst.checked = settings.gstEnabled;
        }

        const invGst = document.getElementById('inv-gst-toggle');
        if (invGst) invGst.checked = settings.gstEnabled === true;

        // Ensure the reference file is displayed correctly in the UI on load/render
        const indicator = document.getElementById('inv-ref-file-indicator');
        const link = document.getElementById('inv-ref-file-link');
        const btn = document.getElementById('inv-ref-file-btn');
        if (indicator && link) {
            if (_invRefFile) {
                link.textContent = _invRefFile.fileName || 'Attached File';
                link.setAttribute('title', 'View attached file');
                indicator.style.display = 'block';
                if (btn) btn.style.display = 'none';
            } else {
                indicator.style.display = 'none';
                link.textContent = '';
                if (btn) btn.style.display = '';
            }
        }

        recalcTax();
    }

    let _invOutsideClickHandler = null;

    function _setupColumnSettings() {
        const toggleList = document.getElementById('inv-column-toggle-list');
        if (!toggleList) return;

        const visibility = Storage.getINVColumnVisibility();
        const table = document.getElementById('inv-items-table');

        // Apply classes to table
        Object.keys(visibility).forEach(key => {
            if (key === 'signature' || key === 'total') return; // PDF-only flags, not table columns
            if (table) {
                if (visibility[key] === false) {
                    table.classList.add(`hide-col-${key}`);
                } else {
                    table.classList.remove(`hide-col-${key}`);
                }
            }
        });

        // Column Labels Map
        const columnLabels = {
            hours: 'UOM',
            qty: 'Quantity',
            rate: 'Unit Rate',
            total: 'Total'
        };

        // Populate checkboxes
        toggleList.innerHTML = Object.keys(columnLabels).map(key => {
            const checked = visibility[key] !== false ? 'checked' : '';
            return `
                <div class="inv-column-toggle-item" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                    <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">${columnLabels[key]}</span>
                    <label class="switch">
                        <input type="checkbox" class="inv-col-toggle-input" data-col="${key}" ${checked}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
        }).join('');

        // Bind change events
        toggleList.querySelectorAll('.inv-col-toggle-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const colKey = e.target.dataset.col;
                const isChecked = e.target.checked;

                // Validation: prevent hiding all columns
                const currentVisibility = Storage.getINVColumnVisibility();
                const activeCount = Object.keys(currentVisibility).filter(k => k === colKey ? isChecked : currentVisibility[k] !== false).length;
                if (activeCount === 0) {
                    App.showToast('At least one column must be visible!', 'error');
                    e.target.checked = true; // revert checkbox
                    return;
                }

                _toggleColumn(colKey, isChecked);
            });
        });

        // Append the Signature & Stamp toggle (PDF-only, not a table column)
        const invSigItem = document.createElement('div');
        invSigItem.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0 4px; border-top:1px solid rgba(0,0,0,0.08); margin-top:6px;';
        invSigItem.innerHTML = `
            <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">Signature</span>
            <label class="switch">
                <input type="checkbox" id="inv-signature-toggle" ${visibility.signature === true ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;
        toggleList.appendChild(invSigItem);
        const invSigInput = invSigItem.querySelector('#inv-signature-toggle');
        if (invSigInput) {
            invSigInput.addEventListener('change', (e) => {
                const v = Storage.getINVColumnVisibility();
                v.signature = e.target.checked;
                Storage.saveINVColumnVisibility(v);
            });
        }

        // Round Off toggle (domestic INR invoices only) — rounds the grand total to
        // the nearest rupee and prints the adjustment above the amount in words.
        if (_invMode === 'domestic') {
            const invRoundItem = document.createElement('div');
            invRoundItem.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0 4px; border-top:1px solid rgba(0,0,0,0.08); margin-top:6px;';
            invRoundItem.innerHTML = `
                <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">Round Off</span>
                <label class="switch">
                    <input type="checkbox" id="inv-roundoff-toggle" ${visibility.roundOff === true ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            `;
            toggleList.appendChild(invRoundItem);
            const invRoundInput = invRoundItem.querySelector('#inv-roundoff-toggle');
            if (invRoundInput) {
                invRoundInput.addEventListener('change', (e) => {
                    const v = Storage.getINVColumnVisibility();
                    v.roundOff = e.target.checked;
                    Storage.saveINVColumnVisibility(v);
                });
            }
        }

        // Wire show/hide click and click outside
        const settingsBtn = document.getElementById('inv-columns-settings-btn');
        const settingsDropdown = document.getElementById('inv-columns-settings-dropdown');

        if (settingsBtn && settingsDropdown) {
            const newSettingsBtn = settingsBtn.cloneNode(true);
            settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);

            newSettingsBtn.addEventListener('click', (e) => {
                const isVisible = settingsDropdown.style.display === 'block';
                // Close other dropdowns first
                document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
                document.querySelectorAll('.po-columns-settings-dropdown, .qu-columns-settings-dropdown').forEach(d => d.style.display = 'none');
                settingsDropdown.style.display = isVisible ? 'none' : 'block';
                e.stopPropagation();
            });

            // Click outside handler
            if (_invOutsideClickHandler) {
                document.removeEventListener('click', _invOutsideClickHandler);
            }
            _invOutsideClickHandler = (e) => {
                const dropdown = document.getElementById('inv-columns-settings-dropdown');
                const btn = document.getElementById('inv-columns-settings-btn');
                if (!dropdown) {
                    document.removeEventListener('click', _invOutsideClickHandler);
                    _invOutsideClickHandler = null;
                    return;
                }
                if (dropdown && btn && !dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            };
            document.addEventListener('click', _invOutsideClickHandler);
        }
        updateClientDropdown();
    }

    function _toggleColumn(colKey, isChecked) {
        const visibility = Storage.getINVColumnVisibility();
        visibility[colKey] = isChecked;
        Storage.saveINVColumnVisibility(visibility);

        const table = document.getElementById('inv-items-table');
        if (table) {
            if (isChecked) {
                table.classList.remove(`hide-col-${colKey}`);
            } else {
                table.classList.add(`hide-col-${colKey}`);
            }
        }
        recalcTax();
    }

    // Retained as a no-op: the Order metadata section is now universal (no PO/Job toggle).
    function toggleMetadataFields() {}

    function onClientSelect() {
        const sel = document.getElementById('inv-client-select');
        const clientId = sel.value;
        const fieldsDiv = document.getElementById('inv-client-fields');
        const actionsDiv = document.getElementById('inv-client-save-actions');

        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        if (!clientId) {
            document.getElementById('inv-client-name').value = '';
            document.getElementById('inv-client-gst').value = '';
            document.getElementById('inv-client-address').value = '';
            document.getElementById('inv-client-contact-person').value = '';
            document.getElementById('inv-client-contact').value = '';
            document.getElementById('inv-client-email').value = '';
            updateAutoRefNumber();
            return;
        }

        const client = Storage.getVendor(clientId);
        if (client) {
            document.getElementById('inv-client-name').value = client.name || '';
            document.getElementById('inv-client-gst').value = client.gst || '';
            document.getElementById('inv-client-address').value = client.address || '';
            document.getElementById('inv-client-contact-person').value = client.contactPerson || '';
            document.getElementById('inv-client-contact').value = client.contact || '';
            document.getElementById('inv-client-email').value = client.email || '';
        }
        updateAutoRefNumber();
    }

    function updateAutoRefNumber() {
        const invRefInput = document.getElementById('inv-ref-number');
        if (!invRefInput || invRefInput.getAttribute('data-auto-generated') !== 'true') return;

        const clientNameInput = document.getElementById('inv-client-name');
        const clientName = clientNameInput ? clientNameInput.value.trim() : '';
        if (!clientName) {
            invRefInput.value = '';
            return;
        }

        const dateInput = document.getElementById('inv-date');
        const dateVal = dateInput ? dateInput.value : _todayISO();
        if (!dateVal) return;

        const fy = Storage.getFinancialYear(dateVal);
        const fyShort = Storage.getFinancialYearShort(dateVal);
        const clientCode = Storage.generateClientCode(clientName);

        // Domestic and international invoices keep completely separate serial runs
        const invDocType = _invMode === 'international' ? 'INV_INT' : 'INV_DOM';
        const nextSerial = Storage.peekNextSerialNumber(invDocType, '', fy);
        // International serials are 3 digits (001…999) and grow to 4+ past 999;
        // domestic stays 4 digits.
        const serialStr = String(nextSerial).padStart(_invMode === 'international' ? 3 : 4, '0');

        invRefInput.value = `${Storage.getOrgInfo().serialPrefix}/${_invMode === 'international' ? 'INT' : ''}${serialStr}/${fyShort}`;
    }

    function showAddClient() {
        App.showAddContactModal('client', (data) => {
            document.getElementById('inv-client-name').value = data.name;
            document.getElementById('inv-client-gst').value = data.gst;
            document.getElementById('inv-client-address').value = data.address;
            document.getElementById('inv-client-contact-person').value = data.contactPerson;
            document.getElementById('inv-client-contact').value = data.contact;
            document.getElementById('inv-client-email').value = data.email;

            saveNewClient();
        }, () => {
            const sel = document.getElementById('inv-client-select');
            if (sel) {
                sel.value = '';
                const wrapper = sel.closest('.custom-select-wrapper');
                if (wrapper) {
                    const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                    if (triggerSpan) triggerSpan.textContent = '— Select a saved client —';
                    wrapper.querySelectorAll('.custom-option').forEach(opt => {
                        if (opt.dataset.value === '') {
                            opt.classList.add('selected');
                        } else {
                            opt.classList.remove('selected');
                        }
                    });
                }
            }
            updateAutoRefNumber();
        }, { hideClientType: true });
    }

    function hideAddClient() {
        document.getElementById('inv-client-name').value = '';
        document.getElementById('inv-client-gst').value = '';
        document.getElementById('inv-client-address').value = '';
        document.getElementById('inv-client-contact-person').value = '';
        document.getElementById('inv-client-contact').value = '';
        document.getElementById('inv-client-email').value = '';

        const fieldsDiv = document.getElementById('inv-client-fields');
        const actionsDiv = document.getElementById('inv-client-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        const sel = document.getElementById('inv-client-select');
        if (sel) {
            sel.value = '';
            const wrapper = sel.closest('.custom-select-wrapper');
            if (wrapper) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                if (triggerSpan) triggerSpan.textContent = '— Select a saved client —';
                wrapper.querySelectorAll('.custom-option').forEach(opt => {
                    if (opt.dataset.value === '') {
                        opt.classList.add('selected');
                    } else {
                        opt.classList.remove('selected');
                    }
                });
            }
        }
        updateAutoRefNumber();
    }

    function saveNewClient() {
        const name = document.getElementById('inv-client-name').value.trim();
        if (!name) {
            App.showToast('Please enter client company name', 'error');
            return;
        }
        const clientData = {
            name: name,
            gst: document.getElementById('inv-client-gst').value.trim(),
            address: document.getElementById('inv-client-address').value.trim(),
            contactPerson: document.getElementById('inv-client-contact-person').value.trim(),
            contact: document.getElementById('inv-client-contact').value.trim(),
            email: document.getElementById('inv-client-email').value.trim(),
            clientType: _invMode
        };
        const saved = Storage.saveVendor(clientData);

        const clients = _clientsForMode();
        const customOptionsDiv = document.getElementById('inv-client-custom-options');
        if (customOptionsDiv) {
            customOptionsDiv.innerHTML = '<div class="custom-option" data-value="">— Select a saved client —</div>' +
                clients.map(v => `<div class="custom-option ${v.id === saved.id ? 'selected' : ''}" data-value="${v.id}">${_escapeAttr(v.name)}</div>`).join('');
        }

        const sel = document.getElementById('inv-client-select');
        if (sel) {
            sel.value = saved.id;
            const wrapper = sel.closest('.custom-select-wrapper');
            if (wrapper) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                if (triggerSpan) triggerSpan.textContent = saved.name;
            }
        }

        document.getElementById('inv-client-name').value = saved.name || '';
        document.getElementById('inv-client-gst').value = saved.gst || '';
        document.getElementById('inv-client-address').value = saved.address || '';
        document.getElementById('inv-client-contact-person').value = saved.contactPerson || '';
        document.getElementById('inv-client-contact').value = saved.contact || '';
        document.getElementById('inv-client-email').value = saved.email || '';

        const fieldsDiv = document.getElementById('inv-client-fields');
        const actionsDiv = document.getElementById('inv-client-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        App.showToast(`Client "${saved.name}" saved!`, 'success');
        updateAutoRefNumber();
    }

    function updateClientDropdown() {
        const clients = _clientsForMode();
        const selectedVal = document.getElementById('inv-client-select')?.value || '';
        App.setupGroupedClientSelect('inv', clients, selectedVal, Invoice.onClientSelect);
    }

    function _todayISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function addTerm(value = '') {
        invoiceTermCount++;
        const list = document.getElementById('inv-terms-list');
        if (!list) return;
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `inv-term-${invoiceTermCount}`;
        div.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:8px;';
        const num = list.children.length + 1;
        div.innerHTML = `
            <span class="list-number" style="font-size:13px; font-weight:600; min-width:20px;">${num}.</span>
            <input type="text" class="inv-term-input" value="${_escapeAttr(value)}" placeholder="Enter term/condition" style="flex:1; padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
            <button class="btn-remove" onclick="Invoice.removeTerm(${invoiceTermCount})" style="background:transparent; border:none; color:#E53935; font-size:18px; cursor:pointer; line-height:1;">×</button>
        `;
        list.appendChild(div);
    }

    function removeTerm(id) {
        const el = document.getElementById(`inv-term-${id}`);
        if (el) {
            el.remove();
            _renumberList('inv-terms-list');
        }
    }

    function addCondition(value = '') {
        invoiceConditionCount++;
        const list = document.getElementById('inv-conditions-list');
        if (!list) return;
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `inv-cond-${invoiceConditionCount}`;
        div.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:8px;';
        const num = list.children.length + 1;
        div.innerHTML = `
            <span class="list-number" style="font-size:13px; font-weight:600; min-width:20px;">${num}.</span>
            <textarea class="inv-condition-input" placeholder="Enter milestone" rows="2" style="flex:1; padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">${_escapeHtml(value)}</textarea>
            <button class="btn-remove" onclick="Invoice.removeCondition(${invoiceConditionCount})" style="background:transparent; border:none; color:#E53935; font-size:18px; cursor:pointer; line-height:1;">×</button>
        `;
        list.appendChild(div);
    }

    function removeCondition(id) {
        const el = document.getElementById(`inv-cond-${id}`);
        if (el) {
            el.remove();
            _renumberList('inv-conditions-list');
        }
    }

    function _renumberList(listId) {
        const list = document.getElementById(listId);
        if (!list) return;
        Array.from(list.children).forEach((item, idx) => {
            const numSpan = item.querySelector('.list-number');
            if (numSpan) numSpan.textContent = `${idx + 1}.`;
        });
    }

    function addItem(initData = null) {
        itemCount++;
        const curList = _currenciesForMode();
        let currentCurrency = getSelectedCurrency();
        if (!curList.includes(currentCurrency)) currentCurrency = _defaultCurrencyForMode();
        const lockCurrency = curList.length <= 1;
        const tbody = document.getElementById('inv-items-body');
        const tr = document.createElement('tr');
        tr.id = `inv-item-${itemCount}`;

        const specVal = initData ? initData.specification : '';
        const qtyVal = initData ? initData.qty : '';
        const uomVal = initData ? (initData.uom || '') : 'Hrs';
        const rateVal = initData ? initData.rate : '';
        // Amount is always derived from qty×rate (the single source of truth used by
        // recalcTax, _collectFormData and the PDF). Deriving it here — instead of
        // trusting a possibly-stale stored amount from a bulk import — makes the total
        // correct on load without needing to re-touch the rate field.
        const amountVal = initData ? ((parseFloat(initData.qty) || 0) * (parseFloat(initData.rate) || 0)) : 0;

        tr.innerHTML = `
            <td class="col-sno"><div class="sno-display">${itemCount}</div></td>
            <td class="col-desc"><textarea class="item-spec" placeholder="Detailed specification" rows="2">${_escapeHtml(specVal)}</textarea></td>
            <td class="col-hours">
                <div class="custom-select-wrapper uom-select">
                    <div class="custom-select-trigger">
                        <span>${_escapeAttr(uomVal)}</span>
                    </div>
                    <div class="custom-options">${App.uomOptionsHTML(uomVal)}</div>
                    <input type="hidden" class="item-uom" value="${_escapeAttr(uomVal)}">
                </div>
            </td>
            <td class="col-qty"><input type="number" class="item-qty" placeholder="0" min="0" step="any" oninput="Invoice.calcRow(this)" value="${qtyVal}"></td>
            <td class="col-rate">
                <div class="rate-currency-box">
                    <input type="number" class="item-rate" placeholder="0" min="0" step="any" oninput="Invoice.calcRow(this)" value="${rateVal}">
                    <div class="custom-select-wrapper currency-select" style="${lockCurrency ? 'display:none;' : ''}">
                        <div class="custom-select-trigger">
                            <span>${currentCurrency}</span>
                        </div>
                        <div class="custom-options">${App.buildCurrencyOptionsHTML(curList, currentCurrency)}</div>
                        <input type="hidden" class="item-currency" value="${currentCurrency}" onchange="Invoice.handleCurrencyChange(this)">
                    </div>
                </div>
            </td>
            <td class="col-amount"><input type="number" class="item-amount" placeholder="0" min="0" step="any" oninput="Invoice.calcRow(this)" value="${amountVal}"></td>
            <td class="col-actions"><button class="btn-remove" onclick="Invoice.removeItem(${itemCount})" title="Remove">×</button></td>
        `;
        tbody.appendChild(tr);

        // Sync new row's currency
        const itemCurrencyInput = tr.querySelector('.item-currency');
        if (itemCurrencyInput) {
            itemCurrencyInput.value = currentCurrency;
            const wrapper = itemCurrencyInput.closest('.custom-select-wrapper');
            if (wrapper) {
                const textSpan = wrapper.querySelector('.custom-select-trigger span');
                if (textSpan) {
                    textSpan.textContent = currentCurrency;
                }
                wrapper.querySelectorAll('.custom-option').forEach(opt => {
                    if (opt.dataset.value === currentCurrency) {
                        opt.classList.add('selected');
                    } else {
                        opt.classList.remove('selected');
                    }
                });
            }
        }

        _renumberItems();
    }

    function removeItem(id) {
        const row = document.getElementById(`inv-item-${id}`);
        if (row) {
            row.remove();
            _renumberItems();
            recalcTax();
        }
    }

    function calcRow(input) {
        const row = input.closest('tr');
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
        const amountInput = row.querySelector('.item-amount');

        const amount = FinanceUtils.truncate2(qty * rate);
        amountInput.value = amount.toFixed(2);
        recalcTax();
    }

    function handleCurrencyChange(select) {
        const val = select.value;
        // Scope to THIS form's items only — never touch other documents' rows.
        document.querySelectorAll('#inv-items-body .item-currency').forEach(s => {
            s.value = val;
            const wrapper = s.closest('.custom-select-wrapper');
            if (wrapper) {
                const textSpan = wrapper.querySelector('.custom-select-trigger span');
                if (textSpan) {
                    textSpan.textContent = val;
                }
                wrapper.querySelectorAll('.custom-option').forEach(opt => {
                    if (opt.dataset.value === val) {
                        opt.classList.add('selected');
                    } else {
                        opt.classList.remove('selected');
                    }
                });
            }
        });
        recalcTax();
    }

    function getSelectedCurrency() {
        // Only read THIS form's own items — a document-wide query would inherit a
        // stale currency left in the DOM by another form (e.g. an India INR row).
        const first = document.querySelector('#inv-items-body .item-currency');
        if (first && first.value) return first.value;
        return _invMode === 'international' ? 'USD' : 'INR';
    }

    // Ask the user for the exchange rate used to convert a foreign-currency invoice
    // into the home currency (INR). Shows the (read-only) Forex Amount and the
    // live-computed Value, mirroring the "Forex Amount / Rate of Exchange / Value"
    // layout. Resolves with the entered rate (number), or null if cancelled.
    function _promptExchangeRate(forexAmount, foreignCur, homeCur, prefillRate) {
        return new Promise((resolve) => {
            const existing = document.getElementById('inv-fx-modal');
            if (existing) existing.remove();

            const hSym = PdfUtils.currencySymbol(homeCur);
            // Show the full ISO code before the symbol+amount (e.g. "CAD $1,096.00"),
            // so dollar currencies aren't confused with one another.
            const fmtForex = `${foreignCur} ${PdfUtils.formatMoney(forexAmount, foreignCur)}`;

            const modal = document.createElement('div');
            modal.id = 'inv-fx-modal';
            modal.className = 'modal-overlay';
            modal.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.4); z-index:20000; align-items:center; justify-content:center; backdrop-filter:blur(4px); font-family:\'Inter\', -apple-system, sans-serif;';

            modal.innerHTML = `
                <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:16px; padding:28px; width:560px; max-width:95vw; box-shadow:0 15px 45px rgba(0,0,0,0.15); text-align:left;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <h3 style="font-size:18px; font-weight:700; color:#18181b; margin:0;">Currency Conversion</h3>
                        <button type="button" id="inv-fx-x" style="background:transparent; border:none; font-size:20px; cursor:pointer; color:#71717a; line-height:1;">✕</button>
                    </div>
                    <p style="margin:0 0 18px; font-size:12.5px; color:#71717a;">Enter the exchange rate to record this invoice's value in ${homeCur}.</p>
                    <div style="display:flex; align-items:flex-end; gap:12px;">
                        <div style="flex:1;">
                            <label style="display:block; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:6px;">Forex Amount</label>
                            <div style="padding:0 12px; border:1px solid rgba(0,0,0,0.12); border-radius:8px; background:#f4f4f5; height:42px; line-height:40px; font-size:14px; font-weight:700; color:#27272a; box-sizing:border-box; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${_escapeAttr(fmtForex)}">${_escapeHtml(fmtForex)}</div>
                        </div>
                        <div style="padding-bottom:11px; font-size:16px; font-weight:700; color:#a1a1aa;">@</div>
                        <div style="flex:1;">
                            <label style="display:block; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:6px;">Rate of Exchange</label>
                            <div style="position:relative;">
                                <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); font-size:14px; font-weight:700; color:#71717a;">${_escapeHtml(hSym)}</span>
                                <input type="number" id="inv-fx-rate" step="any" min="0" value="${prefillRate != null ? _escapeAttr(String(prefillRate)) : ''}" placeholder="0.00" style="width:100%; padding:0 12px 0 ${22 + hSym.length * 6}px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; background:#fff; height:42px; font-size:14px; font-weight:700; box-sizing:border-box;">
                            </div>
                        </div>
                        <div style="padding-bottom:11px; font-size:16px; font-weight:700; color:#a1a1aa;">=</div>
                        <div style="flex:1.2;">
                            <label style="display:block; font-size:11px; font-weight:700; color:#71717a; letter-spacing:0.4px; text-transform:uppercase; margin-bottom:6px;">Value in ${_escapeHtml(hSym)}</label>
                            <div id="inv-fx-value" style="padding:0 12px; border:1px solid rgba(0,0,0,0.12); border-radius:8px; background:#f4f4f5; height:42px; line-height:40px; font-size:14px; font-weight:800; color:#004d2c; box-sizing:border-box; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">—</div>
                        </div>
                    </div>
                    <div style="font-size:11.5px; color:#71717a; margin-top:10px;" id="inv-fx-rateline"></div>
                    <div style="display:flex; justify-content:flex-end; gap:12px; border-top:1px solid rgba(0,0,0,0.06); padding-top:20px; margin-top:22px;">
                        <button type="button" id="inv-fx-cancel" style="padding:10px 20px; font-size:13px; font-weight:600; background:transparent; border:1px solid rgba(0,0,0,0.15); color:#27272a; border-radius:8px; cursor:pointer;">Cancel</button>
                        <button type="button" id="inv-fx-ok" style="padding:10px 24px; font-size:13px; font-weight:600; background:#004d2c; border:none; color:#fff; border-radius:8px; cursor:pointer;">Generate Invoice</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            const rateInput = modal.querySelector('#inv-fx-rate');
            const valueEl = modal.querySelector('#inv-fx-value');
            const rateLineEl = modal.querySelector('#inv-fx-rateline');
            const okBtn = modal.querySelector('#inv-fx-ok');

            const recompute = () => {
                const rate = parseFloat(rateInput.value);
                if (rate > 0) {
                    valueEl.textContent = PdfUtils.formatMoney(forexAmount * rate, homeCur);
                    rateLineEl.textContent = `1 ${foreignCur} = ${PdfUtils.formatMoney(rate, homeCur)}`;
                } else {
                    valueEl.textContent = '—';
                    rateLineEl.textContent = '';
                }
            };

            const cleanup = () => modal.remove();
            const cancel = () => { cleanup(); resolve(null); };
            const confirm = () => {
                const rate = parseFloat(rateInput.value);
                if (!(rate > 0)) {
                    App.showToast('Please enter a valid exchange rate.', 'error');
                    rateInput.focus();
                    return;
                }
                cleanup();
                resolve(rate);
            };

            rateInput.addEventListener('input', recompute);
            rateInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirm(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            });
            okBtn.addEventListener('click', confirm);
            modal.querySelector('#inv-fx-cancel').addEventListener('click', cancel);
            modal.querySelector('#inv-fx-x').addEventListener('click', cancel);

            recompute();
            setTimeout(() => rateInput.focus(), 50);
        });
    }

    function recalcTax() {
        const rows = document.querySelectorAll('#inv-items-body tr');
        let subtotal = 0;

        rows.forEach(row => {
            const spec = row.querySelector('.item-spec')?.value || '';
            const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
            const rate = parseFloat(row.querySelector('.item-rate')?.value) || 0;
            const amount = FinanceUtils.truncate2(qty * rate); // source of truth — never the stored amount field
            const specEmpty = !spec.trim();
            const qtyEmpty = qty === 0;
            const rateEmpty = rate === 0;

            if (specEmpty && qtyEmpty && rateEmpty) return;
            subtotal += amount;
        });
        subtotal = FinanceUtils.truncate2(subtotal);

        const settings = _effectiveSettings();
        const clientGstInput = document.getElementById('inv-client-gst');
        const clientGst = clientGstInput ? clientGstInput.value.trim() : '';
        const fin = FinanceUtils.calculateTotals(subtotal, settings, clientGst);

        const subtotalRow = document.getElementById('inv-subtotal-row');
        const cgstRow = document.getElementById('inv-cgst-row');
        const sgstRow = document.getElementById('inv-sgst-row');
        const igstRow = document.getElementById('inv-igst-row');

        // Hide all by default
        if (subtotalRow) subtotalRow.style.display = 'none';
        if (cgstRow) cgstRow.style.display = 'none';
        if (sgstRow) sgstRow.style.display = 'none';
        if (igstRow) igstRow.style.display = 'none';

        const currency = getSelectedCurrency();

        const subtotalEl = document.getElementById('inv-subtotal-display');
        if (subtotalEl) {
            subtotalEl.textContent = PdfUtils.formatMoney(subtotal, currency);
        }

        // Tax is not itemised — show only Sub Total (excl. Tax) when GST is on.
        if (fin.gstEnabled) {
            if (subtotalRow) subtotalRow.style.display = 'flex';
        }

        const grandEl = document.getElementById('inv-total-display');
        if (grandEl) grandEl.textContent = PdfUtils.formatMoney(fin.grandTotal, currency);
    }

    function _renumberItems() {
        const rows = document.querySelectorAll('#inv-items-body tr');
        rows.forEach((row, i) => {
            const sno = row.querySelector('.sno-display');
            if (sno) sno.textContent = i + 1;
        });
    }

    function onCorrBankSelect() {
        const sel = document.getElementById('inv-corr-bank-select');
        const bankId = sel.value;
        const triggerSpan = document.getElementById('inv-corr-bank-trigger');

        if (!bankId) {
            if (triggerSpan) triggerSpan.textContent = '— Select Correspondent Bank —';
            return;
        }

        const bank = Storage.getCorrBank(bankId);
        if (bank) {
            if (triggerSpan) triggerSpan.textContent = bank.name;
        }
    }

    function showAddCorrBank() {
        App.showAddCorrBankModal((data) => {
            const saved = Storage.saveCorrBank(data);
            updateCorrBankDropdown();

            const sel = document.getElementById('inv-corr-bank-select');
            if (sel) {
                sel.value = saved.id;
                sel.dispatchEvent(new Event('change'));
            }
            // Close dropdown list
            const wrapper = document.getElementById('inv-corr-bank-custom-options')?.closest('.custom-select-wrapper');
            if (wrapper) {
                wrapper.classList.remove('open');
                const dropdown = wrapper.querySelector('.custom-options');
                if (dropdown) dropdown.style.display = 'none';
            }
            App.showToast(`Bank "${saved.name}" saved!`, 'success');
        });
    }

    function showEditCorrBank() {
        const sel = document.getElementById('inv-corr-bank-select');
        const bankId = sel ? sel.value : '';
        if (!bankId) {
            App.showToast('Please select a Correspondent Bank to edit first.', 'info');
            return;
        }
        const bank = Storage.getCorrBank(bankId);
        if (!bank) return;

        App.showAddCorrBankModal(bank, (data) => {
            data.id = bank.id;
            const saved = Storage.saveCorrBank(data);
            updateCorrBankDropdown();

            const selectEl = document.getElementById('inv-corr-bank-select');
            if (selectEl) {
                selectEl.value = saved.id;
                selectEl.dispatchEvent(new Event('change'));
            }
            App.showToast(`Bank "${saved.name}" updated!`, 'success');
        });
    }

    function updateCorrBankDropdown() {
        const dropdown = document.getElementById('inv-corr-bank-custom-options');
        if (!dropdown) return;
        const banks = Storage.getAllCorrBanks();
        const selectedVal = document.getElementById('inv-corr-bank-select')?.value || '';

        let html = `<div class="custom-option${selectedVal === '' ? ' selected' : ''}" data-value="">— Select Correspondent Bank —</div>`;
        banks.forEach(b => {
            html += `<div class="custom-option${b.id === selectedVal ? ' selected' : ''}" data-value="${b.id}">${_escapeAttr(b.name)}</div>`;
        });
        dropdown.innerHTML = html;

        if (!selectedVal) {
            const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
            if (triggerSpan) {
                triggerSpan.textContent = '— Select Correspondent Bank —';
            }
        } else {
            const matched = banks.find(b => b.id === selectedVal);
            const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
            if (triggerSpan && matched) {
                triggerSpan.textContent = matched.name;
            }
        }
    }

    function onBenefBankSelect() {
        const sel = document.getElementById('inv-benef-bank-select');
        const bankId = sel.value;
        const triggerSpan = document.getElementById('inv-benef-bank-trigger');

        if (!bankId) {
            if (triggerSpan) triggerSpan.textContent = '— Select Beneficiary Bank —';
            return;
        }

        const bank = Storage.getBenefBank(bankId);
        if (bank) {
            if (triggerSpan) triggerSpan.textContent = bank.name;
        }
    }

    function showAddBenefBank() {
        App.showAddBenefBankModal((data) => {
            const saved = Storage.saveBenefBank(data);
            updateBenefBankDropdown();

            const sel = document.getElementById('inv-benef-bank-select');
            if (sel) {
                sel.value = saved.id;
                sel.dispatchEvent(new Event('change'));
            }
            // Close dropdown list
            const wrapper = document.getElementById('inv-benef-bank-custom-options')?.closest('.custom-select-wrapper');
            if (wrapper) {
                wrapper.classList.remove('open');
                const dropdown = wrapper.querySelector('.custom-options');
                if (dropdown) dropdown.style.display = 'none';
            }
            App.showToast(`Bank "${saved.name}" saved!`, 'success');
        });
    }

    function showEditBenefBank() {
        const sel = document.getElementById('inv-benef-bank-select');
        const bankId = sel ? sel.value : '';
        if (!bankId) {
            App.showToast('Please select a Beneficiary Bank to edit first.', 'info');
            return;
        }
        const bank = Storage.getBenefBank(bankId);
        if (!bank) return;

        App.showAddBenefBankModal(bank, (data) => {
            data.id = bank.id;
            const saved = Storage.saveBenefBank(data);
            updateBenefBankDropdown();

            const selectEl = document.getElementById('inv-benef-bank-select');
            if (selectEl) {
                selectEl.value = saved.id;
                selectEl.dispatchEvent(new Event('change'));
            }
            App.showToast(`Bank "${saved.name}" updated!`, 'success');
        });
    }

    function updateBenefBankDropdown() {
        const dropdown = document.getElementById('inv-benef-bank-custom-options');
        if (!dropdown) return;
        const banks = Storage.getAllBenefBanks();
        const selectedVal = document.getElementById('inv-benef-bank-select')?.value || '';

        let html = `<div class="custom-option${selectedVal === '' ? ' selected' : ''}" data-value="">— Select Beneficiary Bank —</div>`;
        banks.forEach(b => {
            html += `<div class="custom-option${b.id === selectedVal ? ' selected' : ''}" data-value="${b.id}">${_escapeAttr(b.name)}</div>`;
        });
        dropdown.innerHTML = html;

        if (!selectedVal) {
            const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
            if (triggerSpan) {
                triggerSpan.textContent = '— Select Beneficiary Bank —';
            }
        } else {
            const matched = banks.find(b => b.id === selectedVal);
            const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
            if (triggerSpan && matched) {
                triggerSpan.textContent = matched.name;
            }
        }
    }

    // --- Domestic (IFSC) bank ---
    function onDomesticBankSelect() {
        const sel = document.getElementById('inv-domestic-bank-select');
        const bankId = sel.value;
        const triggerSpan = document.getElementById('inv-domestic-bank-trigger');
        if (!bankId) {
            if (triggerSpan) triggerSpan.textContent = '— Select Bank —';
            return;
        }
        const bank = Storage.getDomesticBank(bankId);
        if (bank && triggerSpan) triggerSpan.textContent = bank.name;
    }

    function showAddDomesticBank() {
        App.showAddDomesticBankModal((data) => {
            const saved = Storage.saveDomesticBank(data);
            updateDomesticBankDropdown();
            const sel = document.getElementById('inv-domestic-bank-select');
            if (sel) {
                sel.value = saved.id;
                sel.dispatchEvent(new Event('change'));
            }
            const wrapper = document.getElementById('inv-domestic-bank-custom-options')?.closest('.custom-select-wrapper');
            if (wrapper) {
                wrapper.classList.remove('open');
                const dropdown = wrapper.querySelector('.custom-options');
                if (dropdown) dropdown.style.display = 'none';
            }
            App.showToast(`Bank "${saved.name}" saved!`, 'success');
        });
    }

    function showEditDomesticBank() {
        const sel = document.getElementById('inv-domestic-bank-select');
        const bankId = sel ? sel.value : '';
        if (!bankId) {
            App.showToast('Please select a Bank to edit first.', 'info');
            return;
        }
        const bank = Storage.getDomesticBank(bankId);
        if (!bank) return;
        App.showAddDomesticBankModal(bank, (data) => {
            data.id = bank.id;
            const saved = Storage.saveDomesticBank(data);
            updateDomesticBankDropdown();
            const selectEl = document.getElementById('inv-domestic-bank-select');
            if (selectEl) {
                selectEl.value = saved.id;
                selectEl.dispatchEvent(new Event('change'));
            }
            App.showToast(`Bank "${saved.name}" updated!`, 'success');
        });
    }

    function updateDomesticBankDropdown() {
        const dropdown = document.getElementById('inv-domestic-bank-custom-options');
        if (!dropdown) return;
        const banks = Storage.getAllDomesticBanks();
        const selectedVal = document.getElementById('inv-domestic-bank-select')?.value || '';

        let html = `<div class="custom-option${selectedVal === '' ? ' selected' : ''}" data-value="">— Select Bank —</div>`;
        banks.forEach(b => {
            html += `<div class="custom-option${b.id === selectedVal ? ' selected' : ''}" data-value="${b.id}">${_escapeAttr(b.name)}</div>`;
        });
        dropdown.innerHTML = html;

        const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
        if (!selectedVal) {
            if (triggerSpan) triggerSpan.textContent = '— Select Bank —';
        } else {
            const matched = banks.find(b => b.id === selectedVal);
            if (triggerSpan && matched) triggerSpan.textContent = matched.name;
        }
    }

    function onUltBenefSelect() {
        const sel = document.getElementById('inv-ult-benef-select');
        const ultBenefId = sel.value;
        const triggerSpan = document.getElementById('inv-ult-benef-trigger');

        if (!ultBenefId) {
            if (triggerSpan) triggerSpan.textContent = '— Select Ultimate Beneficiary —';
            return;
        }

        const ultBenef = Storage.getUltBenef(ultBenefId);
        if (ultBenef) {
            if (triggerSpan) triggerSpan.textContent = ultBenef.orgName;
        }
    }

    function showAddUltBenef() {
        App.showAddUltBenefModal((data) => {
            const saved = Storage.saveUltBenef(data);
            if (saved.success) {
                updateUltBenefDropdown();

                const sel = document.getElementById('inv-ult-benef-select');
                if (sel) {
                    sel.value = saved.data[saved.data.length - 1].id;
                    sel.dispatchEvent(new Event('change'));
                }
                // Close dropdown list
                const wrapper = document.getElementById('inv-ult-benef-custom-options')?.closest('.custom-select-wrapper');
                if (wrapper) {
                    wrapper.classList.remove('open');
                    const dropdown = wrapper.querySelector('.custom-options');
                    if (dropdown) dropdown.style.display = 'none';
                }
                App.showToast(`Ultimate Beneficiary "${data.orgName}" saved!`, 'success');
            }
        });
    }

    function showEditUltBenef() {
        const sel = document.getElementById('inv-ult-benef-select');
        const ultBenefId = sel ? sel.value : '';
        if (!ultBenefId) {
            App.showToast('Please select an Ultimate Beneficiary to edit first.', 'info');
            return;
        }
        const ultBenef = Storage.getUltBenef(ultBenefId);
        if (!ultBenef) return;

        App.showAddUltBenefModal(ultBenef, (data) => {
            data.id = ultBenef.id;
            const saved = Storage.saveUltBenef(data);
            if (saved.success) {
                updateUltBenefDropdown();

                const selectEl = document.getElementById('inv-ult-benef-select');
                if (selectEl) {
                    selectEl.value = ultBenef.id;
                    selectEl.dispatchEvent(new Event('change'));
                }
                App.showToast(`Ultimate Beneficiary "${data.orgName}" updated!`, 'success');
            }
        });
    }

    function updateUltBenefDropdown() {
        const dropdown = document.getElementById('inv-ult-benef-custom-options');
        if (!dropdown) return;
        const ultBenefs = Storage.getAllUltBenef();
        const selectedVal = document.getElementById('inv-ult-benef-select')?.value || '';

        let html = `<div class="custom-option${selectedVal === '' ? ' selected' : ''}" data-value="">— Select Ultimate Beneficiary —</div>`;
        ultBenefs.forEach(ub => {
            html += `<div class="custom-option${ub.id === selectedVal ? ' selected' : ''}" data-value="${ub.id}">${_escapeAttr(ub.orgName)}</div>`;
        });
        dropdown.innerHTML = html;

        if (!selectedVal) {
            const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
            if (triggerSpan) {
                triggerSpan.textContent = '— Select Ultimate Beneficiary —';
            }
        } else {
            const matched = ultBenefs.find(ub => ub.id === selectedVal);
            const triggerSpan = dropdown.parentElement?.querySelector('.custom-select-trigger span');
            if (triggerSpan && matched) {
                triggerSpan.textContent = matched.orgName;
            }
        }
    }

    function _collectFormData() {
        const items = [];
        document.querySelectorAll('#inv-items-body tr').forEach(row => {
            const spec = row.querySelector('.item-spec')?.value || '';
            const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
            const uom = row.querySelector('.item-uom')?.value || '';
            const rate = parseFloat(row.querySelector('.item-rate')?.value) || 0;
            const amount = FinanceUtils.truncate2(qty * rate); // source of truth — keep saved amount consistent with the total

            const specEmpty = !spec.trim();
            const qtyEmpty = qty === 0;
            const rateEmpty = rate === 0;

            if (specEmpty && qtyEmpty && rateEmpty) return;

            items.push({
                sno: items.length + 1,
                specification: spec,
                qty: qty,
                uom: uom,
                rate: rate,
                amount: amount
            });
        });

        const totalAmount = FinanceUtils.truncate2(items.reduce((s, it) => s + it.amount, 0));

        // Get bank details if selected
        let corrBankData = null;
        const corrBankId = document.getElementById('inv-corr-bank-select')?.value;
        if (corrBankId) {
            corrBankData = Storage.getCorrBank(corrBankId);
        }

        let benefBankData = null;
        const benefBankId = document.getElementById('inv-benef-bank-select')?.value;
        if (benefBankId) {
            benefBankData = Storage.getBenefBank(benefBankId);
        }

        let ultBenefData = null;
        const ultBenefId = document.getElementById('inv-ult-benef-select')?.value;
        if (ultBenefId) {
            ultBenefData = Storage.getUltBenef(ultBenefId);
        }

        let domesticBankData = null;
        const domesticBankId = document.getElementById('inv-domestic-bank-select')?.value;
        if (domesticBankId) {
            domesticBankData = Storage.getDomesticBank(domesticBankId);
        }

        // Universal order metadata (no PO/Job distinction). poDate/poNumber keys are kept
        // for backward compatibility with stored invoices and the PDF renderer.
        const poDate = document.getElementById('inv-order-date')?.value || '';
        const poNumber = document.getElementById('inv-order-ref')?.value || '';
        const shippedVia = document.getElementById('inv-order-shipped-via')?.value || '';
        const projectCode = document.getElementById('inv-project-code')?.value || '';
        const department = document.getElementById('inv-department')?.value || '';
        const terms = document.getElementById('inv-order-terms')?.value || ''; // metadata TERMS column — separate, manual

        const termsAndConditions = [];
        document.querySelectorAll('#inv-terms-list .dynamic-list-item input').forEach(inp => {
            const val = inp.value.trim();
            if (val) termsAndConditions.push(val);
        });

        const milestones = [];
        document.querySelectorAll('#inv-conditions-list .dynamic-list-item textarea').forEach(inp => {
            const val = inp.value.trim();
            if (val) milestones.push(val);
        });

        const settings = _effectiveSettings();
        const clientGst = document.getElementById('inv-client-gst')?.value.trim() || '';
        const fin = FinanceUtils.calculateTotals(totalAmount, settings, clientGst);

        return {
            mode: _invMode,
            refNumber: document.getElementById('inv-ref-number').value.trim(),
            date: document.getElementById('inv-date').value,
            clientName: document.getElementById('inv-client-name').value.trim(),
            clientAddress: document.getElementById('inv-client-address').value.trim(),
            clientGST: document.getElementById('inv-client-gst').value.trim(),
            clientContactPerson: document.getElementById('inv-client-contact-person').value.trim(),
            clientContact: document.getElementById('inv-client-contact').value.trim(),
            clientEmail: document.getElementById('inv-client-email').value.trim(),
            invoiceType: 'po',
            poDate,
            poNumber,
            shippedVia,
            projectCode,
            department,
            terms,
            termsAndConditions,
            milestones,
            items,
            ...fin,
            totalAmount, // Subtotal
            corrBank: corrBankData,
            benefBank: benefBankData,
            ultBenef: ultBenefData,
            domesticBank: domesticBankData,
            currency: getSelectedCurrency(),
            referenceMode: document.getElementById('inv-ref-mode')?.value.trim() || '',
            referenceFileName: _invRefFile ? _invRefFile.fileName : '',
            referenceFilePath: _invRefFile ? _invRefFile.filePath : ''
        };
    }

    async function generate(withPdf = true) {
        const invRefInput = document.getElementById('inv-ref-number');
        if (invRefInput && invRefInput.getAttribute('data-auto-generated') === 'true') {
            const clientNameInput = document.getElementById('inv-client-name');
            const clientName = clientNameInput ? clientNameInput.value.trim() : '';
            const dateInput = document.getElementById('inv-date');
            const dateVal = dateInput ? dateInput.value : _todayISO();

            if (clientName && dateVal) {
                const fy = Storage.getFinancialYear(dateVal);
                const fyShort = Storage.getFinancialYearShort(dateVal);
                const clientCode = Storage.generateClientCode(clientName);

                const invDocType = _invMode === 'international' ? 'INV_INT' : 'INV_DOM';
                const finalSerial = Storage.incrementSerialNumber(invDocType, '', fy);
                // International serials are 3 digits (grow past 999); domestic 4.
                const serialStr = String(finalSerial).padStart(_invMode === 'international' ? 3 : 4, '0');
                invRefInput.value = `${Storage.getOrgInfo().serialPrefix}/${_invMode === 'international' ? 'INT' : ''}${serialStr}/${fyShort}`;
                invRefInput.setAttribute('data-auto-generated', 'false');
            }
        }

        const data = _collectFormData();
        if (!data.refNumber) {
            App.showToast('Please enter Invoice number', 'error');
            return;
        }
        if (!data.date) {
            App.showToast('Please select Invoice Date', 'error');
            return;
        }

        // Reference is optional — a typed reference mode and/or attached file may
        // be supplied, but neither is required.
        if (!data.clientName) {
            App.showToast('Please select or add a client', 'error');
            return;
        }
        if (data.items.length === 0 || !data.items[0].specification) {
            App.showToast('Please add at least one item', 'error');
            return;
        }

        // Warn if this reference number is already used by another document.
        if (!(await App.confirmIfDuplicateRef(data.refNumber, _editingId))) return;

        // Foreign-currency invoices are converted into the home currency (INR)
        // (INR / USD) for our internal records (Sales + Dashboard). Ask for the rate
        // up front; a home-currency invoice needs no conversion (rate is 1:1).
        // Books are kept in INR; foreign-currency invoices are converted at the
        // rate the user supplies (see _promptExchangeRate).
        const homeCur = 'INR';
        if ((data.currency || homeCur) !== homeCur) {
            const savedRate = parseFloat(data.exchangeRate);
            if (_editingId && savedRate > 0) {
                // Editing an existing foreign-currency invoice that already has a
                // saved exchange rate — reuse it silently instead of asking again.
                // (The rate is per-currency, so it stays valid even if items/total
                // were changed.)
                data.exchangeRate = savedRate;
                data.reportValue = data.grandTotal * savedRate;
            } else {
                const rate = await _promptExchangeRate(data.grandTotal, data.currency, homeCur, null);
                if (rate == null) return; // user cancelled — abort generation
                data.exchangeRate = rate;
                data.reportValue = data.grandTotal * rate;
            }
        } else {
            data.exchangeRate = 1;
            data.reportValue = data.grandTotal;
        }

        App.showLoading(withPdf ? 'Generating Invoice PDF...' : 'Saving Invoice...');

        try {
            // Editing: keep the same id so the existing record is overwritten.
            if (_editingId) data.id = _editingId;
            // Save to storage
            Storage.saveInvoice(data);
            _editingId = null;
            // If this invoice was generated from a proforma, remove that proforma
            // now that it has become a real invoice.
            if (_sourceProformaId && Storage.deleteProforma) {
                try { Storage.deleteProforma(_sourceProformaId); } catch (e) { console.warn('Could not remove source proforma', e); }
                _sourceProformaId = null;
            }
            // If generated from a PO Received received PO, mark that PO completed.
            if (_sourceTmId && typeof PoReceived !== 'undefined' && PoReceived.markCompletedFromInvoice) {
                try { PoReceived.markCompletedFromInvoice(_sourceTmId); } catch (e) { console.warn('Could not mark PO completed', e); }
                _sourceTmId = null;
            }
            // Save-only: the record is stored, skip the PDF step entirely.
            if (!withPdf) {
                App.hideLoading();
                App.showToast('Invoice saved successfully!', 'success');
                render();
                showDashboardView();
                App.navigateTo('invoice');
                return;
            }

            // Generate PDF
            const result = await generatePDF(data, false);
            App.hideLoading();

            if (result && result.savedToPath) {
                App.showConfirm(
                    'PDF Saved Successfully',
                    '',
                    () => {
                        render();
                        showDashboardView();
                        App.navigateTo('invoice');
                    },
                    null,
                    true
                );
            } else if (result && result.cancelled) {
                // User chose not to overwrite, do not clear form or show success toast
            } else {
                App.showToast('Invoice generated successfully!', 'success');
                render();
                showDashboardView();
                App.navigateTo('invoice');
            }
        } catch (err) {
            App.hideLoading();
            App.showToast((withPdf ? 'PDF generation failed: ' : 'Save failed: ') + err.message, 'error');
            console.error(err);
        }
    }

    // Save stores the record only; Save & Download also produces the PDF.
    function save() { return generate(false); }
    function saveAndDownload() { return generate(true); }

    async function generatePDF(data, action = 'download', targetWin = null) {
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        let doc = new jsPDF('p', 'mm', 'a4');
        PdfUtils.registerCurrencyFont(doc);
        const pageWidth = 210;
        const margin = 10;
        const contentWidth = pageWidth - 2 * margin;
        let y = 5;

        // Bank layout follows the document mode; org GST in the header follows the
        // GST flag (GST is optional for domestic, and never set for international).
        const isDomestic = data.mode ? (data.mode === 'domestic') : (data.gstEnabled === true);
        // Company GST is mandatory in the header for domestic documents (invoice /
        // proforma) regardless of whether GST tax is itemised; international has none.
        const showOrgGst = isDomestic;
        // A proforma is a byte-for-byte copy of the invoice layout, only the
        // document title and the reference label differ.
        const isProforma = data.isProforma === true;

        // --- Header / Letterhead (logo left, company details right) ---
        const logo = await PdfUtils.getLogoBase64();
        y = PdfUtils.drawLetterhead(doc, logo, pageWidth, margin, y, showOrgGst);

        // --- Slanted Gradient Bar ---
        const greenWidth = contentWidth * 0.82;
        const slantWidth = 4;
        const barH = 2; // bar height, halved from 4 (50% thinner)

        // Orange spans the full width underneath, so the green's slanted right
        // edge always blends into orange — no white seam can appear.
        doc.setFillColor(243, 123, 33);
        doc.rect(margin, y, contentWidth, barH, 'F');

        // Green drawn as a single filled polygon (no internal seam).
        doc.setFillColor(0, 77, 44);
        doc.lines([[greenWidth + slantWidth, 0], [-slantWidth, barH], [-greenWidth, 0]], margin, y, [1, 1], 'F', true);

        y += 12;

        // --- Document Title ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(0, 77, 44);
        let title = isProforma ? 'PROFORMA INVOICE' : (isDomestic ? 'TAX INVOICE' : 'INVOICE');
        doc.text(title, pageWidth / 2, y, { align: 'center' });

        y += 9;

        // --- TO Section (left) and Ref/Date (right) on the same line ---
        const blockTopY = y;

        // Ref No. + Date — right column, top-aligned with TO
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        let metaY = blockTopY;
        if (data.isCreditNote) {
            doc.text(`CN No.: ${data.creditNoteNumber || data.refNumber}`, pageWidth - margin, metaY, { align: 'right' });
            metaY += 5;
        } else {
            doc.text(`${isProforma ? 'Proforma No.' : 'INV No.'}: ${data.refNumber}`, pageWidth - margin, metaY, { align: 'right' });
            metaY += 5;
        }
        doc.text(`Date: ${PdfUtils.formatDateDMY(data.date)}`, pageWidth - margin, metaY, { align: 'right' });

        // TO — left column
        y = blockTopY;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(0, 77, 44);
        doc.text('TO:', margin, y);

        doc.setDrawColor(243, 123, 33);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 1.5, margin + 80, y + 1.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);

        const clientNameLines = doc.splitTextToSize(data.clientName || '', 80);
        doc.text(clientNameLines, margin, y + 6);

        let addrY = y + 6 + (clientNameLines.length * 4.5) + 0.5;
        doc.setFont('helvetica', 'normal');
        const clientAddrLines = [];
        (data.clientAddress || '').split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed) clientAddrLines.push(...doc.splitTextToSize(trimmed, 80));
        });
        clientAddrLines.forEach(line => {
            doc.text(line, margin, addrY);
            addrY += 4.5;
        });
        doc.setFont('helvetica', 'normal');
        if (data.clientContactPerson) {
            doc.text(data.clientContactPerson, margin, addrY);
            addrY += 4.5;
        }
        if (data.clientContact) {
            doc.text(data.clientContact, margin, addrY);
            addrY += 4.5;
        }
        if (data.clientEmail) {
            doc.text(data.clientEmail, margin, addrY);
            addrY += 4.5;
        }
        if (data.clientGST) {
            doc.setFont('helvetica', 'bold');
            doc.text('GST: ' + data.clientGST, margin, addrY);
            addrY += 4.5;
        }

        y = addrY + 2.4;

        // --- Metadata Table ---
        const metaCurrency = data.currency || 'INR';
        let rawMetaCols = [];

        // Universal order metadata. Falls back to legacy job fields for older invoices.
        const orderDateVal = data.poDate || data.jobDate || '';
        const orderRefVal = data.poNumber || data.jobMode || '';
        rawMetaCols = [
            { label: 'ORDER DATE', value: orderDateVal ? PdfUtils.formatDateDMY(orderDateVal) : '', halign: 'center', baseWidth: 35 },
            { label: 'ORDER REFERENCE NUMBER', value: orderRefVal, halign: 'center', baseWidth: 40 },
            { label: 'PROJECT CODE', value: data.projectCode || '', halign: 'center', baseWidth: 30 },
            { label: 'SHIPPED VIA', value: data.shippedVia || '', halign: 'center', baseWidth: 25 },
            { label: 'CURRENCY', value: metaCurrency, halign: 'center', baseWidth: 22 },
            { label: 'TERMS', value: data.terms || '', halign: 'left', baseWidth: 63 }
        ];

        const activeMetaCols = rawMetaCols.filter(col => col.value && col.value.trim());

        if (activeMetaCols.length > 0) {
            const sumMetaWidths = activeMetaCols.reduce((sum, col) => sum + col.baseWidth, 0);
            const metaHead = [activeMetaCols.map(col => col.label)];
            const metaBody = [activeMetaCols.map(col => col.value)];
            const metaColumnStyles = {};
            activeMetaCols.forEach((col, idx) => {
                metaColumnStyles[idx] = {
                    halign: col.halign,
                    cellWidth: (col.baseWidth / sumMetaWidths) * contentWidth
                };
            });

            doc.autoTable({
                startY: y,
                head: metaHead,
                body: metaBody,
                margin: { left: margin, right: margin, bottom: 5 },
                styles: {
                    font: 'helvetica',
                    fontSize: 8,
                    // Vertical padding halved (3 -> 1.2) to reduce row height ~50%;
                    // horizontal padding kept for readability.
                    cellPadding: { top: 1.2, bottom: 1.2, left: 3, right: 3 },
                    lineColor: [200, 200, 200],
                    lineWidth: 0.2,
                    textColor: [51, 51, 51]
                },
                headStyles: {
                    fillColor: [220, 224, 230],
                    textColor: [51, 51, 51],
                    fontStyle: 'bold',
                    halign: 'center',
                    lineWidth: 0.2,
                    lineColor: [200, 200, 200]
                },
                columnStyles: metaColumnStyles,
                theme: 'grid'
            });

            y = doc.lastAutoTable.finalY + 2.4;
        }

        // --- Items Table ---
        const currencyCode = data.currency || 'INR';

        const colVisibility = Storage.getINVColumnVisibility();
        const pdfItems = data.items || [];
        const dataHasUom = pdfItems.some(it => (it.uom || '').trim());
        const dataHasQty = pdfItems.some(it => Number(it.qty) > 0);
        const dataHasRate = pdfItems.some(it => Number(it.rate) > 0);
        const dataHasAmount = dataHasQty && dataHasRate;
        const showQty = dataHasQty && colVisibility.qty !== false;
        const showHours = dataHasUom && colVisibility.hours !== false;
        const showRate = dataHasRate && colVisibility.rate !== false;
        const showTotal = dataHasAmount && colVisibility.total !== false;

        // Determine UNIT RATE header: domestic uses "UNIT RATE (INR)", international uses "UNIT RATE"
        const unitRateHeader = isDomestic ? 'UNIT RATE (INR)' : 'UNIT RATE';

        const colsToInclude = [];
        colsToInclude.push({ id: 'sno', header: 'S.NO', baseWidth: 15, halign: 'center' });
        colsToInclude.push({ id: 'spec', header: 'DETAILED SPECIFICATION', baseWidth: 75, halign: 'left' });
        if (showHours) colsToInclude.push({ id: 'hours', header: 'UOM', baseWidth: 18, halign: 'center' });
        if (showQty) colsToInclude.push({ id: 'qty', header: 'QTY', baseWidth: 15, halign: 'center' });
        if (showRate) colsToInclude.push({ id: 'rate', header: unitRateHeader, baseWidth: 30, halign: 'right' });
        if (showTotal) colsToInclude.push({ id: 'amount', header: 'AMOUNT', baseWidth: 30, halign: 'right' });

        function getINVItemVal(it, colId, idx) {
            if (colId === 'sno') return (it.sno || idx + 1).toString().padStart(2, '0');
            if (colId === 'spec') return it.specification || '';
            if (colId === 'qty') return (it.qty || 0).toString();
            if (colId === 'hours') return it.uom || '';
            if (colId === 'rate') return PdfUtils.formatMoney(it.rate || 0, currencyCode);
            if (colId === 'amount') {
                const lineAmount = (Number(it.qty) || 0) * (Number(it.rate) || 0);
                return PdfUtils.formatMoney(lineAmount, currencyCode);
            }
            return '';
        }

        const activeCols = (PdfUtils.autoAdjustTableColumns
            ? PdfUtils.autoAdjustTableColumns(doc, colsToInclude, data.items || [], getINVItemVal, contentWidth, 9)
            : null) || colsToInclude.map(col => ({
                id: col.id,
                header: col.header,
                width: (col.baseWidth / (colsToInclude.reduce((sum, c) => sum + c.baseWidth, 0) || 1)) * contentWidth,
                halign: col.halign
            }));

        const totalCols = activeCols.length;
        const itemsHead = [activeCols.map(col => col.header)];

        const itemsBody = (data.items || []).map((it, idx) => {
            return activeCols.map(col => getINVItemVal(it, col.id, idx));
        });

        // Derive totals from line items (qty × rate) — never trust a pre-saved sheet total.
        let subtotal = 0;
        const clientGst = data.clientGST || '';
        let gstEnabled = data.gstEnabled !== undefined ? data.gstEnabled : (Storage.getSettings().gstEnabled === true);

        let cgstRate = data.cgstRate;
        let sgstRate = data.sgstRate;
        let igstRate = data.igstRate;
        let cgstAmount = data.cgstAmount;
        let sgstAmount = data.sgstAmount;
        let igstAmount = data.igstAmount;
        let grandTotal = data.grandTotal;
        let isInterState = data.isInterState;

        if (data.isCreditNote) {
            subtotal = data.creditNet !== undefined ? data.creditNet : data.creditAmount;
            grandTotal = data.creditAmount;
            if (gstEnabled && Number(data.creditGst) > 0) {
                if (isInterState) {
                    igstAmount = data.creditGst;
                } else {
                    cgstAmount = data.creditGst / 2;
                    sgstAmount = data.creditGst / 2;
                }
            } else {
                gstEnabled = false;
            }
        } else {
            subtotal = FinanceUtils.truncate2((data.items || []).reduce((s, it) => s + FinanceUtils.truncate2((Number(it.qty) || 0) * (Number(it.rate) || 0)), 0));
            const settings = Storage.getSettings();
            const effSettings = isDomestic ? settings : { ...settings, gstEnabled: false };
            const fin = FinanceUtils.calculateTotals(subtotal, effSettings, clientGst);
            gstEnabled = fin.gstEnabled;
            cgstRate = fin.cgstRate;
            sgstRate = fin.sgstRate;
            igstRate = fin.igstRate;
            cgstAmount = fin.cgstAmount;
            sgstAmount = fin.sgstAmount;
            igstAmount = fin.igstAmount;
            grandTotal = fin.grandTotal;
            isInterState = fin.isInterState;
        }

        // Add gross subtotal if GST is enabled
        if (gstEnabled) {
            itemsBody.push([
                { content: `Sub Total (excl. GST):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                { content: PdfUtils.formatMoney(subtotal, currencyCode), styles: { halign: 'right' } }
            ]);
        }

        // Add tax rows if enabled
        if (gstEnabled) {
            if (isInterState) {
                itemsBody.push([
                    { content: `IGST (${igstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatMoney(igstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
            } else {
                itemsBody.push([
                    { content: `CGST (${cgstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatMoney(cgstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
                itemsBody.push([
                    { content: `SGST (${sgstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatMoney(sgstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
            }
        }

        // Round Off (domestic INR invoices only, when enabled in Visible Columns):
        // round the grand total to the nearest rupee and show the adjustment just
        // above the grand total / amount in words.
        let displayGrand = grandTotal;
        const roundOffOn = colVisibility.roundOff === true && isDomestic && currencyCode === 'INR';
        if (roundOffOn) {
            const ro = PdfUtils.roundOffTotal(grandTotal);
            displayGrand = ro.rounded;
            // Only show the Round Off line when there's an actual adjustment.
            if (ro.delta !== 0) {
                itemsBody.push([
                    { content: `Round Off:`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatRoundOffDelta(ro.delta, currencyCode), styles: { halign: 'right' } }
                ]);
            }
        }

        // Add Grand Total row (only when Total column is visible)
        if (showTotal) {
            itemsBody.push([
                {
                    content: `GRAND TOTAL (${currencyCode}):`,
                    colSpan: totalCols - 1,
                    styles: {
                        halign: 'right',
                        fontStyle: 'bold',
                        fillColor: [240, 240, 240], // Light grey background
                        textColor: [51, 51, 51],     // Standard text color
                        lineColor: [224, 224, 224],  // Standard table border color
                        lineWidth: 0.2
                    }
                },
                {
                    content: PdfUtils.formatMoneyPdf(displayGrand, currencyCode),
                    styles: {
                        halign: 'right',
                        fontStyle: 'bold',
                        // Use the embedded Unicode font when the currency symbol (e.g. ₹)
                        // isn't drawable by jsPDF's built-in fonts.
                        font: PdfUtils.needsCurrencyFont(currencyCode) ? 'Arimo' : 'helvetica',
                        fillColor: [240, 240, 240], // Light grey background
                        textColor: [51, 51, 51],     // Standard text color
                        lineColor: [224, 224, 224],  // Standard table border color
                        lineWidth: 0.2
                    }
                }
            ]);

            // Add Amount in Words row (matches PO / Quotation tables)
            itemsBody.push([
                {
                    content: PdfUtils.amountInWords(displayGrand, currencyCode),
                    colSpan: totalCols,
                    styles: {
                        halign: 'left',
                        fontStyle: 'bold',
                        textColor: [51, 51, 51],
                        lineColor: [224, 224, 224],
                        lineWidth: 0.2
                    }
                }
            ]);
        }

        const columnStyles = {};
        activeCols.forEach((col, idx) => {
            columnStyles[idx] = {
                cellWidth: col.width,
                halign: col.halign
            };
        });

        doc.autoTable({
            startY: y,
            head: itemsHead,
            body: itemsBody,
            margin: { left: margin, right: margin, bottom: 5 },
            styles: {
                // Use the embedded Unicode font for the whole table when the currency
                // symbol (e.g. ₹) isn't drawable by the built-in font — now that the
                // rate/amount/tax cells carry the symbol, they all need it.
                font: PdfUtils.needsCurrencyFont(currencyCode) ? 'Arimo' : 'helvetica',
                fontSize: 9,
                cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
                lineColor: [224, 224, 224],
                lineWidth: 0.2,
                textColor: [51, 51, 51],
                valign: 'top',
                overflow: 'linebreak'
            },
            headStyles: {
                fillColor: [0, 77, 44],
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                lineWidth: 0.2,
                lineColor: [0, 77, 44],
                valign: 'middle'
            },
            alternateRowStyles: {
                fillColor: [249, 249, 249]
            },
            columnStyles: columnStyles,
            didParseCell: (hookData) => {
                if (hookData.section === 'head') {
                    const colStyle = columnStyles[hookData.column.index];
                    if (colStyle && colStyle.halign) {
                        hookData.cell.styles.halign = colStyle.halign;
                    }
                }
            },
            theme: 'grid'
        });

        y = doc.lastAutoTable.finalY + 6;

        // --- Signature box attached to the bottom-right of the items table ---
        // It sits on the right; bank details flow on the left beside/below it so
        // they are never pushed off the page.
        const invSettings = Storage.getSettings();
        const sigOn = colVisibility.signature;
        const sigBoxW = 48;
        let sigBoxBottom = 0;
        // The Sign / Name / Designation box stays only on International documents.
        // Domestic Tax Invoices instead print a heading + signature below all the
        // text (handled after the bank/terms/milestones sections).
        if (sigOn && !isDomestic) {
            const boxX = margin + contentWidth - sigBoxW;
            let by = doc.lastAutoTable.finalY; // attach directly to the table's bottom edge

            doc.setDrawColor(120, 120, 120);
            doc.setLineWidth(0.2);
            doc.setTextColor(51, 51, 51);

            // Sign row (label + signature image) — kept compact
            const signRowH = 9;
            doc.rect(boxX, by, sigBoxW, signRowH);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.text('Sign:', boxX + 2, by + 4);
            if (invSettings.invSignImage) {
                const dims = await PdfUtils.getImageDimensions(invSettings.invSignImage);
                const sigMaxW = sigBoxW - 16;
                const sigMaxH = signRowH - 2.5;
                let sw = sigMaxW;
                let sh = dims ? sigMaxW * (dims.h / dims.w) : sigMaxH;
                if (sh > sigMaxH) { sh = sigMaxH; sw = dims ? sigMaxH * (dims.w / dims.h) : sigMaxW; }
                try {
                    const sig = await PdfUtils.rasterizeForPrint(invSettings.invSignImage, sw, sh);
                    doc.addImage(sig, PdfUtils.getDataUrlFormat(sig), boxX + 12, by + 1.5, sw, sh, undefined, 'FAST');
                } catch (e) { console.warn('Invoice signature image error', e); }
            }
            by += signRowH;

            // Name + Designation rows
            const rowH = 5;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.rect(boxX, by, sigBoxW, rowH);
            doc.text('Name: ' + (invSettings.signName || ''), boxX + 2, by + 3.4);
            by += rowH;
            doc.rect(boxX, by, sigBoxW, rowH);
            doc.text('Designation: ' + (invSettings.signDesignation || ''), boxX + 2, by + 3.4);
            by += rowH;

            sigBoxBottom = by;
            // NOTE: do not push y here — bank details render on the left beside the box.
        }

        // Bank-section underlines stop short of the signature box so they don't cross it
        // (only the International box sits beside the bank section; Domestic prints its
        // signature below everything, so bank lines may run full width there).
        const bankLineRight = margin + contentWidth - ((sigOn && !isDomestic) ? (sigBoxW + 6) : 0);

        function ensureSpace(h) {
            if (y + h > 285) {
                doc.addPage();
                y = 5;
                sigBoxBottom = 0; // Signature box is on the previous page
            }
        }

        // --- Narrations (formerly Terms & Conditions) ---
        // Rendered BETWEEN the items table and the bank details, per the new
        // layout. Bullet-style list, mirrors the visual treatment of the other
        // titled sections on the page.
        if (data.termsAndConditions && data.termsAndConditions.length > 0) {
            ensureSpace(15);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('NARRATIONS', margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, margin + contentWidth, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);
            data.termsAndConditions.forEach(term => {
                const lines = doc.splitTextToSize(term, contentWidth - 6);
                ensureSpace(lines.length * 4 + 2);
                doc.text('•', margin + 2, y);
                lines.forEach(line => {
                    doc.text(line, margin + 6, y);
                    y += 3.8;
                });
                y += 0.5;
            });
            y += 3;
        }

        // --- Domestic bank details (IFSC) ---
        if (isDomestic && data.domesticBank) {
            const db = data.domesticBank;
            ensureSpace(db.orgName ? 28 : 24);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('Bank Details', margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, bankLineRight, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);
            if (db.orgName) {
                doc.text('Organization Name: ' + db.orgName, margin, y);
                y += 4;
            }
            doc.text('Bank Name: ' + (db.name || ''), margin, y);
            y += 4;
            if (db.accountNumber) {
                doc.text('Account Number: ' + db.accountNumber, margin, y);
                y += 4;
            }
            doc.text('IFSC Code: ' + (db.ifscCode || ''), margin, y);
            y += 4;
            if (db.branch) {
                doc.text('Branch: ' + db.branch, margin, y);
                y += 4;
            }
            y += 3;
        }

        // --- Bank Details Sections (International — SWIFT) ---
        if (!isDomestic && data.corrBank) {
            ensureSpace(22);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text("Receiver's Correspondent Bank", margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, bankLineRight, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);

            doc.text('Bank Name: ' + (data.corrBank.name || ''), margin, y);
            y += 4;
            doc.text('Bank Address: ' + (data.corrBank.address || ''), margin, y);
            y += 4;
            doc.text('SWIFT Code: ' + (data.corrBank.swiftCode || ''), margin, y);
            y += 4;
            if (data.corrBank.accountNumber) {
                doc.text('Account Number: ' + data.corrBank.accountNumber, margin, y);
                y += 4;
            }
            y += 3;
        }

        if (!isDomestic && data.benefBank) {
            ensureSpace(22);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('Beneficiary Bank', margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, bankLineRight, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);

            doc.text('Bank Name: ' + (data.benefBank.name || ''), margin, y);
            y += 4;
            doc.text('Bank Address: ' + (data.benefBank.address || ''), margin, y);
            y += 4;
            doc.text('SWIFT Code: ' + (data.benefBank.swiftCode || ''), margin, y);
            y += 4;
            if (data.benefBank.accountNumber) {
                doc.text('Account Number: ' + data.benefBank.accountNumber, margin, y);
                y += 4;
            }
            y += 3;
        }

        if (!isDomestic && data.ultBenef) {
            ensureSpace(26);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('Ultimate Beneficiary', margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, bankLineRight, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);

            doc.text('Org Name: ' + (data.ultBenef.orgName || ''), margin, y);
            y += 4;
            doc.text('Bank Name: ' + (data.ultBenef.bankName || ''), margin, y);
            y += 4;
            doc.text('Bank Address: ' + (data.ultBenef.bankAddress || ''), margin, y);
            y += 4;
            doc.text('SWIFT Code: ' + (data.ultBenef.swiftCode || ''), margin, y);
            y += 4;
            if (data.ultBenef.accountNumber) {
                doc.text('Account Number: ' + data.ultBenef.accountNumber, margin, y);
                y += 4;
            }
            y += 3;
        }

        // Make sure anything after the bank details clears the signature box on the right
        if (sigOn && !isDomestic) y = Math.max(y, sigBoxBottom + 6);

        // (Terms & Conditions block was moved above, between the items table and
        // the bank details, and renamed "NARRATIONS".)

        // --- Milestones ---
        if (data.milestones && data.milestones.length > 0) {
            ensureSpace(15);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('MILESTONES', margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, margin + contentWidth, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);
            data.milestones.forEach(milestone => {
                const lines = doc.splitTextToSize(milestone, contentWidth - 6);
                ensureSpace(lines.length * 4 + 2);
                doc.text('•', margin + 2, y);
                lines.forEach(line => {
                    doc.text(line, margin + 6, y);
                    y += 3.8;
                });
                y += 0.5;
            });
            y += 3;
        }

        // --- Domestic Tax Invoice signature (heading + signature only, bottom-right) ---
        // International documents use the Sign/Name/Designation box attached to the table
        // above; domestic prints the fixed company heading and a signature below all text.
        // The heading is fixed and always shown; only the signature image follows the
        // Signature toggle.
        if (isDomestic) {
            const headingText = 'For ' + (PdfUtils.activeCompany().name || '');
            const rightEdge = margin + contentWidth;
            const maxW = 45;
            const showSig = sigOn && invSettings.invSignImageDom;
            let imgW = 0, imgH = 0;
            if (showSig) {
                const dims = await PdfUtils.getImageDimensions(invSettings.invSignImageDom);
                imgW = maxW;
                imgH = dims ? maxW * (dims.h / dims.w) : 22;
            }
            ensureSpace(6 + (showSig ? imgH : 16) + 8);
            y += 4;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(51, 51, 51);
            doc.text(headingText, rightEdge, y, { align: 'right' });
            y += 2;
            if (showSig) {
                try {
                    const sig = await PdfUtils.rasterizeForPrint(invSettings.invSignImageDom, imgW, imgH);
                    doc.addImage(sig, PdfUtils.getDataUrlFormat(sig), rightEdge - imgW, y, imgW, imgH, undefined, 'FAST');
                } catch (e) { console.warn('Domestic invoice signature image error', e); }
                y += imgH;
            } else {
                // No signature image — print " - SD " placeholder centered over "Authorized signatory".
                // Equal spacing: 8mm above SD (2+6), 8mm below SD (4+4).
                y += 6;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                const authSignW = doc.getTextWidth('Authorized signatory');
                const authSignCenter = rightEdge - authSignW / 2;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(51, 51, 51);
                doc.text(' - SD ', authSignCenter, y, { align: 'center' });
                y += 4;
            }
            // Fixed "Authorized signatory" caption below the sign/stamp space.
            y += 4;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(90, 90, 90);
            doc.text('Authorized signatory', rightEdge, y, { align: 'right' });
            y += 3;
        }

        // Flatten to an image-based PDF (so text can't be copied) ONLY for the file
        // that leaves the app — download/save/email. The on-screen preview is shown
        // to the signed-in user who already owns this data, so it skips the costly
        // full-page rasterization and opens instantly.
        if (action !== 'view') {
            doc = await PdfUtils.flattenToImagePdf(doc);
        }

        // --- Output Action ---
        if (action === 'view') {
            let refToUse = data.isCreditNote ? (data.creditNoteNumber || data.refNumber) : data.refNumber;
            PdfUtils.openPdfPreview(doc, targetWin, `${refToUse} Preview`);
            return;
        } else {
            let refToUse = data.isCreditNote ? (data.creditNoteNumber || data.refNumber) : data.refNumber;
            let filename = `${refToUse.replace(/[\/\\]/g, '_')}.pdf`;

            const userPaths = Storage.getUserPaths();
            const invPath = (data.mode || _invMode) === 'domestic'
                ? userPaths.invSavePathDom
                : userPaths.invSavePathIntl;
            // Always send to the server so the PDF is archived to cloud object
            // storage; a local copy is also written when a save path is configured.
            {
                try {
                    const pdfBase64 = doc.output('datauristring');
                    const response = await fetch('/api/save-pdf', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'same-origin',
                        body: JSON.stringify({
                            pdf_data: pdfBase64,
                            filename: filename,
                            save_path: invPath || ''
                        })
                    });
                    let finalResponse = response;
                    let resData = await response.json();
                    if (response.ok && resData.exists) {
                        App.hideLoading();
                        const overwrite = await new Promise(resolve => {
                            App.showConfirm(
                                'Warning',
                                'Do you want to re-download?',
                                () => resolve(true),
                                () => resolve(false)
                            );
                        });
                        if (!overwrite) {
                            return { cancelled: true };
                        }

                        App.showLoading('Generating Invoice PDF...');
                        const response2 = await fetch('/api/save-pdf', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'same-origin',
                            body: JSON.stringify({
                                pdf_data: pdfBase64,
                                filename: filename,
                                save_path: invPath || '',
                                overwrite: true
                            })
                        });
                        resData = await response2.json();
                        finalResponse = response2;
                    }

                    if (finalResponse.ok && resData.success) {
                        // Saved to a local folder → done. Cloud-only → fall through
                        // so the user still gets the PDF via browser download.
                        if (resData.savedToPath) return { savedToPath: resData.savedToPath };
                    } else {
                        throw new Error(resData.error || 'Server error');
                    }
                } catch (err) {
                    console.error('Failed to save PDF on the server, falling back to browser download:', err);
                    App.showToast('Could not auto-save: ' + err.message + '. Falling back to browser download.', 'error');
                }
            }

            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{
                            description: 'PDF Document',
                            accept: {
                                'application/pdf': ['.pdf'],
                            },
                        }],
                    });
                    const writable = await handle.createWritable();
                    const pdfOutput = doc.output('arraybuffer');
                    await writable.write(pdfOutput);
                    await writable.close();
                    return { downloaded: true };
                } catch (err) {
                    if (err.name === 'AbortError') {
                        return; // user cancelled
                    }
                    console.warn('showSaveFilePicker failed, falling back to prompt & doc.save', err);
                }
            }

            // Reliable browser download — doc.save() works in every browser. We no
            // longer call prompt() (unsupported/blocked in some browsers, which made
            // the download fail) and don't depend on showSaveFilePicker.
            doc.save(filename);
            return { downloaded: true };
        }
    }


    // --- Reference file upload ---
    function triggerRefFileUpload() {
        const inp = document.getElementById('inv-ref-file-input');
        if (inp) inp.click();
    }

    function _readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async function handleRefFileUpload(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const link = document.getElementById('inv-ref-file-link');
        const indicator = document.getElementById('inv-ref-file-indicator');
        try {
            if (link) link.textContent = 'Uploading… ' + file.name;
            if (indicator) indicator.style.display = 'block';

            const fileBase64 = await _readFileAsBase64(file);
            const resp = await fetch('/api/upload-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ file_data: fileBase64, filename: file.name, upload_path: Storage.getUserPaths().uploadSavePath || '' })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || 'Upload failed');
            }
            const result = await resp.json();
            _invRefFile = { fileName: result.filename, filePath: result.path };
            if (link) {
                link.textContent = result.filename;
                link.setAttribute('title', 'View attached file');
            }
            const btn = document.getElementById('inv-ref-file-btn');
            if (btn) btn.style.display = 'none';
            input.value = '';
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Reference file attached', 'success');
            Storage.logActivity('user_action', `Uploaded invoice reference file: ${result.filename}`);
        } catch (e) {
            console.error('Reference file upload failed:', e);
            if (_invRefFile && _invRefFile.fileName) {
                if (link) link.textContent = _invRefFile.fileName;
            } else {
                if (indicator) indicator.style.display = 'none';
            }
            input.value = '';
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Upload failed: ' + e.message, 'error');
        }
    }

    function viewRefFile() {
        if (_invRefFile && _invRefFile.filePath) {
            window.open(_invRefFile.filePath, '_blank');
        }
    }

    function removeRefFile() {
        _invRefFile = null;
        const indicator = document.getElementById('inv-ref-file-indicator');
        if (indicator) indicator.style.display = 'none';
        const link = document.getElementById('inv-ref-file-link');
        if (link) link.textContent = '';
        const input = document.getElementById('inv-ref-file-input');
        if (input) input.value = '';
        const btn = document.getElementById('inv-ref-file-btn');
        if (btn) btn.style.display = '';
        if (typeof App !== 'undefined' && App.showToast) App.showToast('Reference file removed', 'success');
    }

    function _tryAutoFillFromPoReceived(ref) {
        if (!ref) return;
        if (typeof Storage === 'undefined' || !Storage.getAllTMs) return;

        // Do NOT auto-fill if we are editing an existing saved invoice — that would
        // overwrite the user's saved data with the PO's data just because the order
        // reference number happens to match a PO Received document.
        if (_editingId) return;

        // Also skip if the invoice already has meaningful content (client name or
        // at least one non-empty item row) so that a user who filled in their own
        // details first does not lose them by typing the order ref number last.
        const clientNameEl = document.getElementById('inv-client-name');
        if (clientNameEl && clientNameEl.value.trim()) return;

        const firstItemSpec = document.querySelector('#inv-items-body tr .item-spec');
        if (firstItemSpec && firstItemSpec.value.trim()) return;

        const match = Storage.getAllTMs().find(tm =>
            tm && tm.details && (tm.details.poNumber || '').trim().toLowerCase() === ref.toLowerCase()
        );
        if (!match) return;

        applyImportedDetails(match.details);

        // Carry the collection's uploaded file over as the invoice's reference
        // file so it can be viewed from the dashboard after the invoice is saved.
        _invRefFile = (match.filePath)
            ? { fileName: match.fileName || '', filePath: match.filePath }
            : null;

        // Keep Reference text field empty so user can fill manually
        const refModeInput = document.getElementById('inv-ref-mode');
        if (refModeInput) {
            refModeInput.value = '';
        }

        const indicator = document.getElementById('inv-ref-file-indicator');
        const link = document.getElementById('inv-ref-file-link');
        if (indicator && link) {
            if (_invRefFile) {
                link.textContent = _invRefFile.fileName || 'Attached File';
                link.setAttribute('title', 'View attached file');
                indicator.style.display = 'block';
            } else {
                indicator.style.display = 'none';
                link.textContent = '';
            }
        }

        // Refresh the auto-generated invoice number now that client/date/mode changed
        // (no-op when the user typed their own number).
        updateAutoRefNumber();

        if (typeof App !== 'undefined' && App.showToast) {
            App.showToast('Details auto-filled from uploaded document: ' + (match.fileName || ''), 'success');
        }
    }

    function applyImportedDetails(d) {
        if (!d) return;
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };

        // Adopt the document mode (Domestic / International) from the PO Received record,
        // or infer it from the reference number. Done first so item rows pick up the
        // correct currency set.
        const importedMode = (d.mode === 'domestic' || d.mode === 'international')
            ? d.mode
            : _modeFromRef(d.refNumber);
        if (importedMode) setMode(importedMode);

        if (d.date) setVal('inv-date', d.date);

        // Client details — switch to manual entry and reveal the fields
        const fieldsDiv = document.getElementById('inv-client-fields');
        if (fieldsDiv) fieldsDiv.style.display = 'block';
        setVal('inv-client-name', d.clientName);
        setVal('inv-client-gst', d.clientGST);
        setVal('inv-client-address', d.clientAddress);
        setVal('inv-client-contact-person', d.clientContactPerson);
        setVal('inv-client-contact', d.clientContact);
        setVal('inv-client-email', d.clientEmail);

        // Universal order metadata fields.
        // The "Terms" metadata field (TERMS column) is separate and manual — only a plain
        // string belongs here. PO Received stores its "Terms & Conditions" as an ARRAY in
        // d.terms, which must flow into the Terms & Conditions list below, not this field.
        const metaTerms = (typeof d.terms === 'string') ? d.terms : '';
        setVal('inv-order-date', d.poDate || d.jobDate || '');
        setVal('inv-order-ref', d.poNumber || d.jobMode || '');
        setVal('inv-order-shipped-via', d.shippedVia);
        setVal('inv-project-code', d.projectCode);
        _applyDepartment(d.department);
        setVal('inv-order-terms', metaTerms);

        // Items
        const tbody = document.getElementById('inv-items-body');
        if (tbody) tbody.innerHTML = '';
        itemCount = 0;
        if (d.items && d.items.length > 0) {
            d.items.forEach(it => addItem(it));
        } else {
            addItem();
        }

        // Currency
        if (d.currency) {
            const dummy = document.createElement('input');
            dummy.value = d.currency;
            handleCurrencyChange(dummy);
        }

        // Auto-fill banks
        if (d.corrBankId) {
            const sel = document.getElementById('inv-corr-bank-select');
            if (sel) {
                sel.value = d.corrBankId;
                sel.dispatchEvent(new Event('change'));
            }
        } else {
            const sel = document.getElementById('inv-corr-bank-select');
            if (sel) {
                sel.value = '';
                sel.dispatchEvent(new Event('change'));
            }
        }

        if (d.benefBankId) {
            const sel = document.getElementById('inv-benef-bank-select');
            if (sel) {
                sel.value = d.benefBankId;
                sel.dispatchEvent(new Event('change'));
            }
        } else {
            const sel = document.getElementById('inv-benef-bank-select');
            if (sel) {
                sel.value = '';
                sel.dispatchEvent(new Event('change'));
            }
        }

        if (d.ultBenefId) {
            const sel = document.getElementById('inv-ult-benef-select');
            if (sel) {
                sel.value = d.ultBenefId;
                sel.dispatchEvent(new Event('change'));
            }
        } else {
            const sel = document.getElementById('inv-ult-benef-select');
            if (sel) {
                sel.value = '';
                sel.dispatchEvent(new Event('change'));
            }
        }

        // Terms & Conditions (autofill) — PO Received's "Terms & Conditions" array (d.terms)
        // or a saved invoice's termsAndConditions list. All entries go into this list.
        const invTermsList = document.getElementById('inv-terms-list');
        if (invTermsList) invTermsList.innerHTML = '';
        invoiceTermCount = 0;
        let termsToLoad = [];
        if (d.termsAndConditions && d.termsAndConditions.length > 0) {
            termsToLoad = d.termsAndConditions;
        } else if (Array.isArray(d.terms)) {
            termsToLoad = d.terms;
        }
        if (termsToLoad.length > 0) {
            termsToLoad.forEach(t => addTerm(t));
        } else {
            addTerm();
        }

        // Milestones (autofill)
        const invMilestonesList = document.getElementById('inv-conditions-list');
        if (invMilestonesList) invMilestonesList.innerHTML = '';
        invoiceConditionCount = 0;
        const milestonesToLoad = (d.milestones && d.milestones.length > 0) ? d.milestones : (d.conditions || []);
        if (Array.isArray(milestonesToLoad) && milestonesToLoad.length > 0) {
            milestonesToLoad.forEach(m => addCondition(m));
        } else if (typeof milestonesToLoad === 'string' && milestonesToLoad.trim()) {
            addCondition(milestonesToLoad);
        } else {
            addCondition();
        }

        recalcTax();
    }

    // Links the in-progress invoice to a source proforma so it is removed from the
    // Proforma dashboard once this invoice is generated. Call right after render().
    function setSourceProforma(id) { _sourceProformaId = id || null; }

    return {
        render,
        generate,
        generatePDF,
        setSourceProforma,
        // Reads the current invoice form into a data object (used by the Proforma
        // popup, which hosts this same form and saves the result as a proforma).
        collectData: _collectFormData,
        applyImportedDetails,
        handleCurrencyChange,
        toggleMetadataFields,
        save, saveAndDownload,
        onClientSelect,
        showAddClient,
        hideAddClient,
        saveNewClient,
        updateClientDropdown,
        updateAutoRefNumber,
        recalcTax,
        addItem,
        removeItem,
        calcRow,
        onCorrBankSelect,
        showAddCorrBank,
        showEditCorrBank,
        updateCorrBankDropdown,
        onBenefBankSelect,
        showAddBenefBank,
        showEditBenefBank,
        updateBenefBankDropdown,
        onUltBenefSelect,
        showAddUltBenef,
        showEditUltBenef,
        updateUltBenefDropdown,
        setMode,
        onDomesticBankSelect,
        showAddDomesticBank,
        showEditDomesticBank,
        updateDomesticBankDropdown,
        addTerm,
        removeTerm,
        addCondition,
        removeCondition,
        triggerRefFileUpload,
        handleRefFileUpload,
        viewRefFile,
        removeRefFile,
        // Dashboard & Modal exports
        isFormActive,
        resetToDashboard,
        showDashboardView,
        ensureTypeModal,
        openTypeModal,
        closeTypeModal,
        selectTypeAndCreate,
        showCreateView,
        showEditView,
        toggleDashFilters,
        downloadDashReport,
        applyDashFilters,
        resetDashFilters,
        changeDashPage,
        changeDashPageSize,
        deleteINVDash,
        renderDashboard
    };
})();
