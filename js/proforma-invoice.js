/* ============================================
   Proforma Invoice Module
   --------------------------------------------
   - Listing container (mirrors the dashboard "Recent Documents" table)
   - Create/Edit popup that hosts the REAL Invoice form (#inv-content) so it
     carries every invoice field and the correct domestic/international layout.
     The form node is temporarily relocated into a full-width modal and moved
     back on close — no markup is duplicated.
   - Working row actions: View / Edit / Download / Delete
   A Proforma reuses Invoice.generatePDF — only the title differs
   ("PROFORMA INVOICE"), driven by data.isProforma.
   ============================================ */

const ProformaInvoice = (() => {
    let _openMenuBtn = null;
    let _editingId = null; // null = creating; set = editing an existing proforma
    let _docKind = 'proforma'; // 'proforma' | 'invoice' — what the popup will save/generate
    let _sourceProformaId = null; // when generating an invoice, the proforma it came from (deleted on success)
    let _sourceTmId = null; // when generated from a received PO, that PO's id — used to record partial billing
    let currentPage = 1;
    let pageSize = 10;
    let _filtersVisible = false;
    let _search = '';

    /* ---------------- Listing ---------------- */

    function render() {
        _closeRowMenu();
        const container = document.getElementById('proforma-content');
        if (!container) return;

        const allDocs = Storage.getAllProformas ? Storage.getAllProformas() : [];
        Dashboard.registerClientFilter('pf', () => allDocs, () => { currentPage = 1; render(); });

        const clientSel = Dashboard.clientSelection('pf');
        const q = _search.trim().toLowerCase();
        const docs = allDocs.filter(d => {
            const party = (d.clientName || d.consignorName || '').trim();
            if (clientSel.size && !clientSel.has(party)) return false;
            if (q && ![d.refNumber, party].some(v => String(v || '').toLowerCase().includes(q))) return false;
            return true;
        });

        const total = docs.length;
        const totalPages = Math.ceil(total / pageSize);
        if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
        const paginatedDocs = docs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
        const hasActiveFilters = !!(_search || clientSel.size);

        container.innerHTML = `
            <div class="recent-section">
                <div style="margin-bottom:16px; display:flex; justify-content:flex-end;">
                    <button type="button" class="btn btn-add${_filtersVisible ? ' active' : ''}" id="btn-pf-filter-toggle" onclick="ProformaInvoice.toggleFilters()" style="padding:7px 14px; font-size:13px; display:inline-flex; align-items:center; gap:6px; border-radius:8px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        <span>Filter</span>
                        ${hasActiveFilters ? '<span style="width:7px; height:7px; border-radius:50%; background:#166534; display:inline-block;"></span>' : ''}
                    </button>
                </div>
                <div id="pf-filters-wrapper" style="display:${_filtersVisible ? 'block' : 'none'}; margin-bottom:18px; padding:14px 16px; background:rgba(0,0,0,0.02); border:1px solid rgba(0,0,0,0.05); border-radius:10px;">
                    <div class="dashboard-filters" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                        <input type="text" id="pf-filter-search" class="dashboard-filter-input" placeholder="Search Invoice No, Client..." oninput="Dashboard.keepFocus(ProformaInvoice.applyFilters)" style="width:250px; font-size:13px;" value="${_escapeHtml(_search)}">
                        ${Dashboard.renderClientFilter('pf', { width: 170 })}
                    </div>
                </div>
                ${total > 0 ? _renderTable(paginatedDocs, total) : _renderEmptyTable()}
            </div>
        `;
    }

    function toggleFilters() {
        _filtersVisible = !_filtersVisible;
        const el = document.getElementById('pf-filters-wrapper');
        if (el) el.style.display = _filtersVisible ? 'block' : 'none';
        const btn = document.getElementById('btn-pf-filter-toggle');
        if (btn) btn.classList.toggle('active', _filtersVisible);
    }

    function applyFilters() {
        const el = document.getElementById('pf-filter-search');
        _search = el ? (el.value || '') : '';
        currentPage = 1;
        render();
    }

    function _renderTable(docs, total = 0) {
        const rows = docs.map(doc => {
            const invNo = doc.refNumber || '-';
            const clientName = doc.clientName || doc.consignorName || '-';
            const dateTime = _formatDateTime(doc);
            const isIntl = doc.mode === 'international';
            const typeLabel = isIntl ? 'International' : 'Domestic';
            const typeBadge = isIntl ? 'badge-qu' : 'badge-inv';

            return `
                <tr>
                    <td style="font-weight:600">${_escapeHtml(invNo)}</td>
                    <td style="white-space:nowrap;">${dateTime}</td>
                    <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
                    <td>${_escapeHtml(clientName)}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        <button class="btn-action-generate" onclick="ProformaInvoice.generateInvoice('${doc.id}')" title="Generate an official Invoice from this proforma">Generate Invoice</button>
                        <button class="btn-row-actions" onclick="ProformaInvoice.toggleRowMenu(event,'${doc.id}')" title="Actions" aria-label="Actions">⋮</button>
                    </td>
                </tr>
            `;
        }).join('');

        const totalPages = Math.ceil(total / pageSize);
        let paginationHtml = '';
        if (total > 0) {
            paginationHtml = Dashboard.renderPagination({
                page: currentPage, pageSize, total, noun: 'proforma invoices',
                onPage: 'ProformaInvoice.changePage', onSize: 'ProformaInvoice.changePageSize'
            });
        }

        return `
            <div class="recent-table">
                <table>
                    <thead>${_headRow()}</thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${paginationHtml}
        `;
    }

    function _renderEmptyTable() {
        return `
            <div class="recent-table">
                <table>
                    <thead>${_headRow()}</thead>
                    <tbody>
                        <tr>
                            <td colspan="5" style="text-align:center; color:var(--text-secondary); padding:32px 12px;">
                                No proforma invoices yet.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    function _headRow() {
        return `
            <tr>
                <th>Invoice Number</th>
                <th>Date &amp; Time</th>
                <th>Type</th>
                <th>Client / Vendor</th>
                <th style="text-align:center; width: 70px;">Action</th>
            </tr>
        `;
    }

    function _formatDateTime(doc) {
        const datePart = doc.date ? PdfUtils.formatDateDMY(doc.date) : '-';
        if (!doc.savedAt) return datePart;
        const d = new Date(doc.savedAt);
        if (isNaN(d.getTime())) return datePart;
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${datePart}, ${time}`;
    }

    /* ---------------- Reference numbering ---------------- */

    // Next reference in the ORG-P-### series.
    function nextRef() {
        const prefix = Storage.getOrgInfo().serialPrefix;
        const existing = (Storage.getAllProformas ? Storage.getAllProformas() : []) || [];
        let max = 0;
        const re = new RegExp(prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '-P-(\\d+)', 'i');
        existing.forEach(p => {
            const m = re.exec(p.refNumber || '');
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return `${prefix}-P-${String(max + 1).padStart(3, '0')}`;
    }

    /* ---------------- Create / Edit popup ---------------- */

    function _ensureModal() {
        let modal = document.getElementById('proforma-modal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'proforma-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.32); z-index:9200; align-items:flex-start; justify-content:center; backdrop-filter:blur(4px); font-family:\'Inter\', -apple-system, sans-serif; overflow:auto; padding:24px 0;';
        modal.innerHTML = `
            <div class="modal-card" style="background:#f8fafc; border:1px solid rgba(0,0,0,0.1); border-radius:16px; width:96vw; max-width:1760px; margin:auto; box-shadow:0 15px 45px rgba(0,0,0,0.16); display:flex; flex-direction:column; max-height:94vh;">
                <div style="display:flex; justify-content:space-between; align-items:center; padding:18px 24px; border-bottom:1px solid rgba(0,0,0,0.08); background:#fff; border-radius:16px 16px 0 0;">
                    <h3 id="proforma-modal-title" style="font-size:20px; font-weight:700; color:#000; margin:0; letter-spacing:-0.2px;">Generate Proforma Invoice</h3>
                    <div style="display:flex; align-items:center; gap:14px;">
                        <!-- The invoice "Visible Columns" settings (GST / Signature / columns) are relocated here while the popup is open. -->
                        <div id="proforma-settings-slot" style="position:relative;"></div>
                        <button type="button" class="btn btn-secondary" onclick="ProformaInvoice.closeModal()" style="padding:6px 14px; font-size:13px; font-weight:600; margin:0; background:transparent; border:1px solid rgba(0,0,0,0.12); color:#000; border-radius:6px; cursor:pointer;">✕ Close</button>
                    </div>
                </div>
                <div id="proforma-modal-body" style="padding:18px 24px; overflow-y:auto; flex:1;"></div>
                <div style="display:flex; justify-content:flex-end; gap:12px; padding:16px 24px; border-top:1px solid rgba(0,0,0,0.08); background:#fff; border-radius:0 0 16px 16px;">
                    <button type="button" class="btn btn-secondary" onclick="ProformaInvoice.closeModal()" style="padding:11px 22px; font-size:13px; font-weight:600; background:transparent; border:1px solid rgba(0,0,0,0.15); color:#27272a; border-radius:8px; cursor:pointer;">Cancel</button>
                    <button type="button" id="proforma-save-btn" class="btn btn-generate" onclick="ProformaInvoice.save()" style="padding:11px 26px; font-size:13px; font-weight:600; background:#004d2c; color:#fff; border:none; border-radius:8px; cursor:pointer; box-shadow:0 2px 6px rgba(0,77,44,0.15);">Generate Proforma</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    // Open the popup to create a new proforma from a prefill payload
    // (PO Received "Generate Proforma" passes the document's details, incl. mode).
    function openCreate(prefill) {
        _docKind = 'proforma';
        _sourceProformaId = null;
        _sourceTmId = (prefill && prefill.sourceTmId) ? prefill.sourceTmId : null;
        _open(prefill || {}, null);
    }

    // Reopen an existing proforma for editing (same id / reference kept).
    function editDoc(id) {
        const data = Storage.getProforma ? Storage.getProforma(id) : null;
        if (!data) { App.showToast('Proforma not found.', 'error'); return; }
        _docKind = 'proforma';
        _sourceProformaId = null;
        _sourceTmId = null; // editing an existing proforma never re-records billing
        _open(JSON.parse(JSON.stringify(data)), id);
    }

    function _open(sourceData, editId) {
        if (typeof Invoice === 'undefined' || !Invoice.render) {
            App.showToast('Invoice form unavailable.', 'error');
            return;
        }
        const invContent = document.getElementById('inv-content');
        if (!invContent) { App.showToast('Invoice form unavailable.', 'error'); return; }

        _editingId = editId || null;
        const modal = _ensureModal();

        // Leave a placeholder so the invoice form can be returned to its page on close.
        if (!document.getElementById('inv-content-placeholder')) {
            const ph = document.createElement('div');
            ph.id = 'inv-content-placeholder';
            ph.style.display = 'none';
            invContent.parentNode.insertBefore(ph, invContent);
        }
        document.getElementById('proforma-modal-body').appendChild(invContent);

        // Bring the invoice's "Visible Columns" settings (GST / Signature / column
        // toggles) into the modal header so they're available here too.
        const settings = document.querySelector('.inv-settings-wrapper');
        if (settings && !document.getElementById('inv-settings-placeholder')) {
            const ph = document.createElement('div');
            ph.id = 'inv-settings-placeholder';
            ph.style.display = 'none';
            settings.parentNode.insertBefore(ph, settings);
            document.getElementById('proforma-settings-slot').appendChild(settings);
        }

        // Render the real invoice form, prefilled and in the inherited mode.
        const mode = sourceData.mode === 'international' ? 'international' : 'domestic';
        const renderData = Object.keys(sourceData).length ? Object.assign({}, sourceData) : null;
        if (renderData) delete renderData.id; // never bind Invoice's own editing id
        Invoice.render(renderData, mode);

        const refInput = document.getElementById('inv-ref-number');
        if (_docKind === 'invoice') {
            // Real invoice: use the invoice form's native auto-numbering (ORG/###/FY
            // or ORG/INT###/FY). The serial is only consumed on save.
            if (refInput) {
                refInput.value = '';
                refInput.setAttribute('data-auto-generated', 'true');
                if (Invoice.updateAutoRefNumber) Invoice.updateAutoRefNumber();
            }
        } else if (refInput) {
            // Proforma: force the ORG-P-### reference and keep auto-numbering off.
            refInput.value = sourceData.refNumber || nextRef();
            refInput.setAttribute('data-auto-generated', 'false');
        }

        // Hide the invoice form's own action row — the modal footer drives saving.
        const genRow = document.getElementById('inv-generate-row');
        if (genRow) genRow.style.display = 'none';

        const noun = _docKind === 'invoice' ? 'Invoice' : 'Proforma Invoice';
        const verb = _docKind === 'invoice' ? 'Generate' : (_editingId ? 'Edit' : 'Generate');
        document.getElementById('proforma-modal-title').textContent = verb + ' ' + noun;
        document.getElementById('proforma-save-btn').textContent = 'Generate ' + (_docKind === 'invoice' ? 'Invoice' : 'Proforma');
        modal.style.display = 'flex';
    }

    async function save() {
        return _docKind === 'invoice' ? _saveInvoice() : _saveProforma();
    }

    async function _saveProforma() {
        const data = Invoice.collectData();
        data.isProforma = true;
        if (_editingId) data.id = _editingId; else delete data.id;

        if (!data.refNumber) { App.showToast('Proforma number is required.', 'error'); return; }
        if (!data.clientName) { App.showToast('Please select or add a client.', 'error'); return; }
        if (!data.items.length || !data.items[0].specification) { App.showToast('Please add at least one item.', 'error'); return; }

        // Warn if this reference number is already used by another document.
        if (!(await App.confirmIfDuplicateRef(data.refNumber, _editingId))) return;

        try {
            const saved = Storage.saveProforma(data);
            // If this proforma was generated from a received PO, record the billed
            // amount against that PO so its partial/remaining billing stays in sync.
            if (_sourceTmId && typeof PoReceived !== 'undefined' && PoReceived.recordProformaBilling) {
                PoReceived.recordProformaBilling(_sourceTmId, saved);
            }
            _sourceTmId = null;
            App.showToast(`Proforma Invoice ${saved.refNumber} saved successfully!`, 'success');
            _teardown();
            // Redirect to the Proforma Invoice dashboard (don't open the PDF).
            if (App.navigateTo) App.navigateTo('proforma-invoice');
            render();
        } catch (err) {
            console.error('Save proforma failed:', err);
            App.showToast('Failed to save proforma: ' + err.message, 'error');
        }
    }

    async function _saveInvoice() {
        const data = Invoice.collectData();
        delete data.isProforma; // a real invoice — title becomes TAX INVOICE / INVOICE
        delete data.id;         // always a new invoice record

        if (!data.clientName) { App.showToast('Please select or add a client.', 'error'); return; }
        if (!data.items.length || !data.items[0].specification) { App.showToast('Please add at least one item.', 'error'); return; }

        // Finalise the invoice reference: if still auto, consume the next serial
        // (ORG/###/FY or ORG/INT###/FY); otherwise honour the user's manual number.
        const refInput = document.getElementById('inv-ref-number');
        if (refInput && refInput.getAttribute('data-auto-generated') === 'true') {
            const mode = data.mode === 'international' ? 'international' : 'domestic';
            const dateVal = data.date || new Date().toISOString().split('T')[0];
            const fy = Storage.getFinancialYear(dateVal);
            const fyShort = Storage.getFinancialYearShort(dateVal);
            const serial = Storage.incrementSerialNumber(mode === 'international' ? 'INV_INT' : 'INV_DOM', '', fy);
            // International invoice serials are 3 digits (grow past 999); domestic 4.
            data.refNumber = `${Storage.getOrgInfo().serialPrefix}/${mode === 'international' ? 'INT' : ''}${String(serial).padStart(mode === 'international' ? 3 : 4, '0')}/${fyShort}`;
        }
        if (!data.refNumber) { App.showToast('Invoice number is required.', 'error'); return; }

        // Warn if this reference number is already used by another document.
        if (!(await App.confirmIfDuplicateRef(data.refNumber, null))) return;

        try {
            const saved = Storage.saveInvoice(data);
            // The proforma has now become an invoice — remove it from the
            // Proforma Invoice dashboard.
            if (_sourceProformaId && Storage.deleteProforma) {
                Storage.deleteProforma(_sourceProformaId);
            }
            App.showToast(`Invoice ${saved.refNumber} generated successfully!`, 'success');
            _teardown();
            // Redirect to the dashboard (don't open the PDF).
            if (App.navigateTo) App.navigateTo('dashboard');
        } catch (err) {
            console.error('Generate invoice failed:', err);
            App.showToast('Failed to generate invoice: ' + err.message, 'error');
        }
    }

    function closeModal() {
        _teardown();
    }

    // Return the invoice form to its page, reset it to a clean state, hide modal.
    function _teardown() {
        const modal = document.getElementById('proforma-modal');
        const invContent = document.getElementById('inv-content');
        const ph = document.getElementById('inv-content-placeholder');
        if (invContent && ph && ph.parentNode) {
            ph.parentNode.insertBefore(invContent, ph);
            ph.remove();
        }
        // Return the settings wrapper to the invoice page.
        const settings = document.querySelector('.inv-settings-wrapper');
        const sph = document.getElementById('inv-settings-placeholder');
        if (settings && sph && sph.parentNode) {
            sph.parentNode.insertBefore(settings, sph);
            sph.remove();
        }
        const genRow = document.getElementById('inv-generate-row');
        if (genRow) genRow.style.display = '';
        if (modal) modal.style.display = 'none';
        _editingId = null;
        _docKind = 'proforma';
        _sourceProformaId = null;
        // Reset the invoice form so leftover proforma data doesn't linger on its page.
        if (typeof Invoice !== 'undefined' && Invoice.render) Invoice.render();
    }

    /* ---------------- Row actions ---------------- */

    function toggleRowMenu(event, id) {
        event.stopPropagation();
        const trigger = event.currentTarget;
        const existing = document.getElementById('row-actions-popup');
        const wasSame = existing && _openMenuBtn === trigger;
        _closeRowMenu();
        if (wasSame) return;

        _openMenuBtn = trigger;
        const menu = document.createElement('div');
        menu.id = 'row-actions-popup';
        menu.className = 'row-actions-popup';
        menu.innerHTML = `
            <button onclick="ProformaInvoice.viewDoc('${id}'); ProformaInvoice._closeRowMenu();">View</button>
            <button onclick="ProformaInvoice.editDoc('${id}'); ProformaInvoice._closeRowMenu();">Edit</button>
            <button onclick="ProformaInvoice.downloadDoc('${id}'); ProformaInvoice._closeRowMenu();">Download</button>
            <button class="danger" onclick="ProformaInvoice.deleteDoc('${id}'); ProformaInvoice._closeRowMenu();">Delete</button>
        `;
        document.body.appendChild(menu);

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

    async function viewDoc(id) {
        const win = window.open('', '_blank');
        try {
            const data = Storage.getProforma(id);
            if (!data) { if (win) win.close(); return; }
            await Invoice.generatePDF(data, 'view', win);
        } catch (err) {
            console.error('View proforma failed:', err);
            if (win && !win.closed) win.close();
            App.showToast('Failed to view proforma: ' + err.message, 'error');
        }
    }

    async function downloadDoc(id) {
        try {
            const data = Storage.getProforma(id);
            if (!data) return;
            const result = await Invoice.generatePDF(data, 'download');
            if (result && result.savedToPath) {
                App.showConfirm('PDF Saved Successfully', '', () => {}, null, true);
            } else if (result && result.downloaded) {
                App.showToast('PDF downloaded successfully!', 'success');
            }
        } catch (err) {
            console.error('Download proforma failed:', err);
            App.showToast('Failed to download proforma: ' + err.message, 'error');
        }
    }

    // Open the invoice form popup pre-filled with all the proforma's details so the
    // user can review and then generate an official Invoice (real ORG reference,
    // saved to the Invoice store). The proforma's own ORG-P number is dropped.
    function generateInvoice(id) {
        const prof = Storage.getProforma(id);
        if (!prof) { App.showToast('Proforma not found.', 'error'); return; }
        if (typeof Invoice === 'undefined' || !Invoice.render) {
            App.showToast('Invoice form unavailable.', 'error');
            return;
        }
        const source = JSON.parse(JSON.stringify(prof));
        delete source.id;
        delete source.isProforma;
        delete source.savedAt;
        delete source.refNumber; // invoice gets its own auto-generated number
        const mode = source.mode === 'international' ? 'international' : 'domestic';

        // Open the real Invoice page, prefilled, so the user can review/correct the
        // details before generating. The invoice is NOT created yet.
        Invoice.render(source, mode);
        if (App.navigateTo) App.navigateTo('invoice');

        // Force a fresh auto-generated invoice number (the proforma number is not reused).
        const refInput = document.getElementById('inv-ref-number');
        if (refInput) {
            refInput.value = '';
            refInput.setAttribute('data-auto-generated', 'true');
            if (Invoice.updateAutoRefNumber) Invoice.updateAutoRefNumber();
        }

        // Remember the source proforma; it is removed from this dashboard only once
        // the user actually clicks Generate on the invoice form.
        if (Invoice.setSourceProforma) Invoice.setSourceProforma(id);

        App.showToast('Review the details, then click Generate to create the invoice.', 'success');
    }

    function deleteDoc(id) {
        App.showConfirm(
            'Delete Proforma Invoice',
            'Are you sure you want to delete this Proforma Invoice? This action cannot be undone.',
            () => {
                Storage.deleteProforma(id);
                App.showToast('Proforma Invoice deleted successfully!', 'success');
                render();
            }
        );
    }

    /* ---------------- utils ---------------- */

    function _escapeHtml(str) {
        if (str === undefined || str === null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function changePage(p) {
        currentPage = p;
        render();
    }

    function changePageSize(size) {
        pageSize = size;
        currentPage = 1;
        render();
    }

    return {
        render, openCreate, editDoc, closeModal, save,
        toggleRowMenu, _closeRowMenu, viewDoc, downloadDoc, deleteDoc, generateInvoice, nextRef,
        changePage, changePageSize, toggleFilters, applyFilters
    };
})();
