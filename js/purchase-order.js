/* ============================================
   Purchase Order Module — form + PDF generation
   ============================================ */

const PurchaseOrder = (() => {
    // Default company details
    const COMPANY = PdfUtils.COMPANY;

    const CURRENCY_MAP = PdfUtils.CURRENCY_MAP;

    const DEFAULT_TERMS = [
        'Price is exclusive of GST.',
        'The invoice shall be raised in accordance with the work as verified by the relevant project manager.',
        'Payment will be processed on realization from the end-client.',
        'The scope of work and other terms & conditions shall be as outlined in the annexure.',
        'GST will be cleared on submission of the b2b copies.',
        'TDS to be deducted as applicable.'
    ];

    // Reporting departments (reference only — not printed on the PDF). The PO list
    // additionally carries "Admin" for administrative/overhead purchase orders.
    const DEPARTMENTS = ['Engineering', 'Consulting', 'Projects', 'Support', 'Admin'];

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
                <input type="hidden" id="po-department" value="${_escapeAttr(sel)}">
            </div>`;
    }

    let itemCount = 1;
    let termCount = 0;
    let conditionCount = 0;
    let _poOutsideClickHandler = null;
    // Holds the uploaded reference (quotation) file for the PO being created/edited
    let _pendingRefFile = null;
    // When editing an existing PO, holds its id so save overwrites the same record
    // (same PO number). null = new document (or a revision).
    let _editingId = null;

    // --- Purchase Order Dashboard State ---
    let _currentView = 'dashboard'; // 'dashboard' | 'form'
    let _dashSearch = '';
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
        const dashView = document.getElementById('po-dashboard-view');
        const formView = document.getElementById('po-form-view');
        if (dashView) dashView.style.display = 'block';
        if (formView) formView.style.display = 'none';
        renderDashboard();
    }

    function showCreateView() {
        _currentView = 'form';
        const dashView = document.getElementById('po-dashboard-view');
        const formView = document.getElementById('po-form-view');
        if (dashView) dashView.style.display = 'none';
        if (formView) formView.style.display = 'block';
        const titleEl = document.getElementById('po-form-header-title');
        const subEl = document.getElementById('po-form-header-subtitle');
        if (titleEl) titleEl.textContent = 'Issue Purchase Order';
        if (subEl) subEl.textContent = 'Create and generate a new Purchase Order';
        render(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showEditView(poIdOrData) {
        const data = typeof poIdOrData === 'string' ? Storage.getPO(poIdOrData) : poIdOrData;
        _currentView = 'form';
        const dashView = document.getElementById('po-dashboard-view');
        const formView = document.getElementById('po-form-view');
        if (dashView) dashView.style.display = 'none';
        if (formView) formView.style.display = 'block';
        const titleEl = document.getElementById('po-form-header-title');
        const subEl = document.getElementById('po-form-header-subtitle');
        const poNo = data ? (data.poNumber || data.refNumber || '') : '';
        if (titleEl) titleEl.textContent = poNo ? `Edit Purchase Order — ${poNo}` : 'Edit Purchase Order';
        if (subEl) subEl.textContent = 'Modify and regenerate this Purchase Order';
        render(data);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function toggleDashFilters() {
        _dashFiltersVisible = !_dashFiltersVisible;
        const el = document.getElementById('po-dash-filters-wrapper');
        if (el) el.style.display = _dashFiltersVisible ? 'block' : 'none';
        const btn = document.getElementById('btn-po-dash-filter-toggle');
        if (btn) btn.classList.toggle('active', _dashFiltersVisible);
    }

    function applyDashFilters() {
        const searchInput = document.getElementById('po-dash-filter-search');
        const monthInput = document.getElementById('po-dash-filter-month');
        const fyInput = document.getElementById('po-dash-filter-fy');
        const deptInput = document.getElementById('po-dash-filter-dept');

        if (searchInput) _dashSearch = searchInput.value || '';
        if (monthInput) _dashMonth = monthInput.value || '';
        if (fyInput) _dashFy = fyInput.value || '';
        if (deptInput) _dashDept = deptInput.value || '';

        _dashPage = 1;
        renderDashboard();
    }

    function resetDashFilters() {
        Dashboard.clientSelection('po').clear();
        _dashSearch = '';
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

    function deletePODash(id) {
        Dashboard.deleteDoc('PO', id, renderDashboard);
    }

    function renderDashboard() {
        const container = document.getElementById('po-dashboard-content');
        if (!container) return;

        const docs = Storage.getAllPOs();
        Dashboard.registerClientFilter('po', () => docs, () => { _dashPage = 1; renderDashboard(); }, 'All Suppliers');
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

        // 3. Filter data
        const clientSel = Dashboard.clientSelection('po');
        let filtered = docs.filter(doc => {
            const q = _dashSearch.toLowerCase().trim();
            if (q) {
                const no = (doc.poNumber || doc.refNumber || '').toLowerCase();
                const sup = (doc.consignorName || '').toLowerCase();
                const dept = (doc.department || '').toLowerCase();
                const items = (doc.items || []).map(i => (i.specification || '').toLowerCase()).join(' ');
                if (!no.includes(q) && !sup.includes(q) && !dept.includes(q) && !items.includes(q)) return false;
            }
            if (clientSel.size && !clientSel.has((doc.consignorName || '').trim())) return false;
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

        const hasActiveFilters = !!(_dashSearch || clientSel.size || _dashMonth || _dashFy || _dashDept);

        // 4. Build Table Rows
        let rowsHtml = pageDocs.map(doc => {
            const docNo = doc.poNumber || doc.refNumber || '-';
            const dateStr = doc.date ? PdfUtils.formatDateDMY(doc.date) : '-';
            const supplier = doc.consignorName || '-';
            const dept = doc.department || '—';
            const cur = doc.currency || homeCur;
            const hasAmt = (doc.grandTotal !== undefined && doc.grandTotal !== null && doc.grandTotal !== '');
            const curSym = PdfUtils.currencySymbol(cur);
            const valStr = hasAmt ? `${curSym} ${PdfUtils.formatCurrency(doc.grandTotal, cur)}` : '—';
            const hasRef = !!doc.referenceFilePath;
            const isCompleted = doc.status === 'completed' || !doc.status;

            return `
                <tr>
                    <td style="font-weight: 600; text-align: left;">
                        <a href="javascript:void(0)" onclick="Dashboard.viewPdf('PO','${doc.id}')" style="color: #166534; text-decoration: none; font-weight: 700; border-bottom: 1px dashed rgba(22,101,52,0.4);" title="Click to view PDF">
                            ${_escapeHtml(docNo)}
                        </a>
                    </td>
                    <td style="white-space: nowrap; color: #52525b; text-align: left;">${dateStr}</td>
                    <td style="font-weight: 500; color: #27272a; text-align: left;">${_escapeHtml(supplier)}</td>
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
                            <button type="button" class="btn-icon-action" onclick="Dashboard.viewPdf('PO','${doc.id}')" title="View PDF" aria-label="View PDF" style="padding: 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); background: #fff; cursor: pointer; color: #166534; display: inline-flex; align-items: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button type="button" class="btn-icon-action" onclick="Dashboard.downloadPdf('PO','${doc.id}')" title="Download PDF" aria-label="Download PDF" style="padding: 6px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); background: #fff; cursor: pointer; color: #2563eb; display: inline-flex; align-items: center;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            </button>
                            <button type="button" class="btn-row-actions" onclick="Dashboard.toggleRowMenu(event,'PO','${doc.id}',${hasRef})" title="More Actions" aria-label="More Actions">⋮</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        if (!rowsHtml) {
            rowsHtml = `
                <tr>
                    <td colspan="7" style="padding: 50px 20px; text-align: center; color: #71717a;">
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
                            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(22,101,52,0.08); display: flex; align-items: center; justify-content: center; color: #166534;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            </div>
                            <div style="font-size: 15px; font-weight: 600; color: #18181b;">${docs.length === 0 ? 'No Purchase Orders issued yet' : 'No Purchase Orders match your filters'}</div>
                            <p style="margin: 0; font-size: 13px; color: #71717a; max-width: 380px;">
                                ${docs.length === 0 ? 'Click "Create New Purchase order" above to generate and issue your first purchase order.' : 'Try changing your search terms or clearing active filters to see all purchase orders.'}
                            </p>
                            ${hasActiveFilters ? `
                            <button type="button" class="btn btn-secondary" onclick="PurchaseOrder.resetDashFilters()" style="padding: 6px 14px; font-size: 12.5px; margin-top: 6px;">
                                Clear Filters
                            </button>
                            ` : `
                            <button type="button" class="btn btn-primary" onclick="PurchaseOrder.showCreateView()" style="padding: 8px 18px; font-size: 13px; margin-top: 6px; background: #166534; border: none; border-radius: 8px;">
                                + Create New Purchase order
                            </button>
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
                page: _dashPage, pageSize: _dashPageSize, total: totalFiltered, noun: 'orders',
                onPage: 'PurchaseOrder.changeDashPage', onSize: 'PurchaseOrder.changeDashPageSize'
            });
        }

        // 6. Assemble HTML
        container.innerHTML = `
            <!-- Table Card Section -->
            <div class="recent-section" style="background: #fff; border: 1px solid rgba(0,0,0,0.07); border-radius: 18px; padding: 22px; box-shadow: 0 4px 20px rgba(0,0,0,0.02);">
                <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
                    <div>
                        <h2 style="font-size: 17.5px; font-weight: 700; color: #18181b; margin: 0 0 3px;">Issued Purchase Orders</h2>
                        <p style="margin: 0; font-size: 12.5px; color: #71717a;">All purchase orders issued to suppliers and vendors</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button type="button" class="btn btn-add${_dashFiltersVisible ? ' active' : ''}" id="btn-po-dash-filter-toggle" onclick="PurchaseOrder.toggleDashFilters()" style="padding: 7px 14px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                            <span>Filter</span>
                            ${hasActiveFilters ? '<span style="width:7px; height:7px; border-radius:50%; background:#166534; display:inline-block;"></span>' : ''}
                        </button>
                    </div>
                </div>

                <!-- Filters Bar (Collapsible) -->
                <div id="po-dash-filters-wrapper" style="display: ${_dashFiltersVisible ? 'block' : 'none'}; margin-bottom: 18px; padding: 14px 16px; background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.05); border-radius: 10px;">
                    <div class="dashboard-filters" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="po-dash-filter-search" class="dashboard-filter-input" placeholder="Search PO No, Supplier, Items..." oninput="Dashboard.keepFocus(PurchaseOrder.applyDashFilters)" style="width: 240px; font-size: 13px;" value="${_escapeAttr(_dashSearch)}">

                        <!-- Supplier Filter (shared grouped multi-select) -->
                        ${Dashboard.renderClientFilter('po', { width: 170 })}

                        <!-- Month Filter -->
                        <div class="custom-select-wrapper" style="width: 140px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(monthLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashMonth === '' ? ' selected' : ''}" data-value="">All Months</div>
                                ${Object.keys(monthNames).filter(Boolean).map(k => `<div class="custom-option${_dashMonth === k ? ' selected' : ''}" data-value="${k}">${monthNames[k]}</div>`).join('')}
                            </div>
                            <input type="hidden" id="po-dash-filter-month" value="${_escapeAttr(_dashMonth)}" onchange="PurchaseOrder.applyDashFilters()">
                        </div>

                        <!-- FY Filter -->
                        <div class="custom-select-wrapper" style="width: 125px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(fyLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashFy === '' ? ' selected' : ''}" data-value="">All FY</div>
                                ${uniqueFys.map(f => `<div class="custom-option${_dashFy === f ? ' selected' : ''}" data-value="${_escapeAttr(f)}">${f}</div>`).join('')}
                            </div>
                            <input type="hidden" id="po-dash-filter-fy" value="${_escapeAttr(_dashFy)}" onchange="PurchaseOrder.applyDashFilters()">
                        </div>

                        <!-- Department Filter -->
                        <div class="custom-select-wrapper" style="width: 155px;">
                            <div class="custom-select-trigger" style="justify-content: space-between; text-align: left; font-size: 12.5px;">
                                <span>${_escapeHtml(deptLabel)}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option${_dashDept === '' ? ' selected' : ''}" data-value="">All Departments</div>
                                ${DEPARTMENTS.map(d => `<div class="custom-option${_dashDept === d ? ' selected' : ''}" data-value="${_escapeAttr(d)}">${_escapeHtml(d)}</div>`).join('')}
                            </div>
                            <input type="hidden" id="po-dash-filter-dept" value="${_escapeAttr(_dashDept)}" onchange="PurchaseOrder.applyDashFilters()">
                        </div>

                        ${hasActiveFilters ? `
                        <button type="button" class="btn btn-secondary" onclick="PurchaseOrder.resetDashFilters()" style="padding: 7px 12px; font-size: 12px; border-radius: 8px;">
                            Clear
                        </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Table -->
                <div class="recent-table" style="overflow-x: auto;">
                    <table>
                        <thead>
                            <tr>
                                <th style="text-align: left;">PO Number</th>
                                <th style="text-align: left;">Date</th>
                                <th style="text-align: left;">Supplier</th>
                                <th style="text-align: left;">Department</th>
                                <th style="text-align: right;">Total Amount</th>
                                <th style="text-align: center;">Status</th>
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

    function render(editData = null) {
        const container = document.getElementById('po-content');
        if (!container) return;
        const vendors = Storage.getAllSuppliers();

        // If editData is provided, switch to form view and set edit title
        if (editData && (editData.id || editData.poNumber || editData.consignorName)) {
            _currentView = 'form';
            const dashView = document.getElementById('po-dashboard-view');
            const formView = document.getElementById('po-form-view');
            if (dashView) dashView.style.display = 'none';
            if (formView) formView.style.display = 'block';
            const titleEl = document.getElementById('po-form-header-title');
            const subEl = document.getElementById('po-form-header-subtitle');
            const poNo = editData.poNumber || editData.refNumber || '';
            if (titleEl) titleEl.textContent = poNo ? `Edit Purchase Order — ${poNo}` : 'Edit Purchase Order';
            if (subEl) subEl.textContent = 'Modify and regenerate this Purchase Order';
        }

        // Editing keeps the id (save overwrites); revise strips it (save creates new).
        _editingId = (editData && editData.id) ? editData.id : null;

        let selectedVendorId = '';
        let selectedVendorName = '— Select a saved supplier —';
        if (editData && editData.consignorName) {
            const matchedVendor = vendors.find(v => v.name === editData.consignorName);
            if (matchedVendor) {
                selectedVendorId = matchedVendor.id;
                selectedVendorName = matchedVendor.name;
            } else {
                selectedVendorName = editData.consignorName;
            }
        }

        const vendorCustomOptions = vendors.map(v =>
            `<div class="custom-option${v.id === selectedVendorId ? ' selected' : ''}" data-value="${v.id}">${_escapeAttr(v.name)}</div>`
        ).join('');

        const settings = Storage.getSettings();
        const cgstDefault = settings.cgst !== undefined ? settings.cgst : 9;
        const sgstDefault = settings.sgst !== undefined ? settings.sgst : 9;

        container.innerHTML = `
            <!-- PO Header & Consignor (Vendor) -->
            <div class="form-container">
                <div class="form-row">
                    <div class="form-group">
                        <label>PO Number <span style="color: #ef4444;">*</span></label>
                        <input type="text" id="po-number" placeholder="e.g., ORG001/ABC001/PO/26-27" value="${editData ? _escapeAttr(editData.poNumber) : ''}" data-auto-generated="${editData ? 'false' : 'true'}">
                    </div>
                    <div class="form-group">
                        <label>Date <span style="color: #ef4444;">*</span></label>
                        <input type="date" id="po-date" max="9999-12-31" value="${editData ? editData.date : _todayISO()}" onchange="PurchaseOrder.updateAutoPONumber()">
                    </div>
                </div>

                <div class="form-row" style="margin-top: 16px;">
                    <div class="form-group">
                        <label>Select Supplier <span style="color: #ef4444;">*</span></label>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            <div style="display:flex; gap:8px;">
                                <div class="custom-select-wrapper searchable-select" style="flex:1">
                                    <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                        <span>${_escapeAttr(selectedVendorName)}</span>
                                    </div>
                                    <div class="custom-options" id="po-vendor-custom-options">
                                        <div class="custom-option${selectedVendorId === '' ? ' selected' : ''}" data-value="">— Select a saved supplier —</div>
                                        ${vendorCustomOptions}
                                    </div>
                                    <input type="hidden" id="po-vendor-select" value="${selectedVendorId}">
                                </div>
                                <button class="btn btn-add" onclick="PurchaseOrder.showAddVendor()" style="white-space:nowrap">+ Add New</button>
                            </div>
                            <!-- Sub Vendor select -->
                            <div id="po-sub-vendor-wrapper" class="custom-select-wrapper searchable-select" style="display:none; width:100%;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>— Select Supplier —</span>
                                </div>
                                <div class="custom-options" id="po-sub-vendor-custom-options">
                                </div>
                                <input type="hidden" id="po-sub-vendor-select" value="">
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Reference</label>
                        <div style="display:flex; gap:8px;">
                            <input type="text" id="po-ref-mode" placeholder="e.g., Email, Phone call, Letter" value="${editData && editData.referenceMode ? _escapeAttr(editData.referenceMode) : ''}" style="flex:1;">
                            <button id="po-ref-file-btn" class="btn btn-add" type="button" onclick="PurchaseOrder.triggerRefFileUpload()" style="white-space:nowrap; ${editData && editData.referenceFilePath ? 'display:none;' : ''}">+ Add File</button>
                        </div>
                        <div id="po-ref-file-indicator" style="margin-top:6px; font-size:12px; color:var(--text-secondary); ${editData && editData.referenceFilePath ? '' : 'display:none;'}">
                            📎 <a id="po-ref-file-link" onclick="PurchaseOrder.viewRefFile()" title="View attached file" style="color:var(--accent-green); cursor:pointer; text-decoration:underline;">${editData && editData.referenceFilePath ? _escapeHtml(editData.referenceFileName || editData.referenceFilePath.split('/').pop() || 'Attached File') : ''}</a>
                            <span onclick="PurchaseOrder.removeRefFile()" title="Remove file" style="cursor:pointer; color:#ef4444; margin-left:8px; font-weight:700;">✕</span>
                        </div>
                        <input type="file" id="po-ref-file-input" accept=".pdf,application/pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style="display:none" onchange="PurchaseOrder.handleRefFileUpload(this)">
                    </div>
                </div>

                <div class="form-row" style="margin-top: 16px;">
                    <div class="form-group">
                        <label>Department</label>
                        ${_departmentSelectHTML(editData ? editData.department : '')}
                    </div>
                    <div class="form-group"></div>
                </div>

                <!-- Vendor details (auto-filled or manual) -->
                <div id="po-vendor-fields" style="display:none;">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Company Name</label>
                            <input type="text" id="po-consignor-name" placeholder="Vendor company name" value="${editData ? _escapeAttr(editData.consignorName) : ''}">
                        </div>
                        <div class="form-group">
                            <label>GST</label>
                            <input type="text" id="po-consignor-gst" placeholder="GST number" value="${editData ? _escapeAttr(editData.consignorGST) : ''}">
                        </div>
                    </div>
                    <div class="form-row single">
                        <div class="form-group">
                            <label>Address</label>
                            <textarea id="po-consignor-address" rows="2" placeholder="Full address">${editData ? _escapeHtml(editData.consignorAddress) : ''}</textarea>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Contact Person Name</label>
                            <input type="text" id="po-consignor-contact-person" placeholder="Contact person name" value="${editData ? _escapeAttr(editData.consignorContactPerson) : ''}">
                        </div>
                        <div class="form-group"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Contact</label>
                            <input type="text" id="po-consignor-contact" placeholder="Phone number" value="${editData ? _escapeAttr(editData.consignorContact) : ''}">
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="po-consignor-email" placeholder="Email address" value="${editData ? _escapeAttr(editData.consignorEmail) : ''}">
                        </div>
                    </div>
                    <!-- Inline actions to save newly added vendor -->
                    <div id="po-vendor-save-actions" style="display:none; gap:8px; margin-top:16px;">
                        <button class="btn btn-generate" style="padding:10px 24px; font-size:13px;" onclick="PurchaseOrder.saveNewVendor()">Save</button>
                        <button class="btn btn-secondary" style="padding:10px 20px; font-size:13px;" onclick="PurchaseOrder.hideAddVendor()">Cancel</button>
                    </div>
                </div>
            </div>

            <!-- Item Details -->
            <div class="form-container">
                <div class="items-table-wrapper">
                    <table class="items-table" id="po-items-table">
                        <thead>
                            <tr>
                                <th class="col-sno">S.No</th>
                                <th class="col-name">Item / Particulars</th>
                                <th class="col-desc">Detailed Specification</th>
                                <th class="col-uom">UOM</th>
                                <th class="col-qty">Qty</th>
                                <th class="col-rate">Unit Rate</th>
                                <th class="col-discount">Discount</th>
                                <th class="col-amount">Amount</th>
                                <th class="col-actions"></th>
                            </tr>
                        </thead>
                        <tbody id="po-items-body">
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:10px">
                    <button class="btn btn-add" onclick="PurchaseOrder.addItem()">+ Add Item</button>
                </div>
                <div style="margin-top: 16px; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 16px;">
                    <div class="total-row" id="po-subtotal-row" style="display: none;">
                        <span class="total-label">Sub Total (excl. Tax):</span>
                        <span class="total-value" id="po-subtotal-display">0.00</span>
                    </div>
                    <div class="total-row" id="po-discount-row" style="display: none;">
                        <span class="total-label">Total Discount:</span>
                        <span class="total-value" id="po-discount-display">0.00</span>
                    </div>
                    <div class="total-row" id="po-cgst-row" style="display: none;">
                        <span class="total-label" id="po-cgst-label">CGST Amount:</span>
                        <span class="total-value" id="po-cgst-display">0.00</span>
                    </div>
                    <div class="total-row" id="po-sgst-row" style="display: none;">
                        <span class="total-label" id="po-sgst-label">SGST Amount:</span>
                        <span class="total-value" id="po-sgst-display">0.00</span>
                    </div>
                    <div class="total-row" id="po-igst-row" style="display: none;">
                        <span class="total-label" id="po-igst-label">IGST Amount:</span>
                        <span class="total-value" id="po-igst-display">0.00</span>
                    </div>
                    <div class="total-row" style="display: flex; justify-content: flex-end; gap: 16px;">
                        <span class="total-label" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">Grand Total:</span>
                        <span class="total-value" id="po-total-display" style="font-size: 15px; font-weight: 700; color: var(--text-primary); min-width: 120px; text-align: right;">0.00</span>
                    </div>
                </div>
            </div>

            <!-- Terms of Payment -->
            <div class="form-container">
                <div class="form-section-title">Terms of Payment</div>
                <div class="dynamic-list" id="po-terms-list"></div>
                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button class="btn btn-add" onclick="PurchaseOrder.addTerm()">+ Add Term</button>
                    <button class="btn btn-secondary" onclick="PurchaseOrder.saveDefaultTerms()" style="padding: 8px 16px; font-size: 13px;">Save as Defaults</button>
                </div>
            </div>

            <!-- General Terms & Conditions (optional) -->
            <div class="form-container">
                <div class="form-section-title">General Terms & Conditions <span style="font-weight:400; color:#999; font-size:12px;">(Optional)</span></div>
                <div class="dynamic-list" id="po-conditions-list"></div>
                <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <button class="btn btn-add" onclick="PurchaseOrder.addCondition()">+ Add Condition</button>
                    <button class="btn btn-secondary" onclick="PurchaseOrder.saveDefaultConditions()" style="padding: 8px 16px; font-size: 13px;">Save as Defaults</button>
                </div>
            </div>

            <!-- Signature and Stamp pre-loaded statically -->

            <!-- Generate Button -->
            <div class="form-container" style="text-align: center; padding: 20px 0;">
                <button class="btn btn-secondary" onclick="PurchaseOrder.save()" style="padding: 12px 40px; font-size: 14px; margin-right: 12px;">Save</button>
                <button class="btn btn-generate" onclick="PurchaseOrder.saveAndDownload()" style="padding: 12px 40px; font-size: 14px;">Save &amp; Download</button>
            </div>
        `;

        // Initialize with items and terms
        itemCount = 0;
        termCount = 0;
        conditionCount = 0;
        _pendingRefFile = (editData && editData.referenceFilePath)
            ? { 
                fileName: editData.referenceFileName || editData.referenceFilePath.split('/').pop() || 'Attached File', 
                filePath: editData.referenceFilePath 
              }
            : null;

        const tbody = document.getElementById('po-items-body');
        if (tbody) tbody.innerHTML = '';
        const termsList = document.getElementById('po-terms-list');
        if (termsList) termsList.innerHTML = '';
        const condList = document.getElementById('po-conditions-list');
        if (condList) condList.innerHTML = '';

        if (editData && editData.items && editData.items.length > 0) {
            editData.items.forEach(it => {
                addItem(it);
            });
        } else {
            addItem();
        }

        const termsToLoad = (editData && editData.terms) ? editData.terms : (settings.poDefaultTerms || DEFAULT_TERMS);
        termsToLoad.forEach(t => addTerm(t));

        const condsToLoad = (editData && editData.conditions) ? editData.conditions : (settings.poDefaultConditions || []);
        condsToLoad.forEach(c => addCondition(c));

        if (editData && editData.currency) {
            setTimeout(() => {
                const dummy = document.createElement('input');
                dummy.value = editData.currency;
                handleCurrencyChange(dummy);
            }, 0);
        }

        const poNumInput = document.getElementById('po-number');
        if (poNumInput) {
            poNumInput.addEventListener('input', () => {
                poNumInput.setAttribute('data-auto-generated', 'false');
            });
        }

        const consignorNameInput = document.getElementById('po-consignor-name');
        if (consignorNameInput) {
            consignorNameInput.addEventListener('input', () => {
                PurchaseOrder.updateAutoPONumber();
            });
        }

        PurchaseOrder.updateAutoPONumber();

        // Sync settings with the document's saved tax settings if revising/editing
        if (editData && editData.gstEnabled !== undefined) {
            settings.gstEnabled = !!editData.gstEnabled;
            Storage.saveSettings(settings);

            // Sync all checkboxes across forms
            const quGst = document.getElementById('qu-gst-toggle');
            const invGst = document.getElementById('inv-gst-toggle');
            if (quGst) quGst.checked = settings.gstEnabled;
            if (invGst) invGst.checked = settings.gstEnabled;
        }

        // On edit/revise the vendor is already saved — keep the detail fields collapsed
        // and just show the selected vendor in the dropdown (cleaner; data is retained).

        _rebuildCurrencyOptions();
        _setupColumnSettings();

        recalcTax();

        const poGst = document.getElementById('po-gst-toggle');
        if (poGst) poGst.checked = settings.gstEnabled === true;
    }

    function _rebuildCurrencyOptions() {
        const currencies = Object.keys(PdfUtils.CURRENCY_MAP);
        const target = getSelectedCurrency();
        document.querySelectorAll('#po-items-body tr').forEach(row => {
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
        const toggleList = document.getElementById('po-column-toggle-list');
        if (!toggleList) return;

        const visibility = Storage.getPOColumnVisibility();
        const table = document.getElementById('po-items-table');

        // Apply classes to table
        Object.keys(visibility).forEach(key => {
            if (key === 'signature') return; // PDF-only flag, not a table column
            if (table) {
                if (['sno', 'qty', 'rate', 'amount'].includes(key)) {
                    table.classList.remove(`hide-col-${key}`);
                    return;
                }
                const classSuffix = key === 'spec' ? 'desc' : key;
                if (visibility[key] === false) {
                    table.classList.add(`hide-col-${classSuffix}`);
                } else {
                    table.classList.remove(`hide-col-${classSuffix}`);
                }
            }
        });

        // Column Labels Map (sno, qty, rate, amount removed to make them permanently visible)
        const columnLabels = {
            name: 'Item / Particulars',
            spec: 'Detailed Specification',
            uom: 'UOM',
            discount: 'Discount'
        };

        // Populate checkboxes
        toggleList.innerHTML = Object.keys(columnLabels).map(key => {
            const checked = visibility[key] !== false ? 'checked' : '';
            return `
                <div class="po-column-toggle-item" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
                    <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">${columnLabels[key]}</span>
                    <label class="switch">
                        <input type="checkbox" class="po-col-toggle-input" data-col="${key}" ${checked}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
        }).join('');

        // Bind change events
        toggleList.querySelectorAll('.po-col-toggle-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const colKey = e.target.dataset.col;
                const isChecked = e.target.checked;

                // Validation: prevent hiding both Item/Particulars (name) and Detailed Specification (spec) at the same time
                if (colKey === 'name' && !isChecked) {
                    const currentVisibility = Storage.getPOColumnVisibility();
                    if (currentVisibility.spec === false) {
                        _toggleColumn('spec', true);
                        const specInput = toggleList.querySelector('input[data-col="spec"]');
                        if (specInput) specInput.checked = true;
                    }
                } else if (colKey === 'spec' && !isChecked) {
                    const currentVisibility = Storage.getPOColumnVisibility();
                    if (currentVisibility.name === false) {
                        _toggleColumn('name', true);
                        const nameInput = toggleList.querySelector('input[data-col="name"]');
                        if (nameInput) nameInput.checked = true;
                    }
                }

                // Validation: prevent hiding all columns
                const currentVisibility = Storage.getPOColumnVisibility();
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
        const poSigItem = document.createElement('div');
        poSigItem.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0 4px; border-top:1px solid rgba(0,0,0,0.08); margin-top:6px;';
        poSigItem.innerHTML = `
            <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">Signature &amp; Stamp</span>
            <label class="switch">
                <input type="checkbox" id="po-signature-toggle" ${visibility.signature === true ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;
        toggleList.appendChild(poSigItem);
        const poSigInput = poSigItem.querySelector('#po-signature-toggle');
        if (poSigInput) {
            poSigInput.addEventListener('change', (e) => {
                const v = Storage.getPOColumnVisibility();
                v.signature = e.target.checked;
                Storage.savePOColumnVisibility(v);
            });
        }

        // Round Off toggle (INR purchase orders) — rounds the grand total to
        // the nearest rupee and prints the adjustment above the amount in words.
        const poRoundItem = document.createElement('div');
        poRoundItem.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0 4px; border-top:1px solid rgba(0,0,0,0.08); margin-top:6px;';
        poRoundItem.innerHTML = `
            <span style="font-size: 13.5px; color: var(--text-primary); font-weight: 500;">Round Off</span>
            <label class="switch">
                <input type="checkbox" id="po-roundoff-toggle" ${visibility.roundOff === true ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        `;
        toggleList.appendChild(poRoundItem);
        const poRoundInput = poRoundItem.querySelector('#po-roundoff-toggle');
        if (poRoundInput) {
            poRoundInput.addEventListener('change', (e) => {
                const v = Storage.getPOColumnVisibility();
                v.roundOff = e.target.checked;
                Storage.savePOColumnVisibility(v);
            });
        }

        // Wire show/hide click and click outside
        const settingsBtn = document.getElementById('po-columns-settings-btn');
        const settingsDropdown = document.getElementById('po-columns-settings-dropdown');

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
            if (_poOutsideClickHandler) {
                document.removeEventListener('click', _poOutsideClickHandler);
            }
            _poOutsideClickHandler = (e) => {
                const dropdown = document.getElementById('po-columns-settings-dropdown');
                const btn = document.getElementById('po-columns-settings-btn');
                if (!dropdown) {
                    document.removeEventListener('click', _poOutsideClickHandler);
                    _poOutsideClickHandler = null;
                    return;
                }
                if (dropdown && btn && !dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            };
            document.addEventListener('click', _poOutsideClickHandler);
        }

        // Ensure the reference file is displayed correctly in the UI on load/render
        const indicator = document.getElementById('po-ref-file-indicator');
        const link = document.getElementById('po-ref-file-link');
        const btn = document.getElementById('po-ref-file-btn');
        if (indicator && link) {
            if (_pendingRefFile) {
                link.textContent = _pendingRefFile.fileName || 'Attached File';
                link.setAttribute('title', 'View attached file');
                indicator.style.display = 'block';
                if (btn) btn.style.display = 'none';
            } else {
                indicator.style.display = 'none';
                link.textContent = '';
                if (btn) btn.style.display = '';
            }
        }
        updateVendorDropdown();
    }

    function _toggleColumn(colKey, isChecked) {
        const visibility = Storage.getPOColumnVisibility();
        visibility[colKey] = isChecked;
        Storage.savePOColumnVisibility(visibility);

        const table = document.getElementById('po-items-table');
        if (table) {
            const classSuffix = colKey === 'spec' ? 'desc' : colKey;
            if (isChecked) {
                table.classList.remove(`hide-col-${classSuffix}`);
            } else {
                table.classList.add(`hide-col-${classSuffix}`);
            }
        }
        recalcTax();
    }

    // --- Vendor dropdown handlers ---
    function onVendorSelect() {
        const sel = document.getElementById('po-vendor-select');
        const vendorId = sel.value;
        const fieldsDiv = document.getElementById('po-vendor-fields');
        const actionsDiv = document.getElementById('po-vendor-save-actions');

        // Always hide fields and actions when selecting or deselecting a saved vendor
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        if (!vendorId) {
            document.getElementById('po-consignor-name').value = '';
            document.getElementById('po-consignor-gst').value = '';
            document.getElementById('po-consignor-address').value = '';
            document.getElementById('po-consignor-contact-person').value = '';
            document.getElementById('po-consignor-contact').value = '';
            document.getElementById('po-consignor-email').value = '';
            return;
        }

        const vendor = Storage.getSupplier(vendorId);
        if (vendor) {
            document.getElementById('po-consignor-name').value = vendor.name || '';
            document.getElementById('po-consignor-gst').value = vendor.gst || '';
            document.getElementById('po-consignor-address').value = vendor.address || '';
            document.getElementById('po-consignor-contact-person').value = vendor.contactPerson || '';
            document.getElementById('po-consignor-contact').value = vendor.contact || '';
            document.getElementById('po-consignor-email').value = vendor.email || '';
        }
        updateAutoPONumber();
    }

    function updateAutoPONumber() {
        const poNumInput = document.getElementById('po-number');
        if (!poNumInput || poNumInput.getAttribute('data-auto-generated') !== 'true') return;

        const vendorNameInput = document.getElementById('po-consignor-name');
        const vendorName = vendorNameInput ? vendorNameInput.value.trim() : '';
        if (!vendorName) {
            poNumInput.value = '';
            return;
        }

        const dateInput = document.getElementById('po-date');
        const dateVal = dateInput ? dateInput.value : _todayISO();
        if (!dateVal) return;

        const fy = Storage.getFinancialYear(dateVal);
        const fyShort = Storage.getFinancialYearShort(dateVal);
        const clientCode = Storage.generateClientCode(vendorName);

        const orgSerial = String(Storage.peekNextSerialNumber('PO', '', fy)).padStart(3, '0');
        const clientSerial = String(Storage.peekNextSerialNumber('PO_CLIENT:' + clientCode, '', fy)).padStart(3, '0');

        poNumInput.value = `${Storage.getOrgInfo().serialPrefix}${orgSerial}/${clientCode}${clientSerial}/PO/${fyShort}`;
    }

    // --- Reference (quotation) file upload ---
    function triggerRefFileUpload() {
        const inp = document.getElementById('po-ref-file-input');
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
        const link = document.getElementById('po-ref-file-link');
        const indicator = document.getElementById('po-ref-file-indicator');
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
            _pendingRefFile = { fileName: result.filename, filePath: result.path };
            if (link) {
                link.textContent = result.filename;
                link.setAttribute('title', 'View attached file');
            }
            const btn = document.getElementById('po-ref-file-btn');
            if (btn) btn.style.display = 'none';
            input.value = '';
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Reference file attached', 'success');
            Storage.logActivity('user_action', `Uploaded PO Issue reference file: ${result.filename}`);
        } catch (e) {
            console.error('Reference file upload failed:', e);
            if (_pendingRefFile && _pendingRefFile.fileName) {
                if (link) link.textContent = _pendingRefFile.fileName;
            } else {
                if (indicator) indicator.style.display = 'none';
            }
            input.value = '';
            if (typeof App !== 'undefined' && App.showToast) App.showToast('Upload failed: ' + e.message, 'error');
        }
    }

    function viewRefFile() {
        if (_pendingRefFile && _pendingRefFile.filePath) {
            window.open(_pendingRefFile.filePath, '_blank');
        }
    }

    function removeRefFile() {
        _pendingRefFile = null;
        const indicator = document.getElementById('po-ref-file-indicator');
        if (indicator) indicator.style.display = 'none';
        const link = document.getElementById('po-ref-file-link');
        if (link) link.textContent = '';
        const input = document.getElementById('po-ref-file-input');
        if (input) input.value = '';
        const btn = document.getElementById('po-ref-file-btn');
        if (btn) btn.style.display = '';
        if (typeof App !== 'undefined' && App.showToast) App.showToast('Reference file removed', 'success');
    }

    function showAddVendor() {
        App.showAddContactModal('consignor', (data) => {
            document.getElementById('po-consignor-name').value = data.name;
            document.getElementById('po-consignor-gst').value = data.gst;
            document.getElementById('po-consignor-address').value = data.address;
            document.getElementById('po-consignor-contact-person').value = data.contactPerson;
            document.getElementById('po-consignor-contact').value = data.contact;
            document.getElementById('po-consignor-email').value = data.email;

            saveNewVendor();
        }, () => {
            // Cancel callback
            const sel = document.getElementById('po-vendor-select');
            if (sel) {
                sel.value = '';
                const wrapper = sel.closest('.custom-select-wrapper');
                if (wrapper) {
                    const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                    if (triggerSpan) triggerSpan.textContent = '— Select a saved supplier —';
                    wrapper.querySelectorAll('.custom-option').forEach(opt => {
                        if (opt.dataset.value === '') {
                            opt.classList.add('selected');
                        } else {
                            opt.classList.remove('selected');
                        }
                    });
                }
            }
        });
    }

    function hideAddVendor() {
        document.getElementById('po-consignor-name').value = '';
        document.getElementById('po-consignor-gst').value = '';
        document.getElementById('po-consignor-address').value = '';
        document.getElementById('po-consignor-contact-person').value = '';
        document.getElementById('po-consignor-contact').value = '';
        document.getElementById('po-consignor-email').value = '';

        const fieldsDiv = document.getElementById('po-vendor-fields');
        const actionsDiv = document.getElementById('po-vendor-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        const sel = document.getElementById('po-vendor-select');
        if (sel) {
            sel.value = '';
            const wrapper = sel.closest('.custom-select-wrapper');
            if (wrapper) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                if (triggerSpan) triggerSpan.textContent = '— Select a saved supplier —';
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

    function saveNewVendor() {
        const name = document.getElementById('po-consignor-name').value.trim();
        if (!name) {
            App.showToast('Please enter vendor company name', 'error');
            return;
        }
        const vendorData = {
            name: name,
            gst: document.getElementById('po-consignor-gst').value.trim(),
            address: document.getElementById('po-consignor-address').value.trim(),
            contactPerson: document.getElementById('po-consignor-contact-person').value.trim(),
            contact: document.getElementById('po-consignor-contact').value.trim(),
            email: document.getElementById('po-consignor-email').value.trim()
        };
        const saved = Storage.saveSupplier(vendorData);

        // Refresh custom dropdown options
        const vendors = Storage.getAllSuppliers();
        const customOptionsDiv = document.getElementById('po-vendor-custom-options');
        if (customOptionsDiv) {
            customOptionsDiv.innerHTML = '<div class="custom-option" data-value="">— Select a saved supplier —</div>' +
                vendors.map(v => `<div class="custom-option ${v.id === saved.id ? 'selected' : ''}" data-value="${v.id}">${_escapeAttr(v.name)}</div>`).join('');
        }

        const sel = document.getElementById('po-vendor-select');
        if (sel) {
            sel.value = saved.id;
            const wrapper = sel.closest('.custom-select-wrapper');
            if (wrapper) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                if (triggerSpan) triggerSpan.textContent = saved.name;
            }
        }

        // Keep fields populated behind the scenes, but hide them
        document.getElementById('po-consignor-name').value = saved.name || '';
        document.getElementById('po-consignor-gst').value = saved.gst || '';
        document.getElementById('po-consignor-address').value = saved.address || '';
        document.getElementById('po-consignor-contact-person').value = saved.contactPerson || '';
        document.getElementById('po-consignor-contact').value = saved.contact || '';
        document.getElementById('po-consignor-email').value = saved.email || '';

        const fieldsDiv = document.getElementById('po-vendor-fields');
        const actionsDiv = document.getElementById('po-vendor-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';

        App.showToast(`Vendor "${saved.name}" saved!`, 'success');
        updateAutoPONumber();
    }

    function updateVendorDropdown() {
        const vendors = Storage.getAllSuppliers();
        const selectedVal = document.getElementById('po-vendor-select')?.value || '';
        App.setupGroupedClientSelect('po', vendors, selectedVal, PurchaseOrder.onVendorSelect);
    }

    function handleCurrencyChange(select) {
        const val = select.value;
        // Scope to THIS form's items only — never touch other documents' rows.
        document.querySelectorAll('#po-items-body .item-currency').forEach(s => {
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
        const first = document.querySelector('#po-items-body .item-currency');
        if (first && first.value) return first.value;
        return 'INR';
    }

    function addItem(initData = null) {
        itemCount++;
        const currentCurrency = getSelectedCurrency();
        const tbody = document.getElementById('po-items-body');
        const tr = document.createElement('tr');
        tr.id = `po-item-${itemCount}`;

        const nameVal = initData ? initData.name : '';
        const specVal = initData ? initData.specification : '';
        const uomVal = initData ? initData.uom : 'Nos';
        const qtyVal = initData ? initData.qty : '';
        const rateVal = initData ? initData.rate : '';
        const discountVal = initData ? (initData.discount || '') : '';
        const amountVal = initData ? initData.amount : 0;

        const currencies = Object.keys(PdfUtils.CURRENCY_MAP);

        tr.innerHTML = `
            <td class="col-sno"><div class="sno-display">${itemCount}</div></td>
            <td class="col-name"><textarea class="item-name" placeholder="Item name" rows="2">${_escapeHtml(nameVal)}</textarea></td>
            <td class="col-desc"><textarea class="item-spec" placeholder="Specification details" rows="2">${_escapeHtml(specVal)}</textarea></td>
            <td class="col-uom">
                <div class="custom-select-wrapper uom-select">
                    <div class="custom-select-trigger">
                        <span>${_escapeAttr(uomVal)}</span>
                    </div>
                    <div class="custom-options">${App.uomOptionsHTML(uomVal)}</div>
                    <input type="hidden" class="item-uom" value="${_escapeAttr(uomVal)}">
                </div>
            </td>
            <td class="col-qty"><input type="number" class="item-qty" placeholder="0" min="0" step="any" oninput="PurchaseOrder.calcRow(this)" value="${qtyVal}"></td>
            <td class="col-rate">
                <div class="rate-currency-box">
                    <input type="number" class="item-rate" placeholder="0" min="0" step="any" oninput="PurchaseOrder.calcRow(this)" value="${rateVal}">
                    <div class="custom-select-wrapper currency-select">
                        <div class="custom-select-trigger">
                            <span>${currentCurrency}</span>
                        </div>
                        <div class="custom-options">
                            ${App.buildCurrencyOptionsHTML(currencies, currentCurrency)}
                        </div>
                        <input type="hidden" class="item-currency" value="${currentCurrency}" onchange="PurchaseOrder.handleCurrencyChange(this)">
                    </div>
                </div>
            </td>
            <td class="col-discount">
                <div class="custom-select-wrapper discount-select">
                    <div class="custom-select-trigger discount-trigger">
                        <input type="text" class="item-discount-input" placeholder="0%" value="${_escapeAttr(discountVal)}" oninput="PurchaseOrder.calcRow(this)">
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
            <td class="col-amount"><div class="amount-display item-amount">${PdfUtils.formatCurrency(amountVal, currentCurrency)}</div></td>
            <td class="col-actions"><button class="btn-remove" onclick="PurchaseOrder.removeItem(${itemCount})" title="Remove">×</button></td>
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
        const row = document.getElementById(`po-item-${id}`);
        if (row) {
            row.remove();
            _renumberItems();
            recalcTax();
        }
    }

    function calcRow(input) {
        const row = input.closest('tr');
        const colVisibility = Storage.getPOColumnVisibility();
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showDiscount = colVisibility.discount !== false;

        const qty = showQty ? (parseFloat(row.querySelector('.item-qty').value) || 0) : 1;
        const rate = showRate ? (parseFloat(row.querySelector('.item-rate').value) || 0) : 1;
        const discountVal = showDiscount ? (row.querySelector('.item-discount-input')?.value || '') : '';
        const discountPercent = parseDiscount(discountVal);

        const amount = FinanceUtils.truncate2(qty * rate * (1 - discountPercent / 100));
        const rowCurrency = getSelectedCurrency();
        row.querySelector('.item-amount').textContent = PdfUtils.formatCurrency(amount, rowCurrency);
        recalcTax();
    }

    function recalcTax() {
        const rows = document.querySelectorAll('#po-items-body tr');
        const colVisibility = Storage.getPOColumnVisibility();
        const showName = colVisibility.name !== false;
        const showSpec = colVisibility.spec !== false;
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showDiscount = colVisibility.discount !== false;

        let subtotal = 0;
        let totalDiscount = 0;
        rows.forEach(row => {
            const name = showName ? (row.querySelector('.item-name')?.value || '') : '';
            const spec = showSpec ? (row.querySelector('.item-spec')?.value || '') : '';
            const qty = showQty ? (parseFloat(row.querySelector('.item-qty')?.value) || 0) : 1;
            const rate = showRate ? (parseFloat(row.querySelector('.item-rate')?.value) || 0) : 1;
            const discountVal = showDiscount ? (row.querySelector('.item-discount-input')?.value || '') : '';
            const discountPercent = parseDiscount(discountVal);

            const nameEmpty = !showName || !name.trim();
            const specEmpty = !showSpec || !spec.trim();
            const qtyEmpty = showQty ? (parseFloat(row.querySelector('.item-qty')?.value) || 0) === 0 : true;
            const rateEmpty = showRate ? (parseFloat(row.querySelector('.item-rate')?.value) || 0) === 0 : true;

            if (nameEmpty && specEmpty && qtyEmpty && rateEmpty) return;

            const baseAmount = qty * rate;
            const rowDiscount = baseAmount * (discountPercent / 100);
            totalDiscount += rowDiscount;
            subtotal += FinanceUtils.truncate2(baseAmount - rowDiscount);
        });
        subtotal = FinanceUtils.truncate2(subtotal);

        const settings = Storage.getSettings();
        const vendorGst = document.getElementById('po-consignor-gst')?.value || '';
        const fin = FinanceUtils.calculateTotals(subtotal, settings, vendorGst);

        const subtotalRow = document.getElementById('po-subtotal-row');
        const discountRow = document.getElementById('po-discount-row');
        const cgstRow = document.getElementById('po-cgst-row');
        const sgstRow = document.getElementById('po-sgst-row');
        const igstRow = document.getElementById('po-igst-row');

        // Always hide breakdown rows from the dashboard screen
        if (subtotalRow) subtotalRow.style.display = 'none';
        if (discountRow) discountRow.style.display = 'none';
        if (cgstRow) cgstRow.style.display = 'none';
        if (sgstRow) sgstRow.style.display = 'none';
        if (igstRow) igstRow.style.display = 'none';

        const currency = getSelectedCurrency();

        const subtotalEl = document.getElementById('po-subtotal-display');
        if (subtotalEl) subtotalEl.textContent = PdfUtils.formatCurrency(subtotal, currency);

        const discountEl = document.getElementById('po-discount-display');
        if (discountEl) discountEl.textContent = PdfUtils.formatCurrency(totalDiscount, currency);

        const cgstEl = document.getElementById('po-cgst-display');
        if (cgstEl) {
            const cgstLabel = document.getElementById('po-cgst-label');
            if (cgstLabel) cgstLabel.textContent = `CGST (${fin.cgstRate}%):`;
            cgstEl.textContent = PdfUtils.formatCurrency(fin.cgstAmount, currency);
        }

        const sgstEl = document.getElementById('po-sgst-display');
        if (sgstEl) {
            const sgstLabel = document.getElementById('po-sgst-label');
            if (sgstLabel) sgstLabel.textContent = `SGST (${fin.sgstRate}%):`;
            sgstEl.textContent = PdfUtils.formatCurrency(fin.sgstAmount, currency);
        }

        const igstEl = document.getElementById('po-igst-display');
        if (igstEl) {
            const igstLabel = document.getElementById('po-igst-label');
            if (igstLabel) igstLabel.textContent = `IGST (${fin.igstRate}%):`;
            igstEl.textContent = PdfUtils.formatCurrency(fin.igstAmount, currency);
        }

        const grandEl = document.getElementById('po-total-display');
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
        const rows = document.querySelectorAll('#po-items-body tr');
        rows.forEach((row, i) => {
            const sno = row.querySelector('.sno-display');
            if (sno) sno.textContent = i + 1;
        });
    }

    function addTerm(value = '') {
        termCount++;
        const list = document.getElementById('po-terms-list');
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `po-term-${termCount}`;
        const num = list.children.length + 1;
        div.innerHTML = `
            <span class="list-number">${num}.</span>
            <input type="text" value="${_escapeAttr(value)}" placeholder="Enter payment term">
            <button class="btn-remove" onclick="PurchaseOrder.removeTerm(${termCount})">×</button>
        `;
        list.appendChild(div);
    }

    function removeTerm(id) {
        const el = document.getElementById(`po-term-${id}`);
        if (el) {
            el.remove();
            _renumberList('po-terms-list');
        }
    }

    function addCondition(value = '') {
        conditionCount++;
        const list = document.getElementById('po-conditions-list');
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `po-cond-${conditionCount}`;
        const num = list.children.length + 1;
        div.innerHTML = `
            <span class="list-number">${num}.</span>
            <textarea placeholder="Enter condition" rows="2">${_escapeHtml(value)}</textarea>
            <button class="btn-remove" onclick="PurchaseOrder.removeCondition(${conditionCount})">×</button>
        `;
        list.appendChild(div);
    }

    function removeCondition(id) {
        const el = document.getElementById(`po-cond-${id}`);
        if (el) {
            el.remove();
            _renumberList('po-conditions-list');
        }
    }

    function _renumberList(listId) {
        const items = document.querySelectorAll(`#${listId} .dynamic-list-item`);
        items.forEach((item, i) => {
            const numEl = item.querySelector('.list-number');
            if (numEl) numEl.textContent = (i + 1) + '.';
        });
    }

    // Signature and stamp preloaded statically

    // --- Collect form data ---
    function _collectFormData() {
        const items = [];
        const colVisibility = Storage.getPOColumnVisibility();
        const showName = colVisibility.name !== false;
        const showSpec = colVisibility.spec !== false;
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showDiscount = colVisibility.discount !== false;

        document.querySelectorAll('#po-items-body tr').forEach(row => {
            const name = showName ? (row.querySelector('.item-name')?.value || '') : '';
            const spec = showSpec ? (row.querySelector('.item-spec')?.value || '') : '';
            const qty = showQty ? (parseFloat(row.querySelector('.item-qty')?.value) || 0) : 1;
            const rate = showRate ? (parseFloat(row.querySelector('.item-rate')?.value) || 0) : 1;
            const discountVal = showDiscount ? (row.querySelector('.item-discount-input')?.value || '') : '';

            const nameEmpty = !showName || !name.trim();
            const specEmpty = !showSpec || !spec.trim();
            const qtyEmpty = showQty ? (parseFloat(row.querySelector('.item-qty')?.value) || 0) === 0 : true;
            const rateEmpty = showRate ? (parseFloat(row.querySelector('.item-rate')?.value) || 0) === 0 : true;

            if (nameEmpty && specEmpty && qtyEmpty && rateEmpty) return; // skip row if completely empty

            items.push({
                sno: items.length + 1,
                name: name,
                specification: spec,
                uom: row.querySelector('.item-uom')?.value || '',
                qty: qty,
                rate: rate,
                discount: discountVal,
                amount: FinanceUtils.truncate2(qty * rate * (1 - parseDiscount(discountVal) / 100))
            });
        });

        const terms = [];
        document.querySelectorAll('#po-terms-list .dynamic-list-item input').forEach(inp => {
            if (inp.value.trim()) terms.push(inp.value.trim());
        });

        const conditions = [];
        document.querySelectorAll('#po-conditions-list .dynamic-list-item textarea').forEach(ta => {
            if (ta.value.trim()) conditions.push(ta.value.trim());
        });

        const settings = Storage.getSettings();
        const totalAmount = FinanceUtils.truncate2(items.reduce((s, it) => s + it.amount, 0));
        const consignorGst = document.getElementById('po-consignor-gst')?.value || '';
        const fin = FinanceUtils.calculateTotals(totalAmount, settings, consignorGst);

        return {
            poNumber: document.getElementById('po-number').value.trim(),
            date: document.getElementById('po-date').value,
            department: (document.getElementById('po-department') && document.getElementById('po-department').value) || '',
            consignorName: document.getElementById('po-consignor-name').value.trim(),
            consignorAddress: document.getElementById('po-consignor-address').value.trim(),
            consignorGST: document.getElementById('po-consignor-gst').value.trim(),
            consignorContactPerson: document.getElementById('po-consignor-contact-person').value.trim(),
            consignorContact: document.getElementById('po-consignor-contact').value.trim(),
            consignorEmail: document.getElementById('po-consignor-email').value.trim(),
            items,
            ...fin,
            totalAmount, // Subtotal
            terms,
            conditions,
            currency: getSelectedCurrency(),
            referenceMode: document.getElementById('po-ref-mode')?.value.trim() || '',
            referenceFileName: _pendingRefFile ? _pendingRefFile.fileName : '',
            referenceFilePath: _pendingRefFile ? _pendingRefFile.filePath : ''
        };
    }

    // --- Generate ---
    async function generate(withPdf = true) {
        const poNumInput = document.getElementById('po-number');
        if (poNumInput && poNumInput.getAttribute('data-auto-generated') === 'true') {
            const vendorNameInput = document.getElementById('po-consignor-name');
            const vendorName = vendorNameInput ? vendorNameInput.value.trim() : '';
            const dateInput = document.getElementById('po-date');
            const dateVal = dateInput ? dateInput.value : _todayISO();

            if (vendorName && dateVal) {
                const fy = Storage.getFinancialYear(dateVal);
                const fyShort = Storage.getFinancialYearShort(dateVal);
                const clientCode = Storage.generateClientCode(vendorName);

                const orgSerial = String(Storage.incrementSerialNumber('PO', '', fy)).padStart(3, '0');
                const clientSerial = String(Storage.incrementSerialNumber('PO_CLIENT:' + clientCode, '', fy)).padStart(3, '0');
                poNumInput.value = `${Storage.getOrgInfo().serialPrefix}${orgSerial}/${clientCode}${clientSerial}/PO/${fyShort}`;
                poNumInput.setAttribute('data-auto-generated', 'false');
            }
        }

        const data = _collectFormData();
        if (!data.poNumber) {
            App.showToast('Please enter PO Number', 'error');
            return;
        }
        if (!data.date) {
            App.showToast('Please select PO Date', 'error');
            return;
        }
        if (!data.consignorName) {
            App.showToast('Please select or add a supplier', 'error');
            return;
        }
        // Reference is optional — a typed reference mode and/or attached file may
        // be supplied, but neither is required.
        if (data.items.length === 0) {
            App.showToast('Please add at least one item', 'error');
            return;
        }

        // Warn if this PO number is already used by another document.
        if (!(await App.confirmIfDuplicateRef(data.poNumber, _editingId))) return;

        App.showLoading(withPdf ? 'Generating PO Issue PDF...' : 'Saving PO Issue...');

        try {
            // Editing: keep the same id so the existing record is overwritten.
            if (_editingId) data.id = _editingId;
            // Save to storage
            Storage.savePO(data);
            _editingId = null;
            // Save-only: the record is stored, skip the PDF step entirely.
            if (!withPdf) {
                App.hideLoading();
                App.showToast('PO Issue saved successfully!', 'success');
                render();
                showDashboardView();
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
                        App.navigateTo('dashboard');
                    },
                    null,
                    true
                );
            } else if (result && result.cancelled) {
                // User chose not to overwrite, do not clear form or show success toast
            } else {
                App.showToast('PO Issue generated successfully!', 'success');
                // Clear form inputs and return to PO Dashboard
                render();
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

        // Purchase Orders are domestic — the company GST is mandatory in the header.
        const showOrgGst = true;

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
        doc.text('PURCHASE ORDER', pageWidth / 2, y, { align: 'center' });

        y += 9;
        const blockTopY = y;

        // Meta (right-aligned) — top-aligned with SUPPLIER
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);
        doc.text(`PO No.: ${data.poNumber}`, pageWidth - margin, blockTopY, { align: 'right' });
        doc.text(`Date: ${PdfUtils.formatDateDMY(data.date)}`, pageWidth - margin, blockTopY + 5, { align: 'right' });

        // --- Supplier (left) ---
        y = blockTopY;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(0, 77, 44);
        doc.text('SUPPLIER:', margin, y);

        doc.setDrawColor(243, 123, 33);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 1.5, margin + 80, y + 1.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(51, 51, 51);

        const consignorNameLines = doc.splitTextToSize(data.consignorName || '', 80);
        doc.text(consignorNameLines, margin, y + 6);

        let addrY = y + 6 + (consignorNameLines.length * 4.5) + 0.5;
        doc.setFont('helvetica', 'normal');
        const consignorAddrLines = [];
        (data.consignorAddress || '').split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed) consignorAddrLines.push(...doc.splitTextToSize(trimmed, 80));
        });
        consignorAddrLines.forEach(line => {
            doc.text(line, margin, addrY);
            addrY += 4.5;
        });
        doc.setFont('helvetica', 'normal');
        if (data.consignorContactPerson) {
            doc.text(data.consignorContactPerson, margin, addrY);
            addrY += 4.5;
        }
        if (data.consignorContact) {
            doc.text(data.consignorContact, margin, addrY);
            addrY += 4.5;
        }
        if (data.consignorEmail) {
            doc.text(data.consignorEmail, margin, addrY);
            addrY += 4.5;
        }
        if (data.consignorGST) {
            doc.setFont('helvetica', 'bold');
            doc.text('GST: ' + data.consignorGST, margin, addrY);
            addrY += 4.5;
        }

        y = addrY + 1.8; // Dynamic spacing!

        // --- Table ---
        const currencyCode = data.currency || 'INR';

        const hasName = data.items.some(it => (it.name || '').trim().length > 0);
        const hasSpec = data.items.some(it => (it.specification || '').trim().length > 0);

        const colVisibility = Storage.getPOColumnVisibility();
        const showSno = colVisibility.sno !== false;
        const showName = colVisibility.name !== false && hasName;
        const showSpec = colVisibility.spec !== false && hasSpec;
        const showUom = colVisibility.uom !== false;
        const showQty = colVisibility.qty !== false;
        const showRate = colVisibility.rate !== false;
        const showAmount = colVisibility.amount !== false;

        const colsToInclude = [];
        if (showSno) colsToInclude.push({ id: 'sno', header: 'S.NO', baseWidth: 12, halign: 'center' });
        if (showName) colsToInclude.push({ id: 'name', header: 'Item / Particulars', baseWidth: 38, halign: 'left' });
        if (showSpec) colsToInclude.push({ id: 'spec', header: 'Detailed Specification', baseWidth: 56, halign: 'left' });
        if (showUom) colsToInclude.push({ id: 'uom', header: 'UOM', baseWidth: 15, halign: 'center' });
        if (showQty) colsToInclude.push({ id: 'qty', header: 'QTY', baseWidth: 13, halign: 'center' });
        if (showRate) colsToInclude.push({ id: 'rate', header: 'Unit Rate', baseWidth: 22, halign: 'right' });
        if (showAmount) colsToInclude.push({ id: 'amount', header: 'Amount', baseWidth: 26, halign: 'right' });

        const getPOItemVal = (it, colId, idx) => {
            if (colId === 'sno') return (it.sno !== undefined && it.sno !== null ? it.sno : (idx + 1)).toString().padStart(2, '0');
            if (colId === 'name') return it.name || '';
            if (colId === 'spec') return it.specification || '';
            if (colId === 'uom') return it.uom || '';
            if (colId === 'qty') return (it.qty !== undefined && it.qty !== null ? it.qty : 0).toString();
            if (colId === 'rate') return PdfUtils.formatCurrency(it.rate, currencyCode);
            if (colId === 'amount') return PdfUtils.formatCurrency((it.qty || 0) * (it.rate || 0), currencyCode);
            return '';
        };

        const activeCols = (PdfUtils.autoAdjustTableColumns
            ? PdfUtils.autoAdjustTableColumns(doc, colsToInclude, data.items || [], getPOItemVal, contentWidth, 9.5)
            : null) || (() => {
                const sumBaseWidths = colsToInclude.reduce((sum, col) => sum + col.baseWidth, 0);
                return colsToInclude.map(col => ({
                    id: col.id,
                    header: col.header,
                    width: (col.baseWidth / sumBaseWidths) * contentWidth,
                    halign: col.halign
                }));
            })();

        const totalCols = activeCols.length;
        const tableHead = [activeCols.map(col => col.header)];

        const tableBody = (data.items || []).map((it, idx) => {
            return activeCols.map(col => getPOItemVal(it, col.id, idx));
        });

        // Compute total discount & gross subtotal
        let totalDiscount = 0;
        let grossSubtotal = 0;
        (data.items || []).forEach(it => {
            const qty = (it.qty !== undefined && it.qty !== null ? it.qty : 1);
            const rate = (it.rate !== undefined && it.rate !== null ? it.rate : 0);
            const discountPercent = parseDiscount(it.discount);
            grossSubtotal += qty * rate;
            totalDiscount += qty * rate * (discountPercent / 100);
        });

        // Add discount details if discount was applied
        if (totalDiscount > 0) {
            tableBody.push([
                { content: `Total Discount:`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                { content: `- ` + PdfUtils.formatCurrency(totalDiscount, currencyCode), styles: { halign: 'right' } }
            ]);
        }

        // Add tax rows if enabled
        if (data.gstEnabled) {
            if (data.isInterState) {
                tableBody.push([
                    { content: `IGST (${data.igstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatCurrency(data.igstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
            } else {
                tableBody.push([
                    { content: `CGST (${data.cgstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatCurrency(data.cgstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
                tableBody.push([
                    { content: `SGST (${data.sgstRate}%):`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatCurrency(data.sgstAmount, currencyCode), styles: { halign: 'right' } }
                ]);
            }
        }

        // Round Off (INR purchase orders only, when enabled in Visible
        // Columns): round the grand total to the nearest rupee and show the
        // adjustment above the grand total / amount in words.
        let displayGrand = data.grandTotal;
        const roundOffOn = colVisibility.roundOff === true && currencyCode === 'INR';
        if (roundOffOn) {
            const ro = PdfUtils.roundOffTotal(data.grandTotal);
            displayGrand = ro.rounded;
            // Only show the Round Off line when there's an actual adjustment.
            if (ro.delta !== 0) {
                tableBody.push([
                    { content: `Round Off:`, colSpan: totalCols - 1, styles: { halign: 'right' } },
                    { content: PdfUtils.formatRoundOffDelta(ro.delta, currencyCode), styles: { halign: 'right' } }
                ]);
            }
        }

        // Add Grand Total row
        tableBody.push([
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

        // Add Amount in Words row
        tableBody.push([
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

        const columnStyles = {};
        activeCols.forEach((col, idx) => {
            columnStyles[idx] = {
                cellWidth: col.width,
                halign: col.halign
            };
        });

        // Pre-table space check (let autoTable handle pagination if needed, but we keep it target page 1)

        doc.autoTable({
            startY: y,
            head: tableHead,
            body: tableBody,
            showHead: 'firstPage',
            margin: { left: margin, right: margin, bottom: 5 },
            styles: {
                font: 'helvetica',
                fontSize: 9.5,
                cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
                valign: 'top',
                overflow: 'linebreak',
                lineColor: [224, 224, 224],
                lineWidth: 0.2,
                textColor: [51, 51, 51]
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

        // --- Terms of Payment ---
        if (data.terms && data.terms.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('TERMS OF PAYMENT', margin, y);

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
            y += 3;
        }

        // --- General Terms & Conditions ---
        if (data.conditions && data.conditions.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(0, 77, 44);
            doc.text('GENERAL TERMS & CONDITIONS', margin, y);

            doc.setDrawColor(211, 211, 211);
            doc.setLineWidth(0.3);
            doc.line(margin, y + 1.2, margin + contentWidth, y + 1.2);
            y += 5.5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(68, 68, 68);
            data.conditions.forEach(cond => {
                const lines = doc.splitTextToSize(cond, contentWidth - 6);
                doc.text('•', margin + 2, y);
                lines.forEach(line => {
                    doc.text(line, margin + 6, y);
                    y += 3.8;
                });
                y += 0.5;
            });
        }

        // --- Signature & Stamp (bottom-right, when enabled in Visible Columns) ---
        const poSigVisible = Storage.getPOColumnVisibility().signature === true;
        const poSettings = Storage.getSettings();
        const poSigImg = poSettings.signImagePoQu;
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
            if (poSigVisible && poSigImg) {
                const maxW = 35;
                const dims = await PdfUtils.getImageDimensions(poSigImg);
                const imgW = maxW;
                const imgH = dims ? maxW * (dims.h / dims.w) : 22;
                try {
                    const sig = await PdfUtils.rasterizeForPrint(poSigImg, imgW, imgH);
                    doc.addImage(sig, PdfUtils.getDataUrlFormat(sig), rightEdge - imgW, hy, imgW, imgH, undefined, 'FAST');
                } catch (e) { console.warn('PO signature image error', e); }
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
            PdfUtils.openPdfPreview(doc, targetWin, `${data.poNumber || 'Purchase Order'} Preview`);
            return;
        } else {
            // download action
            let filename = `${data.poNumber.replace(/[\/\\]/g, '_')}.pdf`;

            const userPaths = Storage.getUserPaths();
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
                            save_path: userPaths.poSavePath || ''
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

                        App.showLoading('Generating PO Issue PDF...');
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
                                save_path: userPaths.poSavePath || '',
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
        document.querySelectorAll('#po-terms-list .dynamic-list-item input').forEach(inp => {
            const val = inp.value.trim();
            if (val) terms.push(val);
        });
        const settings = Storage.getSettings();
        settings.poDefaultTerms = terms;
        Storage.saveSettings(settings);
        App.showToast('Default Payment Terms saved!', 'success');
    }

    function saveDefaultConditions() {
        const conditions = [];
        document.querySelectorAll('#po-conditions-list .dynamic-list-item textarea').forEach(ta => {
            const val = ta.value.trim();
            if (val) conditions.push(val);
        });
        const settings = Storage.getSettings();
        settings.poDefaultConditions = conditions;
        Storage.saveSettings(settings);
        App.showToast('Default General Terms & Conditions saved!', 'success');
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

    return {
        render, renderDashboard, showDashboardView, showCreateView, showEditView,
        resetToDashboard, isFormActive,
        applyDashFilters, toggleDashFilters, resetDashFilters,
        changeDashPage, changeDashPageSize, deletePODash,
        addItem, removeItem, calcRow, recalcTax,
        addTerm, removeTerm, addCondition, removeCondition,
        saveDefaultTerms, saveDefaultConditions,
        generate, generatePDF, save, saveAndDownload,
        onVendorSelect, showAddVendor, hideAddVendor, saveNewVendor, updateVendorDropdown,
        handleCurrencyChange, getSelectedCurrency, updateAutoPONumber,
        triggerRefFileUpload, handleRefFileUpload, viewRefFile, removeRefFile
    };
})();
