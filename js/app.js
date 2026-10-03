/* ============================================
   App Module — main controller + routing
   ============================================ */

const App = (() => {
    let currentPage = 'dashboard';
    let _pendingInvoiceMode = null; // mode chosen from the Invoice nav dropdown
    let _pendingQuotationMode = null; // mode chosen from the Quotation nav dropdown
    let inactivityTimeout;
    let inactivityLimit = 5 * 60 * 1000; // default 5 minutes in milliseconds
    let _lastKeepAlive = 0; // throttle for server session keepalive
    let _isGroupingMode = false;
    let _contactsPage = 1, _contactsPageSize = 10, _contactsFilterKey = '';
    let _activeGroupName = '';
    // Who is ticked in the grouping picker, as "kind:id". The picker paginates and
    // filters, so this cannot live in the DOM — checkboxes on other pages do not
    // exist, and re-rendering would drop every tick the user had made.
    let _groupSelection = new Set();

    function _loadInactivityLimit() {
        const settings = Storage.getSettings();
        const raw = settings.inactivityTimeout;
        const minutes = parseInt(raw, 10);
        if (isNaN(minutes) || minutes < 1) {
            inactivityLimit = 30 * 60 * 1000; // default 30 minutes
        } else {
            inactivityLimit = minutes * 60 * 1000;
        }
    }

    async function init() {
        // Ask the server whether this browser already has a valid session cookie.
        // The database is only fetched once authenticated — it is no longer
        // loaded before login (which previously exposed it to anyone).
        try {
            const authed = await Auth.restoreSession();
            if (authed) {
                await Storage.loadDatabaseFromServer();
                _loadInactivityLimit();
                document.documentElement.classList.remove('no-loading');
                _showApp();
            } else {
                document.documentElement.classList.remove('no-loading');
                _showLogin();
            }
        } catch (err) {
            console.error('App initialization failed:', err);
            document.documentElement.classList.remove('no-loading');
            _showLogin();
        }

        // Wire unified login form
        document.getElementById('login-form').addEventListener('submit', _handleLogin);

        // Wire sidebar navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                if (page === 'purchase-order' && typeof PurchaseOrder !== 'undefined' && PurchaseOrder.resetToDashboard) {
                    PurchaseOrder.resetToDashboard();
                }
                if (page === 'quotation' && typeof Quotation !== 'undefined' && Quotation.resetToDashboard) {
                    Quotation.resetToDashboard();
                }
                if (page) navigateTo(page);
            });
        });

        // Close the profile popup when clicking outside of it
        document.addEventListener('click', (e) => {
            const wrapper = document.querySelector('.topbar-profile-wrapper');
            const popup = document.getElementById('profile-popup');
            if (popup && popup.classList.contains('open') && wrapper && !wrapper.contains(e.target)) {
                popup.classList.remove('open');
            }
        });

        // Wire profile logout button
        const profileLogoutBtn = document.getElementById('btn-profile-logout');
        if (profileLogoutBtn) {
            profileLogoutBtn.addEventListener('click', () => {
                showConfirm(
                    'Logout Confirmation',
                    'Are you sure you want to log out of your session?',
                    () => {
                        _performLogout(`User @${Auth.getUser()} manually logged out`);
                    }
                );
            });
        }

        // Wire back button interception
        window.addEventListener('popstate', (e) => {
            if (Auth.isLoggedIn()) {
                // Prevent going back by pushing state again immediately
                history.pushState({ loggedIn: true }, '');
                showConfirm(
                    'Exit Application',
                    'Are you sure you want to log out and exit the application?',
                    () => {
                        _performLogout(`User @${Auth.getUser()} logged out via back navigation`);
                    }
                );
            }
        });

        // Wire inactivity listener
        ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetInactivityTimer, { passive: true });
        });

        // Render a custom-select's option list as a floating (fixed) layer anchored
        // to its trigger, so it isn't clipped by a scrollable/overflow container
        // (e.g. the UOM picker inside the PO Received details modal, whose card has
        // overflow-y:auto). Flips upward when there isn't room below.
        // Portals options to document.body to avoid parent transform/animation positioning offsets.
        const _ensureSelectSearch = (wrapper) => {
            if (!wrapper.classList.contains('searchable-select')) return;
            const options = wrapper.querySelector('.custom-options') || wrapper._optionsRef;
            if (!options || options.querySelector('.currency-search-input')) return;
            const box = document.createElement('div');
            box.className = 'search-box-wrapper';
            box.style.cssText = 'padding:6px; border-bottom:1px solid rgba(0,0,0,0.08); position:sticky; top:0; background:#fff; z-index:10;';
            box.innerHTML = '<input type="text" class="currency-search-input" placeholder="' + (wrapper.dataset.searchPlaceholder || 'Search name...') + '" autocomplete="off" style="width:100%; padding:6px 8px; font-size:13px; border:1px solid rgba(0,0,0,0.15); border-radius:6px; box-sizing:border-box;">';
            options.insertBefore(box, options.firstChild);
        };

        const _positionFloatingSelect = (wrapper) => {
            const trigger = wrapper.querySelector('.custom-select-trigger');
            let options = wrapper.querySelector('.custom-options') || wrapper._optionsRef;
            if (!trigger || !options) return;

            wrapper._optionsRef = options;
            options._wrapper = wrapper;
            if (!options._originalParent) {
                options._originalParent = wrapper;
            }

            const rect = trigger.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                wrapper.classList.remove('open');
                _closeFloatingSelects();
                return;
            }

            if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
                wrapper.classList.remove('open');
                _closeFloatingSelects();
                return;
            }

            if (options.parentElement !== document.body) {
                document.body.appendChild(options);
            }

            options.style.position = 'fixed';
            options.style.zIndex = '999999';
            options.style.left = rect.left + 'px';
            options.style.minWidth = rect.width + 'px';

            if (wrapper.classList.contains('uom-select')) {
                options.style.width = Math.max(90, rect.width) + 'px';
            } else if (wrapper.dataset.optionsWidth) {
                // Wider list than the trigger; keep it inside the viewport.
                const w = Math.max(Number(wrapper.dataset.optionsWidth) || 0, rect.width);
                options.style.boxSizing = 'border-box';
                options.style.width = w + 'px';
                // Right-align to the trigger when it would run past the viewport
                // (clientWidth excludes the scrollbar).
                const vw = document.documentElement.clientWidth;
                const left = rect.left + w > vw - 8 ? rect.right - w : rect.left;
                options.style.left = Math.max(8, left) + 'px';
            } else {
                options.style.width = rect.width + 'px';
            }

            options.style.maxHeight = '240px';
            options.style.overflowY = 'auto';
            options.style.top = (rect.bottom + 4) + 'px';
            options.style.display = 'block';

            const h = options.offsetHeight || 200;
            if (rect.bottom + 4 + h > window.innerHeight - 8) {
                options.style.top = Math.max(8, rect.top - h - 4) + 'px';
            }
        };

        const _closeFloatingSelects = () => {
            document.querySelectorAll('.custom-options').forEach(options => {
                if (options._originalParent && options.parentElement === document.body) {
                    options.style.display = '';
                    options.style.position = '';
                    options.style.left = '';
                    options.style.top = '';
                    options.style.width = '';
                    options.style.minWidth = '';
                    options.style.zIndex = '';
                    options._originalParent.appendChild(options);
                }
            });
        };

        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('.custom-select-trigger');
            const option = e.target.closest('.custom-option');

            if (trigger) {
                const wrapper = trigger.closest('.custom-select-wrapper');
                if (wrapper) {
                    const isOpen = wrapper.classList.contains('open');
                    _closeFloatingSelects();
                    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));

                    if (!isOpen) {
                        wrapper.classList.add('open');
                        _ensureSelectSearch(wrapper);
                        _positionFloatingSelect(wrapper);
                        const options = wrapper.querySelector('.custom-options') || wrapper._optionsRef;
                        const searchInput = options ? options.querySelector('.currency-search-input') : null;
                        if (searchInput) {
                            searchInput.value = '';
                            options.querySelectorAll('.custom-option').forEach(opt => opt.style.display = '');
                            setTimeout(() => searchInput.focus(), 50);
                        }
                    }
                }
                e.stopPropagation();
            } else if (option) {
                const options = option.closest('.custom-options');
                const wrapper = option.closest('.custom-select-wrapper') || options?._wrapper || options?._originalParent;
                if (wrapper) {
                    const val = option.dataset.value;
                    if (val === '__add_uom__') {
                        wrapper.classList.remove('open');
                        _closeFloatingSelects();
                        e.stopPropagation();
                        promptAddUOM(wrapper);
                        return;
                    }
                    const discountInput = wrapper.querySelector('.item-discount-input');
                    if (discountInput) {
                        discountInput.value = val;
                        discountInput.dispatchEvent(new Event('input', { bubbles: true }));
                        const optContainer = options || wrapper;
                        optContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                        option.classList.add('selected');
                    } else {
                        const hiddenInput = wrapper.querySelector('input[type="hidden"]');
                        const textSpan = wrapper.querySelector('.custom-select-trigger span');
                        if (textSpan) {
                            textSpan.textContent = option.textContent.trim();
                            const optContainer = options || wrapper;
                            optContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                            option.classList.add('selected');
                        }
                        if (hiddenInput) {
                            hiddenInput.value = val;
                            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    wrapper.classList.remove('open');
                    _closeFloatingSelects();
                }
                e.stopPropagation();
            } else {
                if (!e.target.closest('.custom-options')) {
                    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
                    _closeFloatingSelects();
                }
            }
        });

        window.addEventListener('scroll', () => {
            document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
                _positionFloatingSelect(w);
            });
        }, { passive: true, capture: true });

        window.addEventListener('resize', () => {
            document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
                _positionFloatingSelect(w);
            });
        }, { passive: true });

        // Dynamic currency search filter
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('currency-search-input')) {
                const query = e.target.value.trim().toUpperCase();
                const container = e.target.closest('.custom-options');
                if (container) {
                    container.querySelectorAll('.custom-option').forEach(opt => {
                        const val = (opt.dataset.value || '').toUpperCase();
                        const text = opt.textContent.toUpperCase();
                        if (val.includes(query) || text.includes(query)) {
                            opt.style.display = '';
                        } else {
                            opt.style.display = 'none';
                        }
                    });
                }
            }
        });

        // Restrict item-table numeric fields to numbers only (qty, units, rate,
        // price, amount across PO / Quotation / Invoice / Collection form). The
        // discount field additionally allows the "%" sign. Blocks letters and the
        // e / E / + / - characters that type="number" would otherwise accept, for
        // both typing and pasting.
        document.addEventListener('beforeinput', (e) => {
            const t = e.target;
            if (!t || typeof t.matches !== 'function') return;
            const isNumeric = t.matches('.item-units, .item-price, .item-qty, .item-rate, .item-amount, .tm-item-qty, .tm-item-rate, .tm-item-amount');
            const isDiscount = t.matches('.item-discount-input');
            if (!isNumeric && !isDiscount) return;
            if (e.data == null) return; // deletions, navigation, etc.
            const allowed = isDiscount ? /^[0-9.%]+$/ : /^[0-9.]+$/;
            if (!allowed.test(e.data)) {
                e.preventDefault();
            }
        });

        // Wire settings IGST auto-split
        const settingsIgst = document.getElementById('settings-igst');
        if (settingsIgst) {
            settingsIgst.addEventListener('input', () => {
                const igstVal = parseFloat(settingsIgst.value);
                const cgstInput = document.getElementById('settings-cgst');
                const sgstInput = document.getElementById('settings-sgst');
                if (!isNaN(igstVal)) {
                    const halfVal = igstVal / 2;
                    if (cgstInput) cgstInput.value = halfVal;
                    if (sgstInput) sgstInput.value = halfVal;
                } else {
                    if (cgstInput) cgstInput.value = '';
                    if (sgstInput) sgstInput.value = '';
                }
            });
        }

        // Render forms once initially so user draft input is preserved during navigation
        PurchaseOrder.render();
        Quotation.render();
        Invoice.render();
        PoReceived.render();
    }

    function resetInactivityTimer() {
        clearTimeout(inactivityTimeout);
        if (Auth.isLoggedIn()) {
            inactivityTimeout = setTimeout(_handleAutoLogout, inactivityLimit);
            // Keep the SERVER session alive while the user is actively working.
            // Form-filling makes no server requests, so without this the server's
            // idle timeout expires mid-work and the next save (e.g. a column
            // toggle) 401s with "Session expired". Throttled to once/5 min.
            const now = Date.now();
            if (now - _lastKeepAlive > 5 * 60 * 1000) {
                _lastKeepAlive = now;
                fetch('/api/auth/session', { credentials: 'same-origin' }).catch(() => {});
            }
        }
    }

    // Shared logout routine. Shows the loading animation while the server
    // session is torn down, so users always get feedback (and aren't tempted
    // to hammer the button, adding load) before the login screen appears.
    async function _performLogout(logMessage) {
        showLoading('Logging out...');
        if (logMessage) {
            try { Storage.logActivity('user_action', logMessage); } catch (e) { /* ignore */ }
        }
        // Keep the loader visible for a brief minimum so the transition reads
        // as a deliberate action rather than a flicker.
        await Promise.all([
            Auth.logout(),
            new Promise(r => setTimeout(r, 500))
        ]);
        _showLogin(); // hides the loading overlay once the login screen is shown
    }

    function _handleAutoLogout() {
        if (Auth.isLoggedIn()) {
            _performLogout(`User @${Auth.getUser()} automatically logged out due to inactivity`)
                .then(() => showToast('Session expired due to inactivity', 'error'));
        }
    }

    async function _handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl  = document.getElementById('login-error');
        const btn      = e.target.querySelector('.btn-login');

        // Show spinner on the button to cover network latency (login + DB load)
        if (btn) btn.classList.add('loading');
        try {
            const result = await Auth.login(username, password);
            if (result === true) {
                errorEl.style.display = 'none';
                // Session cookie is now set — load the protected database, then show the app.
                await Storage.loadDatabaseFromServer();
                _loadInactivityLimit();
                _showApp();
                const displayName = Auth.getFullName() || username;
                showToast(`Welcome, ${displayName}!`, 'welcome');
                // Note: logActivity automatically filters out admin, so this will only log regular users
                Storage.logActivity('login', `User @${username} logged into Vectis`);
            } else if (result === 'pending') {
                errorEl.textContent = 'Your account is awaiting admin approval.';
                errorEl.style.display = 'block';
            } else if (result === 'locked') {
                errorEl.textContent = 'Too many failed attempts. Please wait 15 minutes and try again.';
                errorEl.style.display = 'block';
            } else {
                errorEl.textContent = 'Invalid username or password.';
                errorEl.style.display = 'block';
                const card = document.querySelector('.login-card');
                card.style.animation = 'shake 0.4s';
                setTimeout(() => card.style.animation = '', 400);
            }
        } finally {
            if (btn) btn.classList.remove('loading');
        }
    }

    function _showLogin() {
        hideLoading();
        clearTimeout(inactivityTimeout);
        sessionStorage.removeItem('vectis_current_page');
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-wrapper').classList.remove('active');
        // Clear login form fields
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        document.getElementById('login-error').style.display = 'none';

        // Reset user tab to signin
        if (typeof AuthUI !== 'undefined' && typeof AuthUI.switchUserTab === 'function') {
            AuthUI.switchUserTab('signin');
        }
    }

    // The Quotation/Invoice nav items open their dashboards directly; the
    // domestic/international choice happens on the dashboard itself.
    function _wireDocNav() {
        const quMenu = document.getElementById('nav-qu-menu');
        const invMenu = document.getElementById('nav-inv-menu');
        if (quMenu) quMenu.style.display = 'none';
        if (invMenu) invMenu.style.display = 'none';
        const navQu = document.getElementById('nav-qu');
        const navInv = document.getElementById('nav-inv');
        if (navQu) {
            navQu.onclick = () => {
                if (typeof Quotation !== 'undefined' && Quotation.resetToDashboard) {
                    Quotation.resetToDashboard();
                }
                navigateTo('quotation');
            };
        }
        if (navInv) {
            navInv.onclick = () => {
                if (typeof Invoice !== 'undefined' && Invoice.resetToDashboard) {
                    Invoice.resetToDashboard();
                }
                navigateTo('invoice');
            };
        }
    }

    function _showApp() {
        hideLoading();
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-wrapper').classList.add('active');
        resetInactivityTimer();
        _wireDocNav();

        // Role-based UI: hide User Management card for non-admins
        const umgmtCard = document.getElementById('user-mgmt-card');
        if (umgmtCard) umgmtCard.style.display = Auth.isAdmin() ? '' : 'none';

        // Hide Admin Panel sidebar navigation for non-admins
        const navAdminPanel = document.getElementById('nav-adminpanel');
        if (navAdminPanel) {
            navAdminPanel.style.display = Auth.isAdmin() ? 'flex' : 'none';
        }

        // Show/hide Admin-only Settings cards
        const resetCountersCard = document.getElementById('settings-reset-counters-card');
        const signatureCard = document.getElementById('settings-signature-card');
        const isAdmin = Auth.isAdmin();
        if (resetCountersCard) resetCountersCard.style.display = isAdmin ? 'block' : 'none';
        // Signature & Stamp is editable by every logged-in user.
        if (signatureCard) signatureCard.style.display = 'block';

        // Update pending badge (admin only)
        if (Auth.isAdmin()) _updatePendingBadge();

        // Push state for back button intercepting
        history.pushState({ loggedIn: true }, '');

        // Render saved page on reload, default to dashboard
        let savedPage = sessionStorage.getItem('vectis_current_page') || 'dashboard';
        if (savedPage === 'admin-panel' && !Auth.isAdmin()) {
            savedPage = 'dashboard';
        }
        navigateTo(savedPage);
    }

    function toggleInvoiceMenu(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('nav-inv-menu');
        if (!menu) return;
        const show = !(menu.style.display && menu.style.display !== 'none');
        menu.style.display = show ? 'block' : 'none';
        if (show) {
            setTimeout(() => {
                const handler = (ev) => {
                    const wrap = document.getElementById('nav-inv-wrap');
                    if (!wrap || !wrap.contains(ev.target)) {
                        menu.style.display = 'none';
                        document.removeEventListener('click', handler);
                    }
                };
                document.addEventListener('click', handler);
            }, 0);
        }
    }

    function openInvoice(mode) {
        const menu = document.getElementById('nav-inv-menu');
        if (menu) menu.style.display = 'none';
        _pendingInvoiceMode = (mode === 'international') ? 'international' : 'domestic';
        if (typeof Invoice !== 'undefined' && Invoice.showCreateView) {
            Invoice.showCreateView(_pendingInvoiceMode);
        }
        navigateTo('invoice');
    }

    function openReceiptDashboard() {
        const menu = document.getElementById('nav-inv-menu');
        if (menu) menu.style.display = 'none';
        navigateTo('receipts');
    }

    function toggleQuotationMenu(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('nav-qu-menu');
        if (!menu) return;
        const show = !(menu.style.display && menu.style.display !== 'none');
        menu.style.display = show ? 'block' : 'none';
        if (show) {
            setTimeout(() => {
                const handler = (ev) => {
                    const wrap = document.getElementById('nav-qu-wrap');
                    if (!wrap || !wrap.contains(ev.target)) {
                        menu.style.display = 'none';
                        document.removeEventListener('click', handler);
                    }
                };
                document.addEventListener('click', handler);
            }, 0);
        }
    }

    function openQuotation(mode) {
        const menu = document.getElementById('nav-qu-menu');
        if (menu) menu.style.display = 'none';
        navigateTo('quotation');
        if (typeof Quotation !== 'undefined' && Quotation.showCreateView) {
            Quotation.showCreateView(mode || 'domestic');
        } else {
            _pendingQuotationMode = (mode === 'international') ? 'international' : 'domestic';
        }
    }

    function navigateTo(page) {
        // Show the loading animation, then let the browser actually paint it
        // BEFORE we run the (potentially heavy) section render. Doing the render
        // synchronously here would block paint, so the overlay would never be
        // seen. We defer the render to the next frames and only hide the overlay
        // once the render has finished — with a guaranteed minimum on-screen
        // time so it never just flickers.
        const token = ++_navToken;
        _showNavLoading();
        const shownAt = performance.now();

        currentPage = page;
        sessionStorage.setItem('vectis_current_page', page);

        // Update sidebar active state (cheap — do it immediately)
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });
        // The Invoice nav is a dropdown (no data-page) — mark it active on the invoice page
        const navInv = document.getElementById('nav-inv');
        if (navInv) navInv.classList.toggle('active', page === 'invoice');
        // The Quotation nav is also a dropdown — mark it active on the quotation page
        const navQu = document.getElementById('nav-qu');
        if (navQu) navQu.classList.toggle('active', page === 'quotation');

        // Yield with a short timeout (NOT requestAnimationFrame — rAF is paused
        // while the tab is in the background, which would leave navigation stuck)
        // so the browser can paint the overlay before the render runs.
        clearTimeout(_navLoadingTimer);
        _navLoadingTimer = setTimeout(() => {
            // A newer navigation started while we were waiting — let it win.
            if (token !== _navToken) return;
            try {
                _renderPage(page);
            } catch (err) {
                console.error('Page render failed:', err);
            } finally {
                const MIN_VISIBLE = 400;
                const wait = Math.max(0, MIN_VISIBLE - (performance.now() - shownAt));
                clearTimeout(_navLoadingTimer);
                _navLoadingTimer = setTimeout(() => {
                    if (token !== _navToken) return;
                    const overlay = document.getElementById('loading-overlay');
                    if (overlay) overlay.classList.remove('show');
                    _stopLoader();
                }, wait);
            }
        }, 30);
    }

    function _renderPage(page) {
        // Show/hide sections
        document.querySelectorAll('.page-section').forEach(section => {
            section.classList.toggle('active', section.id === `section-${page}`);
        });

        // Render page content
        switch (page) {
            case 'dashboard':
                Dashboard.render();
                break;
            case 'purchase-order':
                if (typeof PurchaseOrder !== 'undefined' && PurchaseOrder.isFormActive && PurchaseOrder.isFormActive()) {
                    PurchaseOrder.recalcTax();
                    PurchaseOrder.updateVendorDropdown();
                } else if (typeof PurchaseOrder !== 'undefined' && PurchaseOrder.showDashboardView) {
                    PurchaseOrder.showDashboardView();
                } else {
                    PurchaseOrder.recalcTax();
                    PurchaseOrder.updateVendorDropdown();
                }
                break;
            case 'quotation':
                if (typeof Quotation !== 'undefined' && Quotation.isFormActive && Quotation.isFormActive()) {
                    Quotation.recalcTax();
                    Quotation.updateClientDropdown();
                } else if (typeof Quotation !== 'undefined' && Quotation.showDashboardView) {
                    Quotation.showDashboardView();
                } else {
                    if (_pendingQuotationMode) {
                        Quotation.render(null, _pendingQuotationMode);
                        _pendingQuotationMode = null;
                    }
                    Quotation.recalcTax();
                    Quotation.updateClientDropdown();
                }
                break;
            case 'invoice':
                if (typeof Invoice !== 'undefined' && Invoice.isFormActive && !Invoice.isFormActive()) {
                    Invoice.showDashboardView();
                } else {
                    if (_pendingInvoiceMode) {
                        Invoice.render(null, _pendingInvoiceMode);
                        _pendingInvoiceMode = null;
                    }
                    Invoice.updateClientDropdown();
                }
                break;
            case 'settings':
                _loadSettingsPage();
                break;
            case 'proforma-invoice':
                ProformaInvoice.render();
                break;
            case 'po-received':
                PoReceived.render();
                break;
            case 'sales':
                if (typeof Sales !== 'undefined' && Sales.render) Sales.render();
                break;
            case 'receipts':
                if (typeof Receipts !== 'undefined' && Receipts.renderReceipts) Receipts.renderReceipts();
                break;
            case 'sales-returns':
                if (typeof Receipts !== 'undefined' && Receipts.renderSalesReturns) Receipts.renderSalesReturns();
                break;
            case 'summary':
                if (typeof Summary !== 'undefined' && Summary.render) Summary.render();
                break;
            case 'admin-panel':
                _loadAdminPanel();
                break;
        }

        // Always start a freshly-opened section at the top — otherwise the
        // scroll position carries over from the previous (often longer) page,
        // dropping the user into the middle of the new form.
        const _main = document.querySelector('.main-content') || document.scrollingElement || document.documentElement;
        const _reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        _main.scrollTo({ top: 0, left: 0, behavior: _reduce ? 'auto' : 'smooth' });
        if (_main !== (document.scrollingElement || document.documentElement)) {
            window.scrollTo({ top: 0, behavior: _reduce ? 'auto' : 'smooth' });
        }
    }

    // --- Settings page handlers ---
    function _loadSettingsPage() {
        // Start from a clean slate: return any card left open in the detail modal.
        closeSettingDetail();
        const settings = Storage.getSettings();

        document.getElementById('settings-cgst').value = settings.cgst !== undefined ? settings.cgst : 9;
        document.getElementById('settings-sgst').value = settings.sgst !== undefined ? settings.sgst : 9;
        document.getElementById('settings-igst').value = settings.igst !== undefined ? settings.igst : 18;
        document.getElementById('settings-timeout').value = settings.inactivityTimeout !== undefined ? settings.inactivityTimeout : 5;
        // PDF / upload save paths are per-user, with Quotation and Invoice split
        // into Domestic / International.
        const userPaths = Storage.getUserPaths();
        const _setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        _setVal('settings-po-path', userPaths.poSavePath);
        _setVal('settings-upload-path', userPaths.uploadSavePath);
        _setVal('settings-qu-path-dom', userPaths.quSavePathDom);
        _setVal('settings-qu-path-intl', userPaths.quSavePathIntl);
        _setVal('settings-inv-path-dom', userPaths.invSavePathDom);
        _setVal('settings-inv-path-intl', userPaths.invSavePathIntl);

        // Load Signature & Stamp Settings
        const sigNameEl = document.getElementById('settings-sig-name');
        if (sigNameEl) sigNameEl.value = settings.signName || '';
        const sigDesigEl = document.getElementById('settings-sig-designation');
        if (sigDesigEl) sigDesigEl.value = settings.signDesignation || '';
        // The hidden <img> holds the saved base64; the visible name <div> shows the file name.
        _signatureFields().forEach(f => {
            const img = document.getElementById(`settings-sig-${f.which}-preview`);
            const nameEl = document.getElementById(`settings-sig-${f.which}-name`);
            const data = settings[f.imgKey];
            if (img) {
                if (data) { img.src = data; img.dataset.filename = settings[f.nameKey] || ''; }
                else { img.removeAttribute('src'); delete img.dataset.filename; }
            }
            if (nameEl) {
                if (data) { nameEl.textContent = settings[f.nameKey] || 'Signature on file'; nameEl.style.display = 'block'; }
                else { nameEl.textContent = ''; nameEl.style.display = 'none'; }
            }
        });

        _applyRoleToSettings();
    }

    // Fill the Company Header form with the currently-effective values (built-in
    // defaults merged with any saved override).
    function _populateCompanyHeaderForm() {
        const co = (typeof PdfUtils !== 'undefined' && PdfUtils.activeCompany) ? PdfUtils.activeCompany() : {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('settings-co-name', co.name);
        set('settings-co-address', co.address);
        set('settings-co-address2', co.address2);
        set('settings-co-gst', co.gst);
        set('settings-co-cin', co.cin);
        set('settings-co-phone', co.phone);
        set('settings-co-email', co.email);
        set('settings-co-website', co.website);
        const fileInput = document.getElementById('settings-co-logo-file');
        if (fileInput) fileInput.value = '';
        _showCompanyLogo(Storage.getSettings().companyLogo);
    }

    // Company logo preview in the Company Header form; saved with the header.
    function _showCompanyLogo(src) {
        const img = document.getElementById('settings-co-logo-preview');
        const removeBtn = document.getElementById('settings-co-logo-remove');
        if (!img) return;
        if (src) img.src = src; else img.removeAttribute('src');
        img.style.display = src ? 'block' : 'none';
        if (removeBtn) removeBtn.style.display = src ? '' : 'none';
    }

    // Shrink the upload once to the letterhead's print size (~73 × 19 mm at
    // 300 dpi) as PNG, so transparency survives and settings stay small.
    async function previewCompanyLogo(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
            showToast('Choose a PNG, JPG, WEBP or SVG image', 'error');
            input.value = '';
            return;
        }
        const raw = await PdfUtils.readFileAsBase64(file).catch(() => null);
        const logo = raw && await PdfUtils.rasterizeForPrint(raw, 75, 21, 300, { mime: 'image/png' });
        if (!logo || !logo.startsWith('data:image/png')) {
            showToast('Could not read that image. Try a PNG or JPG.', 'error');
            input.value = '';
            return;
        }
        _showCompanyLogo(logo);
    }

    function removeCompanyLogo() {
        const fileInput = document.getElementById('settings-co-logo-file');
        if (fileInput) fileInput.value = '';
        _showCompanyLogo(null);
    }

    // Save the edited company header into the settings. New PDFs pick it
    // up automatically via PdfUtils.activeCompany() / getLogoBase64().
    function saveCompanyHeader() {
        if (typeof Auth !== 'undefined' && Auth.isAdmin && !Auth.isAdmin()) {
            showToast('Only an admin can edit the company header.', 'error');
            return;
        }
        const get = id => (document.getElementById(id)?.value || '').trim();
        const settings = Storage.getSettings();
        settings.companyHeader = {
            name: get('settings-co-name'),
            address: get('settings-co-address'),
            address2: get('settings-co-address2'),
            gst: get('settings-co-gst'),
            cin: get('settings-co-cin'),
            phone: get('settings-co-phone'),
            email: get('settings-co-email'),
            website: get('settings-co-website')
        };
        settings.companyLogo = document.getElementById('settings-co-logo-preview')?.getAttribute('src') || '';
        Storage.saveSettings(settings);
        showToast('Company header saved. New PDFs will use these details.', 'success');
    }

    // Company Header and Serial Numbers are admin-only.
    function _applyRoleToSettings() {
        const isAdmin = typeof Auth !== 'undefined' && Auth.isAdmin && Auth.isAdmin();
        const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
        // Company Header card is pre-filled with the active (merged) company so
        // the admin can edit the letterhead (e.g. on relocation).
        if (isAdmin) _populateCompanyHeaderForm();
        show('settings-company-card', isAdmin);
        show('tile-company', isAdmin);
        show('tile-serial', isAdmin);
    }

    let _openSettingCardId = null;
    let _openSettingPrevDisplay = '';

    // Move the chosen setting's card into the detail modal and show it.
    function openSettingDetail(cardId, title) {
        closeSettingDetail(); // return any currently-open card first
        const card = document.getElementById(cardId);
        const body = document.getElementById('settings-detail-body');
        const modal = document.getElementById('settings-detail-modal');
        if (!card || !body || !modal) return;
        const titleEl = document.getElementById('settings-detail-title');
        if (titleEl) titleEl.textContent = (title || 'Setting').replace(/&amp;/g, '&');
        _openSettingCardId = cardId;
        _openSettingPrevDisplay = card.style.display || '';
        card.style.display = 'block';
        if (cardId === 'settings-bulk-import-card' && typeof BulkImport !== 'undefined' && BulkImport.renderBulkImportPage) {
            BulkImport.renderBulkImportPage();
        }
        body.appendChild(card);
        modal.style.display = 'flex';
    }

    function closeSettingDetail() {
        const modal = document.getElementById('settings-detail-modal');
        if (modal) modal.style.display = 'none';
        if (_openSettingCardId) {
            const card = document.getElementById(_openSettingCardId);
            const holder = document.getElementById('settings-cards-holder');
            if (card && holder) {
                card.style.display = _openSettingPrevDisplay;
                holder.appendChild(card);
            }
            _openSettingCardId = null;
        }
    }

    // Maps each signature upload to its settings keys (image data + original file name).
    function _signatureFields() {
        return [
            { which: 'poqu', imgKey: 'signImagePoQu', nameKey: 'signImagePoQuName' },
            { which: 'invdom', imgKey: 'invSignImageDom', nameKey: 'invSignImageDomName' },
            { which: 'inv', imgKey: 'invSignImage', nameKey: 'invSignImageName' }
        ];
    }

    async function previewSignatureImage(input, which) {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            showToast('Please choose an image file', 'error');
            input.value = '';
            return;
        }
        try {
            const base64 = await PdfUtils.readFileAsBase64(file);
            const img = document.getElementById(`settings-sig-${which}-preview`);
            const nameEl = document.getElementById(`settings-sig-${which}-name`);
            if (img) { img.src = base64; img.dataset.filename = file.name; }
            if (nameEl) { nameEl.textContent = file.name; nameEl.style.display = 'block'; }
        } catch (e) {
            showToast('Could not read image', 'error');
        }
    }

    function saveSignatureSettings() {
        const settings = Storage.getSettings();
        _signatureFields().forEach(f => {
            const img = document.getElementById(`settings-sig-${f.which}-preview`);
            if (img && img.src && img.src.startsWith('data:')) {
                settings[f.imgKey] = img.src;
                settings[f.nameKey] = img.dataset.filename || '';
            }
        });
        settings.signName = document.getElementById('settings-sig-name').value.trim();
        settings.signDesignation = document.getElementById('settings-sig-designation').value.trim();
        Storage.saveSettings(settings);
        showToast('Signature & Stamp saved successfully!', 'success');
    }

    function saveTaxAndGstSettings() {
        const settings = Storage.getSettings();
        const cgst = parseFloat(document.getElementById('settings-cgst').value);
        const sgst = parseFloat(document.getElementById('settings-sgst').value);
        const igst = parseFloat(document.getElementById('settings-igst').value);

        if (isNaN(cgst) || isNaN(sgst) || isNaN(igst) || cgst < 0 || sgst < 0 || igst < 0) {
            showToast('Please enter valid non-negative GST rates', 'error');
            return;
        }

        settings.cgst = cgst;
        settings.sgst = sgst;
        settings.igst = igst;

        Storage.saveSettings(settings);
        showToast('GST Settings saved successfully!', 'success');
    }

    function saveSessionSettings() {
        const minutes = parseInt(document.getElementById('settings-timeout').value);
        if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
            showToast('Please enter a valid timeout between 1 and 1440 minutes', 'error');
            return;
        }
        const settings = Storage.getSettings();
        settings.inactivityTimeout = minutes;
        Storage.saveSettings(settings);
        _loadInactivityLimit();
        resetInactivityTimer();
        showToast('Preferences saved successfully!', 'success');
    }

    function savePdfPaths() {
        const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        Storage.saveUserPaths({
            poSavePath: val('settings-po-path'),
            uploadSavePath: val('settings-upload-path'),
            quSavePathDom: val('settings-qu-path-dom'),
            quSavePathIntl: val('settings-qu-path-intl'),
            invSavePathDom: val('settings-inv-path-dom'),
            invSavePathIntl: val('settings-inv-path-intl')
        });
        showToast('PDF & Upload Save Paths saved successfully!', 'success');
    }

    function triggerBackup() {
        // Download a full backup to the browser.
        try {
            Storage.exportAllData();
            showToast('Backup downloaded to browser.', 'success');
        } catch (e) {
            console.error('Browser backup download failed:', e);
            showToast('Backup download failed: ' + e.message, 'error');
        }
    }
    function resetDocumentCounters(docType) {
        if (!Auth.isAdmin()) {
            showToast('Permission denied. Admin only.', 'error');
            return;
        }
        const isAll = !docType;
        const LABELS = {
            PO: 'PO Issue',
            QU: 'Quotation',
            INV: 'Invoice',
            INV_DOM: 'Domestic Invoice',
            INV_INT: 'International Invoice',
            TM: 'PO Received'
        };
        const typeLabel = isAll ? 'Document' : (LABELS[docType] || 'Document');
        showConfirm(
            `Reset ${typeLabel} Counters?`,
            `Are you sure you want to reset sequential serial numbers for ${typeLabel}s? This will reset them back to 001 for the current month.`,
            () => {
                Storage.resetCounters(docType);

                // Recalculate automatic numbers if active views are open
                if (isAll || docType === 'PO') {
                    if (typeof PurchaseOrder !== 'undefined' && PurchaseOrder.updateAutoPONumber) {
                        try {
                            PurchaseOrder.updateAutoPONumber();
                        } catch (e) {
                            console.error('Error updating auto PO number:', e);
                        }
                    }
                }
                if (isAll || docType === 'QU') {
                    if (typeof Quotation !== 'undefined' && Quotation.updateAutoRefNumber) {
                        try {
                            Quotation.updateAutoRefNumber();
                        } catch (e) {
                            console.error('Error updating auto Quotation ref number:', e);
                        }
                    }
                }
                if (isAll || docType === 'INV' || docType === 'INV_DOM' || docType === 'INV_INT') {
                    if (typeof Invoice !== 'undefined' && Invoice.updateAutoRefNumber) {
                        try {
                            Invoice.updateAutoRefNumber();
                        } catch (e) {
                            console.error('Error updating auto Invoice ref number:', e);
                        }
                    }
                }
                if (isAll || docType === 'TM') {
                    if (typeof PoReceived !== 'undefined' && PoReceived.updateAutoRefNumber) {
                        try {
                            PoReceived.updateAutoRefNumber();
                        } catch (e) {
                            console.error('Error updating auto PO Received ref number:', e);
                        }
                    }
                }

                showToast(`${typeLabel} serial numbers reset to 001!`, 'success');
            }
        );
    }

    // Manually set the next serial number for a document type (admin only).
    function setSerialStart() {
        if (!Auth.isAdmin()) {
            showToast('Permission denied. Admin only.', 'error');
            return;
        }
        const typeSel = document.getElementById('settings-serial-type');
        const numInput = document.getElementById('settings-serial-start');
        const docType = typeSel ? typeSel.value : '';
        const start = parseInt(numInput ? numInput.value : '', 10);
        if (!docType) {
            showToast('Select a document type', 'error');
            return;
        }
        if (!start || start < 1) {
            showToast('Enter a valid start number (1 or more)', 'error');
            return;
        }
        const fy = Storage.getFinancialYear(new Date().toISOString().split('T')[0]);
        Storage.setCounterStart(docType, fy, start);

        // Refresh auto-generated numbers in any open forms.
        try { if (typeof PurchaseOrder !== 'undefined' && PurchaseOrder.updateAutoPONumber) PurchaseOrder.updateAutoPONumber(); } catch (e) {}
        try { if (typeof Quotation !== 'undefined' && Quotation.updateAutoRefNumber) Quotation.updateAutoRefNumber(); } catch (e) {}
        try { if (typeof Invoice !== 'undefined' && Invoice.updateAutoRefNumber) Invoice.updateAutoRefNumber(); } catch (e) {}
        try { if (typeof PoReceived !== 'undefined' && PoReceived.updateAutoRefNumber) PoReceived.updateAutoRefNumber(); } catch (e) {}

        showToast(`Next serial number set to ${String(start).padStart(3, '0')}!`, 'success');
        if (numInput) numInput.value = '';
    }

    // --- Change password (modal) ---
    async function handleChangePassword(e) {
        e.preventDefault();
        const oldPass = document.getElementById('profile-old-password').value;
        const newPass = document.getElementById('profile-new-password').value;
        const confPass = document.getElementById('profile-confirm-password').value;

        if (newPass !== confPass) {
            showToast('New passwords do not match', 'error');
            return;
        }
        if (newPass.length < 8) {
            showToast('New password must be at least 8 characters long', 'error');
            return;
        }
        if (await Auth.changePassword(oldPass, newPass)) {
            showToast('Password changed successfully!', 'success');
            closeChangePassword();
        } else {
            showToast('Invalid current password', 'error');
        }
    }

    // --- Profile popup (top-bar account menu) ---
    function toggleProfilePopup(e) {
        if (e) e.stopPropagation();
        const popup = document.getElementById('profile-popup');
        if (!popup) return;
        if (popup.classList.contains('open')) {
            popup.classList.remove('open');
            return;
        }
        const user = Auth.getUser() || 'User';
        const fullName = Auth.getFullName();
        const displayName = fullName || user;
        const role = Auth.isAdmin() ? 'Administrator' : 'Member';
        const nameEl = document.getElementById('profile-popup-name');
        const usernameEl = document.getElementById('profile-popup-username');
        const roleEl = document.getElementById('profile-popup-role');
        const avEl = document.getElementById('profile-popup-avatar');
        if (nameEl) nameEl.textContent = displayName;
        if (usernameEl) usernameEl.textContent = user;
        if (roleEl) roleEl.textContent = role;
        if (avEl) avEl.textContent = (displayName.charAt(0) || 'U').toUpperCase();
        popup.classList.add('open');
    }

    function closeProfilePopup() {
        const popup = document.getElementById('profile-popup');
        if (popup) popup.classList.remove('open');
    }

    function openChangePassword() {
        closeProfilePopup();
        const modal = document.getElementById('change-password-modal');
        if (!modal) return;
        document.getElementById('profile-old-password').value = '';
        document.getElementById('profile-new-password').value = '';
        document.getElementById('profile-confirm-password').value = '';
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('profile-old-password').focus(), 50);
    }

    function closeChangePassword() {
        const modal = document.getElementById('change-password-modal');
        if (modal) modal.style.display = 'none';
    }

    function logoutFromPopup() {
        closeProfilePopup();
        showConfirm(
            'Logout Confirmation',
            'Are you sure you want to log out of your session?',
            () => {
                _performLogout(`User @${Auth.getUser()} manually logged out`);
            }
        );
    }

    // --- Custom Confirm Modal ---
    // --- Shared Unit-of-Measure dropdown helpers ---
    // Builds the <div class="custom-option"> list for a UOM dropdown from the
    // database-backed list, plus a trailing "+ Add UOM" entry. Used by all four
    // document modules so every UOM dropdown stays in sync.
    function uomOptionsHTML(selectedVal) {
        const list = Storage.getUOMList();
        let html = list.map(u =>
            `<div class="custom-option${u === selectedVal ? ' selected' : ''}" data-value="${_escapeHtml(u)}">${_escapeHtml(u)}</div>`
        ).join('');
        html += `<div class="custom-option uom-add-option" data-value="__add_uom__" title="Add UOM" style="text-align:center; color:#004d2c; font-weight:700; font-size:16px; line-height:1; border-top:1px solid rgba(0,0,0,0.08);">+</div>`;
        return html;
    }

    // Rebuilds the option list of every UOM dropdown on the page (preserving each
    // one's current selection) so a newly added unit appears everywhere at once.
    function refreshUOMDropdowns() {
        document.querySelectorAll('.custom-select-wrapper.uom-select').forEach(wrapper => {
            const hidden = wrapper.querySelector('input[type="hidden"]');
            const current = hidden ? hidden.value : '';
            const optionsContainer = wrapper.querySelector('.custom-options') || wrapper._optionsRef;
            if (optionsContainer) optionsContainer.innerHTML = uomOptionsHTML(current);
        });
    }

    function _setUOMWrapperValue(wrapper, val) {
        if (!wrapper) return;
        const hidden = wrapper.querySelector('input[type="hidden"]');
        const span = wrapper.querySelector('.custom-select-trigger span');
        if (span) span.textContent = val;
        wrapper.querySelectorAll('.custom-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === val);
        });
        if (hidden) {
            hidden.value = val;
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function promptAddUOM(wrapper) {
        showPrompt('Add Unit of Measure', { placeholder: 'e.g., Nos, Acre, Ton', maxLength: 20 }, (val) => {
            const canonical = Storage.addUOM(val);
            if (!canonical) return;
            refreshUOMDropdowns();
            _setUOMWrapperValue(wrapper, canonical);
            showToast(`UOM "${canonical}" added`, 'success');
        });
    }

    // Lightweight single-input prompt modal (no native prompt()).
    function showPrompt(title, opts, onConfirm) {
        opts = opts || {};
        const existing = document.getElementById('custom-prompt-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'custom-prompt-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:20000; align-items:center; justify-content:center; backdrop-filter:blur(4px); font-family:\'Inter\', -apple-system, sans-serif;';
        modal.innerHTML = `
            <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:14px; padding:24px; width:380px; max-width:92vw; box-shadow:0 15px 45px rgba(0,0,0,0.15);">
                <h3 style="margin:0 0 ${opts.message ? '6px' : '14px'}; font-size:16px; font-weight:600; color:#27272a;">${_escapeHtml(title)}</h3>
                ${opts.message ? `<p style="margin:0 0 14px; font-size:13px; color:#71717a;">${_escapeHtml(opts.message)}</p>` : ''}
                <input type="text" id="custom-prompt-input" placeholder="${_escapeHtml(opts.placeholder || '')}" maxlength="${opts.maxLength || 40}" style="width:100%; padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; box-sizing:border-box; margin-bottom:18px;">
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button type="button" id="custom-prompt-cancel" style="padding:9px 18px; font-size:13px; background:transparent; border:1px solid rgba(0,0,0,0.15); color:#27272a; border-radius:8px; font-weight:500; cursor:pointer;">Cancel</button>
                    <button type="button" id="custom-prompt-ok" style="padding:9px 18px; font-size:13px; background:#004d2c; color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer;">${opts.okText || 'Add'}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const input = modal.querySelector('#custom-prompt-input');
        const close = () => modal.remove();
        const submit = () => {
            const val = input.value.trim();
            close();
            if (val && onConfirm) onConfirm(val);
        };
        modal.querySelector('#custom-prompt-ok').onclick = submit;
        modal.querySelector('#custom-prompt-cancel').onclick = close;
        // Intentionally NOT closing on backdrop click to prevent data loss
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        setTimeout(() => input.focus(), 50);
    }

    // Warn before saving a document whose reference number is already used by any
    // PO / Quotation / Invoice / Proforma. Resolves true to proceed, false to abort.
    // Never blocks on an internal error (fails open). `excludeId` skips the doc being edited.
    function confirmIfDuplicateRef(refNumber, excludeId) {
        return new Promise((resolve) => {
            try {
                const hit = (typeof Storage !== 'undefined' && Storage.findByRefNumber)
                    ? Storage.findByRefNumber(refNumber, excludeId) : null;
                if (!hit) { resolve(true); return; }
                showConfirm(
                    'Duplicate reference number',
                    `Reference number "${hit.refNumber}" is already used by an existing ${hit.type}. Save this document anyway?`,
                    () => resolve(true),
                    () => resolve(false)
                );
            } catch (e) {
                resolve(true);
            }
        });
    }

    function showConfirm(title, message, onConfirm, onCancel, singleButton = false) {
        const modal = document.getElementById('custom-confirm-modal');
        if (!modal) return;

        document.getElementById('modal-title').textContent = title;
        const msgEl = document.getElementById('modal-message');
        if (msgEl) {
            msgEl.textContent = message;
            msgEl.style.display = message ? 'block' : 'none';
        }

        const iconContainer = document.getElementById('modal-icon-container');
        if (iconContainer) {
            const titleLower = title.toLowerCase();
            if (titleLower === 'pdf saved successfully') {
                iconContainer.innerHTML = `
                    <div style="width: 56px; height: 56px; background: rgba(0, 77, 44, 0.08); border: 2px solid rgba(0, 77, 44, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #004d2c;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    </div>
                `;
                iconContainer.style.display = 'flex';
            } else if (titleLower === 'warning') {
                iconContainer.innerHTML = `
                    <div style="width: 56px; height: 56px; background: rgba(243, 123, 33, 0.08); border: 2px solid rgba(243, 123, 33, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #f37b21;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </div>
                `;
                iconContainer.style.display = 'flex';
            } else {
                iconContainer.style.display = 'none';
                iconContainer.innerHTML = '';
            }
        }

        const confirmBtn = document.getElementById('modal-btn-confirm');
        const cancelBtn = document.getElementById('modal-btn-cancel');

        const newConfirmBtn = confirmBtn.cloneNode(true);
        const newCancelBtn = cancelBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

        if (singleButton) {
            newCancelBtn.style.display = 'none';
        } else {
            newCancelBtn.style.display = 'block';
        }

        newConfirmBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            if (onConfirm) onConfirm();
        });

        const closeHandler = () => {
            modal.style.display = 'none';
            if (onCancel) onCancel();
        };

        newCancelBtn.addEventListener('click', closeHandler);
        // Intentionally NOT closing on backdrop click to prevent data loss

        modal.style.display = 'flex';
    }

    function _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showManageContactsModal() {
        const modal = document.getElementById('manage-contacts-modal');
        if (modal) {
            modal.style.display = 'flex';
            renderContactsCard();

            // Intentionally NOT closing on backdrop click to prevent data loss
        }
    }

    function closeManageContactsModal() {
        const modal = document.getElementById('manage-contacts-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        cancelGroupingMode();
    }

    function onCreateGroupClick() {
        showAddToGroupDialog();
    }

    // Every saved contact, kind-tagged, from both stores.
    function _allContacts() {
        return Storage.getAllVendors().map(v => ({ ...v, _kind: 'client' }))
            .concat((Storage.getAllSuppliers ? Storage.getAllSuppliers() : []).map(s => ({ ...s, _kind: 'supplier' })));
    }

    function showAddToGroupDialog() {
        // Collect all existing group names
        const allVendors = Storage.getAllVendors().concat(Storage.getAllSuppliers ? Storage.getAllSuppliers() : []);
        if (allVendors.length === 0) {
            showToast('Please add at least one contact first before creating a group.', 'error');
            return;
        }
        const uniqueGroups = [...new Set(allVendors.filter(v => v.group).map(v => v.group.trim()))].sort();

        // Create a custom modal overlay
        const modal = document.createElement('div');
        modal.id = 'group-choice-modal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex; position:fixed; inset:0; background:rgba(0,0,0,0.3); z-index:20000; align-items:center; justify-content:center; backdrop-filter:blur(4px); font-family:\'Inter\', -apple-system, sans-serif;';
        
        let existingGroupOptions = '';
        if (uniqueGroups.length > 0) {
            existingGroupOptions = `
                <div style="margin-bottom: 16px;">
                    <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Add to Existing Group</label>
                    <div class="custom-select-wrapper" style="width:100%;">
                        <div class="custom-select-trigger" style="justify-content: space-between; text-align: left;">
                            <span>— Select an existing group —</span>
                            <div class="arrow"></div>
                        </div>
                        <div class="custom-options">
                            <div class="custom-option selected" data-value="">— Select an existing group —</div>
                            ${uniqueGroups.map(g => `<div class="custom-option" data-value="${_escapeHtml(g)}">${_escapeHtml(g)}</div>`).join('')}
                        </div>
                        <input type="hidden" id="group-choice-select" value="">
                    </div>
                </div>
                <div style="text-align:center; font-size:11px; color:#a1a1aa; margin-bottom:16px; font-weight:700; letter-spacing:0.5px;">— OR —</div>
            `;
        }

        modal.innerHTML = `
            <div class="modal-card" style="background:#fff; border:1px solid rgba(0,0,0,0.1); border-radius:14px; padding:28px 24px; width:400px; max-width:92vw; box-shadow:0 15px 45px rgba(0,0,0,0.15); text-align:left;">
                <h3 style="margin:0 0 16px; font-size:17px; font-weight:700; color:#000; letter-spacing:-0.2px;">Manage Group</h3>
                ${existingGroupOptions}
                <div style="margin-bottom: 24px;">
                    <label style="display:block; font-size:12px; font-weight:600; color:#52525b; margin-bottom:6px;">Create New Group</label>
                    <input type="text" id="group-choice-input" placeholder="e.g. Acme Group" maxlength="30" style="width:100%; padding:10px; border:1px solid rgba(0,0,0,0.15); border-radius:8px; font-size:14px; box-sizing:border-box; font-family:inherit;">
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button type="button" id="group-choice-cancel" style="padding:9px 18px; font-size:13px; background:transparent; border:1px solid rgba(0,0,0,0.15); color:#27272a; border-radius:8px; font-weight:500; cursor:pointer; font-family:inherit;">Cancel</button>
                    <button type="button" id="group-choice-ok" style="padding:9px 18px; font-size:13px; background:#004d2c; color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer; font-family:inherit;">Proceed</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        
        modal.querySelector('#group-choice-cancel').onclick = close;
        modal.querySelector('#group-choice-ok').onclick = () => {
            const selectVal = document.getElementById('group-choice-select')?.value || '';
            const inputVal = document.getElementById('group-choice-input').value.trim();
            
            let chosenGroup = '';
            if (selectVal) {
                chosenGroup = selectVal;
            } else if (inputVal) {
                chosenGroup = inputVal;
            }
            
            if (!chosenGroup) {
                showToast('Please select or enter a group name', 'error');
                return;
            }
            
            close();
            
            _isGroupingMode = true;
            _activeGroupName = chosenGroup;
            _groupSelection = new Set(_allContacts()
                .filter(c => (c.group || '') === chosenGroup)
                .map(c => `${c._kind}:${c.id}`));
            
            // Update header buttons
            const container = document.getElementById('manage-contacts-actions-container');
            if (container) {
                container.innerHTML = `
                    <span style="font-size: 13px; font-weight: 600; color: #004d2c; margin-right: 8px;">Adding to "${_escapeHtml(_activeGroupName)}"</span>
                    <button type="button" class="btn btn-primary" onclick="App.saveCreatedGroup()" style="margin-right: 4px;">
                        Save
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="App.cancelGroupingMode()">
                        Cancel
                    </button>
                `;
            }
            
            renderContactsCard();
        };

        const focusTarget = document.getElementById('group-choice-select') || document.getElementById('group-choice-input');
        if (focusTarget) setTimeout(() => focusTarget.focus(), 50);
    }

    function cancelGroupingMode() {
        _isGroupingMode = false;
        _activeGroupName = '';
        _groupSelection = new Set();
        
        // Restore header buttons
        const container = document.getElementById('manage-contacts-actions-container');
        if (container) {
            container.innerHTML = `
                <button type="button" class="btn btn-primary" onclick="App.addNewContactFromManage()">
                    + Add Client
                </button>
                <button type="button" class="btn btn-secondary" id="manage-contacts-btn-group" onclick="App.onCreateGroupClick()">
                    Create Group
                </button>
                <button type="button" class="btn btn-secondary" onclick="App.closeManageContactsModal()">✕ Close</button>
            `;
        }
        
        renderContactsCard();
    }

    function saveCreatedGroup() {
        // Walk every contact, not just the checkboxes currently on screen — the
        // picker is paginated and filtered, so the DOM only ever holds one page.
        const clientsToSave = [];
        const suppliersToSave = [];

        _allContacts().forEach(c => {
            const stored = c._kind === 'client' ? Storage.getVendor(c.id) : Storage.getSupplier(c.id);
            if (!stored) return;
            const picked = _groupSelection.has(`${c._kind}:${c.id}`);

            if (picked && stored.group !== _activeGroupName) {
                stored.group = _activeGroupName;
                if (!stored.subGroup) stored.subGroup = '';
            } else if (!picked && stored.group === _activeGroupName) {
                // Unticked a current member — take it back out of the group.
                stored.group = '';
                stored.subGroup = '';
            } else {
                return; // unchanged, or a member of some other group
            }

            (c._kind === 'client' ? clientsToSave : suppliersToSave).push(stored);
        });

        if (clientsToSave.length > 0) {
            Storage.saveVendorsBatch(clientsToSave);
        }
        if (suppliersToSave.length > 0) {
            Storage.saveSuppliersBatch(suppliersToSave);
        }

        showToast(`Group "${_activeGroupName}" saved successfully!`, 'success');
        cancelGroupingMode();
        _refreshContactDropdowns();
    }

    function toggleAllContactsSelection(master) {
        document.querySelectorAll('.contact-group-checkbox').forEach(cb => {
            cb.checked = master.checked;
            toggleContactSelection(cb);
        });
    }

    function toggleContactSelection(cb) {
        const key = `${cb.dataset.kind}:${cb.dataset.id}`;
        if (cb.checked) _groupSelection.add(key);
        else _groupSelection.delete(key);
    }

    function toggleGroupRows(groupName, headerRow) {
        const safeGName = groupName.replace(/\s+/g, '_');
        const subRows = document.querySelectorAll('.group-sub-row-' + safeGName);
        const toggleIcon = headerRow.querySelector('.group-toggle-icon');
        let willExpand = false;
        
        subRows.forEach(row => {
            if (row.style.display === 'none') {
                row.style.display = '';
                willExpand = true;
            } else {
                row.style.display = 'none';
            }
        });
        
        if (toggleIcon) {
            toggleIcon.style.transform = willExpand ? 'rotate(90deg)' : 'rotate(0deg)';
        }
    }

    function renderContactsCard() {
        const container = document.getElementById('contacts-management-list');
        if (!container) return;

        // Clients/vendors (Quotation, Invoice) and PO suppliers are stored
        // separately — merge both so every saved contact shows here. Each row is
        // tagged with its kind so Edit/Delete route to the right store.
        const allVendors = _allContacts();
        if (allVendors.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 24px; color: var(--text-secondary); background: rgba(0,0,0,0.01); border-radius: 8px; border: 1px dashed rgba(0,0,0,0.1);">
                    No saved contacts found. You can add them while creating a PO Issue or Quotation.
                </div>
            `;
            return;
        }

        // Apply the search box + Domestic/International filter. Contacts without an
        // explicit clientType are treated as Domestic.
        const term = (document.getElementById('contacts-search')?.value || '').trim().toLowerCase();
        const typeFilter = document.getElementById('contacts-type-filter')?.value || 'all';
        // Search/filter changes reset to page 1 — otherwise narrowing the list while
        // on a later page lands the user on an empty table.
        const filterKey = `${term}|${typeFilter}|${_isGroupingMode}|${_activeGroupName || ''}`;
        if (filterKey !== _contactsFilterKey) {
            _contactsFilterKey = filterKey;
            _contactsPage = 1;
        }

        const vendors = allVendors.filter(v => {
            const isIntl = (v.clientType === 'international');
            if (typeFilter === 'domestic' && isIntl) return false;
            if (typeFilter === 'international' && !isIntl) return false;
            
            // In grouping selection mode, hide contacts belonging to other groups
            if (_isGroupingMode) {
                if (v.group && v.group !== _activeGroupName) {
                    return false;
                }
            }

            if (term) {
                const haystack = [v.name, v.gst, v.contactPerson, v.contact, v.email]
                    .map(x => (x || '').toLowerCase()).join(' ');
                if (!haystack.includes(term)) return false;
            }
            return true;
        });

        if (vendors.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 24px; color: var(--text-secondary); background: rgba(0,0,0,0.01); border-radius: 8px; border: 1px dashed rgba(0,0,0,0.1);">
                    No contacts match your search/filter.
                </div>
            `;
            return;
        }

        if (_isGroupingMode) {
            // Contacts already in this group ride under a collapsible group header
            // rather than sitting loose among the ungrouped ones — once a contact is
            // in a group it should read as part of that group here too, not as an
            // individual wearing a pill. They stay tickable, so unticking one is
            // still how you take it back out.
            const members = vendors.filter(v => (v.group || '') === _activeGroupName);
            const candidates = vendors.filter(v => (v.group || '') !== _activeGroupName);

            // The group counts as a single entry so its members never get split
            // across pages, matching how the main contacts list pages.
            const gmEntries = (members.length ? [{ group: true }] : []).concat(candidates.map(v => ({ vendor: v })));
            const gmPage = _clampContactsPage(gmEntries.length);
            const pageEntries = gmEntries.slice((gmPage - 1) * _contactsPageSize, gmPage * _contactsPageSize);
            const showGroup = pageEntries.some(e => e.group);
            const pageCandidates = pageEntries.filter(e => e.vendor).map(e => e.vendor);
            const safeGName = _activeGroupName.replace(/\s+/g, '_');

            const kindBadge = v => v._kind === 'supplier'
                ? `<span style="display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; background:rgba(180,83,9,0.12); color:#b45309; vertical-align:middle;">Supplier</span>`
                : `<span style="display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; background:rgba(0,77,44,0.10); color:#004d2c; vertical-align:middle;">Client</span>`;

            const contactRow = (v, opts) => `
                <tr class="${opts.cls || ''}" style="${opts.style || ''}">
                    <td style="width: 40px; text-align: center;"><input type="checkbox" class="contact-group-checkbox" data-id="${v.id}" data-kind="${v._kind}" onclick="App.toggleContactSelection(this)" ${_groupSelection.has(`${v._kind}:${v.id}`) ? 'checked' : ''}></td>
                    <td style="font-weight:${opts.indent ? '500' : '600'};${opts.indent ? ' padding-left:28px;' : ''}">${opts.indent ? '↳ ' : ''}${_escapeHtml(v.name)}${kindBadge(v)}</td>
                    <td>${v.gst ? _escapeHtml(v.gst) : '—'}</td>
                    <td>${v.contactPerson ? _escapeHtml(v.contactPerson) : '—'}</td>
                    <td>${v.contact ? _escapeHtml(v.contact) : '—'}</td>
                    <td style="word-break:break-all;">${v.email ? _escapeHtml(v.email) : '—'}</td>
                </tr>
            `;

            let html = `
                <div class="recent-table">
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 40px; text-align: center;"><input type="checkbox" id="check-all-contacts" onclick="App.toggleAllContactsSelection(this)"></th>
                                <th>Company Name</th>
                                <th>GST No</th>
                                <th>Contact Person</th>
                                <th>Phone</th>
                                <th>Email</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            if (showGroup) {
                html += `
                    <tr class="group-header-row" onclick="App.toggleGroupRows('${_activeGroupName.replace(/'/g, "\\'")}', this)" style="cursor:pointer; background:rgba(0,77,44,0.03); font-weight:600; user-select:none;">
                        <td style="width: 40px; text-align: center; color:#004d2c;">
                            <span class="group-toggle-icon" style="display:inline-block; transition: transform 0.15s; transform: rotate(0deg); font-size:11px;">▶</span>
                        </td>
                        <td style="color:#004d2c;">📁 ${_escapeHtml(_activeGroupName)}</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">—</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">—</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">—</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">${members.length} already in this group</td>
                    </tr>
                `;
                members.forEach(v => {
                    html += contactRow(v, { cls: `group-sub-row-${safeGName}`, style: 'display:none; background:rgba(0,0,0,0.015);', indent: true });
                });
            }

            pageCandidates.forEach(v => { html += contactRow(v, {}); });

            html += `
                        </tbody>
                    </table>
                </div>
            ` + _contactsPaginationHTML(gmEntries.length);
            container.innerHTML = html;
        } else {
            // Group contacts for display
            const groupMap = new Map();
            const standaloneVendors = [];
            const uniqueGroups = [];

            vendors.forEach(v => {
                if (v.group) {
                    const g = v.group.trim();
                    if (!groupMap.has(g)) {
                        groupMap.set(g, []);
                        uniqueGroups.push(g);
                    }
                    groupMap.get(g).push(v);
                } else {
                    standaloneVendors.push(v);
                }
            });

            // One "entry" per top-level row: a group (with its members riding along)
            // or a standalone contact. Paging over entries keeps a group's header
            // and its sub-rows on the same page.
            const entries = uniqueGroups.map(g => ({ group: g })).concat(standaloneVendors.map(v => ({ vendor: v })));
            const cPage = _clampContactsPage(entries.length);
            const pageEntries = entries.slice((cPage - 1) * _contactsPageSize, cPage * _contactsPageSize);
            const pageGroups = pageEntries.filter(e => e.group).map(e => e.group);
            const pageStandalone = pageEntries.filter(e => e.vendor).map(e => e.vendor);

            let html = `
                <div class="recent-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Company Name</th>
                                <th>GST No</th>
                                <th>Contact Person</th>
                                <th>Phone</th>
                                <th>Email</th>
                                <th style="text-align:right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            // Render Groups
            pageGroups.forEach(gName => {
                const subClients = groupMap.get(gName);
                const safeGName = gName.replace(/\s+/g, '_');
                
                html += `
                    <tr class="group-header-row" onclick="App.toggleGroupRows('${gName.replace(/'/g, "\\'")}', this)" style="cursor:pointer; background:rgba(0,77,44,0.03); font-weight:600; user-select:none;">
                        <td style="color:#004d2c;">
                            <span class="group-toggle-icon" style="margin-right:8px; display:inline-block; transition: transform 0.15s; transform: rotate(0deg); font-size:11px;">▶</span>
                            📁 ${gName}
                        </td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">—</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">—</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">—</td>
                        <td style="color:var(--text-secondary); font-size:12px; font-weight:normal; font-style:italic;">${subClients.length} clients</td>
                        <td style="text-align:right; white-space:nowrap;">
                            <button class="btn-action-delete" onclick="event.stopPropagation(); App.deleteGroup('${gName.replace(/'/g, "\\'")}')">Delete</button>
                        </td>
                    </tr>
                `;

                subClients.forEach(sub => {
                    const isSupplier = sub._kind === 'supplier';
                    const typeBadge = isSupplier
                        ? `<span style="display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; background:rgba(180,83,9,0.12); color:#b45309; vertical-align:middle;">Supplier</span>`
                        : `<span style="display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; background:rgba(0,77,44,0.10); color:#004d2c; vertical-align:middle;">Client</span>`;
                    html += `
                        <tr class="group-sub-row-${safeGName}" style="display:none; background:rgba(0,0,0,0.015);">
                            <td style="font-weight:500; padding-left:28px;">↳ ${sub.subGroup || sub.name}${typeBadge}</td>
                            <td>${sub.gst ? _escapeHtml(sub.gst) : '—'}</td>
                            <td>${sub.contactPerson ? _escapeHtml(sub.contactPerson) : '—'}</td>
                            <td>${sub.contact ? _escapeHtml(sub.contact) : '—'}</td>
                            <td style="word-break:break-all;">${sub.email ? _escapeHtml(sub.email) : '—'}</td>
                            <td style="text-align:right; white-space:nowrap;">
                                <button class="btn-action-revise" onclick="App.editContact('${sub.id}','${sub._kind}')" style="margin-left: 0;">Edit</button>
                                <button class="btn-action-delete" onclick="App.deleteContact('${sub.id}','${sub._kind}')">Delete</button>
                            </td>
                        </tr>
                    `;
                });
            });

            // Render Standalone
            pageStandalone.forEach(v => {
                const isSupplier = v._kind === 'supplier';
                const typeBadge = isSupplier
                    ? `<span style="display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; background:rgba(180,83,9,0.12); color:#b45309; vertical-align:middle;">Supplier</span>`
                    : `<span style="display:inline-block; margin-left:8px; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; background:rgba(0,77,44,0.10); color:#004d2c; vertical-align:middle;">Client</span>`;
                html += `
                    <tr>
                        <td style="font-weight:600;">${_escapeHtml(v.name)}${typeBadge}</td>
                        <td>${v.gst ? _escapeHtml(v.gst) : '—'}</td>
                        <td>${v.contactPerson ? _escapeHtml(v.contactPerson) : '—'}</td>
                        <td>${v.contact ? _escapeHtml(v.contact) : '—'}</td>
                        <td style="word-break:break-all;">${v.email ? _escapeHtml(v.email) : '—'}</td>
                        <td style="text-align:right; white-space:nowrap;">
                            <button class="btn-action-revise" onclick="App.editContact('${v.id}','${v._kind}')" style="margin-left: 0;">Edit</button>
                            <button class="btn-action-delete" onclick="App.deleteContact('${v.id}','${v._kind}')">Delete</button>
                        </td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            ` + _contactsPaginationHTML(entries.length);
            container.innerHTML = html;
        }
    }

    // Keeps the contacts page in range when the filtered count shrinks.
    function _clampContactsPage(total) {
        const totalPages = Math.max(1, Math.ceil(total / _contactsPageSize));
        _contactsPage = Math.min(Math.max(1, _contactsPage), totalPages);
        return _contactsPage;
    }

    function _contactsPaginationHTML(total) {
        return Dashboard.renderPagination({
            page: _contactsPage, pageSize: _contactsPageSize, total, noun: 'contacts',
            onPage: 'App.setContactsPage', onSize: 'App.setContactsPageSize'
        });
    }

    function setContactsPage(p) {
        _contactsPage = Math.max(1, p);
        renderContactsCard();
    }

    function setContactsPageSize(n) {
        _contactsPageSize = n;
        _contactsPage = 1;
        renderContactsCard();
    }

    function _refreshContactDropdowns() {
        if (typeof PurchaseOrder !== 'undefined' && PurchaseOrder.updateVendorDropdown) PurchaseOrder.updateVendorDropdown();
        if (typeof Quotation !== 'undefined' && Quotation.updateClientDropdown) Quotation.updateClientDropdown();
        if (typeof Invoice !== 'undefined' && Invoice.updateClientDropdown) Invoice.updateClientDropdown();
    }

    function editContact(id, kind) {
        const isSupplier = kind === 'supplier';
        const contact = isSupplier ? Storage.getSupplier(id) : Storage.getVendor(id);
        if (!contact) {
            showToast('Contact not found', 'error');
            return;
        }

        showAddContactModal(contact, (updatedData) => {
            if (isSupplier) Storage.saveSupplier(updatedData);
            else Storage.saveVendor(updatedData);
            showToast(`${isSupplier ? 'Supplier' : 'Contact'} "${updatedData.name}" updated successfully!`, 'success');
            renderContactsCard();
            _refreshContactDropdowns();
        }, null, { hideClientType: isSupplier });
    }

    function deleteContact(id, kind) {
        const isSupplier = kind === 'supplier';
        const contact = isSupplier ? Storage.getSupplier(id) : Storage.getVendor(id);
        if (!contact) {
            showToast('Contact not found', 'error');
            return;
        }

        showConfirm(
            'Delete Contact',
            `Are you sure you want to delete ${isSupplier ? 'supplier' : 'contact'} "${contact.name}"? This action cannot be undone.`,
            () => {
                if (isSupplier) Storage.deleteSupplier(id);
                else Storage.deleteVendor(id);
                showToast(`${isSupplier ? 'Supplier' : 'Contact'} "${contact.name}" deleted successfully!`, 'success');
                renderContactsCard();
                _refreshContactDropdowns();
            }
        );
    }

    function deleteGroup(groupName) {
        showConfirm(
            'Delete Group',
            `Are you sure you want to delete the group "${groupName}" and all of its clients? This action cannot be undone.`,
            () => {
                const allVendors = Storage.getAllVendors();
                const allSuppliers = Storage.getAllSuppliers ? Storage.getAllSuppliers() : [];
                
                const vendorIdsToDelete = allVendors.filter(v => v.group === groupName).map(v => v.id);
                const supplierIdsToDelete = allSuppliers.filter(s => s.group === groupName).map(s => s.id);
                
                if (vendorIdsToDelete.length > 0) {
                    Storage.deleteVendorsBatch(vendorIdsToDelete);
                }
                if (supplierIdsToDelete.length > 0) {
                    Storage.deleteSuppliersBatch(supplierIdsToDelete);
                }
                
                showToast(`Group "${groupName}" and its clients deleted successfully!`, 'success');
                renderContactsCard();
                _refreshContactDropdowns();
            }
        );
    }

    function addNewContactFromManage() {
        showAddContactModal('client', (newData) => {
            Storage.saveVendor(newData);
            showToast(`Contact "${newData.name}" added successfully!`, 'success');
            renderContactsCard();
            _refreshContactDropdowns();
        }, null, { showTypeSelector: true });
    }

    function showAddContactModal(typeOrContact, onSave, onCancel, opts = {}) {
        const modal = document.getElementById('add-contact-modal');
        if (!modal) return;

        let type = 'client';
        let contactData = null;
        if (typeof typeOrContact === 'object' && typeOrContact !== null) {
            contactData = typeOrContact;
            type = 'client';
        } else {
            type = typeOrContact;
        }

        // Client Type selector (Domestic / International). Shown for clients only,
        // and only when the caller hasn't fixed the type (e.g. invoice mode is fixed).
        const showTypeSelector = (type === 'client') && !opts.hideClientType;
        const typeRow = document.getElementById('modal-contact-type-row');
        const typeHidden = document.getElementById('modal-contact-type');
        const initialType = (contactData && contactData.clientType) || opts.defaultClientType || 'domestic';
        if (typeRow) typeRow.style.display = showTypeSelector ? '' : 'none';
        if (typeHidden) typeHidden.value = initialType;
        const _applyContactType = (t) => {
            if (typeHidden) typeHidden.value = t;
            document.querySelectorAll('#modal-contact-type-switch .contact-type-btn').forEach(btn => {
                const active = btn.dataset.type === t;
                btn.style.background = active ? '#004d2c' : 'transparent';
                btn.style.color = active ? '#fff' : 'var(--text-secondary)';
            });
        };
        document.querySelectorAll('#modal-contact-type-switch .contact-type-btn').forEach(btn => {
            btn.onclick = () => _applyContactType(btn.dataset.type);
        });
        _applyContactType(initialType);

        const isEdit = !!contactData;
        const titleLabel = isEdit ? 'Edit Contact Details' : (type === 'consignor' ? 'Add New Consignor' : 'Add New Client');
        const saveLabel = isEdit ? 'Save Changes' : 'Save';

        document.getElementById('contact-modal-title').textContent = titleLabel;
        document.getElementById('modal-contact-btn-save').textContent = saveLabel;

        // Populate fields
        document.getElementById('modal-contact-name').value = contactData ? (contactData.name || '') : '';
        document.getElementById('modal-contact-group').value = contactData ? (contactData.group || '') : '';
        document.getElementById('modal-contact-subgroup').value = contactData ? (contactData.subGroup || '') : '';
        document.getElementById('modal-contact-gst').value = contactData ? (contactData.gst || '') : '';
        document.getElementById('modal-contact-address').value = contactData ? (contactData.address || '') : '';
        document.getElementById('modal-contact-person').value = contactData ? (contactData.contactPerson || '') : '';
        document.getElementById('modal-contact-phone').value = contactData ? (contactData.contact || '') : '';
        document.getElementById('modal-contact-email').value = contactData ? (contactData.email || '') : '';

        const form = document.getElementById('contact-modal-form');
        const cancelBtn = document.getElementById('modal-contact-btn-cancel');

        // Handle Form Submit
        form.onsubmit = (e) => {
            e.preventDefault();
            const data = {
                name: document.getElementById('modal-contact-name').value.trim(),
                group: document.getElementById('modal-contact-group').value.trim(),
                subGroup: document.getElementById('modal-contact-subgroup').value.trim(),
                gst: document.getElementById('modal-contact-gst').value.trim(),
                address: document.getElementById('modal-contact-address').value.trim(),
                contact: document.getElementById('modal-contact-phone').value.trim(),
                email: document.getElementById('modal-contact-email').value.trim(),
                contactPerson: document.getElementById('modal-contact-person').value.trim()
            };
            if (showTypeSelector) {
                data.clientType = document.getElementById('modal-contact-type').value || 'domestic';
            }
            if (isEdit && contactData.id) {
                data.id = contactData.id;
                data.savedAt = contactData.savedAt;
            }
            modal.style.display = 'none';
            if (onSave) onSave(data);
        };

        // Handle Cancel
        const closeHandler = () => {
            modal.style.display = 'none';
            if (onCancel) onCancel();
        };

        cancelBtn.onclick = closeHandler;
        // Intentionally NOT closing on backdrop click to prevent data loss

        modal.style.display = 'flex';

        // Focus first field
        setTimeout(() => {
            document.getElementById('modal-contact-name').focus();
        }, 100);
    }

    function showAddCorrBankModal(bankDataOrOnSave, onSaveOrCancel, onCancel) {
        const modal = document.getElementById('add-corr-bank-modal');
        if (!modal) return;

        let bankData = null;
        let onSave = null;
        let onCancelCallback = null;

        if (typeof bankDataOrOnSave === 'object' && bankDataOrOnSave !== null) {
            bankData = bankDataOrOnSave;
            onSave = onSaveOrCancel;
            onCancelCallback = onCancel;
        } else {
            onSave = bankDataOrOnSave;
            onCancelCallback = onSaveOrCancel;
        }

        const isEdit = !!bankData;
        const titleEl = document.getElementById('corr-bank-modal-title');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit Correspondent Bank' : 'Add Correspondent Bank';
        const saveBtn = document.getElementById('modal-corr-bank-btn-save');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Save Changes' : 'Save';

        // Populate fields
        document.getElementById('modal-corr-bank-name').value = bankData ? (bankData.name || '') : '';
        document.getElementById('modal-corr-bank-address').value = bankData ? (bankData.address || '') : '';
        document.getElementById('modal-corr-bank-swift').value = bankData ? (bankData.swiftCode || '') : '';
        document.getElementById('modal-corr-bank-account').value = bankData ? (bankData.accountNumber || '') : '';

        const form = document.getElementById('corr-bank-modal-form');
        const cancelBtn = document.getElementById('modal-corr-bank-btn-cancel');
        const deleteBtn = document.getElementById('modal-corr-bank-btn-delete');

        if (isEdit && deleteBtn) {
            deleteBtn.style.display = 'block';
            deleteBtn.onclick = () => {
                showConfirm(
                    'Delete Correspondent Bank',
                    `Are you sure you want to delete "${bankData.name}"? This action cannot be undone.`,
                    () => {
                        Storage.deleteCorrBank(bankData.id);
                        modal.style.display = 'none';
                        App.showToast(`Bank "${bankData.name}" deleted!`, 'success');
                        
                        const invSel = document.getElementById('inv-corr-bank-select');
                        if (invSel && invSel.value === bankData.id) {
                            invSel.value = '';
                            invSel.dispatchEvent(new Event('change'));
                        }
                        const tmSel = document.getElementById('tm-corr-bank');
                        if (tmSel && tmSel.value === bankData.id) {
                            tmSel.value = '';
                            tmSel.dispatchEvent(new Event('change'));
                        }
                        
                        if (typeof Invoice !== 'undefined' && Invoice.updateCorrBankDropdown) {
                            Invoice.updateCorrBankDropdown();
                        }
                        if (typeof PoReceived !== 'undefined' && PoReceived.updateCorrBankDropdown) {
                            PoReceived.updateCorrBankDropdown();
                        }
                    }
                );
            };
        } else if (deleteBtn) {
            deleteBtn.style.display = 'none';
            deleteBtn.onclick = null;
        }

        // Handle Form Submit
        form.onsubmit = (e) => {
            e.preventDefault();
            const name = document.getElementById('modal-corr-bank-name').value.trim();
            if (!name) {
                App.showToast('Please enter bank name', 'error');
                return;
            }
            const data = {
                name: name,
                address: document.getElementById('modal-corr-bank-address').value.trim(),
                swiftCode: document.getElementById('modal-corr-bank-swift').value.trim(),
                accountNumber: document.getElementById('modal-corr-bank-account').value.trim()
            };
            if (isEdit && bankData.id) {
                data.id = bankData.id;
            }
            modal.style.display = 'none';
            if (onSave) onSave(data);
        };

        // Handle Cancel
        const closeHandler = () => {
            modal.style.display = 'none';
            if (onCancelCallback) onCancelCallback();
        };

        cancelBtn.onclick = closeHandler;
        // Intentionally NOT closing on backdrop click to prevent data loss

        modal.style.display = 'flex';

        // Focus first field
        setTimeout(() => {
            document.getElementById('modal-corr-bank-name').focus();
        }, 100);
    }

    function showAddBenefBankModal(bankDataOrOnSave, onSaveOrCancel, onCancel) {
        const modal = document.getElementById('add-benef-bank-modal');
        if (!modal) return;

        let bankData = null;
        let onSave = null;
        let onCancelCallback = null;

        if (typeof bankDataOrOnSave === 'object' && bankDataOrOnSave !== null) {
            bankData = bankDataOrOnSave;
            onSave = onSaveOrCancel;
            onCancelCallback = onCancel;
        } else {
            onSave = bankDataOrOnSave;
            onCancelCallback = onSaveOrCancel;
        }

        const isEdit = !!bankData;
        const titleEl = document.getElementById('benef-bank-modal-title');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit Beneficiary Bank' : 'Add Beneficiary Bank';
        const saveBtn = document.getElementById('modal-benef-bank-btn-save');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Save Changes' : 'Save';

        // Populate fields
        document.getElementById('modal-benef-bank-name').value = bankData ? (bankData.name || '') : '';
        document.getElementById('modal-benef-bank-address').value = bankData ? (bankData.address || '') : '';
        document.getElementById('modal-benef-bank-swift').value = bankData ? (bankData.swiftCode || '') : '';
        document.getElementById('modal-benef-bank-account').value = bankData ? (bankData.accountNumber || '') : '';

        const form = document.getElementById('benef-bank-modal-form');
        const cancelBtn = document.getElementById('modal-benef-bank-btn-cancel');
        const deleteBtn = document.getElementById('modal-benef-bank-btn-delete');

        if (isEdit && deleteBtn) {
            deleteBtn.style.display = 'block';
            deleteBtn.onclick = () => {
                showConfirm(
                    'Delete Beneficiary Bank',
                    `Are you sure you want to delete "${bankData.name}"? This action cannot be undone.`,
                    () => {
                        Storage.deleteBenefBank(bankData.id);
                        modal.style.display = 'none';
                        App.showToast(`Bank "${bankData.name}" deleted!`, 'success');
                        
                        const invSel = document.getElementById('inv-benef-bank-select');
                        if (invSel && invSel.value === bankData.id) {
                            invSel.value = '';
                            invSel.dispatchEvent(new Event('change'));
                        }
                        const tmSel = document.getElementById('tm-benef-bank');
                        if (tmSel && tmSel.value === bankData.id) {
                            tmSel.value = '';
                            tmSel.dispatchEvent(new Event('change'));
                        }
                        
                        if (typeof Invoice !== 'undefined' && Invoice.updateBenefBankDropdown) {
                            Invoice.updateBenefBankDropdown();
                        }
                        if (typeof PoReceived !== 'undefined' && PoReceived.updateBenefBankDropdown) {
                            PoReceived.updateBenefBankDropdown();
                        }
                    }
                );
            };
        } else if (deleteBtn) {
            deleteBtn.style.display = 'none';
            deleteBtn.onclick = null;
        }

        // Handle Form Submit
        form.onsubmit = (e) => {
            e.preventDefault();
            const name = document.getElementById('modal-benef-bank-name').value.trim();
            if (!name) {
                App.showToast('Please enter bank name', 'error');
                return;
            }
            const data = {
                name: name,
                address: document.getElementById('modal-benef-bank-address').value.trim(),
                swiftCode: document.getElementById('modal-benef-bank-swift').value.trim(),
                accountNumber: document.getElementById('modal-benef-bank-account').value.trim()
            };
            if (isEdit && bankData.id) {
                data.id = bankData.id;
            }
            modal.style.display = 'none';
            if (onSave) onSave(data);
        };

        // Handle Cancel
        const closeHandler = () => {
            modal.style.display = 'none';
            if (onCancelCallback) onCancelCallback();
        };

        cancelBtn.onclick = closeHandler;
        // Intentionally NOT closing on backdrop click to prevent data loss

        modal.style.display = 'flex';

        // Focus first field
        setTimeout(() => {
            document.getElementById('modal-benef-bank-name').focus();
        }, 100);
    }

    function showAddDomesticBankModal(bankDataOrOnSave, onSaveOrCancel, onCancel) {
        const modal = document.getElementById('add-domestic-bank-modal');
        if (!modal) return;

        let bankData = null;
        let onSave = null;
        let onCancelCallback = null;

        if (typeof bankDataOrOnSave === 'object' && bankDataOrOnSave !== null) {
            bankData = bankDataOrOnSave;
            onSave = onSaveOrCancel;
            onCancelCallback = onCancel;
        } else {
            onSave = bankDataOrOnSave;
            onCancelCallback = onSaveOrCancel;
        }

        const isEdit = !!bankData;
        const titleEl = document.getElementById('domestic-bank-modal-title');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit Bank' : 'Add Bank';
        const saveBtn = document.getElementById('modal-domestic-bank-btn-save');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Save Changes' : 'Save';

        document.getElementById('modal-domestic-bank-org-name').value = bankData ? (bankData.orgName || '') : '';
        document.getElementById('modal-domestic-bank-name').value = bankData ? (bankData.name || '') : '';
        document.getElementById('modal-domestic-bank-ifsc').value = bankData ? (bankData.ifscCode || '') : '';
        document.getElementById('modal-domestic-bank-account').value = bankData ? (bankData.accountNumber || '') : '';
        document.getElementById('modal-domestic-bank-branch').value = bankData ? (bankData.branch || '') : '';

        const form = document.getElementById('domestic-bank-modal-form');
        const cancelBtn = document.getElementById('modal-domestic-bank-btn-cancel');
        const deleteBtn = document.getElementById('modal-domestic-bank-btn-delete');

        if (isEdit && deleteBtn) {
            deleteBtn.style.display = 'block';
            deleteBtn.onclick = () => {
                showConfirm(
                    'Delete Bank',
                    `Are you sure you want to delete "${bankData.name}"? This action cannot be undone.`,
                    () => {
                        Storage.deleteDomesticBank(bankData.id);
                        modal.style.display = 'none';
                        App.showToast(`Bank "${bankData.name}" deleted!`, 'success');
                        const invSel = document.getElementById('inv-domestic-bank-select');
                        if (invSel && invSel.value === bankData.id) {
                            invSel.value = '';
                            invSel.dispatchEvent(new Event('change'));
                        }
                        if (typeof Invoice !== 'undefined' && Invoice.updateDomesticBankDropdown) {
                            Invoice.updateDomesticBankDropdown();
                        }
                    }
                );
            };
        } else if (deleteBtn) {
            deleteBtn.style.display = 'none';
            deleteBtn.onclick = null;
        }

        form.onsubmit = (e) => {
            e.preventDefault();
            const name = document.getElementById('modal-domestic-bank-name').value.trim();
            if (!name) {
                App.showToast('Please enter bank name', 'error');
                return;
            }
            const data = {
                orgName: document.getElementById('modal-domestic-bank-org-name').value.trim(),
                name: name,
                ifscCode: document.getElementById('modal-domestic-bank-ifsc').value.trim().toUpperCase(),
                accountNumber: document.getElementById('modal-domestic-bank-account').value.trim(),
                branch: document.getElementById('modal-domestic-bank-branch').value.trim()
            };
            if (isEdit && bankData.id) {
                data.id = bankData.id;
            }
            modal.style.display = 'none';
            if (onSave) onSave(data);
        };

        const closeHandler = () => {
            modal.style.display = 'none';
            if (onCancelCallback) onCancelCallback();
        };
        cancelBtn.onclick = closeHandler;
        modal.style.display = 'flex';
        setTimeout(() => {
            document.getElementById('modal-domestic-bank-org-name').focus();
        }, 100);
    }

    function showAddUltBenefModal(ultBenefDataOrOnSave, onSaveOrCancel, onCancel) {
        const modal = document.getElementById('add-ult-benef-modal');
        if (!modal) return;

        let ultBenefData = null;
        let onSave = null;
        let onCancelCallback = null;

        if (typeof ultBenefDataOrOnSave === 'object' && ultBenefDataOrOnSave !== null) {
            ultBenefData = ultBenefDataOrOnSave;
            onSave = onSaveOrCancel;
            onCancelCallback = onCancel;
        } else {
            onSave = ultBenefDataOrOnSave;
            onCancelCallback = onSaveOrCancel;
        }

        const isEdit = !!ultBenefData;
        const titleEl = document.getElementById('ult-benef-modal-title');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit Ultimate Beneficiary' : 'Add Ultimate Beneficiary';
        const saveBtn = document.getElementById('modal-ult-benef-btn-save');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Save Changes' : 'Save';

        // Populate fields
        document.getElementById('modal-ult-benef-org-name').value = ultBenefData ? (ultBenefData.orgName || '') : '';
        document.getElementById('modal-ult-benef-bank-name').value = ultBenefData ? (ultBenefData.bankName || '') : '';
        document.getElementById('modal-ult-benef-bank-address').value = ultBenefData ? (ultBenefData.bankAddress || '') : '';
        document.getElementById('modal-ult-benef-bank-swift').value = ultBenefData ? (ultBenefData.swiftCode || '') : '';
        document.getElementById('modal-ult-benef-bank-account').value = ultBenefData ? (ultBenefData.accountNumber || '') : '';

        const form = document.getElementById('ult-benef-modal-form');
        const cancelBtn = document.getElementById('modal-ult-benef-btn-cancel');
        const deleteBtn = document.getElementById('modal-ult-benef-btn-delete');

        if (isEdit && deleteBtn) {
            deleteBtn.style.display = 'block';
            deleteBtn.onclick = () => {
                showConfirm(
                    'Delete Ultimate Beneficiary',
                    `Are you sure you want to delete "${ultBenefData.orgName}"? This action cannot be undone.`,
                    () => {
                        Storage.deleteUltBenef(ultBenefData.id);
                        modal.style.display = 'none';
                        App.showToast(`Ultimate Beneficiary "${ultBenefData.orgName}" deleted!`, 'success');
                        
                        const invSel = document.getElementById('inv-ult-benef-select');
                        if (invSel && invSel.value === ultBenefData.id) {
                            invSel.value = '';
                            invSel.dispatchEvent(new Event('change'));
                        }
                        const tmSel = document.getElementById('tm-ult-benef');
                        if (tmSel && tmSel.value === ultBenefData.id) {
                            tmSel.value = '';
                            tmSel.dispatchEvent(new Event('change'));
                        }
                        
                        if (typeof Invoice !== 'undefined' && Invoice.updateUltBenefDropdown) {
                            Invoice.updateUltBenefDropdown();
                        }
                        if (typeof PoReceived !== 'undefined' && PoReceived.updateUltBenefDropdown) {
                            PoReceived.updateUltBenefDropdown();
                        }
                    }
                );
            };
        } else if (deleteBtn) {
            deleteBtn.style.display = 'none';
            deleteBtn.onclick = null;
        }

        // Handle Form Submit
        form.onsubmit = (e) => {
            e.preventDefault();
            const orgName = document.getElementById('modal-ult-benef-org-name').value.trim();
            if (!orgName) {
                App.showToast('Please enter org name', 'error');
                return;
            }
            const bankName = document.getElementById('modal-ult-benef-bank-name').value.trim();
            if (!bankName) {
                App.showToast('Please enter bank name', 'error');
                return;
            }
            const data = {
                orgName: orgName,
                bankName: bankName,
                bankAddress: document.getElementById('modal-ult-benef-bank-address').value.trim(),
                swiftCode: document.getElementById('modal-ult-benef-bank-swift').value.trim(),
                accountNumber: document.getElementById('modal-ult-benef-bank-account').value.trim()
            };
            if (isEdit && ultBenefData.id) {
                data.id = ultBenefData.id;
            }
            modal.style.display = 'none';
            if (onSave) onSave(data);
        };

        // Handle Cancel
        const closeHandler = () => {
            modal.style.display = 'none';
            if (onCancelCallback) onCancelCallback();
        };

        cancelBtn.onclick = closeHandler;
        // Intentionally NOT closing on backdrop click to prevent data loss

        modal.style.display = 'flex';

        // Focus first field
        setTimeout(() => {
            document.getElementById('modal-ult-benef-org-name').focus();
        }, 100);
    }

    // ─────────────────────────────────────────────
    // User Management (Admin approval panel)
    // ─────────────────────────────────────────────
    let _umgmtCurrentTab = 'pending';

    function _updatePendingBadge() {
        const count = Auth.getPendingUsers().length;
        // Sidebar badge
        const badge = document.getElementById('pending-badge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        // Settings card badge
        const chip = document.getElementById('settings-pending-count');
        if (chip) {
            chip.textContent = count + ' pending';
            chip.style.display = count > 0 ? 'inline-block' : 'none';
        }
        // Admin Panel tab badge
        const adminTabChip = document.getElementById('admin-pending-chip');
        if (adminTabChip) {
            adminTabChip.textContent = count;
            adminTabChip.style.display = count > 0 ? 'inline-block' : 'none';
        }
        // Admin Panel page heading badge
        const adminPageChip = document.getElementById('admin-panel-pending-count');
        if (adminPageChip) {
            adminPageChip.textContent = count;
            adminPageChip.style.display = count > 0 ? 'inline-block' : 'none';
        }
    }

    function showUserManagementModal() {
        const modal = document.getElementById('user-mgmt-modal');
        modal.style.display = 'flex';
        _umgmtCurrentTab = 'pending';
        _renderUmgmtTab('pending');
    }

    function closeUserManagementModal() {
        document.getElementById('user-mgmt-modal').style.display = 'none';
    }

    function switchUserMgmtTab(tab) {
        _umgmtCurrentTab = tab;
        _renderUmgmtTab(tab);

        const tabPending  = document.getElementById('umgmt-tab-pending');
        const tabApproved = document.getElementById('umgmt-tab-approved');
        const isPending   = tab === 'pending';

        tabPending.style.borderBottomColor  = isPending  ? '#000' : 'transparent';
        tabPending.style.color              = isPending  ? '#000' : '#71717a';
        tabApproved.style.borderBottomColor = !isPending ? '#000' : 'transparent';
        tabApproved.style.color             = !isPending ? '#000' : '#71717a';

        document.getElementById('umgmt-pending-list').style.display  = isPending  ? 'block' : 'none';
        document.getElementById('umgmt-approved-list').style.display = !isPending ? 'block' : 'none';
    }

    function _renderUmgmtTab(tab) {
        if (tab === 'pending') {
            _renderPendingList();
        } else {
            _renderApprovedList();
        }
    }

    function _emptyState(icon, msg) {
        return `<div style="text-align:center; padding:40px 20px; color:#71717a;">
            <p style="font-size:13.5px; font-weight:500;">${msg}</p>
        </div>`;
    }

    function _renderPendingList() {
        const list = document.getElementById('umgmt-pending-list');
        const pending = Auth.getPendingUsers();

        // Update chip
        const chip = document.getElementById('umgmt-pending-chip');
        if (chip) chip.textContent = pending.length;

        if (pending.length === 0) {
            list.innerHTML = _emptyState('✅', 'No pending registration requests.');
            return;
        }

        const itemsHtml = pending.map(u => {
            const date = u.requestedAt ? new Date(u.requestedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '';
            const initial = (u.fullName || u.username || 'U').charAt(0).toUpperCase();
            return `
                <div class="premium-table-row">
                    <div style="display:flex; align-items:center; gap:14px; flex:1; min-width:0;">
                        <div class="premium-user-avatar">${initial}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:2px;">${_esc(u.fullName || u.username)}</div>
                            <div style="font-size:12px; color:var(--text-secondary); display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                                <span>@${_esc(u.username)}</span>
                                ${u.email ? `<span>· ${_esc(u.email)}</span>` : ''}
                                ${u.department ? `<span>· ${_esc(u.department)}</span>` : ''}
                                ${date ? `<span>· Requested ${date}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; flex-shrink:0;">
                        <button onclick="App.approveUser('${_esc(u.id)}')"
                            style="padding:7px 16px; font-size:12.5px; font-weight:600; background:#004d2c; color:#fff; border:none; border-radius:7px; cursor:pointer;">
                            Approve
                        </button>
                        <button onclick="App.rejectUser('${_esc(u.id)}')"
                            style="padding:7px 14px; font-size:12.5px; font-weight:600; background:transparent; border:1px solid rgba(239,68,68,0.4); color:#ef4444; border-radius:7px; cursor:pointer;">
                            Reject
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        list.innerHTML = `<div class="premium-table-container">${itemsHtml}</div>`;
    }

    function _renderApprovedList() {
        const list = document.getElementById('umgmt-approved-list');
        const users = Auth.getApprovedUsers();

        if (users.length === 0) {
            list.innerHTML = _emptyState('👤', 'No approved users yet.');
            return;
        }

        const itemsHtml = users.map(u => {
            const initial = (u.fullName || u.username || 'U').charAt(0).toUpperCase();
            return `
                <div class="premium-table-row">
                    <div style="display:flex; align-items:center; gap:14px; flex:1; min-width:0;">
                        <div class="premium-user-avatar">${initial}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:2px; display:flex; align-items:center;">
                                ${_esc(u.fullName || u.username)}
                                <span style="background:rgba(0,77,44,0.08); color:#004d2c; font-size:10px; font-weight:700; border-radius:6px; padding:2px 7px; margin-left:8px;">Active</span>
                            </div>
                            <div style="font-size:12px; color:var(--text-secondary); display:flex; flex-wrap:wrap; gap:8px;">
                                <span>@${_esc(u.username)}</span>
                                ${u.email ? `<span>· ${_esc(u.email)}</span>` : ''}
                                ${u.department ? `<span>· ${_esc(u.department)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <button onclick="App.removeUser('${_esc(u.id)}')"
                        style="padding:7px 14px; font-size:12.5px; font-weight:600; background:transparent; border:1px solid rgba(239,68,68,0.35); color:#ef4444; border-radius:7px; cursor:pointer; flex-shrink:0;">
                        Remove
                    </button>
                </div>
            `;
        }).join('');
        list.innerHTML = `<div class="premium-table-container">${itemsHtml}</div>`;
    }

    function approveUser(id) {
        // Find user details before approval for logging
        const pendingList = Auth.getPendingUsers();
        const user = pendingList.find(u => u.id === id);
        const name = user ? (user.fullName || user.username) : id;

        Auth.approveUser(id);
        _updatePendingBadge();
        if (document.getElementById('umgmt-pending-list')) _renderPendingList();
        if (document.getElementById('admin-pending-list')) _renderAdminPendingList();
        if (document.getElementById('admin-approved-list')) _renderAdminApprovedList();

        Storage.logActivity('user_action', `Approved registration request for user: ${name}`);
        showToast('User approved successfully!', 'success');
    }

    function rejectUser(id) {
        // Look the name up by id (system-generated, safe) rather than trusting a
        // value passed through an inline handler — user-controlled text in an
        // onclick attribute is a stored-XSS vector even when HTML-escaped.
        const user = Auth.getPendingUsers().find(u => u.id === id);
        const name = user ? (user.fullName || user.username) : id;
        showConfirm(
            'Reject Registration',
            `Are you sure you want to reject the registration request from "${name}"? This cannot be undone.`,
            () => {
                Auth.rejectUser(id);
                _updatePendingBadge();
                if (document.getElementById('umgmt-pending-list')) _renderPendingList();
                if (document.getElementById('admin-pending-list')) _renderAdminPendingList();

                Storage.logActivity('user_action', `Rejected registration request for user: ${name}`);
                showToast(`Registration for "${name}" rejected.`, 'info');
            }
        );
    }

    function removeUser(id) {
        const user = Auth.getApprovedUsers().find(u => u.id === id);
        const name = user ? (user.fullName || user.username) : id;
        showConfirm(
            'Remove User',
            `Are you sure you want to remove "${name}"? They will no longer be able to sign in.`,
            () => {
                Auth.removeUser(id);
                if (document.getElementById('umgmt-approved-list')) _renderApprovedList();
                if (document.getElementById('admin-approved-list')) _renderAdminApprovedList();

                Storage.logActivity('user_action', `Removed user account: ${name}`);
                showToast(`User "${name}" removed.`, 'info');
            }
        );
    }

    // ─────────────────────────────────────────────
    // Admin Panel
    // ─────────────────────────────────────────────
    function _loadAdminPanel() {
        if (!Auth.isAdmin()) {
            showToast('Access Denied: Admin role required.', 'error');
            navigateTo('dashboard');
            return;
        }

        _updatePendingBadge();

        const activeTabBtn = document.querySelector('.admin-tab.active');
        const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : 'user-management';

        if (activeTab === 'user-management') {
            _renderAdminPendingList();
            _renderAdminApprovedList();
        } else {
            _renderAdminActivityLog();
        }
    }

    function _renderAdminPendingList() {
        const listContainer = document.getElementById('admin-pending-list');
        if (!listContainer) return;

        const pending = Auth.getPendingUsers();
        if (pending.length === 0) {
            listContainer.innerHTML = _emptyState('✅', 'No pending registration requests.');
            return;
        }

        const itemsHtml = pending.map(u => {
            const date = u.requestedAt ? new Date(u.requestedAt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
            const initial = (u.fullName || u.username || 'U').charAt(0).toUpperCase();
            return `
                <div class="premium-table-row">
                    <div style="display:flex; align-items:center; gap:14px; flex:1; min-width:0;">
                        <div class="premium-user-avatar">${initial}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:2px;">${_esc(u.fullName || u.username)}</div>
                            <div style="font-size:12px; color:var(--text-secondary); display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                                <span>@${_esc(u.username)}</span>
                                ${u.email ? `<span>· ${_esc(u.email)}</span>` : ''}
                                ${u.department ? `<span>· ${_esc(u.department)}</span>` : ''}
                                ${date ? `<span>· Requested ${date}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; flex-shrink:0;">
                        <button onclick="App.approveUser('${u.id}')"
                            style="padding:7px 16px; font-size:12.5px; font-weight:600; background:#004d2c; color:#fff; border:none; border-radius:7px; cursor:pointer;">
                            Approve
                        </button>
                        <button onclick="App.rejectUser('${_esc(u.id)}')"
                            style="padding:7px 14px; font-size:12.5px; font-weight:600; background:transparent; border:1px solid rgba(239,68,68,0.4); color:#ef4444; border-radius:7px; cursor:pointer;">
                            Reject
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        listContainer.innerHTML = `<div class="premium-table-container">${itemsHtml}</div>`;
    }

    function _renderAdminApprovedList() {
        const listContainer = document.getElementById('admin-approved-list');
        if (!listContainer) return;

        const users = Auth.getApprovedUsers();
        if (users.length === 0) {
            listContainer.innerHTML = _emptyState('👤', 'No approved users yet.');
            return;
        }

        const itemsHtml = users.map(u => {
            const initial = (u.fullName || u.username || 'U').charAt(0).toUpperCase();
            return `
                <div class="premium-table-row" style="cursor:pointer;" onclick="App.showUserActivityLog('${_esc(u.username)}', '${_esc(u.fullName || u.username)}')">
                    <div style="display:flex; align-items:center; gap:14px; flex:1; min-width:0;">
                        <div class="premium-user-avatar">${initial}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:2px; display:flex; align-items:center;">
                                ${_esc(u.fullName || u.username)}
                                <span style="background:rgba(0,77,44,0.08); color:#004d2c; font-size:10px; font-weight:700; border-radius:6px; padding:2px 7px; margin-left:8px;">Active</span>
                            </div>
                            <div style="font-size:12px; color:var(--text-secondary); display:flex; flex-wrap:wrap; gap:8px;">
                                <span>@${_esc(u.username)}</span>
                                ${u.email ? `<span>· ${_esc(u.email)}</span>` : ''}
                                ${u.department ? `<span>· ${_esc(u.department)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); App.removeUser('${_esc(u.id)}')"
                        style="padding:7px 14px; font-size:12.5px; font-weight:600; background:transparent; border:1px solid rgba(239,68,68,0.35); color:#ef4444; border-radius:7px; cursor:pointer; flex-shrink:0;">
                        Remove
                    </button>
                </div>
            `;
        }).join('');
        listContainer.innerHTML = `<div class="premium-table-container">${itemsHtml}</div>`;
    }

    function _renderAdminActivityLog(filterType = 'all') {
        const listContainer = document.getElementById('activity-log-list');
        if (!listContainer) return;

        // Sync custom select UI state with active filter type
        const filterInput = document.getElementById('activity-filter');
        if (filterInput) {
            filterInput.value = filterType;
            const wrapper = filterInput.closest('.custom-select-wrapper');
            if (wrapper) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                const matchedOption = wrapper.querySelector(`.custom-option[data-value="${filterType}"]`);
                if (triggerSpan && matchedOption) {
                    triggerSpan.textContent = matchedOption.textContent.trim();
                }
                wrapper.querySelectorAll('.custom-option').forEach(opt => {
                    if (opt.dataset.value === filterType) {
                        opt.classList.add('selected');
                    } else {
                        opt.classList.remove('selected');
                    }
                });
            }
        }

        let logs = Storage.getActivityLog();
        if (filterType !== 'all') {
            logs = logs.filter(l => l.action === filterType);
        }

        if (logs.length === 0) {
            listContainer.innerHTML = _emptyState('📋', 'No activity records found.');
            return;
        }

        const itemsHtml = logs.map(l => {
            const date = l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
            let badgeBg = 'rgba(107, 114, 128, 0.08)';
            let badgeColor = '#4b5563';
            let label = l.action;

            if (l.action === 'login') {
                badgeBg = 'rgba(59, 130, 246, 0.08)';
                badgeColor = '#2563eb';
                label = 'Login';
            } else if (l.action === 'file_generated') {
                badgeBg = 'rgba(16, 185, 129, 0.08)';
                badgeColor = '#059669';
                label = 'Generated';
            } else if (l.action === 'file_edited') {
                badgeBg = 'rgba(245, 158, 11, 0.08)';
                badgeColor = '#d97706';
                label = 'Edited';
            } else if (l.action === 'file_deleted') {
                badgeBg = 'rgba(239, 68, 68, 0.08)';
                badgeColor = '#dc2626';
                label = 'Deleted';
            } else if (l.action === 'settings_changed') {
                badgeBg = 'rgba(139, 92, 246, 0.08)';
                badgeColor = '#7c3aed';
                label = 'Settings';
            } else if (l.action === 'user_action') {
                badgeBg = 'rgba(14, 116, 144, 0.08)';
                badgeColor = '#0891b2';
                label = 'User Action';
            }

            return `
                <div class="audit-row">
                    <div class="audit-time">${date}</div>
                    <div class="audit-desc">
                        <span style="font-weight:600; color:var(--text-primary); margin-right:4px;">@${_esc(l.username)}</span>
                        <span style="color:var(--text-secondary); font-size:12px; margin-right:8px;">(${l.role})</span>
                        <span>${_esc(l.details)}</span>
                    </div>
                    <div>
                        <span class="audit-badge" style="background:${badgeBg}; color:${badgeColor};">${label}</span>
                    </div>
                </div>
            `;
        }).join('');
        listContainer.innerHTML = `<div class="audit-timeline">${itemsHtml}</div>`;
    }

    function showUserActivityLog(username, fullName) {
        const modal = document.getElementById('user-activity-log-modal');
        if (!modal) return;

        const titleEl = document.getElementById('user-activity-modal-title');
        if (titleEl) titleEl.textContent = `Activity Log: @${username}`;

        const subtitleEl = document.getElementById('user-activity-modal-subtitle');
        if (subtitleEl) subtitleEl.textContent = `Detailed history of actions performed by ${fullName || username}.`;

        const listContainer = document.getElementById('user-activity-modal-list');
        if (!listContainer) return;

        // Fetch logs for this specific user
        const allLogs = Storage.getActivityLog() || [];
        const userLogs = allLogs.filter(l => l.username === username);

        if (userLogs.length === 0) {
            listContainer.innerHTML = _emptyState('📋', 'No activity records found for this user.');
        } else {
            const itemsHtml = userLogs.map(l => {
                const date = l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
                let badgeBg = 'rgba(107, 114, 128, 0.08)';
                let badgeColor = '#4b5563';
                let label = l.action;

                if (l.action === 'login') {
                    badgeBg = 'rgba(59, 130, 246, 0.08)';
                    badgeColor = '#2563eb';
                    label = 'Login';
                } else if (l.action === 'file_generated') {
                    badgeBg = 'rgba(16, 185, 129, 0.08)';
                    badgeColor = '#059669';
                    label = 'Generated';
                } else if (l.action === 'file_edited') {
                    badgeBg = 'rgba(245, 158, 11, 0.08)';
                    badgeColor = '#d97706';
                    label = 'Edited';
                } else if (l.action === 'file_deleted') {
                    badgeBg = 'rgba(239, 68, 68, 0.08)';
                    badgeColor = '#dc2626';
                    label = 'Deleted';
                } else if (l.action === 'settings_changed') {
                    badgeBg = 'rgba(139, 92, 246, 0.08)';
                    badgeColor = '#7c3aed';
                    label = 'Settings';
                } else if (l.action === 'user_action') {
                    badgeBg = 'rgba(14, 116, 144, 0.08)';
                    badgeColor = '#0891b2';
                    label = 'User Action';
                }

                return `
                    <div class="audit-row">
                        <div class="audit-time">${date}</div>
                        <div class="audit-desc">${_esc(l.details)}</div>
                        <div>
                            <span class="audit-badge" style="background:${badgeBg}; color:${badgeColor};">${label}</span>
                        </div>
                    </div>
                `;
            }).join('');
            listContainer.innerHTML = `<div class="audit-timeline">${itemsHtml}</div>`;
        }

        modal.style.display = 'flex';
    }

    function closeUserActivityLogModal() {
        const modal = document.getElementById('user-activity-log-modal');
        if (modal) modal.style.display = 'none';
    }

    function switchAdminTab(tab) {
        const isUserMgmt = tab === 'user-management';
        const tabs = document.querySelectorAll('.admin-tab');
        tabs.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        const userMgmtPanel = document.getElementById('admin-tab-user-management');
        const activityLogPanel = document.getElementById('admin-tab-activity-log');

        if (userMgmtPanel) userMgmtPanel.style.display = isUserMgmt ? 'block' : 'none';
        if (activityLogPanel) activityLogPanel.style.display = !isUserMgmt ? 'block' : 'none';

        if (isUserMgmt) {
            _renderAdminPendingList();
            _renderAdminApprovedList();
        } else {
            _renderAdminActivityLog();
        }
    }

    function filterActivityLog() {
        const filterVal = document.getElementById('activity-filter').value;
        _renderAdminActivityLog(filterVal);
    }

    function clearActivityLog() {
        showConfirm(
            'Clear Activity Log?',
            'Are you sure you want to delete all activity log records? This cannot be undone.',
            () => {
                Storage.clearActivityLog();
                _renderAdminActivityLog();
                showToast('Activity log has been cleared.', 'info');
            }
        );
    }

    function _esc(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // --- Toast notification ---
    function showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        if (type === 'welcome') {
            toast.innerHTML = message;
        } else {
            const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
            toast.innerHTML = `<span>${icon}</span> ${message}`;
        }
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // --- Loading overlay ---
    // Pause/resume the Lottie loader so it doesn't burn CPU with a perpetual
    // animation loop while the overlay is hidden.
    function _playLoader() {
        const lp = document.getElementById('loading-lottie');
        if (lp && typeof lp.play === 'function') {
            try { lp.play(); } catch (e) { /* player not ready */ }
        }
    }

    function _stopLoader() {
        const lp = document.getElementById('loading-lottie');
        if (lp && typeof lp.stop === 'function') {
            try { lp.stop(); } catch (e) { /* player not ready */ }
        }
    }

    function showLoading(msg = 'Processing...') {
        const overlay = document.getElementById('loading-overlay');
        overlay.querySelector('p').textContent = msg;
        overlay.classList.add('show');
        _playLoader();
    }

    function hideLoading() {
        document.getElementById('loading-overlay').classList.remove('show');
        _stopLoader();
    }

    // --- Navigation loading (brief Lottie flash between pages) ---
    let _navLoadingTimer;
    let _navToken = 0;
    function _showNavLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        clearTimeout(_navLoadingTimer);
        const p = overlay.querySelector('p');
        if (p) p.textContent = 'Loading...';
        overlay.classList.add('show');
        _playLoader();
    }


    function handleImportBackup(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                const data = JSON.parse(evt.target.result);
                if (data.purchaseOrders && data.quotations && data.vendors && data.settings) {
                    const missingKeys = [];
                    if (!data.invoices) missingKeys.push('Invoices');
                    if (!data.poReceived) missingKeys.push('PO Received Documents');

                    const proceedImport = () => {
                        Storage.importAllData(data);
                        showToast('Backup restored successfully!', 'success');
                        navigateTo('settings');
                    };

                    if (missingKeys.length > 0) {
                        showConfirm(
                            'Warning: Missing Data in Backup',
                            `This backup file is missing: ${missingKeys.join(' and ')}. Importing this backup will overwrite your current ${missingKeys.join(' and ')} list with empty data. Do you want to proceed?`,
                            proceedImport
                        );
                    } else {
                        proceedImport();
                    }
                } else {
                    showToast('Invalid backup file format', 'error');
                }
            } catch (err) {
                showToast('Failed to parse backup file: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    function toggleGstFromForm(checked, formType) {
        // Mutate the live settings cache synchronously so recalcTax sees the new
        // value immediately. Persisting (server/localStorage + activity log) is
        // deferred below so it never blocks the toggle animation or the GST rows.
        const settings = Storage.getSettings();
        settings.gstEnabled = checked;

        // --- Instant UI feedback (synchronous) ---
        const poGst = document.getElementById('po-gst-toggle');
        const quGst = document.getElementById('qu-gst-toggle');
        const invGst = document.getElementById('inv-gst-toggle');

        if (poGst) poGst.checked = checked;
        if (quGst) quGst.checked = checked;
        if (invGst) invGst.checked = checked;

        // Recalculate tax on active forms — this reveals the GST rows instantly
        if (typeof PurchaseOrder !== 'undefined' && PurchaseOrder.recalcTax) {
            PurchaseOrder.recalcTax();
        }
        if (typeof Quotation !== 'undefined' && Quotation.recalcTax) {
            Quotation.recalcTax();
        }
        if (typeof Invoice !== 'undefined' && Invoice.recalcTax) {
            Invoice.recalcTax();
        }

        // --- Defer persistence + toast until after the UI has painted ---
        setTimeout(() => {
            Storage.saveSettings(settings);
            showToast(`GST toggled ${checked ? 'ON' : 'OFF'}`, 'success');
        }, 0);
    }

    function buildCurrencyOptionsHTML(currencies, selectedVal) {
        const hasSearch = currencies.length > 7;
        let html = '';
        if (hasSearch) {
            html += `
                <div class="search-box-wrapper" style="padding: 6px; border-bottom: 1px solid rgba(0,0,0,0.08); position: sticky; top: 0; background: #fff; z-index: 10;">
                    <input type="text" class="currency-search-input" placeholder="Search code..." style="width: 100%; padding: 6px 8px; font-size: 13px; border: 1px solid rgba(0,0,0,0.15); border-radius: 6px; box-sizing: border-box;">
                </div>
            `;
        }
        
        const optionsHtml = currencies.map(c => {
            const isSel = c === selectedVal;
            return `<div class="custom-option${isSel ? ' selected' : ''}" data-value="${c}">${c}</div>`;
        }).join('');
        
        if (hasSearch) {
            html += `<div class="options-scroll-container" style="max-height: 196px; overflow-y: auto;">${optionsHtml}</div>`;
        } else {
            html += optionsHtml;
        }
        
        return html;
    }

    function setupGroupedClientSelect(prefix, clients, selectedClientId, onSelectCallback) {
        const isPO = (prefix === 'po');
        const mainSelectId = isPO ? 'po-vendor-select' : (prefix + '-client-select');
        const mainOptionsId = isPO ? 'po-vendor-custom-options' : (prefix + '-client-custom-options');
        const subWrapperId = isPO ? 'po-sub-vendor-wrapper' : (prefix + '-sub-client-wrapper');
        const subOptionsId = isPO ? 'po-sub-vendor-custom-options' : (prefix + '-sub-client-custom-options');
        const subSelectId = isPO ? 'po-sub-vendor-select' : (prefix + '-sub-client-select');

        const mainSelect = document.getElementById(mainSelectId);
        if (!mainSelect) return;
        const mainWrapper = mainSelect.closest('.custom-select-wrapper');
        const subWrapper = document.getElementById(subWrapperId);
        const subSelect = document.getElementById(subSelectId);
        
        if (!mainWrapper || !subWrapper || !subSelect) return;

        // Group clients
        const uniqueGroups = [...new Set(clients.filter(c => c.group).map(c => c.group.trim()))].sort();
        const standaloneClients = clients.filter(c => !c.group);

        // Determine initial selection
        let initialMainVal = '';
        let initialSubVal = '';
        let activeGroup = '';

        if (selectedClientId) {
            const c = clients.find(x => x.id === selectedClientId);
            if (c) {
                if (c.group) {
                    activeGroup = c.group;
                    initialMainVal = 'GROUP:' + c.group;
                    initialSubVal = c.id;
                } else {
                    initialMainVal = c.id;
                }
            } else {
                // Try legacy name match
                const c2 = clients.find(x => x.name === selectedClientId);
                if (c2) {
                    if (c2.group) {
                        activeGroup = c2.group;
                        initialMainVal = 'GROUP:' + c2.group;
                        initialSubVal = c2.id;
                    } else {
                        initialMainVal = c2.id;
                    }
                }
            }
        }

        // Populate main select options
        const mainOptionsContainer = document.getElementById(mainOptionsId);
        if (mainOptionsContainer) {
            const defaultLabel = isPO ? '— Select a saved supplier —' : '— Select a saved client —';
            let html = `<div class="custom-option${!initialMainVal ? ' selected' : ''}" data-value="">${defaultLabel}</div>`;
            uniqueGroups.forEach(g => {
                html += `<div class="custom-option${initialMainVal === 'GROUP:' + g ? ' selected' : ''}" data-value="GROUP:${g}">${g}</div>`;
            });
            standaloneClients.forEach(c => {
                html += `<div class="custom-option${initialMainVal === c.id ? ' selected' : ''}" data-value="${c.id}">${c.name}</div>`;
            });
            mainOptionsContainer.innerHTML = html;

            // Update main select trigger text
            const triggerSpan = mainWrapper.querySelector('.custom-select-trigger span');
            if (triggerSpan) {
                if (initialMainVal) {
                    if (initialMainVal.startsWith('GROUP:')) {
                        triggerSpan.textContent = initialMainVal.substring(6);
                    } else {
                        const c = clients.find(x => x.id === initialMainVal);
                        triggerSpan.textContent = c ? c.name : defaultLabel;
                    }
                } else {
                    triggerSpan.textContent = defaultLabel;
                }
            }
        }

        // Rebuild subgroup select helper
        function rebuildSubSelect(groupName, selectedId) {
            const subClients = clients.filter(c => c.group === groupName);
            const subOptionsContainer = document.getElementById(subOptionsId);
            if (subOptionsContainer) {
                const subDefaultLabel = isPO ? '— Select Supplier —' : '— Select Client —';
                let html = `<div class="custom-option${!selectedId ? ' selected' : ''}" data-value="">${subDefaultLabel}</div>`;
                subClients.forEach(c => {
                    html += `<div class="custom-option${selectedId === c.id ? ' selected' : ''}" data-value="${c.id}">${c.subGroup || c.name}</div>`;
                });
                subOptionsContainer.innerHTML = html;
                
                const subTriggerSpan = subWrapper.querySelector('.custom-select-trigger span');
                if (subTriggerSpan) {
                    const selC = subClients.find(x => x.id === selectedId);
                    subTriggerSpan.textContent = selC ? (selC.subGroup || selC.name) : subDefaultLabel;
                }
            }
            subSelect.value = selectedId || '';
            subWrapper.style.display = 'block';
        }

        // Initialize subgroup select if active group exists
        if (activeGroup) {
            rebuildSubSelect(activeGroup, initialSubVal);
            mainSelect.value = initialSubVal;
        } else {
            subWrapper.style.display = 'none';
            subSelect.value = '';
            mainSelect.value = initialMainVal;
        }

        // Setup event handlers
        if (mainSelect._groupedHandler) {
            mainSelect.removeEventListener('change', mainSelect._groupedHandler);
        }
        if (subSelect._groupedHandler) {
            subSelect.removeEventListener('change', subSelect._groupedHandler);
        }

        let isInternalChange = false;

        mainSelect._groupedHandler = (e) => {
            if (isInternalChange) return;
            const val = mainSelect.value;
            if (val.startsWith('GROUP:')) {
                const gName = val.substring(6);
                rebuildSubSelect(gName, '');
                
                // Clear actual value and trigger callback
                isInternalChange = true;
                mainSelect.value = '';
                onSelectCallback();
                isInternalChange = false;
            } else {
                subWrapper.style.display = 'none';
                subSelect.value = '';
                onSelectCallback();
            }
        };

        subSelect._groupedHandler = (e) => {
            const val = subSelect.value;
            if (val) {
                isInternalChange = true;
                mainSelect.value = val;
                onSelectCallback();
                isInternalChange = false;
            }
        };

        mainSelect.addEventListener('change', mainSelect._groupedHandler);
        subSelect.addEventListener('change', subSelect._groupedHandler);
    }

    return {
        init,
        navigateTo,
        toggleInvoiceMenu,
        openInvoice,
        toggleQuotationMenu,
        openQuotation,
        openReceiptDashboard,
        showToast,
        showLoading,
        hideLoading,
        showConfirm,
        confirmIfDuplicateRef,
        uomOptionsHTML,
        buildCurrencyOptionsHTML,
        refreshUOMDropdowns,
        saveTaxAndGstSettings,
        saveCompanyHeader,
        previewCompanyLogo,
        removeCompanyLogo,
        openSettingDetail,
        closeSettingDetail,
        saveSessionSettings,
        savePdfPaths,
        saveSignatureSettings,
        previewSignatureImage,
        triggerBackup,
        handleChangePassword,
        handleImportBackup,
        resetDocumentCounters,
        setSerialStart,
        showAddContactModal,
        showAddCorrBankModal,
        showAddBenefBankModal,
        showAddDomesticBankModal,
        showAddUltBenefModal,
        renderContactsCard,
        editContact,
        deleteContact,
        showManageContactsModal,
        closeManageContactsModal,
        toggleGstFromForm,
        showUserManagementModal,
        closeUserManagementModal,
        switchUserMgmtTab,
        approveUser,
        rejectUser,
        removeUser,
        switchAdminTab,
        showUserActivityLog,
        closeUserActivityLogModal,
        filterActivityLog,
        clearActivityLog,
        toggleProfilePopup,
        openChangePassword,
        closeChangePassword,
        logoutFromPopup,
        onCreateGroupClick,
        cancelGroupingMode,
        saveCreatedGroup,
        toggleAllContactsSelection, toggleContactSelection,
        setContactsPage,
        setContactsPageSize,
        toggleGroupRows,
        deleteGroup,
        addNewContactFromManage,
        setupGroupedClientSelect
    };
})();

// --- Start app ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await App.init();
    } catch (e) {
        console.error('Failed to initialize app:', e);
    }
});

