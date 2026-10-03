/* =========================================================
   PO Received Module — Upload & save incoming client Purchase Orders
   ========================================================= */

const PoReceived = (() => {
    // Holds the uploaded file info while the details popup is open
    let _pendingUpload = null;
    let _modalItemCount = 0;

    let filtersVisible = false;
    let currentSearch = '';
    let currentType = '';
    let currentRegion = '';
    let currentMonth = '';
    let currentFy = '';

    // Trigger button of the currently-open row actions (kebab) menu, if any.
    let _openMenuBtn = null;
    let currentPage = 1;
    let pageSize = 10;

    // Domestic vs international for an uploaded document. Prefer the saved details
    // mode; fall back to the ref-number marker (…/INT/… or …/DOM/…) for legacy rows.
    function _docRegion(doc) {
        const m = doc.details && doc.details.mode;
        if (m === 'international' || m === 'domestic') return m;
        return _modeFromRef(doc.refNumber) || 'domestic';
    }

    // Document mode: 'domestic' (INR only) or 'international' (everything except INR)
    let _tmMode = 'domestic';
    // Client type chosen in the Add Client modal (mirrors the quotation form)
    let _tmPendingClientType = 'domestic';
    function _tmCurrencies() {
        return _tmMode === 'domestic'
            ? ['INR']
            : Object.keys(PdfUtils.CURRENCY_MAP).filter(c => c !== 'INR');
    }
    function _modeFromRef(ref) {
        if (/\/INT\//i.test(ref || '')) return 'international';
        if (/\/DOM\//i.test(ref || '')) return 'domestic';
        return null;
    }

    function init() {
        // No special init needed
    }

    function render() {
        const container = document.getElementById('po-received-content');
        if (!container) return;
        _registerClientFilter();

        const docs = Storage.getAllTMs();
        
        const uniqueFys = [...new Set(docs.map(doc => {
            return doc.details?.date ? Storage.getFinancialYear(doc.details.date) : '';
        }).filter(Boolean))].sort();

        const fyOptions = uniqueFys.map(fy => {
            return `<div class="custom-option${currentFy === fy ? ' selected' : ''}" data-value="${fy}">${fy}</div>`;
        }).join('');

        const monthNames = {
            '': 'All Months', '01': 'January', '02': 'February', '03': 'March', '04': 'April',
            '05': 'May', '06': 'June', '07': 'July', '08': 'August', '09': 'September',
            '10': 'October', '11': 'November', '12': 'December'
        };
        const monthLabel = monthNames[currentMonth] || 'All Months';
        const fyLabel = currentFy || 'All FY';

        container.innerHTML = `
            <div class="po-received-layout" style="display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 100%; flex: 1; min-height: calc(100vh - 200px); box-sizing: border-box;">
                <div class="form-container" id="tm-upload-card" style="position: relative; overflow: hidden; padding: 12px 16px; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.05); width: 100%; box-sizing: border-box;">

                    <!-- Upload Mode (Premium Compact Centered Design) -->
                    <div id="tm-upload-view" style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%;">
                        <div id="tm-drop-zone" style="border: 2px dashed rgba(5, 150, 105, 0.22); border-radius: 12px; padding: 12px 20px; background: rgba(5, 150, 105, 0.015); cursor: pointer; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 72px; box-sizing: border-box; text-align: center;">
                            <input type="file" id="tm-file-input" accept="application/pdf,.pdf" style="display: none;">
                            
                            <!-- Glowing SVG Icon container -->
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%;">
                                <div class="tm-upload-icon-container" style="width: 32px; height: 32px; border-radius: 50%; background: rgba(5, 150, 105, 0.08); display: flex; align-items: center; justify-content: center; color: var(--accent-green); transition: all 0.3s ease; box-shadow: 0 4px 10px rgba(5, 150, 105, 0.05); flex-shrink: 0;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="17 8 12 3 7 8" />
                                        <line x1="12" y1="3" x2="12" y2="15" />
                                    </svg>
                                </div>
                                
                                <!-- Typography -->
                                <div style="display: flex; flex-direction: column; gap: 2px; text-align: center; align-items: center;">
                                    <div style="font-size: 13.5px; font-weight: 700; color: var(--text-primary); line-height: 1.2;">Upload Purchase Order</div>
                                    <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.2;">Drag and drop or click here to upload a PDF (PDF only)</div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- Uploaded Purchase Orders List -->
                <div class="form-container" id="tm-list-card" style="padding: 30px; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.06); width: 100%; flex: 1; display: flex; flex-direction: column; min-height: 480px; box-sizing: border-box;">
                    <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                        <h2 style="font-size: 18px; font-weight: 700; color: #000; margin: 0;">Uploaded Purchase Orders</h2>
                        ${docs.length > 0 ? `
                        <button class="btn btn-add${filtersVisible ? ' active' : ''}" id="btn-tm-toggle-filters" onclick="PoReceived.toggleFilters()" style="padding: 8px 14px; display: inline-flex; align-items: center; gap: 6px;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                            Filter
                        </button>
                        ` : ''}
                    </div>

                    ${docs.length > 0 ? `
                    <div id="tm-filters-wrapper" style="display:${filtersVisible ? 'block' : 'none'}; margin-bottom:16px; padding:16px; background:rgba(0,0,0,0.015); border:1px solid rgba(0,0,0,0.05); border-radius:8px;">
                        <div class="dashboard-filters" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                            <input type="text" id="tm-filter-search" class="dashboard-filter-input" placeholder="Search by Ref No, Client..." oninput="Dashboard.keepFocus(PoReceived.applyFilters)" style="width: 220px;" value="${_escapeHtml(currentSearch)}">
                            
                            <div class="custom-select-wrapper" style="width: 150px;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>${currentType === 'po' ? 'Purchase Order' : (currentType === 'job' ? 'Job' : 'All Types')}</span>
                                    <div class="arrow"></div>
                                </div>
                                <div class="custom-options">
                                    <div class="custom-option${currentType === '' ? ' selected' : ''}" data-value="">All Types</div>
                                    <div class="custom-option${currentType === 'po' ? ' selected' : ''}" data-value="po">Purchase Order</div>
                                    <div class="custom-option${currentType === 'job' ? ' selected' : ''}" data-value="job">Job</div>
                                </div>
                                <input type="hidden" id="tm-filter-type" value="${currentType}" onchange="PoReceived.applyFilters()">
                            </div>

                            ${Dashboard.renderClientFilter('tm', { width: 170 })}

                            <div class="custom-select-wrapper" style="width: 150px;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>${currentRegion === 'domestic' ? 'Domestic' : (currentRegion === 'international' ? 'International' : 'All Regions')}</span>
                                    <div class="arrow"></div>
                                </div>
                                <div class="custom-options">
                                    <div class="custom-option${currentRegion === '' ? ' selected' : ''}" data-value="">All Regions</div>
                                    <div class="custom-option${currentRegion === 'domestic' ? ' selected' : ''}" data-value="domestic">Domestic</div>
                                    <div class="custom-option${currentRegion === 'international' ? ' selected' : ''}" data-value="international">International</div>
                                </div>
                                <input type="hidden" id="tm-filter-region" value="${currentRegion}" onchange="PoReceived.applyFilters()">
                            </div>

                            <div class="custom-select-wrapper" style="width: 150px;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>${monthLabel}</span>
                                    <div class="arrow"></div>
                                </div>
                                <div class="custom-options">
                                    <div class="custom-option${currentMonth === '' ? ' selected' : ''}" data-value="">All Months</div>
                                    <div class="custom-option${currentMonth === '01' ? ' selected' : ''}" data-value="01">January</div>
                                    <div class="custom-option${currentMonth === '02' ? ' selected' : ''}" data-value="02">February</div>
                                    <div class="custom-option${currentMonth === '03' ? ' selected' : ''}" data-value="03">March</div>
                                    <div class="custom-option${currentMonth === '04' ? ' selected' : ''}" data-value="04">April</div>
                                    <div class="custom-option${currentMonth === '05' ? ' selected' : ''}" data-value="05">May</div>
                                    <div class="custom-option${currentMonth === '06' ? ' selected' : ''}" data-value="06">June</div>
                                    <div class="custom-option${currentMonth === '07' ? ' selected' : ''}" data-value="07">July</div>
                                    <div class="custom-option${currentMonth === '08' ? ' selected' : ''}" data-value="08">August</div>
                                    <div class="custom-option${currentMonth === '09' ? ' selected' : ''}" data-value="09">September</div>
                                    <div class="custom-option${currentMonth === '10' ? ' selected' : ''}" data-value="10">October</div>
                                    <div class="custom-option${currentMonth === '11' ? ' selected' : ''}" data-value="11">November</div>
                                    <div class="custom-option${currentMonth === '12' ? ' selected' : ''}" data-value="12">December</div>
                                </div>
                                <input type="hidden" id="tm-filter-month" value="${currentMonth}" onchange="PoReceived.applyFilters()">
                            </div>

                            <div class="custom-select-wrapper" style="width: 150px;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>${fyLabel}</span>
                                    <div class="arrow"></div>
                                </div>
                                <div class="custom-options" id="tm-filter-fy-options">
                                    <div class="custom-option${currentFy === '' ? ' selected' : ''}" data-value="">All FY</div>
                                    ${fyOptions}
                                </div>
                                <input type="hidden" id="tm-filter-fy" value="${currentFy}" onchange="PoReceived.applyFilters()">
                            </div>
                        </div>
                    </div>
                    ` : ''}

                    <div id="tm-table-container"></div>
                </div>

                <div id="tm-pagination-container"></div>

            </div>
        `;

        setupDropZone();
        renderDocumentsList();
    }

    function setupDropZone() {
        const dropZone = document.getElementById('tm-drop-zone');
        const fileInput = document.getElementById('tm-file-input');

        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                processFile(e.target.files[0]);
            }
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--accent-green)';
            dropZone.style.background = 'rgba(5, 150, 105, 0.04)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'rgba(5, 150, 105, 0.22)';
            dropZone.style.background = 'rgba(5, 150, 105, 0.015)';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'rgba(5, 150, 105, 0.22)';
            dropZone.style.background = 'rgba(5, 150, 105, 0.015)';
            if (e.dataTransfer.files.length > 0) {
                processFile(e.dataTransfer.files[0]);
            }
        });
    }

    async function processFile(file) {
        const fileName = file.name;

        // Only PDF files are allowed. The <input accept> guards the file picker,
        // but drag-and-drop ignores it, so we re-check here for both paths.
        const isPdf = (file.type === 'application/pdf') || /\.pdf$/i.test(fileName || '');
        if (!isPdf) {
            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Only PDF files are allowed. Please upload a .pdf document.', 'error');
            }
            const fileInput = document.getElementById('tm-file-input');
            if (fileInput) fileInput.value = '';
            return;
        }

        // Show a loading animation right away (covers file read + compression)
        _showUploadOverlay(fileName);

        try {
            // PDFs over 100 KB are auto-compressed to save cloud storage.
            // IMPORTANT: the file is NOT uploaded to the server here. We only
            // prepare it (compress + base64) and hold it in memory. The actual
            // upload + database save happens only when the user clicks
            // "Save Details" — so abandoning the form leaves nothing behind.
            const fileBase64 = await _prepareUpload(file);

            // Reset drop zone back to normal
            _resetDropZone();

            // Reset file input so user can upload same file again if needed
            const fileInput = document.getElementById('tm-file-input');
            if (fileInput) fileInput.value = '';

            // Hold the prepared (un-uploaded) file and open the details popup so
            // the user can enter the invoice details and a reference number.
            _pendingUpload = {
                fileName: fileName,
                fileBase64: fileBase64,
                isNew: true
            };
            _chooseModeThenOpen();

        } catch (error) {
            console.error('File processing error:', error);
            _resetDropZone();

            if (typeof App !== 'undefined' && App.showToast) {
                App.showToast('Could not process file: ' + error.message, 'error');
            }
        }
    }

    function _resetDropZone() {
        const dropZone = document.getElementById('tm-drop-zone');
        if (!dropZone) return;
        _hideUploadOverlay();
        dropZone.style.borderColor = 'rgba(0, 0, 0, 0.15)';
        dropZone.style.background = 'rgba(0, 0, 0, 0.005)';
    }

    function _showUploadOverlay(fileName) {
        const dropZone = document.getElementById('tm-drop-zone');
        if (!dropZone) return;
        dropZone.style.position = 'relative';
        dropZone.style.borderColor = 'var(--accent-green)';
        let overlay = document.getElementById('tm-upload-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tm-upload-overlay';
            overlay.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:12px; background:rgba(255,255,255,0.96); border-radius:14px; z-index:5; overflow:hidden;';
            dropZone.appendChild(overlay);
        }
        overlay.innerHTML = `
            <div class="tm-upload-loader">
                <div class="tm-upload-loader-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                </div>
                <div class="tm-upload-loader-text">
                    <div class="tm-upload-loader-title">Processing file…</div>
                    <div class="tm-upload-loader-name">${_escapeHtml(fileName)}</div>
                </div>
                <div class="tm-upload-loader-bar"><span></span></div>
            </div>
        `;
    }

    function _hideUploadOverlay() {
        const overlay = document.getElementById('tm-upload-overlay');
        if (overlay) overlay.remove();
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    }

    // ---- Uploaded-PDF compression (PO Received only) -------------------------
    // Cap stored PDFs at 100 KB to save cloud space. PDFs already under the cap
    // are left untouched; larger ones are re-rendered page-by-page to JPEG at a
    // resolution chosen to land at/under the cap (visually near-identical for
    // scans). Non-PDFs and failures fall back to the original upload.
    const _PDF_MAX_BYTES = 100 * 1024;
    let _pdfWorkerReady = false;

    function _ensurePdfWorker() {
        if (_pdfWorkerReady) return true;
        if (typeof window === 'undefined' || !window.pdfjsLib) return false;
        try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
            _pdfWorkerReady = true;
        } catch (e) { return false; }
        return true;
    }

    function _blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
    }

    // Render every page of a loaded pdf.js doc into a new JPEG-per-page PDF.
    async function _renderCompressed(pdf, dpi, quality) {
        const jsPDFc = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        let doc = null;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp1 = page.getViewport({ scale: 1 });            // points (1/72")
            const viewport = page.getViewport({ scale: dpi / 72 }); // render resolution
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency for JPEG
            await page.render({ canvasContext: ctx, viewport }).promise;
            const img = canvas.toDataURL('image/jpeg', quality);
            const orient = vp1.width > vp1.height ? 'l' : 'p';
            if (!doc) doc = new jsPDFc({ unit: 'pt', format: [vp1.width, vp1.height], orientation: orient });
            else doc.addPage([vp1.width, vp1.height], orient);
            doc.addImage(img, 'JPEG', 0, 0, vp1.width, vp1.height, undefined, 'FAST');
            canvas.width = canvas.height = 0; // free memory
        }
        return doc ? doc.output('blob') : null;
    }

    // Compress an arbitrary PDF toward `_PDF_MAX_BYTES`, lowering DPI/quality until
    // it fits or a legibility floor is reached. Returns a Blob or null.
    async function _compressPdf(arrayBuffer) {
        if (!_ensurePdfWorker()) return null;
        const pdfjsLib = window.pdfjsLib;
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false });
        const pdf = await loadingTask.promise;
        let dpi = 150, quality = 0.72, best = null;
        const DPI_FLOOR = 50, Q_FLOOR = 0.35;
        for (let attempt = 0; attempt < 7; attempt++) {
            const blob = await _renderCompressed(pdf, dpi, quality);
            if (!blob) break;
            if (!best || blob.size < best.size) best = blob;
            if (blob.size <= _PDF_MAX_BYTES) { best = blob; break; }
            if (dpi <= DPI_FLOOR && quality <= Q_FLOOR) break; // floor — keep the smallest we got
            // Shrink gradually: scale DPI by how far over we are (gentler than the
            // raw ratio so quality degrades smoothly), and step quality down.
            const ratio = Math.sqrt(_PDF_MAX_BYTES / blob.size);
            dpi = Math.max(DPI_FLOOR, Math.floor(dpi * Math.max(0.6, Math.min(0.9, ratio))));
            quality = Math.max(Q_FLOOR, +(quality - 0.08).toFixed(2));
        }
        try { loadingTask.destroy && loadingTask.destroy(); } catch (e) {}
        return best;
    }

    // Returns a base64 data URL for upload, compressing oversized PDFs first.
    async function _prepareUpload(file) {
        const isPdf = (file.type === 'application/pdf') || /\.pdf$/i.test(file.name || '');
        if (!isPdf) return await readFileAsBase64(file);
        let buf;
        try { buf = await file.arrayBuffer(); } catch (e) { return await readFileAsBase64(file); }
        if (buf.byteLength <= _PDF_MAX_BYTES) return await readFileAsBase64(file); // already under cap
        try {
            const blob = await _compressPdf(buf);
            if (blob && blob.size < buf.byteLength) return await _blobToDataURL(blob);
        } catch (e) {
            console.warn('PDF compression failed; uploading original.', e);
        }
        return await readFileAsBase64(file);
    }

    function viewUploadedFile(filePath) {
        if (!filePath) return;
        window.open(filePath, '_blank');
    }

    function downloadUploadedFile(filePath, fileName) {
        if (!filePath) {
            if (App && App.showToast) App.showToast('No file available to download.', 'error');
            return;
        }
        const a = document.createElement('a');
        a.href = filePath;
        a.download = fileName || '';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    /* ---------------- Row actions (kebab menu) ---------------- */

    function toggleRowMenu(event, id) {
        event.stopPropagation();
        const trigger = event.currentTarget;
        const existing = document.getElementById('row-actions-popup');
        const wasSame = existing && _openMenuBtn === trigger;
        _closeRowMenu();
        if (wasSame) return;

        const doc = Storage.getTM(id);
        if (!doc) return;

        _openMenuBtn = trigger;
        const menu = document.createElement('div');
        menu.id = 'row-actions-popup';
        menu.className = 'row-actions-popup';
        const fp = _escapeAttr(doc.filePath || '');
        const fn = _escapeAttr(doc.fileName || '');
        const viewBtn = doc.filePath
            ? `<button onclick="PoReceived.viewUploadedFile('${fp}'); PoReceived._closeRowMenu();">View</button>`
            : '';
        const downloadBtn = doc.filePath
            ? `<button onclick="PoReceived.downloadUploadedFile('${fp}','${fn}'); PoReceived._closeRowMenu();">Download</button>`
            : '';
        // Billing close/reopen — only meaningful once the PO has an amount on file.
        let billingBtn = '';
        if (_tmTotal(doc) > 0) {
            billingBtn = (doc.billing && doc.billing.closed)
                ? `<button onclick="PoReceived.reopenBilling('${id}'); PoReceived._closeRowMenu();">Reopen billing</button>`
                : `<button onclick="PoReceived.closeBilling('${id}'); PoReceived._closeRowMenu();">Mark billing complete</button>`;
        }
        menu.innerHTML = `
            ${viewBtn}
            <button onclick="PoReceived.editDocument('${id}'); PoReceived._closeRowMenu();">Edit</button>
            ${downloadBtn}
            ${billingBtn}
            <button class="danger" onclick="PoReceived.deleteDocument('${id}','${fp}'); PoReceived._closeRowMenu();">Delete</button>
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

    function deleteDocument(id, filePath) {
        if (typeof App !== 'undefined' && App.showConfirm) {
            App.showConfirm(
                'Delete Document',
                'Are you sure you want to delete this uploaded Purchase Order? This will also remove the file from the server.',
                async () => {
                    try {
                        if (filePath) {
                            await fetch('/api/delete-file', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'same-origin',
                                body: JSON.stringify({ file_path: filePath })
                            });
                        }
                        Storage.deleteTM(id);
                        renderDocumentsList();
                        App.showToast('Document deleted successfully!', 'success');
                    } catch (err) {
                        console.error('Delete failed:', err);
                        Storage.deleteTM(id);
                        renderDocumentsList();
                        App.showToast('Record deleted. File removal may have failed.', 'warning');
                    }
                }
            );
        }
    }

    /* =========================================================
       Details popup — capture the same fields as an Invoice so
       they can later auto-fill the Invoice form by reference number.
       ========================================================= */

    function _ensureModal() {
        let modal = document.getElementById('tm-details-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'tm-details-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.3); z-index:9000; align-items:center; justify-content:center; backdrop-filter:blur(4px); font-family:\'Inter\', -apple-system, sans-serif;';
        modal.innerHTML = `
            <div class="modal-card" style="background:#ffffff; border:1px solid rgba(0,0,0,0.1); border-radius:16px; padding:28px 28px; width:1260px; max-width:95vw; max-height:90vh; overflow-y:auto; box-shadow:0 15px 45px rgba(0,0,0,0.12); text-align:left;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <h3 style="font-size:20px; font-weight:700; color:#000; margin:0; letter-spacing:-0.2px;">Enter Purchase order details</h3>
                    <button type="button" class="btn btn-secondary" onclick="PoReceived.closeDetailsModal()">✕ Close</button>
                </div>
                <p style="font-size:13px; color:var(--text-secondary); margin-bottom:18px; line-height:1.45;">
                    Manually enter the details from this document. When you type the same Order Reference Number while creating an Invoice, these details will auto-fill.
                </p>
                <p id="tm-modal-filename" style="font-size:12px; font-weight:600; color:#004d2c; margin-bottom:18px;"></p>

                <form id="tm-details-form" onsubmit="event.preventDefault();">
                    <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                        <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Date</label>
                            <input type="date" id="tm-date" max="9999-12-31" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                        </div>
                    </div>

                    <div style="font-size:13px; font-weight:700; color:#000; margin:18px 0 10px;">Client Details</div>
                    <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                        <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Select Client</label>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                <div style="display:flex; gap:8px;">
                                    <div class="custom-select-wrapper floating-select searchable-select" style="flex:1">
                                        <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                            <span>— Select a saved client —</span>
                                        </div>
                                        <div class="custom-options" id="tm-client-custom-options">
                                            <div class="custom-option selected" data-value="">— Select a saved client —</div>
                                        </div>
                                        <input type="hidden" id="tm-client-select" value="">
                                    </div>
                                    <button type="button" class="btn btn-primary" onclick="PoReceived.showAddClient()" style="white-space:nowrap;">+ Add New</button>
                                </div>
                                <!-- Sub Group select -->
                                <div id="tm-sub-client-wrapper" class="custom-select-wrapper floating-select searchable-select" style="display:none; width:100%;">
                                    <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                        <span>— Select Client —</span>
                                    </div>
                                    <div class="custom-options" id="tm-sub-client-custom-options">
                                    </div>
                                    <input type="hidden" id="tm-sub-client-select" value="">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Client detail fields (hidden permanently once selected) -->
                    <div id="tm-client-fields" style="display:none !important;">
                        <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                            <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Client Name</label>
                                <input type="text" id="tm-client-name" placeholder="Client company name" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                            <div class="form-group" id="tm-client-gst-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">GST Number</label>
                                <input type="text" id="tm-client-gst" placeholder="GST number" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                        </div>
                        <div class="form-group" style="display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Address</label>
                            <textarea id="tm-client-address" rows="2" placeholder="Full address" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;"></textarea>
                        </div>
                        <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                            <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Contact Person</label>
                                <input type="text" id="tm-client-contact-person" placeholder="Contact person name" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                            <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Phone</label>
                                <input type="text" id="tm-client-contact" placeholder="Phone number" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                            <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Email</label>
                                <input type="email" id="tm-client-email" placeholder="Email address" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                        </div>
                        <!-- Inline actions to save a newly added client -->
                        <div id="tm-client-save-actions" style="display:none; gap:8px; margin-bottom:12px;">
                            <button type="button" class="btn btn-primary" onclick="PoReceived.saveNewClient()">Save</button>
                            <button type="button" class="btn btn-secondary" onclick="PoReceived.hideAddClient()">Cancel</button>
                        </div>
                    </div>

                    <!-- Order Details universal metadata -->
                    <div id="tm-order-meta">
                        <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                            <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Order Date</label>
                                <input type="date" id="tm-po-date" max="9999-12-31" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                            <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                                <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Order Reference Number</label>
                                <input type="text" id="tm-po-number" placeholder="e.g., PO-123" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                            </div>
                        </div>
                    </div>

                    <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                        <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Shipped Via</label>
                            <input type="text" id="tm-shipped-via" placeholder="e.g., INTERNET" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                        </div>
                        <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Currency</label>
                            <div class="custom-select-wrapper floating-select" id="tm-currency-wrapper" style="flex:1;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>INR</span>
                                </div>
                                <div class="custom-options" id="tm-currency-options">
                                    <!-- Options populated dynamically -->
                                </div>
                                <input type="hidden" id="tm-currency" value="INR">
                            </div>
                        </div>
                    </div>

                    <div class="form-row" style="display:flex; gap:12px; margin-bottom:12px;">
                        <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Department</label>
                            <div class="custom-select-wrapper floating-select" style="flex:1;">
                                <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                                    <span>Select department</span>
                                    <div class="arrow"></div>
                                </div>
                                <div class="custom-options">
                                    <div class="custom-option selected" data-value="">— None —</div>
                                    <div class="custom-option" data-value="Engineering">Engineering</div>
                                    <div class="custom-option" data-value="Consulting">Consulting</div>
                                    <div class="custom-option" data-value="Projects">Projects</div>
                                    <div class="custom-option" data-value="Support">Support</div>
                                </div>
                                <input type="hidden" id="tm-department" value="">
                            </div>
                        </div>
                        <div class="form-group" style="flex:1; display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:12px; font-weight:600; color:var(--text-secondary);">Project Code</label>
                            <input type="text" id="tm-project-code" placeholder="e.g., PRJ-2026-01" style="padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
                        </div>
                    </div>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin:18px 0 8px;">
                        <div style="font-size:13px; font-weight:700; color:#000;">Items</div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <div id="tm-col-toggle-wrap" style="position:relative;">
                                <button type="button" id="tm-col-toggle-btn" class="btn btn-sm btn-secondary"
                                    onclick="PoReceived.toggleColumnMenu(event)"
                                    title="Visible Columns" aria-label="Visible Columns">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                                    Columns
                                </button>
                                <div id="tm-col-menu" style="display:none; position:absolute; top:100%; right:0; margin-top:6px; min-width:180px; background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:10px; box-shadow:0 12px 30px rgba(0,0,0,0.14); padding:10px 12px; z-index:1200;">
                                    <div style="font-size:11px; font-weight:700; color:var(--text-secondary); letter-spacing:0.4px; text-transform:uppercase; margin-bottom:8px;">Visible Columns</div>
                                    <label style="display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13px; cursor:pointer;"><span>UOM</span><input type="checkbox" data-tm-col="uom" checked onchange="PoReceived.applyColumnVisibility()"></label>
                                    <label style="display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13px; cursor:pointer;"><span>Qty</span><input type="checkbox" data-tm-col="qty" checked onchange="PoReceived.applyColumnVisibility()"></label>
                                    <label style="display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13px; cursor:pointer;"><span>Unit Rate</span><input type="checkbox" data-tm-col="rate" checked onchange="PoReceived.applyColumnVisibility()"></label>
                                    <label style="display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:13px; cursor:pointer;"><span>Amount</span><input type="checkbox" data-tm-col="amount" checked onchange="PoReceived.applyColumnVisibility()"></label>
                                </div>
                            </div>
                            <button type="button" class="btn btn-sm btn-secondary" onclick="PoReceived.addModalItem()">+ Add Item</button>
                        </div>
                    </div>
                    <table id="tm-items-table" style="width:100%; border-collapse:collapse; margin-bottom:18px;">
                        <thead>
                            <tr style="text-align:left; font-size:11px; color:var(--text-secondary); text-transform:uppercase;">
                                <th style="padding:6px 4px;">Specification</th>
                                <th class="tm-col-uom" style="padding:6px 4px; width:150px;">UOM</th>
                                <th class="tm-col-qty" style="padding:6px 4px; width:80px;">Qty</th>
                                <th class="tm-col-rate" style="padding:6px 4px; width:100px;">Unit Rate</th>
                                <th class="tm-col-amount" style="padding:6px 4px; width:110px;">Amount</th>
                                <th style="padding:6px 4px; width:40px;"></th>
                            </tr>
                        </thead>
                        <tbody id="tm-items-body"></tbody>
                    </table>

                    <!-- GST Options + Totals -->
                    <div id="tm-gst-section" style="border-top:1px solid rgba(0,0,0,0.07); padding-top:16px; margin-top:4px;">

                        <!-- Radio options -->
                        <div style="font-size:12px; font-weight:700; color:#71717a; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">GST Treatment</div>
                        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px;">

                            <label id="tm-gst-opt-none-lbl" style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:9px 16px; border:1.5px solid rgba(0,0,0,0.12); border-radius:10px; font-size:13px; font-weight:600; color:#52525b; transition:all 0.15s; flex:1; min-width:140px;">
                                <input type="radio" name="tm-gst-mode" id="tm-gst-none" value="none" checked onchange="PoReceived.recalcTMTotals()" style="accent-color:#004d2c; width:15px; height:15px;">
                                No GST Applicable
                            </label>

                            <label id="tm-gst-opt-add-lbl" style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:9px 16px; border:1.5px solid rgba(0,0,0,0.12); border-radius:10px; font-size:13px; font-weight:600; color:#52525b; transition:all 0.15s; flex:1; min-width:140px;">
                                <input type="radio" name="tm-gst-mode" id="tm-gst-add" value="add" onchange="PoReceived.recalcTMTotals()" style="accent-color:#004d2c; width:15px; height:15px;">
                                Add GST
                            </label>

                            <label id="tm-gst-opt-incl-lbl" style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:9px 16px; border:1.5px solid rgba(0,0,0,0.12); border-radius:10px; font-size:13px; font-weight:600; color:#52525b; transition:all 0.15s; flex:1; min-width:140px;">
                                <input type="radio" name="tm-gst-mode" id="tm-gst-incl" value="incl" onchange="PoReceived.recalcTMTotals()" style="accent-color:#004d2c; width:15px; height:15px;">
                                GST Included
                            </label>

                        </div>

                        <!-- Totals display -->
                        <div id="tm-totals-display" style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; font-size:13px;">
                            <div style="display:flex; justify-content:space-between; width:280px; color:#52525b;">
                                <span id="tm-subtotal-label">PO Value (No GST)</span>
                                <span id="tm-subtotal-display" style="font-weight:600;">0.00</span>
                            </div>
                            <div id="tm-gst-row-display" style="display:none; justify-content:space-between; width:280px; color:#52525b;">
                                <span id="tm-gst-combined-label">GST (18%)</span>
                                <span id="tm-gst-combined-display" style="font-weight:600;">0.00</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; width:280px; border-top:1.5px solid rgba(0,0,0,0.12); padding-top:7px; margin-top:2px;">
                                <span style="font-weight:700; color:#18181b;">Grand Total</span>
                                <span id="tm-grand-total-display" style="font-weight:800; color:#004d2c; font-size:15px;">0.00</span>
                            </div>
                        </div>
                    </div>


                    <!-- No Terms & Conditions on the PO Received collection form; the
                         uploaded source document carries them. -->

                    <div class="modal-actions" style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
                        <button type="button" class="btn btn-secondary" onclick="PoReceived.closeDetailsModal()" style="min-width:110px;">Cancel</button>
                        <button type="button" id="tm-save-btn" class="btn btn-primary" onclick="PoReceived.saveDetails()" style="min-width:110px;">Save Details</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        // Intentionally NOT closing on backdrop click — the details/collection form
        // must stay open until the user explicitly closes (Close/Cancel) or saves it,
        // so an accidental click outside the card cannot discard entered data.

        return modal;
    }

    // Premium popup that asks whether the uploaded document is Domestic or International
    // before the collection (details) form is shown. The choice drives the ref marker
    // and the currency options.
    function _chooseModeThenOpen() {
        let pop = document.getElementById('tm-mode-popup');
        if (pop) pop.remove();
        pop = document.createElement('div');
        pop.id = 'tm-mode-popup';
        pop.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:9500; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(4px); font-family:'Inter', -apple-system, sans-serif;";
        pop.innerHTML = `
            <div class="tm-mode-popup-card">
                <div class="tm-mode-popup-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                </div>
                <div class="tm-mode-popup-title">Select Region</div>
                <div class="tm-mode-popup-options">
                    <button type="button" data-mode="domestic" class="tm-mode-option-card tm-mode-domestic">
                        <span class="tm-mode-card-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                        </span>
                        <span class="tm-mode-card-text">
                            <span class="tm-mode-card-title">Domestic</span>
                            <span class="tm-mode-card-sub">Within India · INR</span>
                        </span>
                        <svg class="tm-mode-card-arrow" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                    <button type="button" data-mode="international" class="tm-mode-option-card tm-mode-international">
                        <span class="tm-mode-card-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                        </span>
                        <span class="tm-mode-card-text">
                            <span class="tm-mode-card-title">International</span>
                            <span class="tm-mode-card-sub">Cross-border · Foreign currency</span>
                        </span>
                        <svg class="tm-mode-card-arrow" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
                <button type="button" class="tm-mode-popup-cancel" id="tm-mode-cancel">Cancel</button>
            </div>
        `;
        document.body.appendChild(pop);
        
        pop.querySelectorAll('.tm-mode-option-card').forEach(btn => {
            btn.addEventListener('click', () => {
                _tmMode = btn.dataset.mode;
                pop.remove();
                _openDetailsModal();
            });
        });
        const cancelBtn = pop.querySelector('#tm-mode-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { pop.remove(); _pendingUpload = null; });
    }

    function _openDetailsModal(doc = null) {
        const modal = _ensureModal();

        // Reset form or populate with doc details
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };

        if (doc && doc.details) {
            const details = doc.details;
            _tmMode = (details.mode === 'domestic' || details.mode === 'international')
                ? details.mode
                : (_modeFromRef(doc.refNumber) || 'domestic');
            _pendingUpload = {
                id: doc.id,
                fileName: doc.fileName,
                filePath: doc.filePath
            };

            setVal('tm-date', details.date || '');
            const typeSel = document.getElementById('tm-type');
            if (typeSel) typeSel.value = details.invoiceType || 'po';

            setVal('tm-client-name', details.clientName || '');
            setVal('tm-client-gst', details.clientGST || '');
            setVal('tm-client-address', details.clientAddress || '');
            setVal('tm-client-contact-person', details.clientContactPerson || '');
            setVal('tm-client-contact', details.clientContact || '');
            setVal('tm-client-email', details.clientEmail || '');

            // Pre-select the matching saved client (if any)
            const matchedClient = _tmClientsForMode().find(c => c.name === details.clientName);
            _updateTMClientDropdown(matchedClient ? matchedClient.id : '');
            const tmFields = document.getElementById('tm-client-fields');
            if (tmFields) tmFields.style.display = 'none';

            setVal('tm-po-date', details.poDate || details.jobDate || '');
            setVal('tm-po-number', details.poNumber || details.jobMode || '');
            setVal('tm-shipped-via', details.shippedVia || '');
            setVal('tm-project-code', details.projectCode || '');
            _applyTMDepartment(details.department || '');

            // Currency options
            _rebuildTMCurrencyDropdown(details.currency);

            // File name label
            const fnEl = document.getElementById('tm-modal-filename');
            if (fnEl) fnEl.textContent = '📎 ' + doc.fileName;

            // Add items
            _modalItemCount = 0;
            const tbody = document.getElementById('tm-items-body');
            if (tbody) tbody.innerHTML = '';
            if (details.items && details.items.length > 0) {
                details.items.forEach(item => addModalItem(item));
            } else {
                addModalItem();
            }

            // Restore GST mode radio (gstMode preferred, fallback from gstEnabled for old records)
            const savedMode = details.gstMode || (details.gstEnabled ? 'add' : 'none');
            const radioToSet = document.querySelector(`input[name="tm-gst-mode"][value="${savedMode}"]`);
            if (radioToSet) radioToSet.checked = true;
            setTimeout(() => recalcTMTotals(), 0);
        } else {
            setVal('tm-date', new Date().toISOString().split('T')[0]);
            const typeSel = document.getElementById('tm-type');
            if (typeSel) typeSel.value = 'po';
            ['tm-client-name', 'tm-client-gst', 'tm-client-address', 'tm-client-contact-person',
                'tm-client-contact', 'tm-client-email', 'tm-po-date', 'tm-po-number', 'tm-job-date',
                'tm-job-mode', 'tm-shipped-via', 'tm-project-code'].forEach(id => setVal(id, ''));
            _applyTMDepartment('');

            // Fresh document — no client picked yet.
            _updateTMClientDropdown('');
            const tmFieldsNew = document.getElementById('tm-client-fields');
            if (tmFieldsNew) tmFieldsNew.style.display = 'none';
            const tmActionsNew = document.getElementById('tm-client-save-actions');
            if (tmActionsNew) tmActionsNew.style.display = 'none';

            // Currency options
            _rebuildTMCurrencyDropdown();

            // File name label
            const fnEl = document.getElementById('tm-modal-filename');
            if (fnEl && _pendingUpload) fnEl.textContent = '📎 ' + _pendingUpload.fileName;

            // One empty item row
            _modalItemCount = 0;
            const tbody = document.getElementById('tm-items-body');
            if (tbody) tbody.innerHTML = '';
            addModalItem();

            // Default GST mode to 'No GST Applicable' for new document
            const noneRadio = document.querySelector('input[name="tm-gst-mode"][value="none"]');
            if (noneRadio) noneRadio.checked = true;
            setTimeout(() => recalcTMTotals(), 0);
        }

        // Clear dynamic lists and load defaults or initial empty rows
        _modalTermCount = 0;
        _modalConditionCount = 0;
        const termsList = document.getElementById('tm-terms-list');
        if (termsList) termsList.innerHTML = '';
        const condList = document.getElementById('tm-conditions-list');
        if (condList) condList.innerHTML = '';

        if (doc && doc.details) {
            const termsToLoad = doc.details.terms || [];
            if (termsToLoad.length > 0) {
                termsToLoad.forEach(t => addModalTerm(t));
            } else {
                addModalTerm();
            }

            const condsToLoad = doc.details.conditions || [];
            if (condsToLoad.length > 0) {
                condsToLoad.forEach(c => addModalCondition(c));
            } else {
                addModalCondition();
            }
        } else {
            const settings = Storage.getSettings();
            const defaultTerms = settings.poDefaultTerms || [];
            if (defaultTerms.length > 0) {
                defaultTerms.forEach(t => addModalTerm(t));
            } else {
                addModalTerm();
            }

            const defaultConds = settings.poDefaultConditions || [];
            if (defaultConds.length > 0) {
                defaultConds.forEach(c => addModalCondition(c));
            } else {
                addModalCondition();
            }
        }

        updateCorrBankDropdown();
        updateBenefBankDropdown();
        updateUltBenefDropdown();

        if (doc && doc.details) {
            setVal('tm-corr-bank', doc.details.corrBankId || '');
            setVal('tm-benef-bank', doc.details.benefBankId || '');
            setVal('tm-ult-benef', doc.details.ultBenefId || '');
        }

        toggleModalMeta();
        _applyTMModeToClientFields();
        modal.style.display = 'flex';
    }

    function closeDetailsModal() {
        const modal = document.getElementById('tm-details-modal');
        if (modal) modal.style.display = 'none';
        _pendingUpload = null;
    }

    function updateCorrBankDropdown() {
        const sel = document.getElementById('tm-corr-bank');
        if (!sel) return;
        const banks = Storage.getAllCorrBanks();
        sel.innerHTML = '<option value="">— Select Correspondent Bank —</option>' +
            banks.map(b => `<option value="${b.id}">${_escapeHtml(b.name)}</option>`).join('');
    }

    function updateBenefBankDropdown() {
        const sel = document.getElementById('tm-benef-bank');
        if (!sel) return;
        const banks = Storage.getAllBenefBanks();
        sel.innerHTML = '<option value="">— Select Beneficiary Bank —</option>' +
            banks.map(b => `<option value="${b.id}">${_escapeHtml(b.name)}</option>`).join('');
    }

    function updateUltBenefDropdown() {
        const sel = document.getElementById('tm-ult-benef');
        if (!sel) return;
        const list = Storage.getAllUltBenef();
        sel.innerHTML = '<option value="">— Select Ultimate Beneficiary —</option>' +
            list.map(ub => `<option value="${ub.id}">${_escapeHtml(ub.orgName)}</option>`).join('');
    }

    function addCorrBank() {
        App.showAddCorrBankModal((data) => {
            const saved = Storage.saveCorrBank(data);
            updateCorrBankDropdown();
            const sel = document.getElementById('tm-corr-bank');
            if (sel) sel.value = saved.id;
            App.showToast(`Bank "${saved.name}" saved!`, 'success');
        });
    }

    function addBenefBank() {
        App.showAddBenefBankModal((data) => {
            const saved = Storage.saveBenefBank(data);
            updateBenefBankDropdown();
            const sel = document.getElementById('tm-benef-bank');
            if (sel) sel.value = saved.id;
            App.showToast(`Bank "${saved.name}" saved!`, 'success');
        });
    }

    function addUltBenef() {
        App.showAddUltBenefModal((data) => {
            const saved = Storage.saveUltBenef(data);
            if (saved.success) {
                updateUltBenefDropdown();
                const list = Storage.getAllUltBenef();
                const matched = list.find(ub => ub.orgName === data.orgName);
                const sel = document.getElementById('tm-ult-benef');
                if (sel && matched) sel.value = matched.id;
                App.showToast(`Beneficiary "${data.orgName}" saved!`, 'success');
            } else {
                App.showToast(saved.message || 'Save failed', 'error');
            }
        });
    }

    let _modalTermCount = 0;
    let _modalConditionCount = 0;

    function addModalTerm(value = '') {
        _modalTermCount++;
        const list = document.getElementById('tm-terms-list');
        if (!list) return;
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `tm-term-${_modalTermCount}`;
        div.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:8px;';
        const num = list.children.length + 1;
        div.innerHTML = `
            <span class="list-number" style="font-size:13px; font-weight:600; min-width:20px;">${num}.</span>
            <input type="text" class="tm-term-input" value="${_escapeAttr(value)}" placeholder="Enter payment term" style="flex:1; padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
            <button type="button" class="btn-remove" onclick="PoReceived.removeModalTerm(${_modalTermCount})" style="background:transparent; border:none; color:#E53935; font-size:18px; cursor:pointer; line-height:1;">×</button>
        `;
        list.appendChild(div);
    }

    function removeModalTerm(id) {
        const el = document.getElementById(`tm-term-${id}`);
        if (el) {
            el.remove();
            _renumberModalList('tm-terms-list');
        }
    }

    function addModalCondition(value = '') {
        _modalConditionCount++;
        const list = document.getElementById('tm-conditions-list');
        if (!list) return;
        const div = document.createElement('div');
        div.className = 'dynamic-list-item';
        div.id = `tm-condition-${_modalConditionCount}`;
        div.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:8px;';
        const num = list.children.length + 1;
        div.innerHTML = `
            <span class="list-number" style="font-size:13px; font-weight:600; min-width:20px;">${num}.</span>
            <input type="text" class="tm-condition-input" value="${_escapeAttr(value)}" placeholder="Enter general term/condition" style="flex:1; padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px;">
            <button type="button" class="btn-remove" onclick="PoReceived.removeModalCondition(${_modalConditionCount})" style="background:transparent; border:none; color:#E53935; font-size:18px; cursor:pointer; line-height:1;">×</button>
        `;
        list.appendChild(div);
    }

    function removeModalCondition(id) {
        const el = document.getElementById(`tm-condition-${id}`);
        if (el) {
            el.remove();
            _renumberModalList('tm-conditions-list');
        }
    }

    function _renumberModalList(listId) {
        const list = document.getElementById(listId);
        if (!list) return;
        Array.from(list.children).forEach((item, idx) => {
            const numSpan = item.querySelector('.list-number');
            if (numSpan) numSpan.textContent = `${idx + 1}.`;
        });
    }

    /* =========================================================
       Client select / add — mirrors the Quotation form so a saved
       client can be picked, or a new one added inline.
       ========================================================= */

    // Clients are kept separate per mode (domestic vs international). A client's
    // clientType tags it; untagged (legacy) clients count as domestic.
    function _tmClientsForMode() {
        return Storage.getAllVendors().filter(c => (c.clientType || 'domestic') === _tmMode);
    }

    // Rebuild the saved-client dropdown options, optionally pre-selecting one.
    function _updateTMClientDropdown(selectedId = '') {
        const clients = _tmClientsForMode();
        App.setupGroupedClientSelect('tm', clients, selectedId, PoReceived.onClientSelect);
    }

    // Rebuild the currency dropdown dynamically based on the current mode.
    function _rebuildTMCurrencyDropdown(selectedVal = '') {
        const currencies = _tmCurrencies();
        const target = selectedVal || (_tmMode === 'domestic' ? 'INR' : 'USD');
        const wrapper = document.getElementById('tm-currency-wrapper');
        const hidden = document.getElementById('tm-currency');
        if (!wrapper || !hidden) return;
        const optionsBox = wrapper.querySelector('#tm-currency-options');
        if (optionsBox) {
            optionsBox.innerHTML = App.buildCurrencyOptionsHTML(currencies, target);
        }
        hidden.value = target;
        const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
        if (triggerSpan) triggerSpan.textContent = target;
        // Hide the selector wrapper entirely when domestic (INR only)
        wrapper.style.display = currencies.length <= 1 ? 'none' : '';
    }

    // Set the Department select to `val` (blank = none). Updates the hidden input,
    // the trigger label and the selected option so it survives load/reset.
    function _applyTMDepartment(val) {
        const hidden = document.getElementById('tm-department');
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

    // Hide the GST field for international documents (no GST applies abroad).
    function _applyTMModeToClientFields() {
        const gstGroup = document.getElementById('tm-client-gst-group');
        if (gstGroup) gstGroup.style.display = _tmMode === 'international' ? 'none' : '';
        if (_tmMode === 'international') {
            const gst = document.getElementById('tm-client-gst');
            if (gst) gst.value = '';
        }
        // Hide the GST section for international (no GST abroad), reset to 'none', and refresh.
        const gstSection = document.getElementById('tm-gst-section');
        if (gstSection) gstSection.style.display = _tmMode === 'international' ? 'none' : '';
        if (_tmMode === 'international') {
            const noneRadio = document.querySelector('input[name="tm-gst-mode"][value="none"]');
            if (noneRadio) noneRadio.checked = true;
        }
        recalcTMTotals();
    }

    function onClientSelect() {
        const sel = document.getElementById('tm-client-select');
        const clientId = sel ? sel.value : '';
        const fieldsDiv = document.getElementById('tm-client-fields');
        const actionsDiv = document.getElementById('tm-client-save-actions');
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };

        if (actionsDiv) actionsDiv.style.display = 'none';

        if (!clientId) {
            ['tm-client-name', 'tm-client-gst', 'tm-client-address', 'tm-client-contact-person',
                'tm-client-contact', 'tm-client-email'].forEach(id => setVal(id, ''));
            if (fieldsDiv) fieldsDiv.style.display = 'none';
            return;
        }

        const client = Storage.getVendor(clientId);
        if (client) {
            setVal('tm-client-name', client.name || '');
            setVal('tm-client-gst', client.gst || '');
            setVal('tm-client-address', client.address || '');
            setVal('tm-client-contact-person', client.contactPerson || '');
            setVal('tm-client-contact', client.contact || '');
            setVal('tm-client-email', client.email || '');
            // Do not show the client details once selected
            if (fieldsDiv) fieldsDiv.style.display = 'none';
            _applyTMModeToClientFields();
        }
    }

    function showAddClient() {
        App.showAddContactModal('client', (data) => {
            // Clients are partitioned by the document's mode, so a client added
            // here always belongs to the current domestic/international run.
            _tmPendingClientType = _tmMode || 'domestic';
            const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
            setVal('tm-client-name', data.name);
            setVal('tm-client-gst', data.gst);
            setVal('tm-client-address', data.address);
            setVal('tm-client-contact-person', data.contactPerson);
            setVal('tm-client-contact', data.contact);
            setVal('tm-client-email', data.email);
            saveNewClient();
        }, () => {
            _updateTMClientDropdown('');
        }, { hideClientType: true });
    }

    function hideAddClient() {
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        ['tm-client-name', 'tm-client-gst', 'tm-client-address', 'tm-client-contact-person',
            'tm-client-contact', 'tm-client-email'].forEach(id => setVal(id, ''));
        const fieldsDiv = document.getElementById('tm-client-fields');
        const actionsDiv = document.getElementById('tm-client-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';
        _updateTMClientDropdown('');
    }

    function saveNewClient() {
        const name = (document.getElementById('tm-client-name')?.value || '').trim();
        if (!name) {
            if (App && App.showToast) App.showToast('Please enter client company name', 'error');
            return;
        }
        const clientData = {
            name: name,
            gst: (document.getElementById('tm-client-gst')?.value || '').trim(),
            address: (document.getElementById('tm-client-address')?.value || '').trim(),
            contactPerson: (document.getElementById('tm-client-contact-person')?.value || '').trim(),
            contact: (document.getElementById('tm-client-contact')?.value || '').trim(),
            email: (document.getElementById('tm-client-email')?.value || '').trim(),
            clientType: _tmMode || _tmPendingClientType || 'domestic'
        };
        const saved = Storage.saveVendor(clientData);
        _tmPendingClientType = 'domestic';

        _updateTMClientDropdown(saved.id);

        // Keep the saved client's details visible and current.
        const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        setVal('tm-client-name', saved.name || '');
        setVal('tm-client-gst', saved.gst || '');
        setVal('tm-client-address', saved.address || '');
        setVal('tm-client-contact-person', saved.contactPerson || '');
        setVal('tm-client-contact', saved.contact || '');
        setVal('tm-client-email', saved.email || '');

        const fieldsDiv = document.getElementById('tm-client-fields');
        const actionsDiv = document.getElementById('tm-client-save-actions');
        if (fieldsDiv) fieldsDiv.style.display = 'none';
        if (actionsDiv) actionsDiv.style.display = 'none';
        _applyTMModeToClientFields();

        if (App && App.showToast) App.showToast(`Client "${saved.name}" saved!`, 'success');
    }

    function toggleModalMeta() {
        // No-op: we now have universal Order Date and Order Reference fields
    }

    function addModalItem(item = null) {
        const tbody = document.getElementById('tm-items-body');
        if (!tbody) return;
        _modalItemCount++;
        const tr = document.createElement('tr');
        tr.dataset.rowId = _modalItemCount;
        const inputStyle = 'width:100%; padding:7px; border:1px solid rgba(0,0,0,0.12); border-radius:6px; font-size:13px; box-sizing:border-box;';
        const uomVal = item && item.uom ? item.uom : 'Hrs';
        tr.innerHTML = `
            <td style="padding:4px;"><textarea rows="2" class="tm-item-spec" placeholder="Detailed specification" style="${inputStyle}">${item ? _escapeHtml(item.specification) : ''}</textarea></td>
            <td class="tm-col-uom" style="padding:4px;">
                <div class="custom-select-wrapper uom-select">
                    <div class="custom-select-trigger">
                        <span>${_escapeAttr(uomVal)}</span>
                    </div>
                    <div class="custom-options">${App.uomOptionsHTML(uomVal)}</div>
                    <input type="hidden" class="tm-item-uom" value="${_escapeAttr(uomVal)}">
                </div>
            </td>
            <td class="tm-col-qty" style="padding:4px;"><input type="number" min="0" step="any" class="tm-item-qty" oninput="PoReceived.recalcModalRow(this)" value="${item ? item.qty : ''}" style="${inputStyle}"></td>
            <td class="tm-col-rate" style="padding:4px;"><input type="number" min="0" step="any" class="tm-item-rate" oninput="PoReceived.recalcModalRow(this)" value="${item ? item.rate : ''}" style="${inputStyle}"></td>
            <td class="tm-col-amount" style="padding:4px;"><input type="number" min="0" step="any" class="tm-item-amount" value="${item ? item.amount.toFixed(2) : ''}" style="${inputStyle}"></td>
            <td style="padding:4px; text-align:center;"><button type="button" onclick="PoReceived.removeModalItem(this)" title="Remove" style="background:transparent; border:none; color:#E53935; font-size:18px; cursor:pointer; line-height:1;">×</button></td>
        `;
        tbody.appendChild(tr);
        applyColumnVisibility();
    }

    function toggleColumnMenu(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        const menu = document.getElementById('tm-col-menu');
        if (!menu) return;
        const open = menu.style.display === 'block';
        menu.style.display = open ? 'none' : 'block';
        if (!open) {
            const handler = (ev) => {
                const wrap = document.getElementById('tm-col-toggle-wrap');
                if (!wrap || !wrap.contains(ev.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', handler);
                }
            };
            setTimeout(() => document.addEventListener('click', handler), 0);
        }
    }

    function applyColumnVisibility() {
        const cols = ['uom', 'qty', 'rate', 'amount'];
        cols.forEach(col => {
            const cb = document.querySelector(`#tm-col-menu input[data-tm-col="${col}"]`);
            const show = cb ? cb.checked : true;
            document.querySelectorAll('.tm-col-' + col).forEach(el => {
                el.style.display = show ? '' : 'none';
            });
        });
    }

    function removeModalItem(btn) {
        const tbody = document.getElementById('tm-items-body');
        const tr = btn.closest('tr');
        if (tr && tbody && tbody.children.length > 1) {
            tr.remove();
        } else if (tr) {
            // Keep at least one row — just clear it
            tr.querySelectorAll('input, textarea').forEach(el => el.value = '');
        }
    }

    function recalcModalRow(el) {
        const tr = el.closest('tr');
        if (!tr) return;
        const qty = parseFloat(tr.querySelector('.tm-item-qty')?.value) || 0;
        const rate = parseFloat(tr.querySelector('.tm-item-rate')?.value) || 0;
        // Mirror invoice calcRow: amount = qty * rate
        const amount = FinanceUtils.truncate2(qty * rate);
        const amountEl = tr.querySelector('.tm-item-amount');
        if (amountEl) amountEl.value = amount.toFixed(2);
        // Update totals display
        recalcTMTotals();
    }

    // Recalculate and render the GST / totals section in the modal.
    function recalcTMTotals() {
        const items = [];
        document.querySelectorAll('#tm-items-body tr').forEach(row => {
            const amount = parseFloat(row.querySelector('.tm-item-amount')?.value) || 0;
            items.push(amount);
        });
        const subtotal = FinanceUtils.truncate2(items.reduce((s, a) => s + a, 0));

        // Read which radio is selected: 'none' | 'add' | 'incl'
        const gstMode = (() => {
            const r = document.querySelector('input[name="tm-gst-mode"]:checked');
            return r ? r.value : 'none';
        })();

        // Highlight the active radio label
        ['none', 'add', 'incl'].forEach(mode => {
            const lbl = document.getElementById(`tm-gst-opt-${mode}-lbl`);
            if (lbl) {
                lbl.style.borderColor = gstMode === mode ? '#004d2c' : 'rgba(0,0,0,0.12)';
                lbl.style.background  = gstMode === mode ? 'rgba(0,77,44,0.05)' : '#fff';
                lbl.style.color       = gstMode === mode ? '#004d2c' : '#52525b';
            }
        });

        const settings = (typeof Storage !== 'undefined' && Storage.getSettings) ? Storage.getSettings() : {};
        const clientGst = document.getElementById('tm-client-gst')?.value.trim() || '';

        const cur = document.getElementById('tm-currency')?.value || 'INR';
        const sym = (typeof PdfUtils !== 'undefined' && PdfUtils.currencySymbol) ? PdfUtils.currencySymbol(cur) : '₹';
        const fmt = (n) => sym + ' ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        let grandTotal = subtotal;
        let showGstRow = false;
        let gstLabel = 'GST (18%)';
        let gstAmount = 0;
        let subtotalLabel = 'PO Value (No GST)';

        if (gstMode === 'add') {
            // Calculate GST on top of the subtotal
            const fin = FinanceUtils.calculateTotals(subtotal, { ...settings, gstEnabled: true }, clientGst);
            grandTotal = fin.grandTotal;
            gstAmount  = fin.isInterState ? fin.igstAmount : (fin.cgstAmount + fin.sgstAmount);
            const rate = fin.isInterState ? fin.igstRate : (fin.cgstRate + fin.sgstRate);
            gstLabel   = `GST (${rate}%)`;
            showGstRow = true;
            subtotalLabel = 'Subtotal (Excl. GST)';
        } else if (gstMode === 'incl') {
            // PO amount already includes GST — the entered amount IS the grand total
            grandTotal = subtotal;
            subtotalLabel = 'PO Value (GST Included)';
        } else {
            // 'none' — no GST
            grandTotal = subtotal;
            subtotalLabel = 'PO Value (No GST)';
        }

        const subtotalEl   = document.getElementById('tm-subtotal-display');
        const subtitleLbl  = document.getElementById('tm-subtotal-label');
        const grandEl      = document.getElementById('tm-grand-total-display');
        const gstRowEl     = document.getElementById('tm-gst-row-display');
        const gstCombLabel = document.getElementById('tm-gst-combined-label');
        const gstCombVal   = document.getElementById('tm-gst-combined-display');

        if (subtitleLbl) subtitleLbl.textContent = subtotalLabel;
        if (subtotalEl)  subtotalEl.textContent  = fmt(subtotal);
        if (grandEl)     grandEl.textContent      = fmt(grandTotal);

        if (gstRowEl) {
            gstRowEl.style.display = showGstRow ? 'flex' : 'none';
            if (showGstRow) {
                if (gstCombLabel) gstCombLabel.textContent = gstLabel;
                if (gstCombVal)  gstCombVal.textContent   = fmt(gstAmount);
            }
        }
    }

    function _collectModalData() {
        const items = [];
        document.querySelectorAll('#tm-items-body tr').forEach(row => {
            const spec = row.querySelector('.tm-item-spec')?.value || '';
            const qty = parseFloat(row.querySelector('.tm-item-qty')?.value) || 0;
            const uom = row.querySelector('.tm-item-uom')?.value || '';
            const rate = parseFloat(row.querySelector('.tm-item-rate')?.value) || 0;
            const amount = FinanceUtils.truncate2(qty * rate);
            if (!spec.trim() && qty === 0 && rate === 0) return;
            items.push({ sno: items.length + 1, specification: spec, qty, uom, rate, amount });
        });

        const totalAmount = FinanceUtils.truncate2(items.reduce((s, it) => s + it.amount, 0));
        const type = document.getElementById('tm-type')?.value || 'po';
        const getVal = (id) => document.getElementById(id)?.value.trim() || '';

        const terms = [];
        document.querySelectorAll('.tm-term-input').forEach(input => {
            const val = input.value.trim();
            if (val) terms.push(val);
        });

        const conditions = [];
        document.querySelectorAll('.tm-condition-input').forEach(input => {
            const val = input.value.trim();
            if (val) conditions.push(val);
        });

        const corrBankId = document.getElementById('tm-corr-bank')?.value || '';
        const benefBankId = document.getElementById('tm-benef-bank')?.value || '';
        const ultBenefId = document.getElementById('tm-ult-benef')?.value || '';

        return {
            date: document.getElementById('tm-date')?.value || '',
            clientName: getVal('tm-client-name'),
            clientAddress: getVal('tm-client-address'),
            clientGST: getVal('tm-client-gst'),
            clientContactPerson: getVal('tm-client-contact-person'),
            clientContact: getVal('tm-client-contact'),
            clientEmail: getVal('tm-client-email'),
            invoiceType: type,
            poDate: type === 'po' ? (document.getElementById('tm-po-date')?.value || '') : '',
            poNumber: type === 'po' ? getVal('tm-po-number') : '',
            jobDate: type === 'job' ? (document.getElementById('tm-job-date')?.value || '') : '',
            jobMode: type === 'job' ? getVal('tm-job-mode') : '',
            shippedVia: getVal('tm-shipped-via'),
            department: getVal('tm-department'),
            projectCode: getVal('tm-project-code'),
            items,
            terms,
            conditions,
            corrBankId,
            benefBankId,
            ultBenefId,
            totalAmount,
            gstMode: (() => { const r = document.querySelector('input[name="tm-gst-mode"]:checked'); return r ? r.value : 'none'; })(),
            gstEnabled: (() => { const r = document.querySelector('input[name="tm-gst-mode"]:checked'); return r && r.value === 'add'; })(),
            grandTotal: (() => {
                const r = document.querySelector('input[name="tm-gst-mode"]:checked');
                const mode = r ? r.value : 'none';
                if (mode === 'add') {
                    const settings = (typeof Storage !== 'undefined' && Storage.getSettings) ? Storage.getSettings() : {};
                    const clientGst = (document.getElementById('tm-client-gst')?.value || '').trim();
                    return FinanceUtils.calculateTotals(totalAmount, { ...settings, gstEnabled: true }, clientGst).grandTotal;
                }
                // 'incl' — entered value already has GST, 'none' — no GST; both store as-is
                return totalAmount;
            })(),
            currency: document.getElementById('tm-currency')?.value || 'INR'
        };
    }

    async function saveDetails() {
        if (!_pendingUpload) {
            if (App && App.showToast) App.showToast('No uploaded file to attach. Please upload again.', 'error');
            closeDetailsModal();
            return;
        }

        const details = _collectModalData();
        details.mode = _tmMode;

        // Upload the held file to the server now — this is the first time the file
        // touches the server/database. On an edited document the file is already
        // stored (filePath set, no in-memory base64), so we skip re-uploading.
        let filePath = _pendingUpload.filePath;
        let fileName = _pendingUpload.fileName;
        if (_pendingUpload.fileBase64) {
            const saveBtn = document.getElementById('tm-save-btn');
            const oldLabel = saveBtn ? saveBtn.textContent : '';
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
            try {
                const uploadResponse = await fetch('/api/upload-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        file_data: _pendingUpload.fileBase64,
                        filename: fileName,
                        upload_path: Storage.getUserPaths().uploadSavePath || ''
                    })
                });
                if (!uploadResponse.ok) {
                    const errData = await uploadResponse.json().catch(() => ({}));
                    throw new Error(errData.error || 'Upload failed');
                }
                const uploadResult = await uploadResponse.json();
                filePath = uploadResult.path;
                fileName = uploadResult.filename;
                Storage.logActivity('user_action', `Uploaded PO Received document: ${fileName}`);
            } catch (e) {
                console.error('Upload error:', e);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = oldLabel || 'Save Details'; }
                if (App && App.showToast) App.showToast('Upload failed: ' + e.message, 'error');
                return; // keep the modal open so the user can retry
            }
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = oldLabel || 'Save Details'; }
        }

        // Preserve any existing billing history when re-saving an edited doc.
        const _existing = Storage.getTM(_pendingUpload.id);
        const tmData = {
            id: _pendingUpload.id,
            fileName: fileName,
            filePath: filePath,
            details: details,
            savedAt: new Date().toISOString()
        };
        if (_existing && _existing.billing) tmData.billing = _existing.billing;

        Storage.saveTM(tmData);
        closeDetailsModal();
        renderDocumentsList();

        if (App && App.showToast) {
            App.showToast('Document and details saved successfully!', 'success');
        }
    }

    function toggleFilters() {
        const wrapper = document.getElementById('tm-filters-wrapper');
        const btn = document.getElementById('btn-tm-toggle-filters');
        if (!wrapper || !btn) return;

        if (wrapper.style.display === 'none') {
            wrapper.style.display = 'block';
            btn.classList.add('active');
            filtersVisible = true;
        } else {
            wrapper.style.display = 'none';
            btn.classList.remove('active');
            filtersVisible = false;
        }
    }

    // The client filter's parties live under details.clientName here. Registered
    // from both render paths since the filter bar and the table paint separately.
    function _registerClientFilter() {
        Dashboard.registerClientFilter('tm',
            () => (Storage.getAllTMs() || []).map(d => ({ clientName: d.details && d.details.clientName })),
            () => { currentPage = 1; renderDocumentsList(); });
    }

    function applyFilters(keepPage = false) {
        const searchInput = document.getElementById('tm-filter-search');
        const typeInput = document.getElementById('tm-filter-type');
        const regionInput = document.getElementById('tm-filter-region');
        const monthInput = document.getElementById('tm-filter-month');
        const fyInput = document.getElementById('tm-filter-fy');

        if (!keepPage) {
            currentPage = 1;
        }

        if (searchInput) currentSearch = searchInput.value;
        if (typeInput) currentType = typeInput.value;
        currentRegion = regionInput ? regionInput.value : '';
        if (monthInput) currentMonth = monthInput.value;
        if (fyInput) currentFy = fyInput.value;

        renderDocumentsList();
    }

    function renderDocumentsList() {
        const tableContainer = document.getElementById('tm-table-container');
        if (!tableContainer) return;
        const paginationContainer = document.getElementById('tm-pagination-container');
        const _clearPagination = () => { if (paginationContainer) paginationContainer.innerHTML = ''; };

        const allDocs = Storage.getAllTMs();
        _registerClientFilter();

        // Re-sync FY options list dynamically
        const uniqueFys = [...new Set(allDocs.map(doc => {
            return doc.details?.date ? Storage.getFinancialYear(doc.details.date) : '';
        }).filter(Boolean))].sort();

        const fyOptionsEl = document.getElementById('tm-filter-fy-options');
        if (fyOptionsEl) {
            const fyOptionsHtml = `<div class="custom-option${currentFy === '' ? ' selected' : ''}" data-value="">All FY</div>` +
                uniqueFys.map(fy => {
                    return `<div class="custom-option${currentFy === fy ? ' selected' : ''}" data-value="${fy}">${fy}</div>`;
                }).join('');
            fyOptionsEl.innerHTML = fyOptionsHtml;
            
            // Also update the select trigger text if the selected FY is no longer present
            const triggerSpan = fyOptionsEl.closest('.custom-select-wrapper')?.querySelector('.custom-select-trigger span');
            if (triggerSpan) {
                if (currentFy && !uniqueFys.includes(currentFy)) {
                    currentFy = '';
                    const fyInput = document.getElementById('tm-filter-fy');
                    if (fyInput) fyInput.value = '';
                }
                triggerSpan.textContent = currentFy || 'All FY';
            }
        }

        if (allDocs.length === 0) {
            tableContainer.innerHTML = `
                <div class="empty-state">
                    <p>No uploaded purchase orders yet.</p>
                    <p style="color:#bbb; font-size:13px; margin-top:4px;">Upload your first PO file above to get started.</p>
                </div>
            `;
            _clearPagination();
            return;
        }

        // Apply active filters
        const searchQuery = currentSearch.toLowerCase().trim();
        const typeFilter = currentType;
        const regionFilter = currentRegion;
        const monthFilter = currentMonth;
        const fyFilter = currentFy;
        const clientSel = Dashboard.clientSelection('tm');

        const filteredDocs = allDocs.filter(doc => {
            const fileNm = (doc.fileName || '').toLowerCase();
            const refNum = `${doc.refNumber || ''} ${doc.details?.poNumber || ''}`.toLowerCase();
            const clientName = (doc.details?.clientName || '').toLowerCase();

            const matchesSearch = !searchQuery ||
                fileNm.includes(searchQuery) ||
                refNum.includes(searchQuery) ||
                clientName.includes(searchQuery);

            const matchesType = !typeFilter || doc.details?.invoiceType === typeFilter;

            const matchesRegion = !regionFilter || _docRegion(doc) === regionFilter;

            let matchesMonth = true;
            if (monthFilter && doc.details?.date) {
                const month = doc.details.date.split('-')[1];
                matchesMonth = month === monthFilter;
            }

            let matchesFY = true;
            if (fyFilter && doc.details?.date) {
                const fy = Storage.getFinancialYear(doc.details.date);
                matchesFY = fy === fyFilter;
            }

            const matchesClient = !clientSel.size || clientSel.has((doc.details && doc.details.clientName || '').trim());

            return matchesSearch && matchesType && matchesRegion && matchesMonth && matchesFY && matchesClient;
        });

        filteredDocs.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

        if (filteredDocs.length === 0) {
            tableContainer.innerHTML = `
                <div class="empty-state">
                    <p>No matching uploaded purchase orders found.</p>
                </div>
            `;
            _clearPagination();
            return;
        }

        const total = filteredDocs.length;
        const totalPages = Math.ceil(total / pageSize);
        if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
        const paginatedDocs = filteredDocs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

        const rows = paginatedDocs.map(doc => {
            const savedDate = doc.savedAt ? _formatDateTime(doc.savedAt) : '-';
            // A PO can no longer be proforma-billed once it is fully billed or
            // marked completed (e.g. after its invoice was generated).
            const _rowTotal = _tmTotal(doc);
            const _rowClosed = !!(doc.billing && doc.billing.closed);
            const _rowFullyBilled = _rowTotal > 0 && (_rowTotal - _tmBilled(doc)) <= 0.005;
            const _rowProformaLocked = _rowClosed || _rowFullyBilled;

            return `
                <tr>
                    <td>
                        <div style="display: inline-flex; align-items: center; gap: 6px;">
                            <span>${_escapeHtml(doc.details?.poNumber || '-')}</span>
                            ${doc.details?.poNumber ? `
                            <button class="btn-copy-ref" onclick="PoReceived.copyRef('${_escapeAttr(doc.details.poNumber)}')" title="Copy Order Reference Number" style="background: none; border: none; cursor: pointer; padding: 2px; display: inline-flex; align-items: center; color: var(--text-secondary); transition: color 0.2s;" onmouseover="this.style.color='var(--accent-green)'" onmouseout="this.style.color='var(--text-secondary)'">
                                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                            ` : ''}
                        </div>
                    </td>
                    <td>${_escapeHtml(doc.details?.clientName || '-')}</td>
                    <td>${savedDate}</td>
                    ${(() => {
                        const totalVal = _tmTotal(doc);
                        const cur = _tmCurrency(doc);
                        const billed = _tmBilled(doc);
                        const remaining = Math.max(0, totalVal - billed);
                        if (totalVal <= 0) {
                            return `<td style="color:#a1a1aa; font-size:12px;">—</td><td style="color:#a1a1aa;">—</td><td style="color:#a1a1aa;">—</td>`;
                        }
                        const remColor = (totalVal - billed > 0.005 && !(doc.billing && doc.billing.closed)) ? '#b45309' : '#15803d';
                        return `
                            <td>${_amountCell(totalVal, cur, '#18181b')}</td>
                            <td>${_amountCell(billed, cur, '#18181b')}</td>
                            <td>${_amountCell(remaining, cur, remColor)}</td>`;
                    })()}
                    <td>${_billingStatusCell(doc)}</td>
                    <td style="text-align:center; white-space:nowrap;">
                        ${_rowProformaLocked
                            ? `<button class="btn-action-generate" disabled title="${_rowClosed ? 'This purchase order is completed' : 'This purchase order is fully billed'}" style="opacity:0.5; cursor:not-allowed;">Generate Proforma</button>`
                            : `<button class="btn-action-generate" onclick="PoReceived.generateProforma('${doc.id}')" title="Generate Proforma Invoice from this document">Generate Proforma</button>`}
                        <button class="btn-row-actions" onclick="PoReceived.toggleRowMenu(event,'${doc.id}')" title="Actions" aria-label="Actions">⋮</button>
                    </td>
                </tr>
            `;
        }).join('');

        let paginationHtml = '';
        if (total > 0) {
            paginationHtml = Dashboard.renderPagination({
                page: currentPage, pageSize, total, noun: 'purchase orders',
                onPage: 'PoReceived.changePage', onSize: 'PoReceived.changePageSize'
            });
        }

        tableContainer.innerHTML = `
            <div class="recent-table">
                <table>
                    <thead>
                        <tr>
                            <th>Order Reference Number</th>
                            <th>Client</th>
                            <th>Date Saved</th>
                            <th>Total</th>
                            <th>Billed</th>
                            <th>Remaining</th>
                            <th>Status</th>
                            <th style="text-align:center; min-width: 140px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
        if (paginationContainer) paginationContainer.innerHTML = paginationHtml;
    }

    function _formatDateTime(isoStr) {
        try {
            const d = new Date(isoStr);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        } catch (e) {
            return isoStr;
        }
    }

    function _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _escapeAttr(str) {
        if (!str) return '';
        return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    function editDocument(id) {
        const doc = Storage.getTM(id);
        if (!doc) {
            if (App && App.showToast) App.showToast('Document not found.', 'error');
            return;
        }
        _openDetailsModal(doc);
    }

    function generateInvoice(id) {
        const doc = Storage.getTM(id);
        if (!doc || !doc.details) {
            if (App && App.showToast) App.showToast('Document details not found. Please edit and save details first.', 'error');
            return;
        }
        const d = doc.details;
        const mode = (d.mode === 'domestic' || d.mode === 'international')
            ? d.mode
            : (_modeFromRef(doc.refNumber) || 'domestic');

        // Build the prefill payload for the Invoice form. The invoice number is
        // intentionally left blank so a fresh one is auto-generated for the chosen mode.
        const editData = {
            mode,
            date: d.date || new Date().toISOString().split('T')[0],
            clientName: d.clientName || '',
            clientGST: d.clientGST || '',
            clientAddress: d.clientAddress || '',
            clientContactPerson: d.clientContactPerson || '',
            clientContact: d.clientContact || '',
            clientEmail: d.clientEmail || '',
            invoiceType: d.invoiceType || 'po',
            poDate: d.poDate || '',
            poNumber: d.poNumber || '',
            jobDate: d.jobDate || '',
            jobMode: d.jobMode || '',
            shippedVia: d.shippedVia || '',
            department: d.department || '',
            projectCode: d.projectCode || '',
            items: Array.isArray(d.items) ? d.items : [],
            terms: Array.isArray(d.terms) ? d.terms : [],
            currency: d.currency || (mode === 'international' ? 'USD' : 'INR'),
            referenceMode: '',
            referenceFileName: doc.fileName || '',
            referenceFilePath: doc.filePath || '',
            // Lets the Invoice module mark this PO completed once the invoice is generated.
            sourceTmId: doc.id
        };

        if (typeof Invoice === 'undefined' || !Invoice.render) {
            if (App && App.showToast) App.showToast('Invoice module not available.', 'error');
            return;
        }

        // Render the invoice form (prefilled, correct mode) then navigate to it.
        Invoice.render(editData, mode);
        if (App && App.navigateTo) App.navigateTo('invoice');

        // Force a fresh auto-generated invoice number for the selected mode.
        const refEl = document.getElementById('inv-ref-number');
        if (refEl) {
            refEl.value = '';
            refEl.setAttribute('data-auto-generated', 'true');
            if (Invoice.updateAutoRefNumber) Invoice.updateAutoRefNumber();
        }

        if (App && App.showToast) {
            App.showToast(`Generating ${mode} invoice from ${d.poNumber || doc.refNumber || 'PO'}…`, 'success');
        }
    }

    // ----- Proforma Invoice generation -------------------------------------
    // Opens the editable Proforma popup (owned by the ProformaInvoice module),
    // prefilled with this PO Received document's saved details. The user can edit
    // and then generate — saving creates the PROFORMA INVOICE PDF and a record in
    // the Proforma Invoice dashboard.
    function generateProforma(id, itemsOverride) {
        const doc = Storage.getTM(id);
        if (!doc || !doc.details) {
            if (App && App.showToast) App.showToast('Document details not found. Please edit and save details first.', 'error');
            return;
        }
        if (typeof ProformaInvoice === 'undefined' || !ProformaInvoice.openCreate) {
            if (App && App.showToast) App.showToast('Proforma module not available.', 'error');
            return;
        }
        // Block proforma creation once the PO is fully billed or completed.
        const _total = _tmTotal(doc);
        const _closed = !!(doc.billing && doc.billing.closed);
        if (_closed || (_total > 0 && (_total - _tmBilled(doc)) <= 0.005)) {
            if (App && App.showToast) App.showToast(_closed ? 'This purchase order is completed — no further proforma can be created.' : 'This purchase order is fully billed — no further proforma can be created.', 'info');
            return;
        }
        const d = doc.details;
        const mode = (d.mode === 'domestic' || d.mode === 'international')
            ? d.mode
            : (_modeFromRef(doc.refNumber) || 'domestic');

        ProformaInvoice.openCreate({
            mode,
            date: d.date || new Date().toISOString().split('T')[0],
            clientName: d.clientName || '',
            clientGST: d.clientGST || '',
            clientAddress: d.clientAddress || '',
            clientContactPerson: d.clientContactPerson || d.clientContact || '',
            clientContact: d.clientContact || '',
            clientEmail: d.clientEmail || '',
            // Order metadata captured in the PO Received collection form, so it
            // prefills the proforma's Order Date / Order Reference / Shipped Via.
            poDate: d.poDate || d.jobDate || '',
            poNumber: d.poNumber || d.jobMode || '',
            jobDate: d.jobDate || '',
            jobMode: d.jobMode || '',
            shippedVia: d.shippedVia || '',
            department: d.department || '',
            projectCode: d.projectCode || '',
            items: Array.isArray(itemsOverride) ? itemsOverride
                : (Array.isArray(d.items) ? JSON.parse(JSON.stringify(d.items)) : []),
            currency: d.currency || (mode === 'international' ? 'USD' : 'INR'),
            referenceFileName: doc.fileName || '',
            referenceFilePath: doc.filePath || '',
            sourceTmId: doc.id
        });
    }

    // Open a new proforma pre-filled with only the UNBILLED quantity of each item.
    // The user can still reduce a quantity further before generating.
    function generateRemainingProforma(id) {
        const doc = Storage.getTM(id);
        if (!doc || !doc.details) {
            if (App && App.showToast) App.showToast('Document details not found.', 'error');
            return;
        }
        const rem = _remainingItems(doc);
        const leftover = rem.filter(it => it.remainingQty > 0.0001);
        if (leftover.length === 0) {
            if (App && App.showToast) App.showToast('This purchase order is already fully billed.', 'info');
            return;
        }
        const items = leftover.map((it, i) => ({
            sno: i + 1,
            specification: it.specification,
            uom: it.uom,
            qty: it.remainingQty,
            rate: it.rate,
            amount: it.rate * it.remainingQty
        }));
        generateProforma(id, items);
    }

    // ----- Partial-billing tracking ----------------------------------------
    // A received PO can be invoiced in parts. Each proforma generated from it
    // records the billed amount against the doc, so we can show how much of the
    // PO total has been invoiced and how much is still pending — and let the user
    // mark the PO as fully billed (closed).
    function _tmTotal(doc) {
        const d = doc && doc.details;
        if (!d) return 0;
        return parseFloat(d.grandTotal != null ? d.grandTotal : d.totalAmount) || 0;
    }
    function _tmBilled(doc) {
        const entries = doc && doc.billing && Array.isArray(doc.billing.entries) ? doc.billing.entries : [];
        return entries.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    }
    function _tmCurrency(doc) {
        return (doc && doc.details && doc.details.currency) || 'INR';
    }
    function _fmtMoney(v, cur) {
        return (typeof PdfUtils !== 'undefined' && PdfUtils.formatMoney)
            ? PdfUtils.formatMoney(v, cur) : String(v);
    }

    // Per-item billing status: original qty, qty billed so far (summed across all
    // proformas, matched by specification) and the quantity still to bill.
    function _remainingItems(doc) {
        const po = (doc && doc.details && Array.isArray(doc.details.items)) ? doc.details.items : [];
        const entries = (doc && doc.billing && Array.isArray(doc.billing.entries)) ? doc.billing.entries : [];
        return po.map(item => {
            const spec = (item.specification || '').trim();
            let billedQty = 0;
            entries.forEach(e => {
                (e.items || []).forEach(bi => {
                    if ((bi.specification || '') === spec) billedQty += (parseFloat(bi.qty) || 0);
                });
            });
            const origQty = parseFloat(item.qty) || 0;
            const remainingQty = Math.max(0, origQty - billedQty);
            return {
                specification: item.specification || '',
                uom: item.uom || '',
                rate: parseFloat(item.rate) || 0,
                origQty,
                billedQty,
                remainingQty
            };
        });
    }

    // Called from the Proforma module after a proforma is generated from this PO.
    function recordProformaBilling(tmId, proforma) {
        if (!tmId || !proforma) return;
        const doc = Storage.getTM(tmId);
        if (!doc) return;
        if (!doc.billing) doc.billing = { entries: [], closed: false };
        if (!Array.isArray(doc.billing.entries)) doc.billing.entries = [];
        // Record the per-item billed quantity (matched to the PO item by its
        // specification) plus the pre-tax subtotal, so we can show how much of
        // each item's quantity is billed vs. still pending.
        const billedItems = (Array.isArray(proforma.items) ? proforma.items : []).map(it => ({
            specification: (it.specification || '').trim(),
            qty: parseFloat(it.qty) || 0,
            amount: parseFloat(it.amount) || 0
        }));
        // Use the pre-tax subtotal so it matches the PO total (sum of item amounts,
        // before GST). Falls back to grandTotal if subtotal is absent.
        doc.billing.entries.push({
            proformaId: proforma.id || '',
            refNumber: proforma.refNumber || '',
            amount: parseFloat(proforma.totalAmount != null ? proforma.totalAmount : proforma.grandTotal) || 0,
            items: billedItems,
            date: new Date().toISOString()
        });
        Storage.saveTM(doc);
        renderDocumentsList();
    }

    // Called by the Invoice module after an invoice generated from this PO is saved.
    // Marks the PO completed so it shows the "Completed" status and can no longer be
    // proforma-billed.
    function markCompletedFromInvoice(tmId) {
        if (!tmId) return;
        const doc = Storage.getTM(tmId);
        if (!doc) return;
        if (!doc.billing) doc.billing = { entries: [], closed: false };
        if (doc.billing.closed) return;
        doc.billing.closed = true;
        Storage.saveTM(doc);
        renderDocumentsList();
    }

    function closeBilling(id) {
        const doc = Storage.getTM(id);
        if (!doc) return;
        if (!doc.billing) doc.billing = { entries: [], closed: false };
        doc.billing.closed = true;
        Storage.saveTM(doc);
        renderDocumentsList();
        if (App && App.showToast) App.showToast('Billing marked complete for this document.', 'success');
    }

    function reopenBilling(id) {
        const doc = Storage.getTM(id);
        if (!doc || !doc.billing) return;
        doc.billing.closed = false;
        Storage.saveTM(doc);
        renderDocumentsList();
        if (App && App.showToast) App.showToast('Billing reopened for this document.', 'info');
    }

    // One billing amount column (Total / Billed / Remaining). Amount only — the
    // per-item quantity breakdown was intentionally removed.
    function _amountCell(amount, cur, color) {
        return `
            <div style="white-space:nowrap;">
                <b style="color:${color || '#18181b'}; font-size:13px;">${_escapeHtml(_fmtMoney(amount, cur))}</b>
            </div>`;
    }

    // Status badge for the Status column.
    function _billingStatusCell(doc) {
        const total = _tmTotal(doc);
        if (total <= 0) return `<span style="color:#a1a1aa; font-size:12px;">—</span>`;
        const billed = _tmBilled(doc);
        const remaining = total - billed;
        const closed = !!(doc.billing && doc.billing.closed);
        const fullyBilled = remaining <= 0.005;

        let badge;
        if (closed || fullyBilled) {
            // Once billed reaches the PO total, the PO is automatically Completed
            // (and the Generate Proforma button is blocked for the row).
            badge = `<span style="background:rgba(0,77,44,0.10); color:#004d2c; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700;">Completed</span>`;
        } else if (billed > 0) {
            badge = `<span style="background:rgba(180,83,9,0.12); color:#b45309; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700;">Partially billed</span>`;
        } else {
            badge = `<span style="background:rgba(0,0,0,0.06); color:#71717a; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700;">Not billed</span>`;
        }

        return `<div style="display:flex; align-items:center; gap:8px; white-space:nowrap;">${badge}</div>`;
    }

    function copyRef(text) {
        if (!text || text === '-') return;
        navigator.clipboard.writeText(text).then(() => {
            if (App && App.showToast) {
                App.showToast('Reference number copied to clipboard!', 'success');
            }
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            const el = document.createElement('textarea');
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            if (App && App.showToast) {
                App.showToast('Reference number copied to clipboard!', 'success');
            }
        });
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

    return {
        init,
        render,
        processFile,
        viewUploadedFile,
        downloadUploadedFile,
        toggleRowMenu,
        _closeRowMenu,
        recordProformaBilling,
        markCompletedFromInvoice,
        closeBilling,
        reopenBilling,
        generateRemainingProforma,
        deleteDocument,
        editDocument,
        generateInvoice,
        generateProforma,
        copyRef,
        renderDocumentsList,
        closeDetailsModal,
        toggleFilters,
        applyFilters,
        toggleModalMeta,
        onClientSelect,
        showAddClient,
        hideAddClient,
        saveNewClient,
        addModalItem,
        removeModalItem,
        recalcModalRow,
        recalcTMTotals,
        toggleColumnMenu,
        applyColumnVisibility,
        saveDetails,
        addModalTerm,
        removeModalTerm,
        addModalCondition,
        removeModalCondition,
        addCorrBank,
        addBenefBank,
        addUltBenef,
        updateCorrBankDropdown,
        updateBenefBankDropdown,
        updateUltBenefDropdown,
        changePage,
        changePageSize
    };
})();
