/* ============================================
   Quotation Module — form + PDF generation
   ============================================ */

const Quotation = (() => {
    const COMPANY = PdfUtils.COMPANY;

    // Client type (domestic/international) chosen in the Add Client modal
    let _quPendingClientType = 'domestic';

    // Quotation mode: 'domestic' or 'international'. Chosen from the Quotation nav
    // dropdown. Clients are partitioned by this mode (a domestic quotation only
    // sees domestic clients, etc.) and international quotations carry no GST.
    let _quMode = 'domestic';

    // When editing an existing quotation, holds its id so save overwrites the same
    // record (same ref number). null = new document (or a revision).
    let _editingId = null;

    // Reporting departments (reference only — not printed on the PDF).
    const DEPARTMENTS = ['Engineering', 'Consulting', 'Projects', 'Support'];

    // Department custom-select markup (blank = none). Behaviour is handled by the
    // shared custom-select click handler in app.js.
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
                <input type="hidden" id="qu-department" value="${_escapeAttr(sel)}">
            </div>`;
    }

    // Clients are kept separate per mode. A client's clientType tags it as
    // 'domestic' or 'international'; untagged (legacy) clients count as domestic.
    function _quClientsForMode() {
        return Storage.getAllVendors().filter(c => (c.clientType || 'domestic') === _quMode);
    }

    // Settings adjusted for the active mode — international quotations never carry GST.
    function _quEffectiveSettings() {
        const s = Storage.getSettings();
        if (_quMode === 'international') return { ...s, gstEnabled: false };
        return s;
    }

    // Reflect the active mode across the quotation UI: page heading, client GST field,
    // and the GST toggle in the Visible Columns menu. International = no GST anywhere.
    function _applyQuModeUI() {
        const isIntl = _quMode === 'international';

        const title = document.getElementById('qu-page-title');
        const subtitle = document.getElementById('qu-page-subtitle');
        if (title) title.textContent = isIntl ? 'International Quotation' : 'Domestic Quotation';
        if (subtitle) subtitle.textContent = isIntl
            ? 'Create and generate a new international quotation'
            : 'Create and generate a new domestic quotation';

        // International clients have no GST — hide the client GST field and clear it.
        const gstGroup = document.getElementById('qu-client-gst-group');
        if (gstGroup) gstGroup.style.display = isIntl ? 'none' : '';
        if (isIntl) {
            const gst = document.getElementById('qu-client-gst');
            if (gst) gst.value = '';
        }

        // Hide the GST toggle in the Visible Columns dropdown for international.
        const gstBlock = document.getElementById('qu-gst-tax-block');
        if (gstBlock) gstBlock.style.display = isIntl ? 'none' : '';
    }

    const CURRENCY_MAP = PdfUtils.CURRENCY_MAP;
    const DOMESTIC_CURRENCIES = ['INR'];

    function _currenciesForMode() {
        return _quMode === 'domestic' ? DOMESTIC_CURRENCIES : Object.keys(PdfUtils.CURRENCY_MAP).filter(c => c !== 'INR');
    }

    const DEFAULT_TERMS = [
        'Above mentioned price is exclusive of GST @18%.',
        'Any changes in scope of work will attract additional charges.',
        '30% advance payment along with PO.',
        '60% on delivery.',
        '10% on final acceptance.',
        'Quote valid for 30 days from the date.'
    ];

    // Quotation Dashboard State
    let _currentView = 'dashboard';
    let _dashSearch = '';
    let _dashType = '';
    let _dashMonth = '';
    let _dashFy = '';
    let _dashDept = '';
    let _dashPage = 1;
    let _dashPageSize = 10;
    let _dashFiltersVisible = false;

    function resetToDashboard() {
        _currentView = 'dashboard';
    }

    function isFormActive() {
        return _currentView === 'form';
    }

    function showDashboardView() {
        _currentView = 'dashboard';
        const dashView = document.getElementById('qu-dashboard-view');
        const formView = document.getElementById('qu-form-view');
        if (dashView) dashView.style.display = 'block';
        if (formView) formView.style.display = 'none';
        renderDashboard();
    }

    function ensureTypeModal() {
        let modal = document.getElementById('quotation-type-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'quotation-type-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.45); z-index: 25000; align-items: center; justify-content: center; backdrop-filter: blur(8px);';
        modal.onclick = function(e) {
            if (e.target === modal) closeTypeModal();
        };
        modal.innerHTML = `
        <div class="modal-card"
            style="background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 20px; padding: 32px 28px; width: 520px; max-width: 95vw; box-shadow: 0 25px 60px rgba(15, 23, 42, 0.2); text-align: center; font-family: 'Inter', -apple-system, sans-serif; position: relative; animation: modalPopIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);">
            <button type="button" onclick="Quotation.closeTypeModal()"
                style="position: absolute; top: 16px; right: 16px; background: #f1f5f9; border: none; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: #64748b; cursor: pointer; transition: all 0.2s ease;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 14px; background: rgba(22, 101, 52, 0.1); color: #166534; margin-bottom: 12px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="12" y1="18" x2="12" y2="12"></line>
                    <line x1="9" y1="15" x2="15" y2="15"></line>
                </svg>
            </div>
            <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0;">Create Quotation</h2>
            <p style="font-size: 13.5px; color: #64748b; margin: 0 0 24px 0;">Select the quotation format to proceed with tailored pricing and terms</p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 4px;">
                <div class="qu-type-card qu-type-card-dom" onclick="Quotation.selectTypeAndCreate('domestic')"
                    style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 22px 16px; cursor: pointer; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; position: relative;">
                    <div style="position: absolute; top: 10px; right: 10px; background: rgba(22, 101, 52, 0.08); color: #166534; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; letter-spacing: 0.3px;">INR</div>
                    <div>
                        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">Domestic Quotation</h3>
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
                <div class="qu-type-card qu-type-card-intl" onclick="Quotation.selectTypeAndCreate('international')"
                    style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 16px; padding: 22px 16px; cursor: pointer; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; position: relative;">
                    <div style="position: absolute; top: 10px; right: 10px; background: rgba(30, 64, 175, 0.08); color: #1e40af; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; letter-spacing: 0.3px;">GLOBAL</div>
                    <div>
                        <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">International Quotation</h3>
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
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    function closeTypeModal() {
        const modal = document.getElementById('quotation-type-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function selectTypeAndCreate(mode) {
        closeTypeModal();
        showCreateView(mode);
    }

    function showCreateView(mode = 'domestic') {
        _currentView = 'form';
        _quMode = (mode === 'international') ? 'international' : 'domestic';
        const dashView = document.getElementById('qu-dashboard-view');
        const formView = document.getElementById('qu-form-view');
        if (dashView) dashView.style.display = 'none';
        if (formView) formView.style.display = 'block';
        const isIntl = _quMode === 'international';
        const titleEl = document.getElementById('qu-page-title');
        const subEl = document.getElementById('qu-page-subtitle');
        if (titleEl) titleEl.textContent = isIntl ? 'International Quotation' : 'Domestic Quotation';
        if (subEl) subEl.textContent = isIntl
            ? 'Create and generate a new international quotation'
            : 'Create and generate a new domestic quotation';
        render(null, _quMode);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showEditView(quIdOrData) {
        const data = typeof quIdOrData === 'string' ? Storage.getQuotation(quIdOrData) : quIdOrData;
        _currentView = 'form';
        const dashView = document.getElementById('qu-dashboard-view');
        const formView = document.getElementById('qu-form-view');
        if (dashView) dashView.style.display = 'none';
        if (formView) formView.style.display = 'block';
        const titleEl = document.getElementById('qu-page-title');
        const subEl = document.getElementById('qu-page-subtitle');
        const refNo = data ? (data.refNumber || '') : '';
        if (titleEl) titleEl.textContent = refNo ? `Edit Quotation — ${refNo}` : 'Edit Quotation';
        if (subEl) subEl.textContent = 'Modify and regenerate this Quotation';
        render(data);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function toggleDashFilters() {
        _dashFiltersVisible = !_dashFiltersVisible;
        const el = document.getElementById('qu-dash-filters-wrapper');
        if (el) el.style.display = _dashFiltersVisible ? 'block' : 'none';
        const btn = document.getElementById('btn-qu-dash-filter-toggle');
        if (btn) btn.classList.toggle('active', _dashFiltersVisible);
    }

    function applyDashFilters() {
        const searchInput = document.getElementById('qu-dash-filter-search');
        const typeInput = document.getElementById('qu-dash-filter-type');
        const monthInput = document.getElementById('qu-dash-filter-month');
        const fyInput = document.getElementById('qu-dash-filter-fy');
        const deptInput = document.getElementById('qu-dash-filter-dept');

        if (searchInput) _dashSearch = searchInput.value || '';
        if (typeInput) _dashType = typeInput.value || '';
        if (monthInput) _dashMonth = monthInput.value || '';
        if (fyInput) _dashFy = fyInput.value || '';
        if (deptInput) _dashDept = deptInput.value || '';

        _dashPage = 1;
        renderDashboard();
    }

    function resetDashFilters() {
        Dashboard.clientSelection('qu').clear();
        _dashSearch = '';
        _dashType = '';
        _dashMonth = '';
        _dashFy = '';
        _dashDept = '';
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

    function deleteQUDash(id) {
        Dashboard.deleteDoc('QU', id, renderDashboard);
    }

    function renderDashboard() {
        const container = document.getElementById('qu-dashboard-content');
        if (!container) return;

        const docs = Storage.getAllQuotations();
        Dashboard.registerClientFilter('qu', () => docs, () => { _dashPage = 1; renderDashboard(); });

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
        const typeLabel = _dashType === 'domestic' ? 'Domestic' : (_dashType === 'international' ? 'International' : 'All Types');

        // 3. Filter data
        const clientSel = Dashboard.clientSelection('qu');
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
            return true;
        });

        filtered.sort(Dashboard.compareBySerial);

        const totalFiltered = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / _dashPageSize));
        if (_dashPage > totalPages) _dashPage = totalPages;
        if (_dashPage < 1) _dashPage = 1;
        const startIdx = (_dashPage - 1) * _dashPageSize;
        const pageDocs = filtered.slice(startIdx, startIdx + _dashPageSize);

        const hasActiveFilters = !!(_dashSearch || _dashType || clientSel.size || _dashMonth || _dashFy || _dashDept);

        // 4. Build Table Rows
        let rowsHtml = pageDocs.map(doc => {
            const docNo = doc.refNumber || '-';
            const dateStr = doc.date ? PdfUtils.formatDateDMY(doc.date) : '-';
            const client = doc.clientName || '-';
            const dept = doc.department || '—';
            const mode = doc.mode || 'domestic';
            const isDomestic = mode === 'domestic';
            const cur = doc.currency || (isDomestic ? 'INR' : 'USD');
            const amtVal = (doc.grandTotal !== undefined && doc.grandTotal !== null && doc.grandTotal !== '') 
                ? doc.grandTotal 
                : doc.totalAmount;
            const hasAmt = (amtVal !== undefined && amtVal !== null && amtVal !== '');
            const curSym = PdfUtils.currencySymbol(cur);
            const valStr = hasAmt ? `${curSym} ${PdfUtils.formatCurrency(amtVal, cur)}` : '—';
            const hasRef = !!doc.referenceFilePath;
            const isCompleted = doc.status === 'completed' || !doc.status;

            return `
                <tr>
                    <td style="font-weight: 600; text-align: left;">
                        <a href="javascript:void(0)" onclick="Dashboard.viewPdf('QU','${doc.id}')" style="color: #166534; text-decoration: none; font-weight: 700; border-bottom: 1px dashed rgba(22,101,52,0.4);" title="Click to view PDF">
                            ${_escapeHtml(docNo)}
                        </a>
                    </td>
                    <td style="white-space: nowrap; color: #52525b; text-align: left;">${dateStr}</td>
                    <td style="font-weight: 500; color: #27272a; text-align: left;">${_escapeHtml(client)}</td>
                    <td style="white-space: nowrap; text-align: left;">
                        <span class="${isDomestic ? 'badge-qu-dom' : 'badge-qu-intl'}">
                            ${isDomestic ? 'Domestic' : 'International'}
                        </span>
                    </td>
                    <td style="text-align: left;">
                        <span style="display: inline-block; padding: 2px 9px; border-radius: 6px; font-size: 11.5px; font-weight: 600; background: rgba(0,0,0,0.05); color: #52525b;">
                            ${_escapeHtml(dept)}
                        </span>
                    </td>
                    <td style="font-weight: 700; color: #18181b; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums;">${valStr}</td>
                    <td style="text-align: center; white-space: nowrap;">
                        <span style="display: inline-block; padding: 3px 11px; border-radius: 999px; font-size: 11.5px; font-weight: 700; color: ${isCompleted ? '#166534' : '#b45309'}; background: ${isCompleted ? 'rgba(22,101,52,0.12)' : 'rgba(180,83,9,0.12)'};">
                            ${isCompleted ? 'Issued' : 'Pending'}
                        </span>
                    </td>
                    <td style="text-align: center; white-space: nowrap; width: 110px;">
                        <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            <button type="button" class="btn-icon-action" onclick="Dashboard.viewPdf('QU','${doc.id}')" title="View PDF" aria-label="View PDF" style="padding: 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); background: #fff; cursor: pointer; color: #166534; display: inline-flex; align-items: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button type="button" class="btn-icon-action" onclick="Dashboard.downloadPdf('QU','${doc.id}')" title="Download PDF" aria-label="Download PDF" style="padding: 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); background: #fff; cursor: pointer; color: #2563eb; display: inline-flex; align-items: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </button>
                            <button type="button" class="btn-row-actions" onclick="Dashboard.toggleRowMenu(event,'QU','${doc.id}',${hasRef})" title="More Actions" aria-label="More Actions">⋮</button>
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
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            </div>
                            <div style="font-size: 15px; font-weight: 600; color: #18181b;">${docs.length === 0 ? 'No Quotations issued yet' : 'No Quotations match your filters'}</div>
                            <p style="margin: 0; font-size: 13px; color: #71717a; max-width: 420px;">
                                ${docs.length === 0 ? 'Click "Create Quotation" above to issue your first quotation.' : 'Try changing your search terms or clearing active filters to see all quotations.'}
                            </p>
                            ${hasActiveFilters ? `
                            <button type="button" class="btn btn-secondary" onclick="Quotation.resetDashFilters()" style="padding: 6px 14px; font-size: 12.5px; margin-top: 6px;">
                                Clear Filters
                            </button>
                            ` : `
                            <div style="display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center;">
                                <button type="button" class="btn btn-primary btn-create-po-dash" onclick="Quotation.openTypeModal()" style="padding: 9px 20px; font-size: 13.5px; font-weight: 600; background: #166534; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; color: #fff;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                    <span>Create Quotation</span>
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
                page: _dashPage, pageSize: _dashPageSize, total: totalFiltered, noun: 'quotations',
                onPage: 'Quotation.changeDashPage', onSize: 'Quotation.changeDashPageSize'
            });
        }

        // 6. Assemble HTML
        container.innerHTML = `
            <!-- Table Card Section -->
            <div class="recent-section" style="background: #fff; border: 1px solid rgba(0,0,0,0.07); border-radius: 18px; padding: 22px; box-shadow: 0 4px 20px rgba(0,0,0,0.02);">
                <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
                    <div>
                        <h2 style="font-size: 17.5px; font-weight: 700; color: #18181b; margin: 0 0 3px;">Issued Quotations</h2>
                        <p style="margin: 0; font-size: 12.5px; color: #71717a;">All domestic and international quotations issued to clients</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="btn btn-add${_dashFiltersVisible ? ' active' : ''}" id="btn-qu-dash-filter-toggle" onclick="Quotation.toggleDashFilters()" style="padding: 7px 14px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                            <span>Filter</span>
                            ${hasActiveFilters ? '<span style="width:7px; height:7px; border-radius:50%; background:#166534; display:inline-block;"></span>' : ''}
                        </button>
                    </div>
                </div>

                <!-- Filters Bar (Collapsible) -->
                <div id="qu-dash-filters-wrapper" style="display: ${_dashFiltersVisible ? 'block' : 'none'}; margin-bottom: 18px; padding: 14px 16px; background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.05); border-radius: 10px;">
                    <div class="dashboard-filters" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="qu-dash-filter-search" class="dashboard-filter-input" placeholder="Search Quotation No, Client, Items..." oninput="Dashboard.keepFocus(Quotation.applyDashFilters)" style="width: 250px; font-size: 13px;" value="${_escapeAttr(_dashSearch)}">

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
                            <input type="hidden" id="qu-dash-filter-type" value="${_escapeAttr(_dashType)}" onchange="Quotation.applyDashFilters()">
                        </div>

                        <!-- Client Filter (shared grouped multi-select) -->
                        ${Dashboard.renderClientFilter('qu', { width: 170 })}

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
                            <input type="hidden" id="qu-dash-filter-month" value="${_escapeAttr(_dashMonth)}" onchange="Quotation.applyDashFilters()">
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
                            <input type="hidden" id="qu-dash-filter-fy" value="${_escapeAttr(_dashFy)}" onchange="Quotation.applyDashFilters()">
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
                            <input type="hidden" id="qu-dash-filter-dept" value="${_escapeAttr(_dashDept)}" onchange="Quotation.applyDashFilters()">
                        </div>

                        ${hasActiveFilters ? `
                            <button type="button" class="btn btn-secondary" onclick="Quotation.resetDashFilters()" style="padding: 7px 12px; font-size: 12.5px; border-radius: 8px;">
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
                                <th style="text-align: left;">Quotation No</th>
                                <th style="text-align: left;">Date</th>
                                <th style="text-align: left;">Client</th>
                                <th style="text-align: left;">Type</th>
                                <th style="text-align: left;">Department</th>
                                <th style="text-align: right;">Amount</th>
                                <th style="text-align: center;">Status</th>
                                <th style="text-align: center; width: 110px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="qu-table-body">
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Pagination -->
                ${paginationHtml}
            </div>
        `;
    }

    let itemCount = 0;
    let termCount = 0;
    let _quOutsideClickHandler = null;

    function render(editData = null, modeOverride = null) {
        const container = document.getElementById('qu-content');

        // Automatically switch view container if editData is provided
        if (editData) {
            _currentView = 'form';
            const dashView = document.getElementById('qu-dashboard-view');
            const formView = document.getElementById('qu-form-view');
            if (dashView) dashView.style.display = 'none';
            if (formView) formView.style.display = 'block';
            const title = document.getElementById('qu-page-title');
            const subtitle = document.getElementById('qu-page-subtitle');
            if (title && editData.refNumber) {
                title.textContent = `Edit Quotation — ${editData.refNumber}`;
                if (subtitle) subtitle.textContent = 'Modify and regenerate this Quotation';
            }
        }

        // Editing keeps the id (save overwrites); revise strips it (save creates new).
        _editingId = (editData && editData.id) ? editData.id : null;

        // Resolve the active mode: explicit override > saved doc mode > the saved
        // client's type > default domestic.
        if (modeOverride === 'domestic' || modeOverride === 'international') {
            _quMode = modeOverride;
        } else if (editData && (editData.mode === 'domestic' || editData.mode === 'international')) {
            _quMode = editData.mode;
        } else if (editData && editData.clientName) {
            const c = Storage.getAllVendors().find(v => v.name === editData.clientName);
            _quMode = c ? (c.clientType || 'domestic') : 'domestic';
        }

        const clients = _quClientsForMode();

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

        const settings = Storage.getSettings();
        const cgstDefault = settings.cgst !== undefined ? settings.cgst : 9;
        const sgstDefault = settings.sgst !== undefined ? settings.sgst : 9;

        container.innerHTML = `
            <!-- Quotation Header & Client -->
            <div class="form-container">
                <div class="form-row">
                    <div class="form-group">
                        <label>Quotation number <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="qu-ref-number" placeholder="e.g., ORG001/ABC001/QT/26-27" value="${editData ? _escapeAttr(editData.refNumber) : ''}" data-auto-generated="${editData ? 'false' : 'true'}">
                    </div>
                    <div class="form-group">
                        <label>Date <span style="color: #ef4444;">*</span></label>
                        <input type="date" id="qu-date" max="9999-12-31" value="${editData ? editData.date : _todayISO()}" onchange="Quotation.updateAutoRefNumber()">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Customer Reference</label>
                        <input type="text" id="qu-cust-ref" placeholder="Customer reference details" value="${editData ? _escapeAttr(editData.custRef) : ''}">
                    </div>
                    <div class="form-group">
                        <label>Customer Reference Date</label>
                        <input type="date" id="qu-cust-ref-date" max="9999-12-31" value="${editData ? editData.custRefDate : ''}">
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
                                    <div class="custom-options" id="qu-client-custom-options">
                                        <div class="custom-option${selectedClientId === '' ? ' selected' : ''}" data-value="">— Select a saved client —</div>
                                        ${clientCustomOptions}
                                    </div>
                                    <input type="hidden" id="qu-client-select" value="${selectedClientId}">
                                </div>
                                <button class="btn btn-add" onclick="Quotation.showAddClient()" style="white-space:nowrap">+ Add New</button>
                            </div>
                            <!-- Sub Group select -->
                            <div id="qu-sub-client-wrapper" class="custom-select-wrapper searchable-select" style="display:none; width:100%;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>— Select Client —</span>
                                </div>
                                <div class="custom-options" id="qu-sub-client-custom-options">
                                </div>
                                <input type="hidden" id="qu-sub-client-select" value="">
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Department</label>
                        ${_departmentSelectHTML(editData ? editData.department : '')}
                    </div>
                </div>

                <!-- Client details fields (hidden by default) -->
                <div id="qu-client-fields" style="display:none;">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Company Name</label>
                            <input type="text" id="qu-client-name" placeholder="Client company name" value="${editData ? _escapeAttr(editData.clientName) : ''}">
                        </div>
                        <div class="form-group" id="qu-client-gst-group">
                            <label>GST</label>
                            <input type="text" id="qu-client-gst" placeholder="GST number" value="${editData ? _escapeAttr(editData.clientGST) : ''}">
                        </div>
                    </div>
                    <div class="form-row single">
                        <div class="form-group">
                            <label>Address</label>
                            <textarea id="qu-client-address" rows="2" placeholder="Full address">${editData ? _escapeHtml(editData.clientAddress) : ''}</textarea>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Contact Person Name</label>
                            <input type="text" id="qu-client-contact-person" placeholder="Contact person name" value="${editData ? _escapeAttr(editData.clientContactPerson) : ''}">
                        </div>
                        <div class="form-group"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Contact</label>
                            <input type="text" id="qu-client-contact" placeholder="Phone number" value="${editData ? _escapeAttr(editData.clientContact) : ''}">
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="qu-client-email" placeholder="Email address" value="${editData ? _escapeAttr(editData.clientEmail) : ''}">
                        </div>
                    </div>
                    </div>
                    <!-- Inline actions to save newly added client -->
                    <div id="qu-client-save-actions" style="display:none; gap:8px; margin-top:16px;">
                        <button class="btn btn-generate" style="padding:10px 24px; font-size:13px;" onclick="Quotation.saveNewClient()">Save</button>
                        <button class="btn btn-secondary" style="padding:10px 20px; font-size:13px;" onclick="Quotation.hideAddClient()">Cancel</button>
                    </div>
                </div>
            </div>

            <!-- Item Details -->
            <div class="form-container">
                <div class="items-table-wrapper">
                    <table class="items-table" id="qu-items-table">
                        <thead>
                            <tr>
                                <th class="col-sno">S.No</th>
                                <th class="col-desc">Description of Services</th>
                                <th class="col-uom">UOM</th>
                                <th class="col-qty">No of Units</th>
                                <th class="col-rate">Unit Rate</th>
                                <th class="col-discount">Discount</th>
                                <th class="col-amount">Total</th>
                                <th class="col-actions"></th>
                            </tr>
                        </thead>
                        <tbody id="qu-items-body">
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:10px">
                    <button class="btn btn-add" onclick="Quotation.addItem()">+ Add Item</button>
                </div>
                <div style="margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 16px;">
                    <div class="total-row" id="qu-subtotal-row" style="display: none;">
                        <span class="total-label">Sub Total (excl. Tax):</span>
                        <span class="total-value" id="qu-subtotal-display">0.00</span>
                    </div>
                    <div class="total-row" id="qu-discount-row" style="display: none;">
                        <span class="total-label">Total Discount:</span>
                        <span class="total-value" id="qu-discount-display">0.00</span>
                    </div>
                    <div class="total-row" id="qu-cgst-row" style="display: none;">
                        <span class="total-label" id="qu-cgst-label">CGST Amount:</span>
                        <span class="total-value" id="qu-cgst-display">0.00</span>
                    </div>
                    <div class="total-row" id="qu-sgst-row" style="display: none;">
                        <span class="total-label" id="qu-sgst-label">SGST Amount:</span>
                        <span class="total-value" id="qu-sgst-display">0.00</span>
                    </div>
                    <div class="total-row" id="qu-igst-row" style="display: none;">
                        <span class="total-label" id="qu-igst-label">IGST Amount:</span>
                        <span class="total-value" id="qu-igst-display">0.00</span>
                    </div>
                    <div class="total-row" style="display: flex; justify-content: flex-end; gap: 16px;">
                        <span class="total-label" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">Grand Total:</span>
                        <span class="total-value" id="qu-total-display" style="font-size: 15px; font-weight: 700; color: var(--text-primary); min-width: 120px; text-align: right;">0.00</span>
                    </div>
                </div>
            </div>

            <!-- Payment Terms & Conditions -->
            <div class="form-container">
                <div class="form-section-title">Payment Terms & Conditions</div>
                <div class="dynamic-list" id="qu-terms-list"></div>
                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button class="btn btn-add" onclick="Quotation.addTerm()">+ Add Term</button>
                    <button class="btn btn-secondary" onclick="Quotation.saveDefaultTerms()" style="padding: 8px 16px; font-size: 13px;">Save as Defaults</button>
                </div>
            </div>



            <!-- Generate Button -->
            <div class="form-container" style="text-align: center; padding: 20px 0;">
                <button class="btn btn-secondary" onclick="Quotation.save()" style="padding: 12px 40px; font-size: 14px; margin-right: 12px;">Save</button>
                <button class="btn btn-generate" onclick="Quotation.saveAndDownload()" style="padding: 12px 40px; font-size: 14px;">Save &amp; Download</button>
            </div>
        `;

        itemCount = 0;
        termCount = 0;
        
        const tbody = document.getElementById('qu-items-body');
        if (tbody) tbody.innerHTML = '';
        const termsList = document.getElementById('qu-terms-list');
        if (termsList) termsList.innerHTML = '';

        if (editData && editData.items && editData.items.length > 0) {
            editData.items.forEach(it => {
                addItem(it);
            });
        } else {
            addItem();
        }
        
        const termsToLoad = (editData && editData.terms) ? editData.terms : (settings.quDefaultTerms || DEFAULT_TERMS);
        termsToLoad.forEach(t => addTerm(t));

        if (editData && editData.currency) {
            setTimeout(() => {
                const dummy = document.createElement('input');
                dummy.value = editData.currency;
                handleCurrencyChange(dummy);
            }, 0);
        }

        const quRefInput = document.getElementById('qu-ref-number');
        if (quRefInput) {
            quRefInput.addEventListener('input', () => {
                quRefInput.setAttribute('data-auto-generated', 'false');
            });
        }

        const clientNameInput = document.getElementById('qu-client-name');
        if (clientNameInput) {
            clientNameInput.addEventListener('input', () => {
                Quotation.updateAutoRefNumber();
            });
        }

        Quotation.updateAutoRefNumber();

        // Sync settings with the document's saved tax settings if revising/editing.
        // Never for international quotations — their gstEnabled is always false and
        // persisting that globally would wrongly disable GST for domestic documents.
        if (editData && editData.gstEnabled !== undefined && _quMode !== 'international') {
            settings.gstEnabled = !!editData.gstEnabled;
            Storage.saveSettings(settings);

            // Sync all checkboxes across forms
            const poGst = document.getElementById('po-gst-toggle');
            const invGst = document.getElementById('inv-gst-toggle');
            if (poGst) poGst.checked = settings.gstEnabled;
            if (invGst) invGst.checked = settings.gstEnabled;
        }

        // On edit/revise the client is already saved — keep the detail fields collapsed
        // and just show the selected client in the dropdown (cleaner; data is retained).

        _rebuildCurrencyOptions();
        _setupColumnSettings();
        recalcTax();
        _applyQuModeUI();

        const quGst = document.getElementById('qu-gst-toggle');
        if (quGst) quGst.checked = _quMode !== 'international' && settings.gstEnabled === true;
    }

    function _rebuildCurrencyOptions() {
        const currencies = _currenciesForMode();
        const target = _quMode === 'domestic' ? 'INR' : 'USD';
        document.querySelectorAll('#qu-items-body tr').forEach(row => {
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
            wrapper.style.display = currencies.length <= 1 ? 'none' : '';
        });
    }

    function _setupColumnSettings() {
        const toggleList = document.getElementById('qu-column-toggle-list');
        if (!toggleList) return;

        const visibility = Storage.getQUColumnVisibility();
        const table = document.getElementById('qu-items-table');

        // Apply classes to table
        Object.keys(visibility).forEach(key => {
            if (key === 'signature' || key === 'total') return; // PDF-only flags, not table columns
            if (table) {
                if (['sno', 'qty', 'rate', 'amount', 'desc'].includes(key)) {
                    table.classList.remove(`hide-col-${key}`);
                    return;
                }
                if (visibility[key] === false) {
                    table.classList.add(`hide-col-${key}`);
                } else {
                    table.classList.remove(`hide-col-${key}`);
                }
            }
        });

        // Column Labels Map (sno, qty, rate, amount, desc removed to make them permanently visible)
        const columnLabels = {
            uom: 'UOM',
            discount: 'Discount',
            total: 'Total'
        };

        // Populate checkboxes
        toggleList.innerHTML = Object.keys(columnLabels).map(key => {
            const checked = visibility[key] !== false ? 'checked' : '';
            return `
                <div class="qu-column-toggle-item" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                    <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">${columnLabels[key]}</span>
                    <label class="switch">
                        <input type="checkbox" class="qu-col-toggle-input" data-col="${key}" ${checked}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
        }).join('');

        // Bind change events
        toggleList.querySelectorAll('.qu-col-toggle-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const colKey = e.target.dataset.col;
                const isChecked = e.target.checked;
                
                // Validation: prevent hiding all columns
                const currentVisibility = Storage.getQUColumnVisibility();
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
        const quSigItem = document.createElement('div');
        quSigItem.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0 4px; border-top:1px solid rgba(0,0,0,0.08); margin-top:6px;';
        quSigItem.innerHTML = `
            <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">Signature &amp; Stamp</span>
            <label class="switch">
                <input type="checkbox" id="qu-signature-toggle" ${visibility.signature === true ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;
        toggleList.appendChild(quSigItem);
        const quSigInput = quSigItem.querySelector('#qu-signature-toggle');
        if (quSigInput) {
            quSigInput.addEventListener('change', (e) => {
                const v = Storage.getQUColumnVisibility();
                v.signature = e.target.checked;
                Storage.saveQUColumnVisibility(v);
            });
        }

        // Round Off toggle (domestic INR quotations only) — rounds the grand total
        // to the nearest rupee and prints the adjustment above the amount in words.
        if (_quMode === 'domestic') {
            const quRoundItem = document.createElement('div');
            quRoundItem.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0 4px; border-top:1px solid rgba(0,0,0,0.08); margin-top:6px;';
            quRoundItem.innerHTML = `
                <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">Round Off</span>
                <label class="switch">
                    <input type="checkbox" id="qu-roundoff-toggle" ${visibility.roundOff === true ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            `;
            toggleList.appendChild(quRoundItem);
            const quRoundInput = quRoundItem.querySelector('#qu-roundoff-toggle');
            if (quRoundInput) {
                quRoundInput.addEventListener('change', (e) => {
                    const v = Storage.getQUColumnVisibility();
                    v.roundOff = e.target.checked;
                    Storage.saveQUColumnVisibility(v);
                });
            }
        }

        // Wire show/hide click and click outside
        const settingsBtn = document.getElementById('qu-columns-settings-btn');
        const settingsDropdown = document.getElementById('qu-columns-settings-dropdown');

        if (settingsBtn && settingsDropdown) {
            const newSettingsBtn = settingsBtn.cloneNode(true);
            settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);

            newSettingsBtn.addEventListener('click', (e) => {
                const isVisible = settingsDropdown.style.display === 'block';
                // Close other dropdowns first
                document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
                settingsDropdown.style.display = isVisible ? 'none' : 'block';
                e.stopPropagation();
            });

            // Click outside handler
            if (_quOutsideClickHandler) {
                document.removeEventListener('click', _quOutsideClickHandler);
            }
            _quOutsideClickHandler = (e) => {
                const dropdown = document.getElementById('qu-columns-settings-dropdown');
                const btn = document.getElementById('qu-columns-settings-btn');
                if (!dropdown) {
                    document.removeEventListener('click', _quOutsideClickHandler);
                    _quOutsideClickHandler = null;
                    return;
                }
                if (dropdown && btn && !dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            };
            document.addEventListener('click', _quOutsideClickHandler);
        }
        updateClientDropdown();
    }

    function _toggleColumn(colKey, isChecked) {
        const visibility = Storage.getQUColumnVisibility();
        visibility[colKey] = isChecked;
        Storage.saveQUColumnVisibility(visibility);

        const table = document.getElementById('qu-items-table');
        if (table) {
            if (isChecked) {
                table.classList.remove(`hide-col-${colKey}`);
            } else {
                table.classList.add(`hide-col-${colKey}`);
            }
        }
        recalcTax();
    }

    // --- Client dropdown handlers ---
    function onClientSelect() {
        const sel = document.getElementById('qu-client-select');
        const clientId = sel.value;
        const fieldsDiv = document.getElementById('qu-client-fields');
        const actionsDiv = document.getElementById('qu-client-save-actions');

        // Always hide fields and actions when selecting or deselecting a saved client
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        if (!clientId) {
            document.getElementById('qu-client-name').value = '';
            document.getElementById('qu-client-gst').value = '';
            document.getElementById('qu-client-address').value = '';
            document.getElementById('qu-client-contact-person').value = '';
            document.getElementById('qu-client-contact').value = '';
            document.getElementById('qu-client-email').value = '';
            return;
        }

        const client = Storage.getVendor(clientId);
        if (client) {
            document.getElementById('qu-client-name').value = client.name || '';
            document.getElementById('qu-client-gst').value = client.gst || '';
            document.getElementById('qu-client-address').value = client.address || '';
            document.getElementById('qu-client-contact-person').value = client.contactPerson || '';
            document.getElementById('qu-client-contact').value = client.contact || '';
            document.getElementById('qu-client-email').value = client.email || '';
        }
        _applyQuModeUI();
        updateAutoRefNumber();
    }

    function updateAutoRefNumber() {
        const quRefInput = document.getElementById('qu-ref-number');
        if (!quRefInput || quRefInput.getAttribute('data-auto-generated') !== 'true') return;

        const clientNameInput = document.getElementById('qu-client-name');
        const clientName = clientNameInput ? clientNameInput.value.trim() : '';
        if (!clientName) {
            quRefInput.value = '';
            return;
        }

        const dateInput = document.getElementById('qu-date');
        const dateVal = dateInput ? dateInput.value : _todayISO();
        if (!dateVal) return;

        const fy = Storage.getFinancialYear(dateVal);
        const fyShort = Storage.getFinancialYearShort(dateVal);
        const clientCode = Storage.generateClientCode(clientName);

        const orgSerial = String(Storage.peekNextSerialNumber('QU', '', fy)).padStart(3, '0');
        const clientSerial = String(Storage.peekNextSerialNumber('QU_CLIENT:' + clientCode, '', fy)).padStart(3, '0');

        quRefInput.value = `${Storage.getOrgInfo().serialPrefix}${orgSerial}/${clientCode}${clientSerial}/QT/${fyShort}`;
    }

    function showAddClient() {
        App.showAddContactModal('client', (data) => {
            // Clients are partitioned by the quotation's mode.
            _quPendingClientType = _quMode || 'domestic';
            document.getElementById('qu-client-name').value = data.name;
            document.getElementById('qu-client-gst').value = data.gst;
            document.getElementById('qu-client-address').value = data.address;
            document.getElementById('qu-client-contact-person').value = data.contactPerson;
            document.getElementById('qu-client-contact').value = data.contact;
            document.getElementById('qu-client-email').value = data.email;

            saveNewClient();
        }, () => {
            // Cancel callback
            const sel = document.getElementById('qu-client-select');
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
        }, { hideClientType: true });
    }

    function hideAddClient() {
        document.getElementById('qu-client-name').value = '';
        document.getElementById('qu-client-gst').value = '';
        document.getElementById('qu-client-address').value = '';
        document.getElementById('qu-client-contact-person').value = '';
        document.getElementById('qu-client-contact').value = '';
        document.getElementById('qu-client-email').value = '';

        const fieldsDiv = document.getElementById('qu-client-fields');
        const actionsDiv = document.getElementById('qu-client-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        const sel = document.getElementById('qu-client-select');
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
    }

    function saveNewClient() {
        const name = document.getElementById('qu-client-name').value.trim();
        if (!name) {
            App.showToast('Please enter client company name', 'error');
            return;
        }
        const clientData = {
            name: name,
            gst: document.getElementById('qu-client-gst').value.trim(),
            address: document.getElementById('qu-client-address').value.trim(),
            contactPerson: document.getElementById('qu-client-contact-person').value.trim(),
            contact: document.getElementById('qu-client-contact').value.trim(),
            email: document.getElementById('qu-client-email').value.trim(),
            clientType: _quMode || _quPendingClientType || 'domestic'
        };
        const saved = Storage.saveVendor(clientData);
        _quPendingClientType = 'domestic'; // reset for next add

        // Refresh dropdown options
        const clients = _quClientsForMode();
        const customOptionsDiv = document.getElementById('qu-client-custom-options');
        if (customOptionsDiv) {
            customOptionsDiv.innerHTML = '<div class="custom-option" data-value="">— Select a saved client —</div>' +
                clients.map(v => `<div class="custom-option ${v.id === saved.id ? 'selected' : ''}" data-value="${v.id}">${_escapeAttr(v.name)}</div>`).join('');
        }

        const sel = document.getElementById('qu-client-select');
        if (sel) {
            sel.value = saved.id;
            const wrapper = sel.closest('.custom-select-wrapper');
            if (wrapper) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                if (triggerSpan) triggerSpan.textContent = saved.name;
            }
        }

        // Keep fields populated behind the scenes, but hide them
        document.getElementById('qu-client-name').value = saved.name || '';
        document.getElementById('qu-client-gst').value = saved.gst || '';
        document.getElementById('qu-client-address').value = saved.address || '';
        document.getElementById('qu-client-contact-person').value = saved.contactPerson || '';
        document.getElementById('qu-client-contact').value = saved.contact || '';
        document.getElementById('qu-client-email').value = saved.email || '';

        const fieldsDiv = document.getElementById('qu-client-fields');
        const actionsDiv = document.getElementById('qu-client-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        App.showToast(`Client "${saved.name}" saved!`, 'success');
        updateAutoRefNumber();
    }

    function updateClientDropdown() {
        const clients = _quClientsForMode();
        const selectedVal = document.getElementById('qu-client-select')?.value || '';
        App.setupGroupedClientSelect('qu', clients, selectedVal, Quotation.onClientSelect);
    }

    function handleCurrencyChange(select) {
        const val = select.value;
        // Scope to THIS form's items only — never touch other documents' rows.
        document.querySelectorAll('#qu-items-body .item-currency').forEach(s => {
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
        const first = document.querySelector('#qu-items-body .item-currency');
        if (first && first.value) return first.value;
        return _quMode === 'international' ? 'USD' : 'INR';
    }

    function addItem(initData = null) {
        itemCount++;
        const currentCurrency = getSelectedCurrency();
        const tbody = document.getElementById('qu-items-body');
        const tr = document.createElement('tr');
        tr.id = `qu-item-${itemCount}`;
        
        const descVal = initData ? initData.description : '';
        const uomVal = initData ? initData.uom : 'Nos';
        const qtyVal = initData ? initData.units : '';
        const priceVal = initData ? initData.priceUnit : '';
        const discountVal = initData ? (initData.discount || '') : '';
        const totalVal = initData ? initData.total : 0;

        const currencies = _currenciesForMode();
        const isSingleCurrency = currencies.length <= 1;
        const displayStyle = isSingleCurrency ? 'style="display:none;"' : '';

        tr.innerHTML = `
            <td class="col-sno"><div class="sno-display">${itemCount}</div></td>
            <td class="col-desc"><textarea class="item-desc" placeholder="Description of services" rows="2">${_escapeHtml(descVal)}</textarea></td>
            <td class="col-uom">
                <div class="custom-select-wrapper uom-select">
                    <div class="custom-select-trigger">
                        <span>${_escapeAttr(uomVal)}</span>
                    </div>
                    <div class="custom-options">${App.uomOptionsHTML(uomVal)}</div>
                    <input type="hidden" class="item-uom" value="${_escapeAttr(uomVal)}">
                </div>
            </td>
            <td class="col-qty"><input type="number" class="item-units" placeholder="0" min="0" step="any" oninput="Quotation.calcRow(this)" value="${qtyVal}"></td>
            <td class="col-rate">
                <div class="rate-currency-box">
                    <input type="number" class="item-price" placeholder="0" min="0" step="any" oninput="Quotation.calcRow(this)" value="${priceVal}">
                    <div class="custom-select-wrapper currency-select" ${displayStyle}>
                        <div class="custom-select-trigger">
                            <span>${currentCurrency}</span>
                        </div>
                        <div class="custom-options">
                            ${App.buildCurrencyOptionsHTML(currencies, currentCurrency)}
                        </div>
                        <input type="hidden" class="item-currency" value="${currentCurrency}" onchange="Quotation.handleCurrencyChange(this)">
                    </div>
                </div>
            </td>
            <td class="col-discount">
                <div class="custom-select-wrapper discount-select">
                    <div class="custom-select-trigger discount-trigger">
                        <input type="text" class="item-discount-input" placeholder="0%" value="${_escapeAttr(discountVal)}" oninput="Quotation.calcRow(this)">
                    </div>
                    <div class="custom-options">
                        <div class="custom-option" data-value="5%">5%</div>
                        <div class="custom-option" data-value="10%">10%</div>
                        <div class="custom-option" data-value="15%">15%</div>
                        <div class="custom-option" data-value="20%">20%</div>
                        <div class="custom-option" data-value="25%">25%</div>
                        <div class="custom-option" data-value="30%">30%</div>
                    </div>
                </div>
            </td>
            <td class="col-amount"><div class="amount-display item-total">${PdfUtils.formatCurrency(totalVal, currentCurrency)}</div></td>
            <td class="col-actions"><button class="btn-remove" onclick="Quotation.removeItem(${itemCount})" title="Remove">×</button></td>
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
        const row = document.getElementById(`qu-item-${id}`);
        if (row) {
            row.remove();
            _renumberItems();
            recalcTax();
        }
    }

    function calcRow(input) {
        const row = input.closest('tr');
        const colVisibility = Storage.getQUColumnVisibility();
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showDiscount = colVisibility.discount !== false;

        const units = showQty ? (parseFloat(row.querySelector('.item-units').value) || 0) : 1;
        const price = showRate ? (parseFloat(row.querySelector('.item-price').value) || 0) : 1;
        const discountVal = showDiscount ? (row.querySelector('.item-discount-input')?.value || '') : '';
        const discountPercent = parseDiscount(discountVal);

        const total = FinanceUtils.truncate2(units * price * (1 - discountPercent / 100));
        const rowCurrency = getSelectedCurrency();
        row.querySelector('.item-total').textContent = PdfUtils.formatCurrency(total, rowCurrency);
        recalcTax();
    }

    function recalcTax() {
        const rows = document.querySelectorAll('#qu-items-body tr');
        const colVisibility = Storage.getQUColumnVisibility();
        const showDesc = colVisibility.desc !== false;
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showDiscount = colVisibility.discount !== false;

        let subtotal = 0;
        let totalDiscount = 0;
        rows.forEach(row => {
            const desc = showDesc ? (row.querySelector('.item-desc')?.value || '') : '';
            const units = showQty ? (parseFloat(row.querySelector('.item-units')?.value) || 0) : 1;
            const price = showRate ? (parseFloat(row.querySelector('.item-price')?.value) || 0) : 1;
            const discountVal = showDiscount ? (row.querySelector('.item-discount-input')?.value || '') : '';
            const discountPercent = parseDiscount(discountVal);

            const descEmpty = !showDesc || !desc.trim();
            const qtyEmpty = showQty ? (parseFloat(row.querySelector('.item-units')?.value) || 0) === 0 : true;
            const rateEmpty = showRate ? (parseFloat(row.querySelector('.item-price')?.value) || 0) === 0 : true;

            if (descEmpty && qtyEmpty && rateEmpty) return;

            const baseAmount = units * price;
            const rowDiscount = baseAmount * (discountPercent / 100);
            totalDiscount += rowDiscount;
            subtotal += FinanceUtils.truncate2(baseAmount - rowDiscount);
        });
        subtotal = FinanceUtils.truncate2(subtotal);

        const settings = _quEffectiveSettings();
        const clientGst = document.getElementById('qu-client-gst')?.value || '';
        const fin = FinanceUtils.calculateTotals(subtotal, settings, clientGst);

        // Always hide breakdown rows from the dashboard screen
        const subtotalRow = document.getElementById('qu-subtotal-row');
        const discountRow = document.getElementById('qu-discount-row');
        const cgstRow = document.getElementById('qu-cgst-row');
        const sgstRow = document.getElementById('qu-sgst-row');
        const igstRow = document.getElementById('qu-igst-row');

        if (subtotalRow) subtotalRow.style.display = 'none';
        if (discountRow) discountRow.style.display = 'none';
        if (cgstRow) cgstRow.style.display = 'none';
        if (sgstRow) sgstRow.style.display = 'none';
        if (igstRow) igstRow.style.display = 'none';

        const currency = getSelectedCurrency();

        const subtotalEl = document.getElementById('qu-subtotal-display');
        if (subtotalEl) subtotalEl.textContent = PdfUtils.formatCurrency(subtotal, currency);

        const discountEl = document.getElementById('qu-discount-display');
        if (discountEl) discountEl.textContent = PdfUtils.formatCurrency(totalDiscount, currency);

        const cgstEl = document.getElementById('qu-cgst-display');
        if (cgstEl) {
            const cgstLabel = document.getElementById('qu-cgst-label');
            if (cgstLabel) cgstLabel.textContent = `CGST (${fin.cgstRate}%):`;
            cgstEl.textContent = PdfUtils.formatCurrency(fin.cgstAmount, currency);
        }

        const sgstEl = document.getElementById('qu-sgst-display');
        if (sgstEl) {
            const sgstLabel = document.getElementById('qu-sgst-label');
            if (sgstLabel) sgstLabel.textContent = `SGST (${fin.sgstRate}%):`;
            sgstEl.textContent = PdfUtils.formatCurrency(fin.sgstAmount, currency);
        }

        const igstEl = document.getElementById('qu-igst-display');
        if (igstEl) {
            const igstLabel = document.getElementById('qu-igst-label');
            if (igstLabel) igstLabel.textContent = `IGST (${fin.igstRate}%):`;
            igstEl.textContent = PdfUtils.formatCurrency(fin.igstAmount, currency);
        }

        const grandEl = document.getElementById('qu-total-display');
        if (grandEl) grandEl.textContent = PdfUtils.formatCurrency(fin.grandTotal, currency);

        // Tax is not itemised — show only Sub Total (excl. Tax) when GST is on.
        if (fin.gstEnabled) {
            if (subtotalRow) subtotalRow.style.display = 'flex';
        }
        if (totalDiscount > 0) {
            if (subtotalRow) subtotalRow.style.display = 'flex';
            if (discountRow) discountRow.style.display = 'flex';
        }
    }

    function _renumberItems() {
        const rows = document.querySelectorAll('#qu-items-body tr');
        rows.forEach((row, i) => {
            const sno = row.querySelector('.sno-display');
            if (sno) sno.textContent = i + 1;
        });
    }

    function addTerm(value = '') {
        termCount++;
        const list = document.getElementById('qu-terms-list');
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `qu-term-${termCount}`;
        div.innerHTML = `
            <span class="list-number">•</span>
            <input type="text" value="${_escapeAttr(value)}" placeholder="Enter payment term">
            <button class="btn-remove" onclick="Quotation.removeTerm(${termCount})">×</button>
        `;
        list.appendChild(div);
    }

    function removeTerm(id) {
        const el = document.getElementById(`qu-term-${id}`);
        if (el) el.remove();
    }

    // Signature and stamp preloaded statically

    // --- Collect form data ---
    function _collectFormData() {
        const items = [];
        const colVisibility = Storage.getQUColumnVisibility();
        const showDesc = colVisibility.desc !== false;
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showDiscount = colVisibility.discount !== false;

        document.querySelectorAll('#qu-items-body tr').forEach(row => {
            const desc = showDesc ? (row.querySelector('.item-desc')?.value || '') : '';
            const units = showQty ? (parseFloat(row.querySelector('.item-units')?.value) || 0) : 1;
            const price = showRate ? (parseFloat(row.querySelector('.item-price')?.value) || 0) : 1;
            const discountVal = showDiscount ? (row.querySelector('.item-discount-input')?.value || '') : '';

            const descEmpty = !showDesc || !desc.trim();
            const qtyEmpty = showQty ? (parseFloat(row.querySelector('.item-units')?.value) || 0) === 0 : true;
            const rateEmpty = showRate ? (parseFloat(row.querySelector('.item-price')?.value) || 0) === 0 : true;

            if (descEmpty && qtyEmpty && rateEmpty) return; // skip row if completely empty

            items.push({
                sno: items.length + 1,
                description: desc,
                uom: row.querySelector('.item-uom')?.value || '',
                units: units,
                priceUnit: price,
                discount: discountVal,
                total: FinanceUtils.truncate2(units * price * (1 - parseDiscount(discountVal) / 100))
            });
        });

        const terms = [];
        document.querySelectorAll('#qu-terms-list .dynamic-list-item input').forEach(inp => {
            if (inp.value.trim()) terms.push(inp.value.trim());
        });

        const settings = _quEffectiveSettings();
        const totalAmount = FinanceUtils.truncate2(items.reduce((s, it) => s + it.total, 0));
        const clientGst = document.getElementById('qu-client-gst')?.value || '';
        const fin = FinanceUtils.calculateTotals(totalAmount, settings, clientGst);

        return {
            refNumber: document.getElementById('qu-ref-number').value.trim(),
            date: document.getElementById('qu-date').value,
            department: (document.getElementById('qu-department') && document.getElementById('qu-department').value) || '',
            custRef: document.getElementById('qu-cust-ref').value.trim(),
            custRefDate: document.getElementById('qu-cust-ref-date').value,
            clientName: document.getElementById('qu-client-name').value.trim(),
            clientAddress: document.getElementById('qu-client-address').value.trim(),
            clientGST: document.getElementById('qu-client-gst').value.trim(),
            clientContactPerson: document.getElementById('qu-client-contact-person').value.trim(),
            clientContact: document.getElementById('qu-client-contact').value.trim(),
            clientEmail: document.getElementById('qu-client-email').value.trim(),
            signatory: '',
            mode: _quMode,
            items,
            ...fin,
            totalAmount, // Subtotal
            terms,
            currency: getSelectedCurrency()
        };
    }

    // --- Generate ---
    async function generate(withPdf = true) {
        const quRefInput = document.getElementById('qu-ref-number');
        if (quRefInput && quRefInput.getAttribute('data-auto-generated') === 'true') {
            const clientNameInput = document.getElementById('qu-client-name');
            const clientName = clientNameInput ? clientNameInput.value.trim() : '';
            const dateInput = document.getElementById('qu-date');
            const dateVal = dateInput ? dateInput.value : _todayISO();

            if (clientName && dateVal) {
                const fy = Storage.getFinancialYear(dateVal);
                const fyShort = Storage.getFinancialYearShort(dateVal);
                const clientCode = Storage.generateClientCode(clientName);

                const orgSerial = String(Storage.incrementSerialNumber('QU', '', fy)).padStart(3, '0');
                const clientSerial = String(Storage.incrementSerialNumber('QU_CLIENT:' + clientCode, '', fy)).padStart(3, '0');
                quRefInput.value = `${Storage.getOrgInfo().serialPrefix}${orgSerial}/${clientCode}${clientSerial}/QT/${fyShort}`;
                quRefInput.setAttribute('data-auto-generated', 'false');
            }
        }

        const data = _collectFormData();
        if (!data.refNumber) {
            App.showToast('Please enter Quotation number', 'error');
            return;
        }
        if (!data.date) {
            App.showToast('Please select Quotation Date', 'error');
            return;
        }
        if (!data.clientName) {
            App.showToast('Please select or add a client', 'error');
            return;
        }
        if (data.items.length === 0 || !data.items[0].description) {
            App.showToast('Please add at least one item', 'error');
            return;
        }

        // Warn if this reference number is already used by another document.
        if (!(await App.confirmIfDuplicateRef(data.refNumber, _editingId))) return;

        App.showLoading(withPdf ? 'Generating Quotation PDF...' : 'Saving Quotation...');

        try {
            if (_editingId) data.id = _editingId;
            Storage.saveQuotation(data);
            _editingId = null;
            // Save-only: the record is stored, skip the PDF step entirely.
            if (!withPdf) {
                App.hideLoading();
                App.showToast('Quotation saved successfully!', 'success');
                showDashboardView();
                return;
            }

            const result = await generatePDF(data, false);
            App.hideLoading();
            
            if (result && result.savedToPath) {
                App.showConfirm(
                    'PDF Saved Successfully',
                    '',
                    () => {
                        showDashboardView();
                    },
                    null,
                    true
                );
            } else if (result && result.cancelled) {
                // User chose not to overwrite, do not clear form or show success toast
            } else {
                App.showToast('Quotation generated successfully!', 'success');
                // Return to quotation dashboard
                showDashboardView();
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

    // --- PDF Generation ---
    async function generatePDF(data, action = 'download', targetWin = null) {
        const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        let doc = new jsPDF('p', 'mm', 'a4');
        PdfUtils.registerCurrencyFont(doc);
        const pageWidth = 210;
        const margin = 10;
        const contentWidth = pageWidth - 2 * margin;
        let y = 5;

        // Company GST is mandatory in the header for domestic quotations
        // regardless of the GST tax toggle; international quotations carry none.
        const showOrgGst = data.mode !== 'international';

        // --- Header / Letterhead (logo left, company details right) ---
        const logo = await PdfUtils.getLogoBase64();
        y = PdfUtils.drawLetterhead(doc, logo, pageWidth, margin, y, showOrgGst);

        // --- Slanted Gradient Bar ---
        const greenWidth = contentWidth * 0.82; // 82% green split to match POcode.py CSS
        const slantWidth = 4;
        const barH = 2; // bar height, halved from 4 (50% thinner)

        // Orange spans the full width underneath, so the green's slanted right
        // edge always blends into orange — no white seam can appear.
        doc.setFillColor(243, 123, 33); // #f37b21
        doc.rect(margin, y, contentWidth, barH, 'F');

        // Green drawn as a single filled polygon (no internal seam).
        doc.setFillColor(0, 77, 44);
        doc.lines([[greenWidth + slantWidth, 0], [-slantWidth, barH], [-greenWidth, 0]], margin, y, [1, 1], 'F', true);

        y += 12;

        // --- Document Title ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(0, 77, 44);
        doc.text('QUOTATION', pageWidth / 2, y, { align: 'center' });

        y += 9;
        const blockTopY = y;

        // Meta (right-aligned) — top-aligned with PREPARED FOR
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);

        let metaY = blockTopY;
        doc.text(`QT No.: ${data.refNumber}`, pageWidth - margin, metaY, { align: 'right' });
        metaY += 5;
        doc.text(`Date: ${PdfUtils.formatDateDMY(data.date)}`, pageWidth - margin, metaY, { align: 'right' });

        if (data.custRef) {
            metaY += 5;
            doc.text(`Customer Ref: ${data.custRef}`, pageWidth - margin, metaY, { align: 'right' });
        }

        // --- Client Details (left) ---
        y = blockTopY;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(0, 77, 44);
        doc.text('PREPARED FOR:', margin, y);
        
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

        y = addrY + 2.4; // Dynamic spacing!

        // --- Table ---
        const currencyCode = data.currency || 'INR';

        const colVisibility = Storage.getQUColumnVisibility();
        const showSno = colVisibility.sno !== false;
        const showDesc = colVisibility.desc !== false && data.items.some(it => (it.description || '').trim().length > 0);
        const showUom = colVisibility.uom !== false;
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showAmount = colVisibility.amount !== false;
        const showTotal = colVisibility.total !== false;

        // Determine UNIT RATE header: domestic uses "UNIT RATE (INR)", international uses "UNIT RATE"
        const isDomesticQu = (data.mode || _quMode) === 'domestic';
        const unitRateHeader = isDomesticQu ? 'UNIT RATE (INR)' : 'UNIT RATE';

        const colsToInclude = [];
        if (showSno) colsToInclude.push({ id: 'sno', header: 'S.NO', baseWidth: 12, halign: 'center' });
        if (showDesc) colsToInclude.push({ id: 'desc', header: 'DESCRIPTION OF SERVICES', baseWidth: 80, halign: 'left' });
        if (showUom) colsToInclude.push({ id: 'uom', header: 'UOM', baseWidth: 15, halign: 'center' });
        if (showQty) colsToInclude.push({ id: 'qty', header: 'QTY', baseWidth: 15, halign: 'center' });
        if (showRate) colsToInclude.push({ id: 'rate', header: unitRateHeader, baseWidth: 28, halign: 'right' });
        if (showTotal && showAmount) colsToInclude.push({ id: 'amount', header: 'TOTAL', baseWidth: 30, halign: 'right' });

        function getQUItemVal(it, colId, idx) {
            if (colId === 'sno') return (it.sno !== undefined && it.sno !== null ? it.sno : (idx + 1)).toString();
            if (colId === 'desc') return it.description || '';
            if (colId === 'uom') return it.uom || '';
            if (colId === 'qty') return (it.units !== undefined && it.units !== null ? it.units : 0).toString();
            if (colId === 'rate') return PdfUtils.formatCurrency(it.priceUnit, currencyCode);
            if (colId === 'amount') return PdfUtils.formatCurrency(it.units * it.priceUnit, currencyCode);
            return '';
        }

        const activeCols = (PdfUtils.autoAdjustTableColumns
            ? PdfUtils.autoAdjustTableColumns(doc, colsToInclude, data.items || [], getQUItemVal, contentWidth, 9.5)
            : null) || colsToInclude.map(col => ({
                id: col.id,
                header: col.header,
                width: (col.baseWidth / (colsToInclude.reduce((sum, c) => sum + c.baseWidth, 0) || 1)) * contentWidth,
                halign: col.halign
            }));

        const totalCols = activeCols.length;
        const itemsHead = [activeCols.map(col => col.header)];

        const itemsBody = (data.items || []).map((it, idx) => {
            return activeCols.map(col => getQUItemVal(it, col.id, idx));
        });

        // Compute total discount & gross subtotal
        let totalDiscount = 0;
        let grossSubtotal = 0;
        (data.items || []).forEach(it => {
            const units = (it.units !== undefined && it.units !== null ? it.units : 1);
            const price = (it.priceUnit !== undefined && it.priceUnit !== null ? it.priceUnit : 0);
            const discountPercent = parseDiscount(it.discount);
            grossSubtotal += units * price;
            totalDiscount += units * price * (discountPercent / 100);
        });

        // Add discount details if discount was applied
        if (totalDiscount > 0) {
            itemsBody.push([
                { content: `Total Discount:`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                { content: `- ` + PdfUtils.formatCurrency(totalDiscount, currencyCode), styles: { halign: 'right' } }
            ]);
        }

        // Add tax rows if enabled
        if (data.gstEnabled) {
            if (data.isInterState) {
                itemsBody.push([
                    { content: `IGST (${data.igstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatCurrency(data.igstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
            } else {
                itemsBody.push([
                    { content: `CGST (${data.cgstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatCurrency(data.cgstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
                itemsBody.push([
                    { content: `SGST (${data.sgstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatCurrency(data.sgstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
            }
        }

        // Round Off (domestic INR quotations only, when enabled in Visible Columns):
        // round the grand total to the nearest rupee and show the adjustment above it.
        let displayGrand = data.grandTotal;
        const roundOffOn = colVisibility.roundOff === true && _quMode === 'domestic' && currencyCode === 'INR';
        if (roundOffOn) {
            const ro = PdfUtils.roundOffTotal(data.grandTotal);
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
                        fillColor: [255, 255, 255], // White background
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
                        fillColor: [255, 255, 255], // White background
                        textColor: [51, 51, 51],     // Standard text color
                        lineColor: [224, 224, 224],  // Standard table border color
                        lineWidth: 0.2
                    }
                }
            ]);

            // Add Amount in Words row inside table
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

        // Pre-table space check (let autoTable handle pagination if needed, but we keep it target page 1)

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
            showHead: 'firstPage',
            margin: { left: margin, right: margin, bottom: 5 },
            styles: {
                font: 'helvetica',
                fontSize: 9.5,
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

        doc.setPage(1);
        y = doc.lastAutoTable.finalY + 6;

        // --- Terms & Conditions ---
        if (data.terms && data.terms.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('TERMS & CONDITIONS', margin, y);
            
            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, margin + contentWidth, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);
            data.terms.forEach(term => {
                const lines = doc.splitTextToSize(term, contentWidth - 6);
                doc.text('•', margin + 2, y);
                lines.forEach(line => {
                    doc.text(line, margin + 6, y);
                    y += 3.8;
                });
                y += 0.5;
            });
        }

        // --- Signature & Stamp (bottom-right, when enabled in Visible Columns) ---
        const quSigVisible = Storage.getQUColumnVisibility().signature === true;
        const quSettings = Storage.getSettings();
        const quSigImg = quSettings.signImagePoQu;
        // Fixed company heading, always printed bottom-right (independent of the
        // Signature toggle). The signature image below it is shown only when enabled.
        {
            const rightEdge = pageWidth - margin;
            let hy = y + 4;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8.5);
            doc.setTextColor(51, 51, 51);
            doc.text('For ' + (PdfUtils.activeCompany().name || ''), rightEdge, hy, { align: 'right' });
            hy += 2;
            if (quSigVisible && quSigImg) {
                const maxW = 35;
                const dims = await PdfUtils.getImageDimensions(quSigImg);
                const imgW = maxW;
                const imgH = dims ? maxW * (dims.h / dims.w) : 22;
                try {
                    const sig = await PdfUtils.rasterizeForPrint(quSigImg, imgW, imgH);
                    doc.addImage(sig, PdfUtils.getDataUrlFormat(sig), rightEdge - imgW, hy, imgW, imgH, undefined, 'FAST');
                } catch (e) { console.warn('Quotation signature image error', e); }
                hy += imgH;
            } else {
                // No signature image — print " - SD " placeholder centered over "Authorized signatory".
                // Equal spacing: 8mm above SD (2+6), 8mm below SD (4+4).
                hy += 6;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                const authSignW = doc.getTextWidth('Authorized signatory');
                const authSignCenter = rightEdge - authSignW / 2;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(51, 51, 51);
                doc.text(' - SD ', authSignCenter, hy, { align: 'center' });
                hy += 4;
            }
            // Fixed "Authorized signatory" caption below the sign/stamp space.
            hy += 4;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(90, 90, 90);
            doc.text('Authorized signatory', rightEdge, hy, { align: 'right' });
        }

        // Clean up any extra pages to strictly enforce single page layout
        while (doc.internal.getNumberOfPages() > 1) {
            doc.deletePage(doc.internal.getNumberOfPages());
        }

        // Flatten to an image-based PDF (so text can't be copied) ONLY for the file
        // that leaves the app — download/save/email. The on-screen preview skips it
        // and opens instantly for the signed-in user who already owns this data.
        if (action !== 'view') {
            doc = await PdfUtils.flattenToImagePdf(doc);
        }

        // --- Output Action ---
        if (action === 'view') {
            PdfUtils.openPdfPreview(doc, targetWin, `${data.refNumber || 'Quotation'} Preview`);
            return;
        } else {
            // download action
            let filename = `${data.refNumber.replace(/[\/\\]/g, '_')}.pdf`;
            
            const userPaths = Storage.getUserPaths();
            const quPath = (data.mode || _quMode) === 'domestic'
                ? userPaths.quSavePathDom
                : userPaths.quSavePathIntl;
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
                            save_path: quPath || ''
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

                        App.showLoading('Generating Quotation PDF...');
                        // Send request again with overwrite = true
                        const response2 = await fetch('/api/save-pdf', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'same-origin',
                            body: JSON.stringify({
                                pdf_data: pdfBase64,
                                filename: filename,
                                save_path: quPath || '',
                                overwrite: true
                            })
                        });
                        resData = await response2.json();
                        finalResponse = response2;
                    }

                    if (finalResponse.ok && resData.success) {
                        // Local folder copy → done. Cloud-only → fall through to
                        // the browser download so the user still gets the PDF.
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


    function saveDefaultTerms() {
        const terms = [];
        document.querySelectorAll('#qu-terms-list .dynamic-list-item input').forEach(inp => {
            const val = inp.value.trim();
            if (val) terms.push(val);
        });
        const settings = Storage.getSettings();
        settings.quDefaultTerms = terms;
        Storage.saveSettings(settings);
        App.showToast('Default Payment Terms saved!', 'success');
    }

    // --- Helpers ---
    function parseDiscount(val) {
        if (!val) return 0;
        const str = String(val).replace(/%/g, '').trim();
        const parsed = parseFloat(str);
        return isNaN(parsed) ? 0 : parsed;
    }

    function _todayISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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

    return {
        render, addItem, removeItem, calcRow, recalcTax,
        addTerm, removeTerm, saveDefaultTerms,
        generate, generatePDF, save, saveAndDownload,
        onClientSelect, showAddClient, hideAddClient, saveNewClient, updateClientDropdown,
        handleCurrencyChange, getSelectedCurrency, updateAutoRefNumber,
        renderDashboard, showDashboardView, showCreateView, showEditView,
        openTypeModal, closeTypeModal, selectTypeAndCreate,
        applyDashFilters, resetDashFilters, changeDashPage, changeDashPageSize,
        deleteQUDash, toggleDashFilters, isFormActive, resetToDashboard
    };
})();
