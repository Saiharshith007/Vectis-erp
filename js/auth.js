/* ============================================
   Auth Module — Admin + User roles
   - Admin: single account (email set by VECTIS_ADMIN_EMAIL on the server)
   - Users: registered accounts stored in localStorage, pending admin approval
   - login(username, password, role) — role: 'admin' | 'user'
   ============================================ */

const Auth = (() => {
    // ── User store keys ──
    const USERS_KEY         = 'auth_users';          // approved users
    const PENDING_KEY       = 'auth_pending_users';  // awaiting admin approval

    let session = null; // { user, role, loggedInAt }

    // ── User store helpers ──
    function _getUsers() {
        let users = Storage.getUsers();
        if (users.length === 0) {
            try {
                const localUsers = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
                if (localUsers.length > 0) {
                    Storage.saveUsers(localUsers);
                    users = localUsers;
                }
            } catch(e) {}
        }
        return users;
    }
    function _saveUsers(users) {
        Storage.saveUsers(users);
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }
    function _getPending() {
        let pending = Storage.getPendingUsers();
        if (pending.length === 0) {
            try {
                const localPending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
                if (localPending.length > 0) {
                    Storage.savePendingUsers(localPending);
                    pending = localPending;
                }
            } catch(e) {}
        }
        return pending;
    }
    function _savePending(list) {
        Storage.savePendingUsers(list);
        localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    }

    // ────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────

    /**
     * Login.
     * @param {string} username
     * @param {string} password
     * @returns {Promise<true | 'pending' | false>}
     */
    /**
     * Login — authenticated by the SERVER, which issues an HttpOnly session
     * cookie. The login screen no longer protects data on its own; the server
     * gates every data endpoint behind this cookie.
     * @returns {Promise<true | 'pending' | 'locked' | false>}
     */
    async function login(username, password) {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ username, password })
            });
            if (res.status === 429) return 'locked';
            if (res.status === 403) {
                const d = await res.json().catch(() => ({}));
                if (d.pending) return 'pending';
                return false;
            }
            if (res.ok) {
                const d = await res.json();
                if (d.success) {
                    session = {
                        user: d.user, role: d.role, fullName: d.fullName || '',
                        loggedInAt: new Date().toISOString()
                    };
                    sessionStorage.setItem('vectis_is_logged_in', 'true');
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.error('Login request failed:', e);
            return false;
        }
    }

    /** Restore an existing server session on page load (survives refresh). */
    async function restoreSession() {
        try {
            const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
            if (res.ok) {
                const d = await res.json();
                if (d.authenticated) {
                    session = {
                        user: d.user, role: d.role, fullName: d.fullName || '',
                        loggedInAt: new Date().toISOString()
                    };
                    sessionStorage.setItem('vectis_is_logged_in', 'true');
                    return true;
                }
            }
        } catch (e) { /* server offline — stay logged out */ }
        session = null;
        sessionStorage.removeItem('vectis_is_logged_in');
        return false;
    }

    async function logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (e) { /* ignore */ }
        session = null;
        sessionStorage.removeItem('vectis_is_logged_in');
    }
    function isLoggedIn() { return session !== null; }
    function getUser() { return session ? session.user : null; }
    function getFullName() { return session ? (session.fullName || '') : ''; }
    function getRole() { return session ? session.role : null; }
    function isAdmin() { return session && session.role === 'admin'; }

    async function changePassword(oldPassword, newPassword) {
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ oldPassword, newPassword })
            });
            if (res.ok) {
                const d = await res.json();
                return d.success === true;
            }
            return false;
        } catch (e) {
            console.error('Password change failed:', e);
            return false;
        }
    }

    // ── Registration ──
    /**
     * Step 1: Send a verification OTP to the user's email.
     * The user must call verifyOtp() with the code to complete registration.
     * @returns {Promise<true | 'username_taken' | 'already_pending' | 'smtp_not_configured' | string | false>}
     */
    async function sendVerification({ username, password, fullName, email, department }) {
        try {
            const res = await fetch('/api/auth/send-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ username, password, fullName, email, department })
            });
            if (res.ok) {
                const d = await res.json();
                return d.success === true;
            }
            const d = await res.json().catch(() => ({}));
            if (d.error === 'username_taken')       return 'username_taken';
            if (d.error === 'already_pending')      return 'already_pending';
            if (d.error === 'smtp_not_configured')  return 'smtp_not_configured';
            return d.message || d.error || false;
        } catch (e) {
            console.error('Send verification failed:', e);
            return false;
        }
    }

    /**
     * Step 2: Verify the OTP and complete registration (user goes to pending queue).
     * @returns {Promise<true | 'invalid_otp' | 'otp_expired' | false>}
     */
    async function verifyOtp(email, otp) {
        try {
            const res = await fetch('/api/auth/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ email, otp })
            });
            if (res.ok) {
                const d = await res.json();
                return d.success === true;
            }
            const d = await res.json().catch(() => ({}));
            if (d.error === 'invalid_otp')  return 'invalid_otp';
            if (d.error === 'otp_expired')  return 'otp_expired';
            return false;
        } catch (e) {
            console.error('OTP verification failed:', e);
            return false;
        }
    }

    /**
     * Legacy direct registration (no email verification). Kept for backward compatibility.
     * @returns {Promise<true | 'username_taken' | 'already_pending'>}
     */
    async function registerUser({ username, password, fullName, email, department }) {
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ username, password, fullName, email, department })
            });
            if (res.ok) {
                const d = await res.json();
                return d.success === true;
            }
            const d = await res.json().catch(() => ({}));
            if (d.error === 'username_taken')   return 'username_taken';
            if (d.error === 'already_pending')  return 'already_pending';
            return d.error || false;
        } catch (e) {
            console.error('Registration request failed:', e);
            return false;
        }
    }

    /** Admin: get all pending registrations */
    function getPendingUsers() { return _getPending(); }

    /** Admin: approve a pending user by id */
    function approveUser(id) {
        const pending = _getPending();
        const idx = pending.findIndex(u => u.id === id);
        if (idx === -1) return false;
        const [user] = pending.splice(idx, 1);
        _savePending(pending);
        const users = _getUsers();
        users.push(user);
        _saveUsers(users);
        return true;
    }

    /** Admin: reject/delete a pending user by id */
    function rejectUser(id) {
        const pending = _getPending().filter(u => u.id !== id);
        _savePending(pending);
        return true;
    }

    /** Admin: get all approved users */
    function getApprovedUsers() { return _getUsers(); }

    /** Admin: remove an approved user */
    function removeUser(id) {
        _saveUsers(_getUsers().filter(u => u.id !== id));
        return true;
    }

    return {
        login, logout, isLoggedIn, restoreSession, getUser, getFullName, getRole, isAdmin,
        changePassword,
        sendVerification, verifyOtp, registerUser,
        getPendingUsers, approveUser, rejectUser,
        getApprovedUsers, removeUser
    };
})();
